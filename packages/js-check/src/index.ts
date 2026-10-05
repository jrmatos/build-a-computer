import type { Level, TestSpec } from '@build-a-computer/schema';
import type { CaseResult } from '@build-a-computer/sim-logic';

/**
 * Track 2 checker: run the player's module in the JS sandbox, call the test's
 * entry, compare with tolerance or check a metric (TestSpec 'js'). STUB: the
 * js-check agent implements it (sandbox for Node tests and the browser worker).
 */
export async function runJsTest(
  _source: string,
  test: Extract<TestSpec, { kind: 'js' }>,
  _level: Level,
): Promise<CaseResult> {
  return {
    index: 0,
    pass: false,
    inputs: {},
    expected: {},
    actual: {},
    message: `JavaScript checker not implemented yet (${test.name ?? test.entry})`,
  } as CaseResult;
}
