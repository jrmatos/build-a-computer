/**
 * Live assembly: 300 ms after the player stops typing, assemble main.s with
 * the level's library on the main thread (cheap) and publish the diagnostics
 * to store.codeDiagnostics for the squiggles. The worker's rvLoad on Run/Step
 * reports the same diagnostics.
 */
import { useEditor } from '../editor/store';
import { checkSource } from './diagnostics';

export const LIVE_DELAY_MS = 300;

/** Start checking the current code level; returns a stop function. */
export function startLiveAssembly(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    timer = undefined;
    const { source, level } = useEditor.getState();
    if (level?.mode !== 'code') return;
    const diags = checkSource(source, level);
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
