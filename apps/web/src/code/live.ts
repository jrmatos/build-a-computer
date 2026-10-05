/**
 * Live checking: 300 ms after the player stops typing, assemble main.s with
 * the level's library (assembly levels) or compile main.c against libc's and
 * the level's headers (C levels) on the main thread, and publish the
 * diagnostics to store.codeDiagnostics for the squiggles. The worker's rvLoad
 * on Run/Step reports the same diagnostics.
 */
import { useEditor } from '../editor/store';
import { checkC } from './cDiagnostics';
import { checkSource } from './diagnostics';

export const LIVE_DELAY_MS = 300;

/** Start checking the current code level; returns a stop function. */
export function startLiveAssembly(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    timer = undefined;
    const { source, level } = useEditor.getState();
    if (level?.mode !== 'code') return;
    const diags = level.code?.language === 'c' ? checkC(source, level) : checkSource(source, level);
    const cur = useEditor.getState().codeDiagnostics;
    if (JSON.stringify(cur) !== JSON.stringify(diags)) useEditor.getState().set({ codeDiagnostics: diags });
  };
  check();
  const off = useEditor.subscribe((s, prev) => {
    if (s.level !== prev.level) {
      clearTimeout(timer);
      check();
    } else if (s.source !== prev.source) {
      clearTimeout(timer);
      timer = setTimeout(check, LIVE_DELAY_MS);
    }
  });
  return () => {
    clearTimeout(timer);
    off();
  };
}
