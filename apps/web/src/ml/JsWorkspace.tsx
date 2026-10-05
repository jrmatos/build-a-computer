/**
 * The Track 2 workspace (lazy chunk): replaces the board with the player's
 * main.js, the level's read-only library files and an API reference tab, plus
 * a Run panel and, on training levels, the Training panel. The floating
 * islands (menu, level panel with its test strip) stay around it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { Dialog } from '../ui/Dialog';
import { js } from '../sim/client';
import { loadJsDocs, referenceText } from './apiReference';
import { focusJsEditor, JS_MAIN, JsEditor, onJsReveal } from './JsEditor';
import { runTargets } from './model';
import { RunPanel } from './RunPanel';
import { TrainingPanel } from './TrainingPanel';
import { JsTestDebugPanel } from './TestDebugPanel';
import { registerCaseDebug } from '../level/panels/caseDebug';
import { useJsDebug } from '../sim/client';
import '../code/code.css';
import './ml.css';

const API_TAB = 'API';

export function JsWorkspace() {
  const level = useEditor((s) => s.level);
  const readOnly = useEditor((s) => s.readOnly);
  const jsState = useEditor((s) => s.js);
  const library = useMemo(() => level?.js?.library ?? [], [level]);
  const targets = useMemo(() => runTargets(level), [level]);
  const [docs, setDocs] = useState<string | null>(null);
  const apiText = useMemo(() => referenceText(level, docs), [level, docs]);
  const [picked, setPicked] = useState({ levelId: '', file: '' });
  const [entry, setEntry] = useState({ levelId: '', index: 0 });
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [confirmReset, setConfirmReset] = useState(false);
  const levelId = level?.id ?? '';
  const tab = picked.levelId === levelId ? picked.file : JS_MAIN;
  const entryIndex = entry.levelId === levelId ? entry.index : 0;

  useEffect(() => {
    let alive = true;
    void loadJsDocs().then((d) => alive && setDocs(d));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => onJsReveal((file) => setPicked({ levelId: useEditor.getState().level?.id ?? '', file })), []);
  // The test strip's Debug action: run only that test and show why it passes or fails.
  useEffect(() => registerCaseDebug(['js'], ({ test }) => void js.debug(test)), []);
  const debugging = useJsDebug((s) => s.test !== null);

  if (!level || level.mode !== 'js') return null;
  const target = targets[entryIndex] ?? targets[0];
  const run = () => {
    if (!target || useEditor.getState().js?.running) return;
    void js.call(target.entry, target.args);
  };
  const doReset = () => {
    setConfirmReset(false);
    setPicked({ levelId, file: JS_MAIN });
    useEditor.getState().set({ source: level.js?.starter ?? '' });
    requestAnimationFrame(() => focusJsEditor());
  };
  const files = [{ name: JS_MAIN }, ...library, { name: API_TAB }];
  const err = jsState?.error;

  return (
    <div className="code-ws ml-ws" data-testid="js-workspace">
      <div className="code-ws__frame ml-ws__frame">
        <section className="island code-ws__sheet ml-ws__sheet" aria-label={t('ml.editorLabel')}>
          <header className="code-ws__head">
            <div className="code-ws__tabs" role="tablist" aria-label={t('ml.tabs')}>
              {files.map((f) => {
                const ro = f.name !== JS_MAIN;
                const api = f.name === API_TAB;
                return (
                  <button
                    key={f.name}
                    type="button"
                    role="tab"
                    aria-selected={tab === f.name}
                    className="code-ws__tab"
                    title={api ? t('ml.apiTitle') : ro ? t('ml.readOnlyTitle') : undefined}
                    data-file={f.name}
                    onClick={() => setPicked({ levelId, file: f.name })}
                  >
                    <span className="code-ws__tab-name">{api ? t('ml.apiTab') : f.name}</span>
                    {ro && <span className="code-ws__tab-ro">{t(api ? 'ml.reference' : 'ml.readOnly')}</span>}
                    {!ro && err?.line ? <span className="code-ws__tab-err">1</span> : null}
                  </button>
                );
              })}
            </div>
            <button type="button" className="code-ws__action" disabled={readOnly} onClick={() => setConfirmReset(true)}>
              {t('ml.reset')}
            </button>
          </header>
          <div className="code-ws__body">
            <JsEditor key={`${level.id}:${JS_MAIN}`} file={JS_MAIN} hidden={tab !== JS_MAIN} onCursor={(line, col) => setCursor({ line, col })} onRun={run} />
            {library.map((f) => (
              <JsEditor key={`${level.id}:${f.name}`} file={f.name} text={f.text} readOnly hidden={tab !== f.name} onCursor={(line, col) => setCursor({ line, col })} onRun={run} />
            ))}
            <JsEditor key={`${level.id}:${API_TAB}`} file={API_TAB} text={apiText} readOnly plain hidden={tab !== API_TAB} onCursor={(line, col) => setCursor({ line, col })} onRun={run} />
          </div>
          <footer className="code-ws__status">
            <span
              className={`code-ws__badge ${err ? 'code-ws__badge--error' : jsState?.running ? 'code-ws__badge--warn' : 'code-ws__badge--ok'}`}
              role="status"
            >
              {err ? (err.line ? t('ml.status.error', { line: err.line }) : t('ml.status.errorNoLine')) : jsState?.running ? t('ml.status.running') : t('ml.status.ready')}
            </span>
            <span className="code-ws__hint">{t('ml.hint')}</span>
            <span className="code-ws__pos">{t('ml.status.pos', { line: cursor.line, col: cursor.col })}</span>
          </footer>
        </section>
        <div className="ml-ws__side">
          {debugging && <JsTestDebugPanel key={level.id} level={level} />}
          <RunPanel targets={targets} picked={entryIndex} onPick={(index) => setEntry({ levelId, index })} onRun={run} />
          {level.js?.training && <TrainingPanel key={level.id} level={level} />}
        </div>
      </div>
      {confirmReset && (
        <Dialog
          title={t('ml.resetTitle')}
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <button type="button" className="gu-btn" data-autofocus onClick={() => setConfirmReset(false)}>
                {t('ml.cancel')}
              </button>
              <button type="button" className="gu-btn gu-btn--danger" onClick={doReset}>
                {t('ml.resetConfirm')}
              </button>
            </>
          }
        >
          <p>{t('ml.resetBody')}</p>
        </Dialog>
      )}
    </div>
  );
}
