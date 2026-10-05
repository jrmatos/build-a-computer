import type { Board, Level } from '@ground-up/schema';
import {
  CompileError,
  FastEngine,
  compile,
  runTest,
  type CaseResult,
  type Netlist,
  type SettleResult,
} from '@ground-up/sim-logic';
import type { LoadResult, SimApi, Snapshot } from './protocol';

/** Longest a run slice may block the worker, in ms (plan: runtime split). */
const SLICE_MS = 8;
const SNAPSHOT_MS = 1000 / 60;

/**
 * Owns all simulation state. Runs in a Web Worker in the app, and directly in
 * tests. Time comes from injected functions so tests stay deterministic.
 */
export class SimHost implements SimApi {
  private nl: Netlist | null = null;
  private engine: FastEngine | null = null;
  private last: SettleResult | null = null;
  private listener: ((s: Snapshot) => void) | null = null;
  private hz = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSnapshotAt = 0;
  private wantPower = true;
  private tickDebt = 0;
  private lastRunAt = 0;

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) =>
      setTimeout(fn, ms),
  ) {}

  subscribe(onSnapshot: (s: Snapshot) => void): void {
    this.listener = onSnapshot;
    this.emit(true);
  }

  load(board: Board): LoadResult {
    const switches = new Map<string, boolean>();
    if (this.engine) for (const p of this.engine.nl.parts) if (p.behavior.kind === 'switch') switches.set(p.id, this.engine.isSwitchOn(p.id));
    try {
      this.nl = compile(board);
    } catch (e) {
      this.nl = null;
      this.engine = null;
      this.emit(true);
      if (e instanceof CompileError) return { ok: false, error: e.message, diagnostics: [] };
      throw e;
    }
    // FastEngine is fuzzed tick-for-tick against ReferenceEngine (SIM-04).
    this.engine = new FastEngine(this.nl);
    // Keep switch positions across edits so the board does not flicker.
    for (const [id, on] of switches) if (this.nl.partIndex.has(id)) this.engine.setSwitch(id, on);
    this.last = this.wantPower ? this.engine.powerOn() : null;
    this.emit(true);
    return { ok: true, diagnostics: this.nl.diagnostics };
  }

  setValue(_partId: string, _value: number): void {
    // Multi-bit inputs: implemented with the bus engine.
  }

  press(partId: string, down: boolean): void {
    // Until buttons have their own engine support they act like a switch.
    if (this.nl?.partIndex.has(partId)) this.setSwitch(partId, down);
  }

  memory(_partId: string): number[] {
    return [];
  }

  watch(_wireIds: string[]): void {
    // Waveform recording: implemented with the bus engine.
  }

  history(): { ticks: number[]; values: Record<string, { w: number; v: number; x: number }[]> } {
    return { ticks: [], values: {} };
  }

  setSwitch(partId: string, on: boolean): void {
    if (!this.engine) return;
    this.last = this.engine.setSwitch(partId, on);
    this.emit(true);
  }

  step(ticks: number): void {
    if (!this.engine) return;
    for (let i = 0; i < ticks; i++) this.last = this.engine.tick();
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
    if (on) this.last = this.engine.powerOn();
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

  async runTests(level: Level, onCase: (r: CaseResult) => void | Promise<void>): Promise<{ passed: number; total: number }> {
    if (!this.nl) return { passed: 0, total: 0 };
    let passed = 0;
    let total = 0;
    for (const t of level.tests) {
      for (const r of runTest(this.nl, t)) {
        total++;
        if (r.pass) passed++;
        // Awaited so a proxied callback lands before the final result.
        await onCase(r);
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
      this.last = this.engine.tick();
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
    const wires: Record<string, number> = {};
    const pins: Record<string, number> = {};
    const unstablePins: string[] = [];
    const contentionPins: string[] = [];
    if (nl && e) {
      for (const [id, n] of nl.wireNet) wires[id] = e.net[n]!;
      const unstable = new Set(this.last?.unstableNets ?? []);
      const contention = new Set(this.last?.contentionNets ?? []);
      for (const [key, n] of nl.pinNet) {
        pins[key] = e.net[n]!;
        if (unstable.has(n)) unstablePins.push(key);
        if (contention.has(n)) contentionPins.push(key);
      }
    }
    return {
      wires,
      buses: {},
      busPins: {},
      switchValues: {},
      pins,
      switchesOn: nl && e ? nl.parts.filter((p) => p.behavior.kind === 'switch' && e.isSwitchOn(p.id)).map((p) => p.id) : [],
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
