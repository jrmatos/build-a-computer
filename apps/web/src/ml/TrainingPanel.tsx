/**
 * Training panel (levels with js.training): Train/Stop, live loss and metric
 * curves from the MlSample stream, step counter and progress, the NaN banner
 * (E-ML-03), resume from the last checkpoint (E-ML-06) and the WebGPU/CPU
 * badge (E-ML-01).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Level } from '@build-a-computer/schema';
import type { MlSample } from '@build-a-computer/worker';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { js } from '../sim/client';
import { backend, type Backend } from './capability';
import { clearCheckpoint, loadCheckpoint, saveCheckpoint, type Checkpoint } from './checkpoints';
import { LineChart } from './LineChart';
import { ago, callLabel, checkpointOf, firstNonFinite, formatNumber, mergeSamples, progressOf, seriesKeys, splitSeries, trainTarget } from './model';
import { PlayGlyph, StopGlyph } from './RunPanel';

const NO_SAMPLES: MlSample[] = [];

export function TrainingPanel({ level }: { level: Level }) {
  const state = useEditor((s) => s.js);
  const readOnly = useEditor((s) => s.readOnly);
  const running = !!state?.running;
  const target = useMemo(() => trainTarget(level), [level]);
  const [gpu, setGpu] = useState<Backend | null>(null);
  const [log, setLog] = useState(true);
  // Curve restored from a checkpoint; the live run's samples continue it.
  const [prefix, setPrefix] = useState<MlSample[]>(NO_SAMPLES);
  // The checkpoint offered for resume, with its age computed when it was found.
  const [found, setFound] = useState<{ cp: Checkpoint; when: { key: string; n: number } } | null>(null);
  const offer = found?.cp ?? null;
  const when = found?.when ?? null;
  const live = state?.samples ?? NO_SAMPLES;
  const samples = useMemo(() => mergeSamples(prefix, live), [prefix, live]);

  useEffect(() => {
    let alive = true;
    void backend().then((b) => alive && setGpu(b));
    return () => {
      alive = false;
    };
  }, []);

  // A checkpoint from an earlier session (tab closed mid-training): offer to resume.
  useEffect(() => {
    let alive = true;
    void loadCheckpoint(level.id, level.version).then((cp) => {
      if (alive && cp && !useEditor.getState().js?.running) setFound({ cp, when: ago(cp.savedAt, Date.now()) });
    });
    return () => {
      alive = false;
    };
  }, [level.id, level.version]);

  // Save every checkpoint the running code reports (the sandbox decides how often).
  const lastSaved = useRef<number | null>(null);
  const prefixRef = useRef(prefix);
  useEffect(() => {
    prefixRef.current = prefix;
  });
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        if (s.js === prev.js || s.level?.id !== level.id) return;
        const cp = checkpointOf(s.js);
        if (!cp || cp.step === lastSaved.current) return;
        lastSaved.current = cp.step;
        void saveCheckpoint({
          levelId: level.id,
          levelVersion: level.version,
          step: cp.step,
          state: cp.state,
          samples: mergeSamples(prefixRef.current, s.js?.samples ?? []),
          savedAt: Date.now(),
        });
      }),
    [level.id, level.version],
  );

  // E-ML-03: a NaN or infinite loss stops training.
  const bad = useMemo(() => firstNonFinite(samples), [samples]);
  const errNaN = !bad && state?.error && /\b(NaN|Infinity)\b/.test(state.error.message) ? state.error : null;
  useEffect(() => {
    if (bad && running) void js.stop();
  }, [bad, running]);

  const keys = useMemo(() => seriesKeys(samples), [samples]);
  const slots = useMemo(() => Object.fromEntries(keys.map((k, i) => [k, Math.min(i, 7) + 1])), [keys]);
  const groups = splitSeries(keys);
  const { step, total } = progressOf(samples);

  const train = (resume?: Checkpoint) => {
    setFound(null);
    lastSaved.current = resume?.step ?? null;
    setPrefix(resume ? resume.samples.filter((s) => s.step <= resume.step) : NO_SAMPLES);
    void js.call(target.entry, target.args, resume ? { resume: { step: resume.step, state: resume.state } } : undefined).then((res) => {
      // A finished run needs no resume offer next time.
      if (res?.ok) void clearCheckpoint(level.id);
    });
  };
  const discard = () => {
    setFound(null);
    void clearCheckpoint(level.id);
  };

  const showCharts = samples.length > 0;
  // The badge shows what the last run actually computed on (the sandbox reports it), else what the browser offers.
  const ran = state?.device;
  const shown: Backend | null = ran ? (ran.used ? 'webgpu' : 'cpu') : gpu;
  const badgeTitle = ran
    ? ran.used
      ? t('ml.train.backend.usedGpuTitle')
      : ran.available === 'webgpu'
        ? t('ml.train.backend.gpuUnusedTitle')
        : t('ml.train.backend.usedCpuTitle', { message: ran.message })
    : gpu
      ? t(gpu === 'webgpu' ? 'ml.train.backend.webgpuTitle' : 'ml.train.backend.cpuTitle')
      : undefined;

  return (
    <section className="island ml-panel ml-train" aria-label={t('ml.train.label')}>
      <header className="ml-panel__head">
        <h2 className="ml-panel__title">{t('ml.train.title')}</h2>
        <span
          className={`ml-badge ${shown === 'webgpu' ? 'ml-badge--gpu' : ''}`}
          title={badgeTitle}
          data-backend={shown ?? 'checking'}
        >
          {shown ? t(`ml.train.backend.${shown}`) : t('ml.train.backend.checking')}
        </span>
        <span className="ml-panel__spacer" />
        {running ? (
          <button type="button" className="ml-btn ml-btn--stop" onClick={() => void js.stop()}>
            <StopGlyph />
            {t('ml.train.stop')}
          </button>
        ) : (
          <button
            type="button"
            className="ml-btn ml-btn--primary"
            disabled={readOnly}
            title={t('ml.train.trainTitle', { call: callLabel(target) })}
            onClick={() => train()}
          >
            <PlayGlyph />
            {t('ml.train.train')}
          </button>
        )}
      </header>
      <div className="ml-panel__body">
        {offer && !running && when && (
          <div className="ml-note" role="status">
            <div className="ml-note__text">
              <strong>{t('ml.train.resumeTitle')}</strong> {t('ml.train.resumeBody', { step: offer.step, when: t(when.key, { n: when.n }) })}
            </div>
            <div className="ml-note__actions">
              <button type="button" className="ml-btn ml-btn--primary ml-btn--sm" disabled={readOnly} onClick={() => train(offer)}>
                {t('ml.train.resume', { step: offer.step })}
              </button>
              <button type="button" className="ml-btn ml-btn--sm" onClick={discard}>
                {t('ml.train.discard')}
              </button>
            </div>
          </div>
        )}
        {(bad || errNaN) && (
          <div className="ml-error ml-error--nan" role="alert">
            <div className="ml-error__head">
              <WarnGlyph />
              <span className="ml-error__label">{t('ml.train.nanTitle', { value: bad ? formatNumber(bad.value) : 'NaN' })}</span>
              {bad && <span className="ml-faint">{t('ml.train.step', { step: bad.step })}</span>}
            </div>
            <p className="ml-error__body">{t('ml.train.nanBody')}</p>
          </div>
        )}
        <div className="ml-progress">
          <span className="ml-progress__step">{total ? t('ml.train.stepOf', { step: step.toLocaleString(), total: total.toLocaleString() }) : t('ml.train.step', { step: step.toLocaleString() })}</span>
          <div
            className={`ml-progress__bar ${running && !total ? 'is-indeterminate' : ''}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total ?? undefined}
            aria-valuenow={total ? step : undefined}
            aria-label={t('ml.train.title')}
          >
            <div className="ml-progress__fill" style={{ width: total ? `${Math.min(100, (step / total) * 100)}%` : running ? undefined : '0%' }} />
          </div>
        </div>
        {!showCharts && <p className="ml-empty">{t('ml.train.idle')}</p>}
        {showCharts && groups.loss.length > 0 && (
          <div className="ml-chart-block">
            <label className="ml-toggle" title={t('ml.train.logScaleTitle')}>
              <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} />
              {t('ml.train.logScale')}
            </label>
            <LineChart title={t('ml.train.lossChart')} keys={groups.loss} slots={slots} samples={samples} log={log} />
          </div>
        )}
        {showCharts && groups.metrics.length > 0 && (
          <LineChart title={t('ml.train.metricChart')} keys={groups.metrics} slots={slots} samples={samples} height={132} />
        )}
        {showCharts && (
          <details className="ml-table">
            <summary>{t('ml.train.table')}</summary>
            <table>
              <caption>{t('ml.train.tableCaption', { count: Math.min(20, samples.length) })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('ml.train.stepAxis')}</th>
                  {keys.map((k) => (
                    <th key={k} scope="col">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {samples.slice(-20).map((s) => (
                  <tr key={s.step}>
                    <td>{s.step}</td>
                    {keys.map((k) => (
                      <td key={k}>{s.values[k] === undefined ? '–' : formatNumber(s.values[k] as number | null)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>
    </section>
  );
}

function WarnGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 1.5 15 14H1L8 1.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 6v3.5M8 11.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
