/**
 * The test strip's per-case "Debug" action, shared by every debugger: board
 * cases, code-level tests ('riscv') and Track 2 tests ('js'). A workspace
 * registers a handler for the test kinds it can debug while it is mounted;
 * the strip shows a Debug button (and debugs on double-click) for columns of
 * those kinds. `TestStrip`'s `onDebugCase` prop, when given, wins.
 */
import { create } from 'zustand';
import type { TestSpec } from '@build-a-computer/schema';

type TestKind = TestSpec['kind'];

/** One strip column: its position in the strip, the test (index in level.tests) and the case within it. */
export interface DebugCaseTarget {
  column: number;
  test: number;
  index: number;
  kind: TestKind;
}

export type DebugCaseHandler = (target: DebugCaseTarget) => void;

interface CaseDebugState {
  handlers: Partial<Record<TestKind, DebugCaseHandler>>;
}

export const useCaseDebug = create<CaseDebugState>()(() => ({ handlers: {} }));

/** Register `handler` for `kinds` (until the returned function is called). */
export function registerCaseDebug(kinds: readonly TestKind[], handler: DebugCaseHandler): () => void {
  useCaseDebug.setState((s) => {
    const handlers = { ...s.handlers };
    for (const k of kinds) handlers[k] = handler;
    return { handlers };
  });
  return () =>
    useCaseDebug.setState((s) => {
      const handlers = { ...s.handlers };
      for (const k of kinds) if (handlers[k] === handler) delete handlers[k];
      return { handlers };
    });
}
