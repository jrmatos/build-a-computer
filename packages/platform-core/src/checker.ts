/**
 * Checker interface and level runner. A mode's checker maps the test kinds it
 * understands to runners; the runner here walks a level's tests, tags every
 * result with its test, counts passes and turns kinds a mode cannot run into
 * failed cases. The worker implements checkers as thin adapters around
 * sim-logic (board), rv-check (code) and js-check (js).
 *
 * Results are generic: platform-core does not know the simulator's
 * CaseResult, only the fields every result has.
 */
import type { Level, TestSpec } from '@build-a-computer/schema';
import type { LevelMode, TestKind } from './plugins';

/** The fields every checker result has. */
export interface CheckResult {
  index: number;
  pass: boolean;
  /** Index in level.tests (the runner sets it). */
  test?: number;
  kind?: string;
  message?: string;
}

/** A failed case the runner asks the checker to build (it adds its own empty fields). */
export interface Failure {
  index: number;
  /** Absent when the test itself does not exist. */
  kind?: TestKind;
  test: number;
  message: string;
}

/** Runs the cases of one test kind. */
export interface KindRunner<R extends CheckResult> {
  /** Every case of `test`, in order, each awaited by `emit` so streamed results stay ordered. */
  run(test: TestSpec, testIndex: number, emit: (r: R) => Promise<void>): Promise<void>;
  /** Case `caseIndex` alone, exactly as `run` reports it. */
  runCase(test: TestSpec, testIndex: number, caseIndex: number): Promise<R>;
}

/** A checker bound to one level and one attempt (board or source). */
export interface CheckSession<R extends CheckResult> {
  /** The runner for a kind, or undefined when this mode cannot run it. */
  runner(kind: TestKind): KindRunner<R> | undefined;
}

/**
 * Opening a session can fail for the whole level (a chip cycle in the board):
 * `error` is reported once. With `counts: false` (nothing to test, e.g. no
 * board loaded) a full run reports nothing.
 */
export type Opened<R extends CheckResult> = { ok: true; session: CheckSession<R> } | { ok: false; error: R; counts: boolean };

/** A mode's checker: the plan's `Checker`, per mode rather than per kind. */
export interface Checker<R extends CheckResult, In> {
  mode: LevelMode;
  /** Every test is one case (code and js levels): only case 0 exists. */
  singleCase: boolean;
  /** Message for a test of a kind this mode cannot run. */
  unsupported(kind: TestKind): string;
  /** Build a failed result (unsupported kind, missing test or case). */
  fail(f: Failure): R;
  /** Bind to a level and the player's attempt. */
  open(level: Level, input: In): Opened<R> | Promise<Opened<R>>;
}

/** Checkers by mode. */
export class CheckerRegistry<R extends CheckResult, In> {
  private readonly checkers = new Map<LevelMode, Checker<R, In>>();

  register(checker: Checker<R, In>): this {
    this.checkers.set(checker.mode, checker);
    return this;
  }

  for(level: Pick<Level, 'mode'>): Checker<R, In> {
    const mode = level.mode ?? 'board';
    const c = this.checkers.get(mode);
    if (!c) throw new Error(`No checker for '${mode}' levels.`);
    return c;
  }
}

/**
 * Run every test of `level`, streaming each case to `onCase` (awaited, so
 * callbacks land in order). Returns the pass count over every reported case.
 */
export async function runLevel<R extends CheckResult, In>(
  checker: Checker<R, In>,
  level: Level,
  input: In,
  onCase: (r: R) => void | Promise<void>,
): Promise<{ passed: number; total: number }> {
  const opened = await checker.open(level, input);
  if (!opened.ok) {
    if (!opened.counts) return { passed: 0, total: 0 };
    await onCase(opened.error);
    return { passed: 0, total: 1 };
  }
  const { session } = opened;
  let passed = 0;
  let total = 0;
  const emit = async (r: R): Promise<void> => {
    total++;
    if (r.pass) passed++;
    await onCase(r);
  };
  for (const [ti, t] of level.tests.entries()) {
    const runner = session.runner(t.kind);
    if (!runner) await emit(checker.fail({ index: 0, kind: t.kind, test: ti, message: checker.unsupported(t.kind) }));
    else await runner.run(t, ti, (r) => emit({ ...r, test: ti }));
  }
  return { passed, total };
}

/**
 * "Run this case": case `caseIndex` of `level.tests[testIndex]`, tagged with
 * its test, exactly as `runLevel` reports it.
 */
export async function runLevelCase<R extends CheckResult, In>(checker: Checker<R, In>, level: Level, testIndex: number, caseIndex: number, input: In): Promise<R> {
  const t = level.tests[testIndex];
  if (!t) return checker.fail({ index: caseIndex, test: testIndex, message: 'This test does not exist.' });
  if (checker.singleCase && caseIndex !== 0) return checker.fail({ index: caseIndex, kind: t.kind, test: testIndex, message: `There is no case ${caseIndex + 1} in this test.` });
  const opened = await checker.open(level, input);
  if (!opened.ok) return { ...opened.error, index: caseIndex, kind: t.kind, test: testIndex };
  const runner = opened.session.runner(t.kind);
  if (!runner) return checker.fail({ index: caseIndex, kind: t.kind, test: testIndex, message: checker.unsupported(t.kind) });
  return { ...(await runner.runCase(t, testIndex, caseIndex)), test: testIndex };
}
