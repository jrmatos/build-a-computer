import type { TestSpec } from '@build-a-computer/schema';
import type { CompiledPart, Netlist } from '../compile';
import { ReferenceEngine, type EngineOptions, type SettleResult } from '../engine';
import { V1, fromValue, mask, type Signal, type Value } from '../values';

export type TestKind = TestSpec['kind'];

/**
 * One streamed test result. Everything beyond `index`/`pass`/`inputs`/
 * `expected`/`actual`/`message` was added by LVL-07 and is optional so older
 * readers keep working.
 */
export interface CaseResult {
  /** Case number within its test, from 0. */
  index: number;
  pass: boolean;
  /** Input values by label (unsigned integers). */
  inputs: Record<string, number>;
  /** Expected output values by label (unsigned integers). */
  expected: Record<string, number>;
  /** Actual output values by label: decimal strings ('0', '1', '255') or 'X' when any bit is unknown. */
  actual: Record<string, string>;
  /** Plain-English explanation of the first problem (or a note on a pass). */
  message?: string;
  /** Which checker produced this case. */
  kind?: TestKind;
  /** Index of the test inside `level.tests` (set by the worker). */
  test?: number;
  /** 'sequence': index of the step this case checks. */
  step?: number;
  /**
   * 'sequence': clock half-periods since the last power on, after this step.
   * 'program': full clock cycles the program ran.
   */
  cycle?: number;
  /** Actual output values as numbers; null when any bit is unknown or the output is missing. For UIs. */
  actualNum?: Record<string, number | null>;
  /** 'program': true when the HALT output went to 1 within the budget. */
  halted?: boolean;
  /** 'program': short summary of the run, e.g. "Halted after 42 of 1000 cycles." */
  summary?: string;
}

/**
 * The engine surface the checkers drive. ReferenceEngine and FastEngine both
 * match it; the multi-bit methods are optional until every engine has them.
 */
export interface CheckerEngine {
  readonly nl: Netlist;
  powerOn(): SettleResult;
  powerOff(): void;
  tick(): SettleResult;
  setSwitch(partId: string, on: boolean): SettleResult;
  readPin(partId: string, pin: string): Value;
  setValue?(partId: string, value: number): SettleResult | void;
  press?(partId: string, down: boolean): SettleResult | void;
  readSignal?(partId: string, pin: string): Signal;
}

export interface CheckOptions extends EngineOptions {
  /** Builds the engine for each test. Default: ReferenceEngine. The worker passes FastEngine. */
  createEngine?: (nl: Netlist, opts: EngineOptions) => CheckerEngine;
  /** Monotonic clock in ms, injected by the worker (sim packages never read the clock). */
  now?: () => number;
  /** Wall-clock budget for one test in ms. Only enforced when `now` is given. */
  budgetMs?: number;
}

/** Wall-clock budget tracker. Without `now` it never expires (deterministic tests). */
export class Budget {
  private readonly start: number;
  constructor(private readonly opts: CheckOptions) {
    this.start = opts.now ? opts.now() : 0;
  }
  expired(): boolean {
    const { now, budgetMs } = this.opts;
    if (!now || budgetMs === undefined || !Number.isFinite(budgetMs)) return false;
    return now() - this.start > budgetMs;
  }
  get seconds(): string {
    return ((this.opts.budgetMs ?? 0) / 1000).toLocaleString('en', { maximumFractionDigits: 1 });
  }
}

const settled = (r: SettleResult | void): SettleResult =>
  r && typeof r === 'object' && 'stable' in r ? r : { stable: true, unstableNets: [], contentionNets: [], events: 0 };

export const UNSTABLE_MESSAGE =
  'The circuit never settled: a signal keeps oscillating. Look for a loop without a latch.';

/** Format a signal for `actual`: decimal, or 'X' when any bit is unknown. */
export const showSignal = (s: Signal | undefined): string => (!s || s.x !== 0 ? 'X' : String(s.v >>> 0));

interface Port {
  id: string;
  part: CompiledPart;
}

/**
 * A powered engine plus label lookups: sets labelled inputs (1-bit through
 * setSwitch, wider through setValue) and reads labelled outputs as Signals.
 */
export class Rig {
  readonly engine: CheckerEngine;
  private readonly widths = new Map<string, number>();

  constructor(
    readonly nl: Netlist,
    opts: CheckOptions,
  ) {
    const engineOpts: EngineOptions = {
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      ...(opts.powerOnState !== undefined ? { powerOnState: opts.powerOnState } : {}),
      ...(opts.eventBudgetPerPart !== undefined ? { eventBudgetPerPart: opts.eventBudgetPerPart } : {}),
      ...(opts.maxEventsPerSettle !== undefined ? { maxEventsPerSettle: opts.maxEventsPerSettle } : {}),
    };
    this.engine = opts.createEngine ? opts.createEngine(nl, engineOpts) : new ReferenceEngine(nl, engineOpts);
  }

  input(label: string): Port | undefined {
    const part = this.nl.parts.find(
      (p) => p.label === label && (p.type === 'switch' || p.type === 'button' || p.behavior?.kind === 'switch'),
    );
    return part && { id: part.id, part };
  }

  output(label: string): Port | undefined {
    const part = this.nl.parts.find((p) => p.label === label && (p.type === 'lamp' || p.behavior?.kind === 'lamp'));
    return part && { id: part.id, part };
  }

  /** Width of a labelled port: the compiled width, else what the engine reports, else 1. */
  width(port: Port, pin: string): number {
    const cached = this.widths.get(port.id);
    if (cached !== undefined) return cached;
    const p = port.part as CompiledPart & { width?: number; props?: { width?: number } };
    let w: number | undefined = p.width ?? p.props?.width;
    if (w === undefined && typeof this.engine.readSignal === 'function') {
      try {
        w = this.engine.readSignal(port.id, pin).w;
      } catch {
        w = undefined;
      }
    }
    const width = w && w >= 1 && w <= 32 ? w : 1;
    this.widths.set(port.id, width);
    return width;
  }

  /** True when this engine can drive and read multi-bit ports. */
  get multiBit(): boolean {
    return typeof this.engine.setValue === 'function' && typeof this.engine.readSignal === 'function';
  }

  /**
   * Set labelled inputs. Returns a player-facing error for the first missing
   * or impossible input, and whether every settle was stable.
   */
  set(inputs: Record<string, number>): { error?: string; stable: boolean } {
    let stable = true;
    for (const [label, value] of Object.entries(inputs)) {
      const port = this.input(label);
      if (!port) return { error: `Input ${label} is missing from the board.`, stable };
      const w = this.width(port, 'out');
      if (value >>> 0 !== (value & mask(w)) >>> 0) {
        return { error: `Input ${label} is ${w} bit${w === 1 ? '' : 's'} wide, too narrow for the value ${value}.`, stable };
      }
      let r: SettleResult;
      if (w === 1) {
        if (port.part.type === 'button' && typeof this.engine.press === 'function') r = settled(this.engine.press(port.id, value === 1));
        else r = this.engine.setSwitch(port.id, value === 1);
      } else if (typeof this.engine.setValue === 'function') {
        r = settled(this.engine.setValue(port.id, value >>> 0));
      } else {
        return { error: `Input ${label} is ${w} bits wide, and this engine only drives 1-bit inputs.`, stable };
      }
      if (!r.stable) stable = false;
    }
    return { stable };
  }

  /** Read a labelled output as a Signal; undefined when the board has no such output. */
  read(label: string): Signal | undefined {
    const port = this.output(label);
    if (!port) return undefined;
    if (typeof this.engine.readSignal === 'function') return this.engine.readSignal(port.id, 'in');
    return fromValue(this.engine.readPin(port.id, 'in'));
  }

  /** Is the labelled output exactly 1? */
  isHigh(label: string): boolean {
    const s = this.read(label);
    return !!s && s.x === 0 && s.v === V1;
  }

  /**
   * Compare labelled outputs with expected values. Returns the display values
   * and the first problem in plain English.
   */
  compare(expected: Record<string, number>): {
    pass: boolean;
    actual: Record<string, string>;
    actualNum: Record<string, number | null>;
    message?: string;
  } {
    const actual: Record<string, string> = {};
    const actualNum: Record<string, number | null> = {};
    let pass = true;
    let message: string | undefined;
    for (const [label, want] of Object.entries(expected)) {
      const s = this.read(label);
      actual[label] = showSignal(s);
      actualNum[label] = s && s.x === 0 ? s.v >>> 0 : null;
      if (!s) {
        pass = false;
        message ??= `Output ${label} is missing from the board.`;
      } else if (s.x !== 0) {
        pass = false;
        message ??=
          s.w === 1
            ? `Output ${label} is unknown (X). Is something left unconnected?`
            : `Output ${label} has unknown bits (X). Is a wire or bit left unconnected?`;
      } else if (s.v >>> 0 !== want >>> 0) {
        pass = false;
        message ??= `Output ${label} is ${s.v >>> 0} but should be ${want >>> 0}.`;
      }
    }
    return { pass, actual, actualNum, ...(message ? { message } : {}) };
  }
}

/** A case that fails before anything is compared (missing parts, bad test, out of time). */
export function failCase(
  kind: TestKind,
  index: number,
  message: string,
  extra: Partial<CaseResult> = {},
): CaseResult {
  return { index, pass: false, inputs: {}, expected: {}, actual: {}, kind, message, ...extra };
}
