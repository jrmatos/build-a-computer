import type { TestSpec } from '@build-a-computer/schema';
import type { SettleResult } from '../engine';
import { REFERENCES } from '../blocks/references';
import { Rig, UNSTABLE_MESSAGE, type TestKind } from './common';

/**
 * Case debugger (step-by-step case runner). A test case becomes a short list
 * of operations (power on, set inputs, tick, check), replayed tick by tick on
 * an engine so the player can scrub through it. It does the same work as the
 * checkers in the same order, but every state in between is a "frame" that can
 * be revisited by replaying from power on (the engines are deterministic).
 * Nothing here changes what the checkers report.
 */

type Values = Record<string, number>;

export type DebugOp =
  /** Power on (first op of every plan). */
  | { op: 'power' }
  /** Power off, then on again (sequence step with `power: 'cycle'`). */
  | { op: 'cycle'; step: number }
  | { op: 'set'; inputs: Values; step: number }
  | { op: 'tick'; n: number; step: number }
  /** Compare outputs here: one checkpoint of the test. */
  | { op: 'check'; step: number; expect: Values }
  /** Program tests: full clock cycles (2 ticks each) until `halt` reads 1 or `maxCycles` pass. */
  | { op: 'program'; maxCycles: number; halt: string; step: number };

export interface DebugPlan {
  kind: TestKind;
  ops: DebugOp[];
  /** Index of the checkpoint (check op, in order) this case is about. */
  focus: number;
  /** Labels to record: inputs first, then outputs. */
  inputs: string[];
  outputs: string[];
}

/** A state of the case: after power on, after setting inputs, or after one tick. */
export interface DebugFrame {
  /** Ticks since the last power on. */
  tick: number;
  /** Step (sequence) the frame belongs to; 0 for other kinds. */
  step: number;
  cause: 'power' | 'cycle' | 'set' | 'tick';
}

export interface DebugCheck {
  /** Frame the comparison is made at. */
  frame: number;
  step: number;
  expect: Values;
  /** Actual values; null when a bit is unknown or the output is missing. */
  actual: Record<string, number | null>;
  pass: boolean;
  message?: string;
}

export interface DebugTrace {
  kind: TestKind;
  frames: DebugFrame[];
  checks: DebugCheck[];
  /** Index into `checks` of the case's own checkpoint. */
  focus: number;
  /** Every recorded label's value at each frame (null = unknown or missing). */
  series: Record<string, (number | null)[]>;
  inputs: string[];
  outputs: string[];
  /** More frames ran than were recorded (long programs). */
  truncated: boolean;
  /** Program tests. */
  cycles?: number;
  halted?: boolean;
  /** Set when the case could not start (missing input, bad program...). */
  error?: string;
}

/** Most frames a trace records; replay still reaches later frames. */
export const MAX_DEBUG_FRAMES = 20_000;

/**
 * The operations that reproduce one case of `test`. Exhaustive and random
 * tests need the case's inputs (the test strip already derives them exactly
 * as the checker draws them). Sequence plans hold the whole sequence so the
 * timeline can scrub every step; `focus` points at the requested step.
 */
export function debugPlan(test: TestSpec, caseIndex: number, caseInputs?: Values): DebugPlan | { error: string } {
  const keys = (list: Values[]) => [...new Set(list.flatMap((v) => Object.keys(v)))];
  switch (test.kind) {
    case 'truth-table': {
      const row = test.rows[caseIndex];
      if (!row) return { error: `There is no case ${caseIndex + 1} in this test.` };
      return {
        kind: test.kind,
        ops: [{ op: 'power' }, { op: 'set', inputs: row.inputs, step: 0 }, { op: 'check', step: 0, expect: row.expect }],
        focus: 0,
        inputs: keys(test.rows.map((r) => r.inputs)),
        outputs: keys(test.rows.map((r) => r.expect)),
      };
    }
    case 'exhaustive':
    case 'random': {
      if (!caseInputs) return { error: 'The inputs of this case are not known yet. Run the tests first.' };
      const ref = REFERENCES[test.reference];
      if (!ref) return { error: `This level's test uses an unknown reference model '${test.reference}'.` };
      let out: Values;
      try {
        out = ref(caseInputs);
      } catch (e) {
        return { error: `The reference model failed: ${e instanceof Error ? e.message : String(e)}` };
      }
      const expect: Values = {};
      for (const label of test.outputs) if (out[label] !== undefined) expect[label] = out[label]! >>> 0;
      return {
        kind: test.kind,
        ops: [{ op: 'power' }, { op: 'set', inputs: caseInputs, step: 0 }, { op: 'check', step: 0, expect }],
        focus: 0,
        inputs: [...test.inputs],
        outputs: [...test.outputs],
      };
    }
    case 'sequence': {
      if (caseIndex < 0 || caseIndex >= test.steps.length) return { error: `There is no step ${caseIndex + 1} in this test.` };
      const ops: DebugOp[] = [{ op: 'power' }];
      test.steps.forEach((s, step) => {
        if (s.power === 'cycle') ops.push({ op: 'cycle', step });
        if (s.set && Object.keys(s.set).length) ops.push({ op: 'set', inputs: s.set, step });
        if (s.ticks) ops.push({ op: 'tick', n: s.ticks, step });
        ops.push({ op: 'check', step, expect: s.expect ?? {} });
      });
      return {
        kind: test.kind,
        ops,
        focus: caseIndex,
        inputs: keys(test.steps.map((s) => s.set ?? {})),
        outputs: keys(test.steps.map((s) => s.expect ?? {})),
      };
    }
    case 'program': {
      const ops: DebugOp[] = [{ op: 'power' }];
      if (test.set && Object.keys(test.set).length) ops.push({ op: 'set', inputs: test.set, step: 0 });
      ops.push({ op: 'program', maxCycles: test.maxCycles, halt: test.halt ?? 'HALT', step: 0 }, { op: 'check', step: 0, expect: test.expect });
      const outputs = Object.keys(test.expect);
      const halt = test.halt ?? 'HALT';
      return {
        kind: test.kind,
        ops,
        focus: 0,
        inputs: Object.keys(test.set ?? {}),
        outputs: outputs.includes(halt) ? outputs : [...outputs, halt],
      };
    }
    default:
      return { error: `A '${test.kind}' test is not run on a board.` };
  }
}

export interface StepCaseOptions {
  /** Stop once this frame is reached (the engine is left in that state). Default: run to the end. */
  until?: number;
  /** Record frames, series and checks (off for a plain replay). Default true. */
  record?: boolean;
  /** Tick the engine (the worker records waveform history through this). Default: rig.engine.tick(). */
  tick?: () => SettleResult;
  maxFrames?: number;
}

export interface StepCaseResult {
  trace: DebugTrace;
  /** Frame the engine is left at. */
  frame: number;
  /** Latest settle result, for the worker's snapshot. */
  last: SettleResult;
}

const STABLE: SettleResult = { stable: true, unstableNets: [], contentionNets: [], events: 0 };

/**
 * Run a plan on a fresh rig (not yet powered), frame by frame. With `until`
 * it stops at that frame; otherwise it runs every op and records the trace.
 */
export function stepCase(rig: Rig, plan: DebugPlan, opts: StepCaseOptions = {}): StepCaseResult {
  const record = opts.record !== false;
  const maxFrames = opts.maxFrames ?? MAX_DEBUG_FRAMES;
  const until = opts.until ?? Number.POSITIVE_INFINITY;
  const e = rig.engine;
  const tick = opts.tick ?? (() => e.tick());
  const labels = [...plan.inputs, ...plan.outputs];
  const trace: DebugTrace = {
    kind: plan.kind,
    frames: [],
    checks: [],
    focus: plan.focus,
    series: Object.fromEntries(labels.map((l) => [l, []])),
    inputs: plan.inputs,
    outputs: plan.outputs,
    truncated: false,
  };
  let frame = -1;
  let ticks = 0;
  let last = STABLE;
  /** Any settle in the current step failed to finish. */
  let unstable = false;
  /** A program that never halted fails its check, like the checker. */
  let noHalt: string | undefined;

  const read = (label: string): number | null => {
    const out = rig.read(label);
    if (out) return out.x === 0 ? out.v >>> 0 : null;
    const inp = rig.input(label);
    if (!inp) return null;
    const s = typeof e.readSignal === 'function' ? e.readSignal(inp.id, 'out') : undefined;
    return s && s.x === 0 ? s.v >>> 0 : null;
  };
  /** Add a frame; false once `until` is reached (stop). */
  const push = (cause: DebugFrame['cause'], step: number): boolean => {
    frame++;
    if (record) {
      if (trace.frames.length < maxFrames) {
        trace.frames.push({ tick: ticks, step, cause });
        for (const l of labels) trace.series[l]!.push(read(l));
      } else trace.truncated = true;
    }
    return frame < until;
  };
  const done = (): StepCaseResult => ({ trace, frame, last });

  for (const op of plan.ops) {
    switch (op.op) {
      case 'power':
        last = e.powerOn();
        ticks = 0;
        unstable = !last.stable;
        if (!push('power', 0)) return done();
        break;
      case 'cycle':
        e.powerOff();
        last = e.powerOn();
        ticks = 0;
        unstable = !last.stable;
        if (!push('cycle', op.step)) return done();
        break;
      case 'set': {
        const set = rig.set(op.inputs);
        if (set.error) {
          trace.error = set.error;
          if (record) trace.checks.push({ frame: Math.max(0, frame), step: op.step, expect: {}, actual: {}, pass: false, message: set.error });
          return done();
        }
        unstable = !set.stable;
        if (!push('set', op.step)) return done();
        break;
      }
      case 'tick':
        for (let k = 0; k < op.n; k++) {
          last = tick();
          ticks++;
          if (!last.stable) unstable = true;
          if (!push('tick', op.step)) return done();
        }
        break;
      case 'program': {
        let cycles = 0;
        const hasHalt = !!rig.output(op.halt);
        let halted = hasHalt && rig.isHigh(op.halt);
        let stable = !unstable;
        while (stable && !halted && cycles < op.maxCycles) {
          for (let k = 0; k < 2; k++) {
            last = tick();
            ticks++;
            if (!last.stable) stable = false;
            if (!push('tick', op.step)) {
              trace.cycles = cycles + (k === 1 ? 1 : 0);
              return done();
            }
          }
          cycles++;
          if (hasHalt) halted = rig.isHigh(op.halt);
        }
        if (!stable) unstable = true;
        else if (hasHalt && !halted)
          noHalt = `The program did not halt within ${op.maxCycles.toLocaleString('en')} cycles. It may be stuck in a loop: does it end with a halt instruction that sets ${op.halt}?`;
        trace.cycles = cycles;
        trace.halted = halted;
        break;
      }
      case 'check': {
        if (!record) break;
        const cmp = rig.compare(op.expect);
        let pass = cmp.pass;
        let message = cmp.message;
        if (unstable) {
          pass = false;
          message = UNSTABLE_MESSAGE;
        } else if (noHalt) {
          pass = false;
          message = noHalt;
        }
        trace.checks.push({ frame: Math.max(0, frame), step: op.step, expect: op.expect, actual: cmp.actualNum, pass, ...(message ? { message } : {}) });
        unstable = false;
        break;
      }
    }
  }
  return done();
}
