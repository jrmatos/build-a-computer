/**
 * The code level workspace (Phase 6+): replaces the board canvas with a code
 * editor sheet. The floating islands (menu, toolbar, level panel, debugger
 * panels) stay around it. Files: the player's main.s (or main.c on C levels),
 * the level's read-only library files, and on C levels that link libc a
 * read-only "libc" reference tab, as tabs.
 */
import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { Dialog } from '../ui/Dialog';
import { AsmEditor, focusCodeEditor, onReveal } from './AsmEditor';
import { headersFor, LIBC_HEADERS, linksLibc } from './cDiagnostics';
import { isCFile, LIBC_TAB, libcReference } from './cLanguage';
import { mainFileFor } from './diagnostics';
import { startLiveAssembly } from './live';
import { TestDebugPanel } from './TestDebugPanel';
import { registerCaseDebug } from '../level/panels/caseDebug';
import { useDock } from '../level/panels/dockState';
import { rv, useRvDebug } from '../sim/client';
import './code.css';

export function CodeWorkspace() {
  const level = useEditor((s) => s.level);
  const readOnly = useEditor((s) => s.readOnly);
  const diags = useEditor((s) => s.codeDiagnostics);
  const stoppedFile = useEditor((s) => (s.rv && !s.rv.state.running ? (s.rv.state.file ?? null) : null));
  const isC = level?.code?.language === 'c';
  const mainFile = mainFileFor(level);
  const library = useMemo(() => level?.code?.library ?? [], [level]);
  const libraryTexts = useMemo(() => library.filter((f) => isC === isCFile(f.name)).map((f) => f.text), [library, isC]);
  const headers = useMemo(() => (isC ? headersFor(level) : {}), [level, isC]);
  // The read-only libc reference: only when the level links libc and libc has headers.
  const libcText = useMemo(() => (linksLibc(level) && Object.keys(LIBC_HEADERS).length ? libcReference(LIBC_HEADERS) : null), [level]);
  const refFiles = useMemo(() => [...library, ...(libcText !== null ? [{ name: LIBC_TAB, text: libcText }] : [])], [library, libcText]);
  // The open tab belongs to a level; another level starts on the player's file.
  const [picked, setPicked] = useState({ levelId: '', file: '' });
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [confirmReset, setConfirmReset] = useState(false);
  const [lastStopped, setLastStopped] = useState<string | null>(null);
  const levelId = level?.id ?? '';
  const tab = picked.levelId === levelId ? picked.file : mainFile;
  const setTab = (file: string) => setPicked({ levelId: useEditor.getState().level?.id ?? '', file });
  // Execution stopped inside a library file: show it (state adjusted during render, not in an effect).
  if (stoppedFile !== lastStopped) {
    setLastStopped(stoppedFile);
    if (stoppedFile && refFiles.some((f) => f.name === stoppedFile)) setPicked({ levelId, file: stoppedFile });
  }

  useEffect(() => startLiveAssembly(), []);
  // The test strip's Debug action: load that test into the debugger (and show the registers).
  useEffect(
    () =>
      registerCaseDebug(['riscv'], ({ test }) => {
        if (!useDock.getState().open) useDock.getState().setTab('registers');
        void rv.debugTest(test);
      }),
    [],
  );
  const debugging = useRvDebug((s) => s.test !== null);
  useEffect(() => onReveal((file) => setPicked({ levelId: useEditor.getState().level?.id ?? '', file })), []);

  if (!level) return null;
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warnings = diags.length - errors;
  const countFor = (file: string) => diags.filter((d) => (d.file || mainFile) === file && d.severity === 'error').length;

  const doReset = () => {
    setConfirmReset(false);
    setTab(mainFile);
    useEditor.getState().set({ source: level.code?.starter ?? '' });
    requestAnimationFrame(() => focusCodeEditor());
  };

  return (
    <div className="code-ws" data-testid="code-workspace">
      <div className={`code-ws__frame ${debugging ? 'has-test' : ''}`}>
        <section className="island code-ws__sheet" aria-label={t(isC ? 'code.editorLabelC' : 'code.editorLabel')}>
          <header className="code-ws__head">
            <div className="code-ws__tabs" role="tablist" aria-label={t('code.tabs')}>
              {[{ name: mainFile }, ...refFiles].map((f) => {
                const ro = f.name !== mainFile;
                const ref = f.name === LIBC_TAB;
                const n = countFor(f.name);
                return (
                  <button
                    key={f.name}
                    type="button"
                    role="tab"
                    aria-selected={tab === f.name}
                    className="code-ws__tab"
                    title={ref ? t('code.libcTitle') : ro ? t('code.readOnlyTitle') : undefined}
                    data-file={f.name}
                    onClick={() => setTab(f.name)}
                  >
                    <span className="code-ws__tab-name">{f.name}</span>
                    {ro && <span className="code-ws__tab-ro">{t(ref ? 'code.reference' : 'code.readOnly')}</span>}
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
            <AsmEditor
              key={`${level.id}:${mainFile}`}
              file={mainFile}
              mainFile={mainFile}
              lang={isC ? 'c' : 'asm'}
              hidden={tab !== mainFile}
              libraryTexts={libraryTexts}
              headers={headers}
              onCursor={(line, col) => setCursor({ line, col })}
            />
            {refFiles.map((f) => (
              <AsmEditor
                key={`${level.id}:${f.name}`}
                file={f.name}
                mainFile={mainFile}
                lang={isCFile(f.name) ? 'c' : 'asm'}
                text={f.text}
                readOnly
                hidden={tab !== f.name}
                onCursor={(line, col) => setCursor({ line, col })}
              />
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
                  : t(isC ? 'code.status.okC' : 'code.status.ok')}
            </span>
            <span className="code-ws__hint">{t('code.hint')}</span>
            <span className="code-ws__pos">{t('code.status.pos', { line: cursor.line, col: cursor.col })}</span>
          </footer>
        </section>
        {debugging && <TestDebugPanel />}
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
