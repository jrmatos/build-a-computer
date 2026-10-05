import type { TestSpec } from '@ground-up/schema';
import type { Netlist } from './compile';
import { ReferenceEngine, type EngineOptions } from './engine';
import { VX, valueChar } from './values';

export interface CaseResult {
  index: number;
  pass: boolean;
  inputs: Record<string, number>;
  expected: Record<string, number>;
  actual: Record<string, string>;
  message?: string;
}

/** Find the part labelled `label` (level inputs and outputs are labelled). */
function byLabel(nl: Netlist, label: string, kind: 'switch' | 'lamp'): string | undefined {
  return nl.parts.find((p) => p.label === label && p.behavior.kind === kind)?.id;
}

/**
 * Run a truth-table test. Each row sets the labelled switches, settles, and
 * compares the labelled lamps. Results are yielded one case at a time so the
 * UI can stream them.
 */
export function* runTruthTable(
  nl: Netlist,
  test: Extract<TestSpec, { kind: 'truth-table' }>,
  opts: EngineOptions = {},
): Generator<CaseResult> {
  const engine = new ReferenceEngine(nl, opts);
  const boot = engine.powerOn();
  for (let index = 0; index < test.rows.length; index++) {
    const row = test.rows[index]!;
    const actual: Record<string, string> = {};
    let message: string | undefined;
    let settle = boot;
    for (const [label, bit] of Object.entries(row.inputs)) {
      const id = byLabel(nl, label, 'switch');
      if (!id) {
        message = `Input ${label} is missing from the board.`;
        break;
      }
      settle = engine.setSwitch(id, bit === 1);
    }
    let pass = message === undefined;
    if (pass && !settle.stable) {
      pass = false;
      message = 'The circuit never settled: a signal keeps oscillating. Look for a loop without a latch.';
    }
    for (const [label, want] of Object.entries(row.expect)) {
      const id = byLabel(nl, label, 'lamp');
      const got = id ? engine.readPin(id, 'in') : VX;
      actual[label] = valueChar(got);
      if (got !== want) {
        pass = false;
        if (!message && got === VX) message = `Output ${label} is unknown (X). Is something left unconnected?`;
      }
    }
    yield { index, pass, inputs: row.inputs, expected: row.expect, actual, ...(message ? { message } : {}) };
  }
}

/**
 * Run any test kind, streaming one result per case. The checkers agent adds
 * 'exhaustive', 'random', 'sequence' and 'program' (LVL-07, TOY-03).
 */
export function* runTest(nl: Netlist, test: TestSpec, opts: EngineOptions = {}): Generator<CaseResult> {
  if (test.kind === 'truth-table') {
    yield* runTruthTable(nl, test, opts);
    return;
  }
  throw new Error(`Test kind '${test.kind}' is not implemented yet`);
}
