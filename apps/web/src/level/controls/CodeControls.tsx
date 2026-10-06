import { useEffect } from 'react';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { rv } from '../../sim/client';
import { PauseIcon, PlayIcon, ResetIcon, StepIcon } from '../icons';
import { runLevelTests } from '../runTests';
import { rvStatus } from '../panels/rvStatus';
import { isTyping } from '../shortcuts';
import '../level.css';
import '../panels/panels.css';

/**
 * Debugger shortcuts on code levels: F5 run/continue (pause while running),
 * Shift+F5 reset, F10 step line, F11 step instruction, Ctrl/Cmd+Enter run tests.
 * F-keys work inside the code editor; other text fields keep their keys.
 */
function useCodeShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const inEditor = !!(e.target as HTMLElement | null)?.closest?.('.cm-editor');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter' && !isTyping(e.target)) {
        e.preventDefault();
        void runLevelTests();
        return;
      }
      if (!/^F(5|10|11)$/.test(e.key) || mod || e.altKey) return;
      if (isTextEntry(e.target) && !inEditor) return;
      e.preventDefault();
      if (e.repeat && e.key === 'F5') return;
      if (e.key === 'F5') void (e.shiftKey ? rv.reset() : rv.toggle());
      else if (e.key === 'F10') void rv.stepLine();
      else void rv.step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Text fields only: checkboxes and buttons do not swallow the debugger's F-keys. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!isTyping(target)) return false;
  const el = target as HTMLElement;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(el.type);
  return true;
}

const StepLineIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8c3-4 9-4 12 0" />
    <path d="m16 3 0 5-5 0" />
    <circle cx="10" cy="17" r="2.5" />
  </svg>
);

/** Run/pause, step instruction, step line, reset and a status line for the RV32 machine. */
export function CodeControls() {
  useCodeShortcuts();
  const state = useEditor((s) => s.rv?.state);
  const diagnostics = useEditor((s) => s.codeDiagnostics);
  const running = !!state?.running;
  const status = rvStatus(state, diagnostics);
  return (
    <div className="island sim-controls" role="toolbar" aria-label={t('panels.rv.ctl.label')}>
      <button
        type="button"
        className="lv-icon-btn"
        title={`${t('panels.rv.ctl.reset')} — Shift+F5`}
        aria-label={t('panels.rv.ctl.reset')}
        onClick={() => void rv.reset()}
      >
        <ResetIcon />
      </button>
      <span className="sim-sep" aria-hidden="true" />
      <button
        type="button"
        className={`lv-icon-btn ${running ? 'is-active' : ''}`}
        aria-pressed={running}
        title={`${running ? t('panels.rv.ctl.pause') : t('panels.rv.ctl.continue')} — F5`}
        aria-label={running ? t('panels.rv.ctl.pause') : t('panels.rv.ctl.continue')}
        onClick={() => void rv.toggle()}
      >
        {running ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button
        type="button"
        className="lv-icon-btn"
        title={`${t('panels.rv.ctl.stepInstruction')} — F11`}
        aria-label={t('panels.rv.ctl.stepInstruction')}
        disabled={running}
        onClick={() => void rv.step(1)}
      >
        <StepIcon />
      </button>
      <button
        type="button"
        className="lv-icon-btn"
        title={`${t('panels.rv.ctl.stepLine')} — F10`}
        aria-label={t('panels.rv.ctl.stepLine')}
        disabled={running}
        onClick={() => void rv.stepLine()}
      >
        <StepLineIcon />
      </button>
      <span className="sim-sep" aria-hidden="true" />
      <span className={`rv-status is-${status.tone}`} role="status" aria-live="polite" title={status.detail ?? status.text}>
        <span className="rv-status-dot" aria-hidden="true" />
        <span className="rv-status-text">{status.text}</span>
      </span>
    </div>
  );
}
