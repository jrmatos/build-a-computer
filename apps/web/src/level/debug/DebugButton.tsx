import { useMemo } from 'react';
import type { Level } from '@build-a-computer/schema';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { BugIcon } from './DebugPanel';
import { canDebug, debugColumn, resultsByColumn, useDebug } from './store';
import './debug.css';

/**
 * "Debug" next to "Run tests": opens the case debugger on the first failing
 * case of the last run (or the case already loaded, or case 1).
 */
export function DebugButton({ level, disabled }: { level: Level; disabled?: boolean }) {
  const run = useEditor((s) => s.testRun);
  const current = useDebug((s) => (s.session?.levelId === level.id ? s.session.target.column : -1));
  const firstFail = useMemo(() => (run && !run.running ? resultsByColumn(level).findIndex((r) => r && !r.pass) : -1), [level, run]);
  if (!canDebug(level)) return null;
  const target = firstFail >= 0 ? firstFail : current >= 0 ? current : 0;
  const title = firstFail >= 0 ? t('debug.empty.firstFail', { n: firstFail + 1 }) : t('debug.case', { n: target + 1 });
  return (
    <button
      type="button"
      className={`lv-btn dbg-run-btn ${firstFail >= 0 ? 'is-fail' : ''}`}
      disabled={disabled}
      onClick={() => void debugColumn(target)}
      title={`${title}. ${firstFail >= 0 ? t('debug.button.titleFail') : t('debug.button.title')}`}
      aria-label={title}
    >
      <BugIcon />
      {t('debug.action')}
    </button>
  );
}
