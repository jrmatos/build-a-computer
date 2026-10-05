import type { TestSpec } from '@build-a-computer/schema';
import type { Netlist } from './compile';
import { failCase, type CaseResult, type CheckOptions } from './checkers/common';
import { runExhaustive, runRandom, runTruthTable } from './checkers/combinational';
import { runSequence } from './checkers/sequence';
import { runProgram } from './checkers/program';

export type { CaseResult, CheckOptions, CheckerEngine, TestKind } from './checkers/common';
export { MAX_EXHAUSTIVE_BITS, runExhaustive, runRandom, runTruthTable } from './checkers/combinational';
export { runSequence } from './checkers/sequence';
export { loadProgram, parseProgram, runProgram } from './checkers/program';

/**
 * Run any test kind, streaming one result per case (LVL-02, LVL-07, TOY-03).
 * For 'program' tests, compile `loadProgram(board, test)` first.
 * Options carry the level's power mode (`powerOnState`), an engine factory,
 * and a wall-clock budget (`now` + `budgetMs`, injected by the worker).
 */
export function* runTest(nl: Netlist, test: TestSpec, opts: CheckOptions = {}): Generator<CaseResult> {
  const blocked = cannotRun(nl);
  if (blocked) {
    yield failCase(test.kind, 0, blocked);
    return;
  }
  switch (test.kind) {
    case 'truth-table':
      return yield* runTruthTable(nl, test, opts);
    case 'exhaustive':
      return yield* runExhaustive(nl, test, opts);
    case 'random':
      return yield* runRandom(nl, test, opts);
    case 'sequence':
      return yield* runSequence(nl, test, opts);
    case 'program':
      return yield* runProgram(nl, test, opts);
  }
}

/** A player-facing reason the netlist cannot be simulated, or undefined. */
function cannotRun(nl: Netlist): string | undefined {
  const n = nl as Netlist & { canRun?: boolean; diagnostics?: { code: string }[] };
  if (n.canRun !== false) return undefined;
  const codes = new Set<string>((n.diagnostics ?? []).map((d) => d.code));
  if (codes.has('width-mismatch'))
    return 'Some wires join pins of different widths, so the circuit cannot run. Fix the highlighted wires and test again.';
  if (codes.has('unsupported-part')) return 'The board uses a part the simulator cannot run yet, so the tests cannot start.';
  return 'The circuit cannot run yet. Fix the problems shown on the board and test again.';
}

/**
 * How many cases a test yields when nothing goes wrong early (for progress
 * bars). Exhaustive needs input widths: pass `inputBits` (sum of widths) or
 * get an estimate that assumes 1-bit inputs.
 */
export function caseCount(test: TestSpec, inputBits?: number): number {
  switch (test.kind) {
    case 'truth-table':
      return test.rows.length;
    case 'exhaustive':
      return 2 ** Math.min(inputBits ?? test.inputs.length, 16);
    case 'random':
      return test.count ?? 1000;
    case 'sequence':
      return test.steps.length;
    case 'program':
      return 1;
  }
}
