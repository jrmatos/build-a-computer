/**
 * The per-case "Run" action ("Run this case"), shared by the test strip and
 * the test cases view. Like the Debug registry (caseDebug.ts): a handler is
 * registered for the test kinds it can run while its owner is mounted; views
 * show a Run button only for those kinds. The level panel registers
 * `runSingleCase` (level/runTests.ts) for every kind, so a Run updates that
 * one case in `store.testRun` and never marks the level complete.
 */
import { create } from 'zustand';
import type { TestSpec } from '@build-a-computer/schema';
import type { DebugCaseTarget } from './caseDebug';

type TestKind = TestSpec['kind'];

/** One case: its strip column, the test (index in level.tests), the case within it (sequence: the step) and the kind. */
export type CaseRunTarget = DebugCaseTarget;
/** Runs the case; the promise settles once its result is in `store.testRun`. */
export type CaseRunHandler = (target: CaseRunTarget) => void | Promise<unknown>;

interface CaseRunState {
  handlers: Partial<Record<TestKind, CaseRunHandler>>;
}

export const useCaseRun = create<CaseRunState>()(() => ({ handlers: {} }));

/** Register `handler` for `kinds` (until the returned function is called). */
export function registerCaseRun(kinds: readonly TestKind[], handler: CaseRunHandler): () => void {
  useCaseRun.setState((s) => {
    const handlers = { ...s.handlers };
    for (const k of kinds) handlers[k] = handler;
    return { handlers };
  });
  return () =>
    useCaseRun.setState((s) => {
      const handlers = { ...s.handlers };
      for (const k of kinds) if (handlers[k] === handler) delete handlers[k];
      return { handlers };
    });
}

/** The handler registered for `kind`, if any (outside React; in components use `useCaseRun`). */
export function getCaseRun(kind: TestKind | undefined): CaseRunHandler | undefined {
  return kind ? useCaseRun.getState().handlers[kind] : undefined;
}
