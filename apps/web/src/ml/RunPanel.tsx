/**
 * Run panel: call one exported function of main.js with the level's
 * arguments, then show console output, the error (linked to its line) and
 * the returned value (tensors pretty-printed with their shape).
 */
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { js } from '../sim/client';
import { revealJsLine } from './JsEditor';
import { callLabel, formatValue, type CallTarget } from './model';

interface RunPanelProps {
  targets: readonly CallTarget[];
  picked: number;
  onPick: (i: number) => void;
  onRun: () => void;
}

export function RunPanel({ targets, picked, onPick, onRun }: RunPanelProps) {
  const state = useEditor((s) => s.js);
  const readOnly = useEditor((s) => s.readOnly);
  const running = !!state?.running;
  const target = targets[picked] ?? targets[0];
  const err = state?.error;
  const hasResult = !!state && !running && !err && state.result !== undefined;

  return (
    <section className="island ml-panel" aria-label={t('ml.run.label')}>
      <header className="ml-panel__head">
        <h2 className="ml-panel__title">{t('ml.run.title')}</h2>
        {targets.length > 1 ? (
          <select
            className="ml-select"
            value={picked}
            title={t('ml.run.entryTitle')}
            aria-label={t('ml.run.entry')}
            onChange={(e) => onPick(Number(e.target.value))}
          >
            {targets.map((c, i) => (
              <option key={i} value={i}>
                {callLabel(c)}
              </option>
            ))}
          </select>
        ) : target ? (
          <code className="ml-call" title={t('ml.run.entryTitle')}>
            {callLabel(target)}
          </code>
        ) : null}
        <span className="ml-panel__spacer" />
        {running ? (
          <button type="button" className="ml-btn ml-btn--stop" onClick={() => void js.stop()}>
            <StopGlyph />
            {t('ml.run.stop')}
          </button>
        ) : (
          <button
            type="button"
            className="ml-btn ml-btn--primary"
            disabled={!target || readOnly}
            title={target ? t('ml.run.runTitle', { call: callLabel(target) }) : t('ml.run.noEntry')}
            onClick={onRun}
          >
            <PlayGlyph />
            {t('ml.run.run')}
          </button>
        )}
      </header>
      <div className="ml-panel__body">
        {!target && <p className="ml-empty">{t('ml.run.noEntry')}</p>}
        {err && (
          <div className="ml-error" role="alert">
            <div className="ml-error__head">
              <span className="ml-error__label">{t('ml.run.error')}</span>
              {err.line ? (
                <button type="button" className="ml-link" title={t('ml.run.goToLineTitle', { line: err.line })} onClick={() => revealJsLine(err.line!)}>
                  {t('ml.run.goToLine', { line: err.line })}
                </button>
              ) : null}
            </div>
            <pre className="ml-error__msg">{err.message}</pre>
          </div>
        )}
        <div className="ml-out">
          <div className="ml-out__head">
            <span>{t('ml.run.output')}</span>
            {state && !running && (state.log || state.result !== undefined || err) ? (
              <button type="button" className="ml-link ml-link--quiet" onClick={js.clear}>
                {t('ml.run.clear')}
              </button>
            ) : null}
          </div>
          <pre className="ml-console" aria-live="polite">
            {state?.log ? state.log : <span className="ml-faint">{t('ml.run.noOutput')}</span>}
          </pre>
        </div>
        <div className="ml-out">
          <div className="ml-out__head">
            <span>{t('ml.run.returned')}</span>
          </div>
          <pre className="ml-result">{hasResult ? formatValue(state.result) : <span className="ml-faint">{t('ml.run.nothing')}</span>}</pre>
        </div>
      </div>
    </section>
  );
}

export function PlayGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M3 1.8v8.4a.6.6 0 0 0 .9.5l6.6-4.2a.6.6 0 0 0 0-1L3.9 1.3a.6.6 0 0 0-.9.5z" fill="currentColor" />
    </svg>
  );
}

export function StopGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}
