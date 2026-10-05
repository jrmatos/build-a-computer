/**
 * The code level workspace (Phase 6+): replaces the board canvas with an
 * assembly editor sheet. The floating islands (menu, toolbar, level panel,
 * debugger panels) stay around it. Files: the player's main.s and the level's
 * read-only library files, as tabs.
 */
import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { Dialog } from '../ui/Dialog';
import { AsmEditor, focusCodeEditor, onReveal } from './AsmEditor';
import { MAIN_FILE } from './diagnostics';
import { startLiveAssembly } from './live';
import './code.css';

export function CodeWorkspace() {
  const level = useEditor((s) => s.level);
  const readOnly = useEditor((s) => s.readOnly);
  const diags = useEditor((s) => s.codeDiagnostics);
  const stoppedFile = useEditor((s) => (s.rv && !s.rv.state.running ? (s.rv.state.file ?? null) : null));
  const library = useMemo(() => level?.code?.library ?? [], [level]);
  const libraryTexts = useMemo(() => library.map((f) => f.text), [library]);
  // The open tab belongs to a level; another level starts on main.s.
  const [picked, setPicked] = useState({ levelId: '', file: MAIN_FILE });
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [confirmReset, setConfirmReset] = useState(false);
  const [lastStopped, setLastStopped] = useState<string | null>(null);
  const levelId = level?.id ?? '';
  const tab = picked.levelId === levelId ? picked.file : MAIN_FILE;
  const setTab = (file: string) => setPicked({ levelId: useEditor.getState().level?.id ?? '', file });
  // Execution stopped inside a library file: show it (state adjusted during render, not in an effect).
  if (stoppedFile !== lastStopped) {
    setLastStopped(stoppedFile);
    if (stoppedFile && library.some((f) => f.name === stoppedFile)) setPicked({ levelId, file: stoppedFile });
  }

  useEffect(() => startLiveAssembly(), []);
  useEffect(() => onReveal((file) => setPicked({ levelId: useEditor.getState().level?.id ?? '', file })), []);

  if (!level) return null;
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warnings = diags.length - errors;
  const countFor = (file: string) => diags.filter((d) => (d.file || MAIN_FILE) === file && d.severity === 'error').length;

  const doReset = () => {
    setConfirmReset(false);
    setTab(MAIN_FILE);
    useEditor.getState().set({ source: level.code?.starter ?? '' });
    requestAnimationFrame(() => focusCodeEditor());
  };

  return (
    <div className="code-ws" data-testid="code-workspace">
      <div className="code-ws__frame">
        <section className="island code-ws__sheet" aria-label={t('code.editorLabel')}>
          <header className="code-ws__head">
            <div className="code-ws__tabs" role="tablist" aria-label={t('code.tabs')}>
              {[{ name: MAIN_FILE }, ...library].map((f) => {
                const ro = f.name !== MAIN_FILE;
                const n = countFor(f.name);
                return (
                  <button
                    key={f.name}
                    type="button"
                    role="tab"
                    aria-selected={tab === f.name}
                    className="code-ws__tab"
                    title={ro ? t('code.readOnlyTitle') : undefined}
                    onClick={() => setTab(f.name)}
                  >
                    <span className="code-ws__tab-name">{f.name}</span>
                    {ro && <span className="code-ws__tab-ro">{t('code.readOnly')}</span>}
                    {n > 0 && <span className="code-ws__tab-err" aria-label={n === 1 ? t('code.status.error') : t('code.status.errors', { count: n })}>{n}</span>}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="code-ws__action"
              disabled={readOnly}
              onClick={() => setConfirmReset(true)}
            >
              {t('code.reset')}
            </button>
          </header>
          <div className="code-ws__body">
            <AsmEditor key={`${level.id}:${MAIN_FILE}`} file={MAIN_FILE} hidden={tab !== MAIN_FILE} libraryTexts={libraryTexts} onCursor={(line, col) => setCursor({ line, col })} />
            {library.map((f) => (
              <AsmEditor key={`${level.id}:${f.name}`} file={f.name} text={f.text} readOnly hidden={tab !== f.name} onCursor={(line, col) => setCursor({ line, col })} />
            ))}
          </div>
          <footer className="code-ws__status">
            <span className={errors ? 'code-ws__badge code-ws__badge--error' : warnings ? 'code-ws__badge code-ws__badge--warn' : 'code-ws__badge code-ws__badge--ok'} role="status">
              {errors
                ? errors === 1
                  ? t('code.status.error')
                  : t('code.status.errors', { count: errors })
                : warnings
                  ? warnings === 1
                    ? t('code.status.warning')
                    : t('code.status.warnings', { count: warnings })
                  : t('code.status.ok')}
            </span>
            <span className="code-ws__hint">{t('code.hint')}</span>
            <span className="code-ws__pos">{t('code.status.pos', { line: cursor.line, col: cursor.col })}</span>
          </footer>
        </section>
      </div>
      {confirmReset && (
        <Dialog
          title={t('code.resetTitle')}
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <button type="button" className="gu-btn" data-autofocus onClick={() => setConfirmReset(false)}>
                {t('code.cancel')}
              </button>
              <button type="button" className="gu-btn gu-btn--danger" onClick={doReset}>
                {t('code.resetConfirm')}
              </button>
            </>
          }
        >
          <p>{t('code.resetBody')}</p>
        </Dialog>
      )}
    </div>
  );
}
