import type { Board, ChipMap, Level } from '@ground-up/schema';
import {
  ChipCycleError,
  CompileError,
  FastEngine,
  assertRunnable,
  compile,
  flattenBoard,
  loadProgram,
  runTest,
  type CaseResult,
  type CheckOptions,
  type Netlist,
  type SettleResult,
} from '@ground-up/sim-logic';
import type { BusValue, LoadOptions, LoadResult, SimApi, Snapshot } from './protocol';

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

/**
 * Owns all simulation state. Runs in a Web Worker in the app, and directly in
 * tests. Time comes from injected functions so tests stay deterministic.
 */
export class SimHost implements SimApi {
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

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) =>
      setTimeout(fn, ms),
  ) {}

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
   * callbacks land in order). 'program' tests compile a copy of `board` with
   * the program loaded into its ROM; without `board` they fail with a message.
   * Each test gets `budgetMs` of wall-clock time (default 10 s) and runs with
   * the level's power-on mode.
   */
  async runTests(
    level: Level,
    onCase: (r: CaseResult) => void | Promise<void>,
    board?: Board,
    budgetMs = 10_000,
  ): Promise<{ passed: number; total: number }> {
    // Without a board, fall back to the last loaded one (already flattened).
    if (board) {
      try {
        board = flattenBoard(board, this.chips).board;
      } catch (e) {
        if (!(e instanceof ChipCycleError)) throw e;
        await onCase({ index: 0, pass: false, inputs: {}, expected: {}, actual: {}, message: e.message });
        return { passed: 0, total: 1 };
      }
    } else board = this.flatBoard ?? undefined;
    if (!this.nl && !board) return { passed: 0, total: 0 };
    let passed = 0;
    let total = 0;
    const emit = async (r: CaseResult): Promise<void> => {
      total++;
      if (r.pass) passed++;
      await onCase(r);
    };
    const opts: CheckOptions = {
      powerOnState: level.power,
      seed: 1,
      createEngine: (nl, o) => new FastEngine(nl, o),
      now: this.now,
      budgetMs,
    };
    for (const [ti, t] of level.tests.entries()) {
      let nl: Netlist;
      try {
        if (t.kind === 'program') {
          if (!board) {
            await emit({ index: 0, pass: false, inputs: {}, expected: t.expect, actual: {}, kind: t.kind, test: ti, message: 'Could not load the program: the board was not sent with the test run.' });
            continue;
          }
          nl = compile(loadProgram(board, t));
        } else {
          nl = this.nl ?? compile(board!);
        }
      } catch (e) {
        if (!(e instanceof CompileError)) throw e;
        await emit({ index: 0, pass: false, inputs: {}, expected: {}, actual: {}, kind: t.kind, test: ti, message: e.message });
        continue;
      }
      try {
        for (const r of runTest(nl, t, opts)) await emit({ ...r, test: ti });
      } catch (e) {
        await emit({ index: 0, pass: false, inputs: {}, expected: {}, actual: {}, kind: t.kind, test: ti, message: `The simulator failed while testing: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    return { passed, total };
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
