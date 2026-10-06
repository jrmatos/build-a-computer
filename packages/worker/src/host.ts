import type { Board, ChipMap, Level } from '@build-a-computer/schema';
import {
  ChipCycleError,
  CompileError,
  FastEngine,
  assertRunnable,
  compile,
  flattenBoard,
  loadProgram,
  Rig,
  debugPlan,
  stepCase,
  type CaseResult,
  type DebugPlan,
  type DebugTrace,
  type EngineOptions,
  type Netlist,
  type SettleResult,
} from '@build-a-computer/sim-logic';
import type { BusValue, JsApi, JsCallOptions, JsDebugResult, JsRunState, LoadOptions, LoadResult, RvApi, RvLoadOptions, RvLoadResult, RvSnapshot, RvTranslation, SimApi, Snapshot } from './protocol';
import type { RvHost } from './rv-host';
import { levelCheckers } from './checkers';
import { runLevel, runLevelCase } from '@build-a-computer/platform-core/checker';
import type { JsHost, JsHostOptions } from './js-host';

/**
 * Wall-clock budget per test. It only stops circuits that never finish; exhaustive
 * 8-bit tests (65,536 cases) need headroom on slow laptops.
 */
export const DEFAULT_TEST_BUDGET_MS = 30_000;

/*
 * The RISC-V subsystem (rv-host: rv-check, asm, cc, libc, rv32) and the
 * Track 2 subsystem (js-host: js-check, tensor) load on first use, so a board
 * level's worker script carries only the logic simulator. Each module is
 * imported once per worker and shared by every SimHost.
 */
type RvModule = typeof import('./rv-host') & { runRiscvTest: typeof import('@build-a-computer/rv-check').runRiscvTest };
type JsModule = typeof import('./js-host') & { runJsTest: typeof import('@build-a-computer/js-check').runJsTest };
let rvModule: Promise<RvModule> | null = null;
let jsModule: Promise<JsModule> | null = null;

/** Load the RISC-V subsystem (code levels). */
export function loadRvModule(): Promise<RvModule> {
  rvModule ??= Promise.all([import('./rv-host'), import('@build-a-computer/rv-check')]).then(([host, check]) => ({ ...host, runRiscvTest: check.runRiscvTest }));
  rvModule.catch(() => (rvModule = null));
  return rvModule;
}

/** Load the Track 2 subsystem (js levels). */
export function loadJsModule(): Promise<JsModule> {
  jsModule ??= Promise.all([import('./js-host'), import('@build-a-computer/js-check')]).then(([host, check]) => ({ ...host, runJsTest: check.runJsTest }));
  jsModule.catch(() => (jsModule = null));
  return jsModule;
}

/** Longest a run slice may block the worker, in ms (plan: runtime split). */
const SLICE_MS = 8;
const SNAPSHOT_MS = 1000 / 60;
/** Ticks kept for the waveform panel. */
export const HISTORY_TICKS = 4096;

/** Precomputed lookups so a snapshot is a few typed-array passes (boards of ~5,000 parts at 60 Hz). */
interface View {
  wireIds: string[];
  wireNets: Int32Array;
  pinKeys: string[];
  pinNets: Int32Array;
  /** Indexes into wireIds / pinKeys of entries wider than 1 bit. */
  wideWires: Int32Array;
  widePins: Int32Array;
  switches: string[];
  wideSwitches: string[];
  buttons: string[];
}

interface Track {
  net: number;
  w: number;
  v: Uint32Array;
  x: Uint32Array;
}

function makeView(nl: Netlist): View {
  const wireIds = [...nl.wireNet.keys()];
  const wireNets = Int32Array.from(wireIds, (id) => nl.wireNet.get(id)!);
  const pinKeys = [...nl.pinNet.keys()];
  const pinNets = Int32Array.from(pinKeys, (k) => nl.pinNet.get(k)!);
  const wide = (nets: Int32Array) => Int32Array.from([...nets.keys()].filter((i) => nl.netWidth[nets[i]!]! > 1));
  const sw = nl.parts.filter((p) => p.kind === 'switch');
  return {
    wireIds,
    wireNets,
    pinKeys,
    pinNets,
    wideWires: wide(wireNets),
    widePins: wide(pinNets),
    switches: sw.filter((p) => p.outputWidths[0] === 1).map((p) => p.id),
    wideSwitches: sw.filter((p) => p.outputWidths[0]! > 1).map((p) => p.id),
    buttons: nl.parts.filter((p) => p.kind === 'button').map((p) => p.id),
  };
}

/** What debugStart returns: the recorded case and the frame the live board was left at. */
export type CaseDebugStart = { ok: true; trace: DebugTrace; frame: number; tick: number } | { ok: false; error: string };

/** Case debugger calls (board levels). SimHost implements them; the app reaches them over Comlink. */
export interface CaseDebugApi {
  debugStart(level: Level, testIndex: number, caseIndex: number, inputs?: Record<string, number>, board?: Board): CaseDebugStart;
  debugSeek(frame: number): { frame: number; tick: number } | null;
  debugEnd(): void;
}

/**
 * Owns all simulation state. Runs in a Web Worker in the app, and directly in
 * tests. Time comes from injected functions so tests stay deterministic.
 */
export class SimHost implements SimApi, RvApi, JsApi {
  /** The RISC-V debugger for code levels (RvApi delegates here), created on the first rvLoad. */
  private rv: RvHost | null = null;
  private rvReady: Promise<RvHost> | null = null;
  private rvListener: ((s: RvSnapshot) => void) | null = null;
  /** Track 2 JavaScript runs (JsApi delegates here), created on first use. */
  private js: JsHost | null = null;
  private jsReady: Promise<JsHost> | null = null;
  private jsListener: ((s: JsRunState) => void) | null = null;
  private nl: Netlist | null = null;
  private engine: FastEngine | null = null;
  private view: View | null = null;
  /** The last loaded board after flattening (program tests patch its ROM). */
  private flatBoard: Board | null = null;
  private chips: ChipMap = {};
  private loadOpts: LoadOptions = {};
  private last: SettleResult | null = null;
  private listener: ((s: Snapshot) => void) | null = null;
  private hz = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSnapshotAt = 0;
  private wantPower = true;
  private tickDebt = 0;
  private lastRunAt = 0;
  // Waveform ring buffer.
  private watched: string[] = [];
  private tracks = new Map<string, Track>();
  private histTicks = new Float64Array(HISTORY_TICKS);
  private histLen = 0;
  private histHead = 0;
  /** Case debugger: the case being replayed on the live engine, and the frame shown. */
  private dbg: { plan: DebugPlan; nl: Netlist; opts: EngineOptions; frame: number } | null = null;
  private dbgBusy = false;
  /** Test checkers by level mode (ADR-010). */
  private readonly checkers = levelCheckers(
    { nl: () => this.nl, flatBoard: () => this.flatBoard, chips: () => this.chips, now: () => this.now() },
    loadRvModule,
    loadJsModule,
    () => this.js?.options ?? this.jsOptions,
  );

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) =>
      setTimeout(fn, ms),
    private readonly jsOptions: JsHostOptions = {},
  ) {}

  /** The RvHost, loading the RISC-V subsystem on first use. */
  private rvHost(): Promise<RvHost> {
    this.rvReady ??= loadRvModule().then(({ RvHost }) => {
      const rv = new RvHost(this.now, this.schedule);
      if (this.rvListener) rv.rvSubscribe(this.rvListener);
      return (this.rv = rv);
    });
    this.rvReady.catch(() => (this.rvReady = null));
    return this.rvReady;
  }

  /** Run `fn` on the RvHost now, or in order once it is loading; nothing to do before the first rvLoad. */
  private withRv(fn: (rv: RvHost) => void): void {
    if (this.rv) fn(this.rv);
    else if (this.rvReady) void this.rvReady.then(fn, () => undefined);
  }

  /** The JsHost, loading the Track 2 subsystem on first use. */
  private jsHost(): Promise<JsHost> {
    this.jsReady ??= loadJsModule().then(({ JsHost }) => {
      const js = new JsHost(this.jsOptions, this.now, this.schedule);
      if (this.jsListener) js.jsSubscribe(this.jsListener);
      return (this.js = js);
    });
    this.jsReady.catch(() => (this.jsReady = null));
    return this.jsReady;
  }

  // JsApi: Track 2 levels, handled by JsHost.
  async jsCall(
    source: string,
    level: Level,
    entry: string,
    args: unknown[],
    opts?: JsCallOptions,
  ): Promise<{ ok: boolean; result?: unknown; error?: { message: string; line?: number } }> {
    return (await this.jsHost()).jsCall(source, level, entry, args, opts);
  }
  async jsDebugCall(source: string, level: Level, testIndex: number): Promise<JsDebugResult | null> {
    return (await this.jsHost()).jsDebugCall(source, level, testIndex);
  }
  jsStop(): void {
    if (this.js) this.js.jsStop();
    else if (this.jsReady) void this.jsReady.then((js) => js.jsStop(), () => undefined);
  }
  jsSubscribe(onState: (s: JsRunState) => void): void {
    this.jsListener = onState;
    this.js?.jsSubscribe(onState);
  }

  // RvApi: code levels (Phase 6+), handled by RvHost.
  async rvLoad(source: string, level: Level, opts?: RvLoadOptions): Promise<RvLoadResult> {
    return (this.rv ?? (await this.rvHost())).rvLoad(source, level, opts);
  }
  rvRun(): void {
    this.withRv((rv) => rv.rvRun());
  }
  rvPause(): void {
    this.withRv((rv) => rv.rvPause());
  }
  rvStep(n: number): void {
    this.withRv((rv) => rv.rvStep(n));
  }
  rvStepLine(): void {
    this.withRv((rv) => rv.rvStepLine());
  }
  rvReset(): void {
    this.withRv((rv) => rv.rvReset());
  }
  rvSetBreakpoints(lines: number[]): void {
    this.withRv((rv) => rv.rvSetBreakpoints(lines));
  }
  rvInput(text: string): void {
    this.withRv((rv) => rv.rvInput(text));
  }
  rvMemory(addr: number, length: number): Uint8Array {
    // Before the first rvLoad there is no machine: zeros, as RvHost returns without one.
    return this.rv?.rvMemory(addr, length) ?? new Uint8Array(Math.max(0, Math.min(Math.floor(length), 1 << 20)));
  }
  rvReadWords(addr: number, count: number, stride?: number): Uint32Array {
    return this.rv?.rvReadWords(addr, count, stride) ?? new Uint32Array(0);
  }
  rvTranslate(va: number, satp?: number, access?: 'fetch' | 'load' | 'store'): RvTranslation | null {
    return this.rv?.rvTranslate(va, satp, access) ?? null;
  }
  rvDisk(sector: number, count: number): Uint8Array {
    return this.rv?.rvDisk(sector, count) ?? new Uint8Array(0);
  }
  rvFramebuffer(): { pixels: Uint8Array; palette: Uint32Array } | null {
    return this.rv?.rvFramebuffer() ?? null;
  }
  rvSubscribe(onSnapshot: (s: RvSnapshot) => void): void {
    this.rvListener = onSnapshot;
    this.rv?.rvSubscribe(onSnapshot);
  }

  subscribe(onSnapshot: (s: Snapshot) => void): void {
    this.listener = onSnapshot;
    this.emit(true);
  }

  /**
   * Flatten custom chips, compile, and power on. Switch values survive
   * reloads so the board does not flicker while editing.
   */
  load(board: Board, chips: ChipMap = {}, opts: LoadOptions = {}): LoadResult {
    const values = new Map<string, number>();
    if (this.engine) for (const p of this.engine.nl.parts) if (p.kind === 'switch') values.set(p.id, this.engine.switchValue(p.id));
    this.chips = chips;
    this.loadOpts = opts;
    this.engine = null;
    this.view = null;
    this.last = null;
    try {
      this.flatBoard = flattenBoard(board, chips).board;
      this.nl = compile(this.flatBoard);
      assertRunnable(this.nl);
    } catch (e) {
      const diagnostics = this.nl && !this.nl.canRun ? this.nl.diagnostics : [];
      if (!(this.nl && !this.nl.canRun)) this.nl = null;
      this.resetHistory();
      this.emit(true);
      if (e instanceof CompileError || e instanceof ChipCycleError) return { ok: false, error: e.message, diagnostics };
      throw e;
    }
    // FastEngine is fuzzed tick-for-tick against ReferenceEngine (SIM-04).
    this.engine = new FastEngine(this.nl, {
      ...(opts.power ? { powerOnState: opts.power } : {}),
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    });
    this.view = makeView(this.nl);
    for (const [id, v] of values) {
      const i = this.nl.partIndex.get(id);
      if (i !== undefined && this.nl.parts[i]!.kind === 'switch') this.engine.setValue(id, v);
    }
    this.last = this.wantPower ? this.engine.powerOn() : null;
    this.watch(this.watched);
    this.emit(true);
    return { ok: true, diagnostics: this.nl.diagnostics };
  }

  setValue(partId: string, value: number): void {
    if (!this.engine || !this.isInput(partId)) return;
    this.last = this.engine.setValue(partId, value >>> 0);
    this.emit(true);
  }

  press(partId: string, down: boolean): void {
    if (!this.engine || !this.isInput(partId)) return;
    this.last = this.engine.press(partId, down);
    this.emit(true);
  }

  memory(partId: string): number[] {
    return this.engine?.memory(partId) ?? [];
  }

  /** Choose the wires recorded every tick; recording restarts. */
  watch(wireIds: string[]): void {
    this.watched = [...wireIds];
    this.tracks.clear();
    this.resetHistory();
    const nl = this.nl;
    if (!nl) return;
    for (const id of this.watched) {
      const net = nl.wireNet.get(id);
      if (net === undefined) continue;
      this.tracks.set(id, { net, w: nl.netWidth[net]!, v: new Uint32Array(HISTORY_TICKS), x: new Uint32Array(HISTORY_TICKS) });
    }
    // While a case is being debugged, replay it so the new lanes show the whole case.
    if (this.dbg && !this.dbgBusy && this.dbg.nl === nl) this.debugSeek(this.dbg.frame);
  }

  /**
   * Case debugger: load one test case onto the live board. Compiles `board`
   * (or the last loaded one; program tests get the program in their ROM),
   * records the whole case on a scratch engine, then replays it on the live
   * engine up to the case's checkpoint, so the canvas, probes, memory and
   * waveform panels all show the case. Runs with the level's power-on mode
   * and the checkers' seed. The next `load` returns to the normal board.
   */
  debugStart(level: Level, testIndex: number, caseIndex: number, inputs?: Record<string, number>, board?: Board): CaseDebugStart {
    const test = level.tests[testIndex];
    if (!test) return { ok: false, error: 'This test does not exist.' };
    const plan = debugPlan(test, caseIndex, inputs);
    if ('error' in plan) return { ok: false, error: plan.error };
    let flat: Board | null;
    let nl: Netlist;
    try {
      flat = board ? flattenBoard(board, this.chips).board : this.flatBoard;
      if (!flat) return { ok: false, error: 'There is no board loaded.' };
      if (test.kind === 'program') flat = loadProgram(flat, test);
      nl = compile(flat);
      assertRunnable(nl);
    } catch (e) {
      if (e instanceof CompileError || e instanceof ChipCycleError) return { ok: false, error: e.message };
      throw e;
    }
    this.pause();
    const opts: EngineOptions = { ...(level.power ? { powerOnState: level.power } : {}), seed: 1 };
    const { trace } = stepCase(new Rig(nl, { ...opts, createEngine: (n, o) => new FastEngine(n, o) }), plan);
    this.dbg = { plan, nl, opts, frame: 0 };
    const focus = trace.checks[Math.min(trace.focus, trace.checks.length - 1)];
    const at = this.debugSeek(focus?.frame ?? Math.max(0, trace.frames.length - 1))!;
    return { ok: true, trace, frame: at.frame, tick: at.tick };
  }

  /** Case debugger: show frame `frame` of the case (replayed from power on). */
  debugSeek(frame: number): { frame: number; tick: number } | null {
    const d = this.dbg;
    if (!d) return null;
    this.dbgBusy = true;
    try {
      this.pause();
      this.wantPower = true;
      const made: { engine?: FastEngine } = {};
      const rig = new Rig(d.nl, { ...d.opts, createEngine: (n, o) => (made.engine = new FastEngine(n, o)) });
      this.nl = d.nl;
      this.engine = made.engine!;
      this.view = makeView(d.nl);
      this.last = null;
      this.watch(this.watched);
      const r = stepCase(rig, d.plan, { until: Math.max(0, frame), record: false, tick: () => this.tickOnce() });
      d.frame = Math.max(0, r.frame);
      this.last = r.last;
      this.emit(true);
      return { frame: d.frame, tick: this.engine.ticks };
    } finally {
      this.dbgBusy = false;
    }
  }

  /** Case debugger: stop replaying (the app reloads the board afterwards). */
  debugEnd(): void {
    this.dbg = null;
  }

  history(): { ticks: number[]; values: Record<string, BusValue[]> } {
    const ticks: number[] = [];
    const values: Record<string, BusValue[]> = {};
    const first = (this.histHead - this.histLen + HISTORY_TICKS) % HISTORY_TICKS;
    for (const id of this.tracks.keys()) values[id] = [];
    for (let k = 0; k < this.histLen; k++) {
      const i = (first + k) % HISTORY_TICKS;
      ticks.push(this.histTicks[i]!);
      for (const [id, t] of this.tracks) values[id]!.push({ w: t.w, v: t.v[i]!, x: t.x[i]! });
    }
    return { ticks, values };
  }

  private isInput(partId: string): boolean {
    const i = this.nl?.partIndex.get(partId);
    const k = i === undefined ? undefined : this.nl!.parts[i]!.kind;
    return k === 'switch' || k === 'button';
  }

  private resetHistory(): void {
    this.histLen = 0;
    this.histHead = 0;
  }

  /** One engine tick, recorded for watched wires. */
  private tickOnce(): SettleResult {
    const e = this.engine!;
    const r = e.tick();
    if (this.tracks.size) {
      const i = this.histHead;
      this.histTicks[i] = e.ticks;
      for (const t of this.tracks.values()) {
        t.v[i] = e.netV[t.net]!;
        t.x[i] = e.netX[t.net]!;
      }
      this.histHead = (i + 1) % HISTORY_TICKS;
      if (this.histLen < HISTORY_TICKS) this.histLen++;
    }
    return r;
  }

  setSwitch(partId: string, on: boolean): void {
    if (!this.engine || !this.isInput(partId)) return;
    this.last = this.engine.setSwitch(partId, on);
    this.emit(true);
  }

  step(ticks: number): void {
    if (!this.engine) return;
    for (let i = 0; i < ticks; i++) this.last = this.tickOnce();
    this.emit(true);
  }

  run(hz: number): void {
    this.hz = Math.max(0.5, Math.min(hz, 100_000));
    this.tickDebt = 0;
    this.lastRunAt = this.now();
    if (!this.timer) this.loop();
    this.emit(true);
  }

  pause(): void {
    this.hz = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.emit(true);
  }

  power(on: boolean): void {
    this.wantPower = on;
    if (!this.engine) return;
    if (on) {
      this.resetHistory();
      this.last = this.engine.powerOn();
    }
    else {
      this.engine.powerOff();
      this.last = null;
    }
    this.emit(true);
  }

  reset(): void {
    this.power(false);
    this.power(true);
  }

  /**
   * Run every test of `level`, streaming each case (awaited, so proxied
   * callbacks land in order). Dispatches through the level mode's checker
   * (checkers.ts, ADR-010): board levels test `board` (else the last loaded
   * one) on sim-logic, 'program' tests with the program in its ROM; code
   * levels run each 'riscv' test on the RV32 machine with the player's
   * `source`; js levels run each 'js' test in a fresh sandbox. Each test gets
   * `budgetMs` of wall-clock time and runs with the level's power-on mode.
   */
  async runTests(
    level: Level,
    onCase: (r: CaseResult) => void | Promise<void>,
    board?: Board,
    budgetMs = DEFAULT_TEST_BUDGET_MS,
    source?: string,
  ): Promise<{ passed: number; total: number }> {
    return runLevel(this.checkers.for(level), level, { board, source: source ?? '', budgetMs }, onCase);
  }

  /**
   * "Run this case": run only case `caseIndex` of `level.tests[testIndex]` and
   * return exactly what a full `runTests` reports for that case (tagged with
   * `test`). Board tests replay the checker from power on (sequence: every step
   * up to `caseIndex`; exhaustive/random: the same vectors in order); a
   * 'program', 'riscv' or 'js' test is one case (index 0), run on its own.
   * Same `board`, `budgetMs` and `source` rules as runTests.
   */
  async runCase(level: Level, testIndex: number, caseIndex: number, board?: Board, budgetMs = DEFAULT_TEST_BUDGET_MS, source?: string): Promise<CaseResult> {
    return runLevelCase(this.checkers.for(level), level, testIndex, caseIndex, { board, source: source ?? '', budgetMs });
  }

  /** Run ticks for at most one slice, then yield so pause always works (E-SIM-10). */
  private loop = (): void => {
    this.timer = null;
    if (!this.hz || !this.engine) return;
    const start = this.now();
    this.tickDebt += ((start - this.lastRunAt) / 1000) * this.hz;
    this.lastRunAt = start;
    while (this.tickDebt >= 1 && this.now() - start < SLICE_MS) {
      this.last = this.tickOnce();
      this.tickDebt--;
      if (!this.last.stable) break;
    }
    // Drop backlog we could not run; the clock slows rather than freezing the UI.
    this.tickDebt = Math.min(this.tickDebt, this.hz);
    this.emit(false);
    this.timer = this.schedule(this.loop, Math.max(1, Math.min(SNAPSHOT_MS, 1000 / this.hz)));
  };

  private emit(force: boolean): void {
    if (!this.listener) return;
    const t = this.now();
    if (!force && t - this.lastSnapshotAt < SNAPSHOT_MS) return;
    this.lastSnapshotAt = t;
    this.listener(this.snapshot());
  }

  snapshot(): Snapshot {
    const nl = this.nl;
    const e = this.engine;
    const view = this.view;
    const wires: Record<string, number> = {};
    const pins: Record<string, number> = {};
    const buses: Record<string, BusValue> = {};
    const busPins: Record<string, BusValue> = {};
    const switchValues: Record<string, number> = {};
    const switchesOn: string[] = [];
    const unstablePins: string[] = [];
    const contentionPins: string[] = [];
    if (nl && e && view) {
      const { netV, netX } = e;
      // 1-bit summary per net: 1 if any bit is 1, else 2 if any bit is X, else 0.
      const sum = new Uint8Array(nl.netCount);
      for (let n = 0; n < sum.length; n++) sum[n] = netV[n] !== 0 ? 1 : netX[n] !== 0 ? 2 : 0;
      const { wireIds, wireNets, pinKeys, pinNets } = view;
      for (let i = 0; i < wireIds.length; i++) wires[wireIds[i]!] = sum[wireNets[i]!]!;
      for (let i = 0; i < pinKeys.length; i++) pins[pinKeys[i]!] = sum[pinNets[i]!]!;
      for (const i of view.wideWires) buses[wireIds[i]!] = e.netSignal(wireNets[i]!);
      for (const i of view.widePins) busPins[pinKeys[i]!] = e.netSignal(pinNets[i]!);
      for (const id of view.wideSwitches) switchValues[id] = e.switchValue(id);
      for (const id of view.switches) if (e.isSwitchOn(id)) switchesOn.push(id);
      for (const id of view.buttons) if (e.isSwitchOn(id)) switchesOn.push(id);
      const unstable = new Set(this.last?.unstableNets ?? []);
      const contention = new Set(this.last?.contentionNets ?? []);
      if (unstable.size || contention.size) {
        for (let i = 0; i < pinKeys.length; i++) {
          if (unstable.has(pinNets[i]!)) unstablePins.push(pinKeys[i]!);
          if (contention.has(pinNets[i]!)) contentionPins.push(pinKeys[i]!);
        }
      }
    }
    return {
      wires,
      buses,
      busPins,
      switchValues,
      pins,
      switchesOn,
      powered: e?.isPowered ?? false,
      running: this.hz > 0,
      ticks: e?.ticks ?? 0,
      clock: e?.clock ?? 0,
      stable: this.last?.stable ?? true,
      unstablePins,
      contentionPins,
    };
  }
}
