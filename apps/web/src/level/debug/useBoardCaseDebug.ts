import { useEffect } from 'react';
import type { Level } from '@build-a-computer/schema';
import { registerCaseDebug } from '../panels/caseDebug';
import { DEBUGGABLE } from './model';
import { canDebug, debugColumn } from './store';

/** While a board level is open, the test strip's Debug action (and double-click) opens the case debugger. */
export function useBoardCaseDebug(level: Level | null): void {
  const on = canDebug(level);
  useEffect(() => {
    if (!on) return undefined;
    return registerCaseDebug([...DEBUGGABLE], (target) => void debugColumn(target.column));
  }, [on]);
}
