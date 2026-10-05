import { useEffect } from 'react';
import { useEditor } from '../editor/store';
import { sim } from '../sim/client';
import { runLevelTests } from './runTests';

/** True when keys should go to a text field, not to the game. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

export function toggleRun(): void {
  const { snapshot, speedHz } = useEditor.getState();
  if (snapshot?.running) void sim.pause();
  else void sim.run(speedHz);
}

/** Simulation shortcuts: K run/pause, . step one tick, Ctrl/Cmd+Enter run tests. */
export function useSimShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        void runLevelTests();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        toggleRun();
      } else if (e.key === '.') {
        e.preventDefault();
        void sim.step(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
