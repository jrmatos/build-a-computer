import { Prng } from '@build-a-computer/det';
import type { TestSpec } from '@build-a-computer/schema';
import type { Netlist } from '../compile';
import { REFERENCES } from '../blocks/references';
import { mask } from '../values';
import { Budget, Rig, UNSTABLE_MESSAGE, failCase, type CaseResult, type CheckOptions, type TestKind } from './common';

/** Most input bits an exhaustive test may enumerate (65,536 cases). */
export const MAX_EXHAUSTIVE_BITS = 16;

const outOfTime = (kind: TestKind, index: number, budget: Budget): CaseResult =>
  failCase(
    kind,
    index,
    `The test ran out of time after ${index} case${index === 1 ? '' : 's'} (${budget.seconds} s budget). The design may be too slow to simulate; try verified blocks.`,
  );

/** Set inputs, settle, compare: one combinational case. */
function checkRow(
  rig: Rig,
  kind: TestKind,
  index: number,
  inputs: Record<string, number>,
  expected: Record<string, number>,
  bootStable: boolean,
): CaseResult {
  const set = rig.set(inputs);
  const cmp = rig.compare(expected);
  let pass = cmp.pass;
  let message = cmp.message;
  if (set.error) {
    pass = false;
    message = set.error;
  } else if (!set.stable || (!bootStable && Object.keys(inputs).length === 0)) {
    pass = false;
    message = UNSTABLE_MESSAGE;
  }
  return {
    index,
    kind,
    pass,
    inputs,
    expected,
    actual: cmp.actual,
    actualNum: cmp.actualNum,
    ...(message ? { message } : {}),
  };
}

/**
 * Truth table (LVL-02): each row sets the labelled switches (1-bit or
 * multi-bit), settles and compares the labelled lamps as unsigned integers.
 * Any unknown bit is a mismatch.
 */
export function* runTruthTable(
  nl: Netlist,
  test: Extract<TestSpec, { kind: 'truth-table' }>,
  opts: CheckOptions = {},
): Generator<CaseResult> {
  const budget = new Budget(opts);
  const rig = new Rig(nl, opts);
  const boot = rig.engine.powerOn();
  for (let index = 0; index < test.rows.length; index++) {
    if (budget.expired()) {
      yield outOfTime('truth-table', index, budget);
      return;
    }
    const row = test.rows[index]!;
    yield checkRow(rig, 'truth-table', index, row.inputs, row.expect, boot.stable);
  }
}

type RefSpec = Extract<TestSpec, { kind: 'exhaustive' | 'random' }>;

/** Shared setup for exhaustive and random: reference lookup and input widths. */
function prepare(
  rig: Rig,
  test: RefSpec,
): { error: string } | { ref: (i: Record<string, number>) => Record<string, number>; widths: number[] } {
  const ref = REFERENCES[test.reference];
  if (!ref) return { error: `This level's test uses an unknown reference model '${test.reference}'. Please report this level.` };
  const widths: number[] = [];
  for (const label of test.inputs) {
    const port = rig.input(label);
    if (!port) return { error: `Input ${label} is missing from the board.` };
    widths.push(rig.width(port, 'out'));
  }
  for (const label of test.outputs) {
    if (!rig.output(label)) return { error: `Output ${label} is missing from the board.` };
  }
  return { ref, widths };
}

function expectedFor(
  ref: (i: Record<string, number>) => Record<string, number>,
  inputs: Record<string, number>,
  outputs: readonly string[],
): Record<string, number> | string {
  let out: Record<string, number>;
  try {
    out = ref(inputs);
  } catch (e) {
    return `The reference model failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  const expected: Record<string, number> = {};
  for (const label of outputs) {
    const v = out[label];
    if (v === undefined) return `The reference model has no output ${label}. Please report this level.`;
    expected[label] = v >>> 0;
  }
  return expected;
}

/**
 * Exhaustive (LVL-07): every combination of the named inputs (widths from the
 * labelled switches, at most 16 bits in total), compared with
 * REFERENCES[reference]. The first input is the most significant, like a
 * printed truth table.
 */
export function* runExhaustive(
  nl: Netlist,
  test: Extract<TestSpec, { kind: 'exhaustive' }>,
  opts: CheckOptions = {},
): Generator<CaseResult> {
  const kind = 'exhaustive';
  const budget = new Budget(opts);
  const rig = new Rig(nl, opts);
  const boot = rig.engine.powerOn();
  const prep = prepare(rig, test);
  if ('error' in prep) {
    yield failCase(kind, 0, prep.error);
    return;
  }
  const bits = prep.widths.reduce((a, b) => a + b, 0);
  if (bits > MAX_EXHAUSTIVE_BITS) {
    yield failCase(
      kind,
      0,
      `This test would try every combination of ${bits} input bits; the limit is ${MAX_EXHAUSTIVE_BITS}. Use a 'random' test for wide inputs.`,
    );
    return;
  }
  const total = 2 ** bits;
  for (let combo = 0; combo < total; combo++) {
    if (budget.expired()) {
      yield outOfTime(kind, combo, budget);
      return;
    }
    const inputs: Record<string, number> = {};
    let shift = bits;
    test.inputs.forEach((label, k) => {
      const w = prep.widths[k]!;
      shift -= w;
      inputs[label] = Math.floor(combo / 2 ** shift) & mask(w);
    });
    const expected = expectedFor(prep.ref, inputs, test.outputs);
    if (typeof expected === 'string') {
      yield failCase(kind, combo, expected, { inputs });
      return;
    }
    yield checkRow(rig, kind, combo, inputs, expected, boot.stable);
  }
}

/** Random property test (LVL-07): `count` seeded input vectors compared with the reference. */
export function* runRandom(
  nl: Netlist,
  test: Extract<TestSpec, { kind: 'random' }>,
  opts: CheckOptions = {},
): Generator<CaseResult> {
  const kind = 'random';
  const budget = new Budget(opts);
  const rig = new Rig(nl, opts);
  const boot = rig.engine.powerOn();
  const prep = prepare(rig, test);
  if ('error' in prep) {
    yield failCase(kind, 0, prep.error);
    return;
  }
  const prng = new Prng(test.seed ?? 1);
  const count = test.count ?? 1000;
  for (let index = 0; index < count; index++) {
    if (budget.expired()) {
      yield outOfTime(kind, index, budget);
      return;
    }
    const inputs: Record<string, number> = {};
    test.inputs.forEach((label, k) => {
      inputs[label] = (prng.nextU32() & mask(prep.widths[k]!)) >>> 0;
    });
    const expected = expectedFor(prep.ref, inputs, test.outputs);
    if (typeof expected === 'string') {
      yield failCase(kind, index, expected, { inputs });
      return;
    }
    yield checkRow(rig, kind, index, inputs, expected, boot.stable);
  }
}
