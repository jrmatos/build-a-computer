/**
 * "Debug this test" on Track 2 levels: runs only that test (its args, seed
 * and time limit), then shows the verdict as the checker judges it, the
 * returned value next to the expected one as a collapsible diff (tensor
 * shapes and values, mismatching indices highlighted, tolerance shown), the
 * metric against its range with the run's loss curve, the console output,
 * and errors linked to their main.js line.
 */
import { useMemo, useState } from 'react';
import type { Level, TestSpec } from '@build-a-computer/schema';
import type { JsDiffNode, MlSample } from '@build-a-computer/worker';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { MetricRange } from '../level/panels/CaseDiff';
import { js, useJsDebug } from '../sim/client';
import { revealJsLine } from './JsEditor';
import { LineChart } from './LineChart';
import { callLabel, formatNumber, seriesKeys, splitSeries } from './model';
import { PlayGlyph, StopGlyph } from './RunPanel';

type JsTest = Extract<TestSpec, { kind: 'js' }>;

const NO_SAMPLES: MlSample[] = [];

/** "train(400, 1)" or the test's name. */
export function jsTestLabel(test: JsTest, index: number): string {
  return test.name ?? `${t('ml.debug.n', { n: index + 1 })}: ${callLabel({ entry: test.entry, args: test.args ?? [] })}`;
}

export function JsTestDebugPanel({ level }: { level: Level }) {
  const dbg = useJsDebug();
  const state = useEditor((s) => s.js);
  const readOnly = useEditor((s) => s.readOnly);
  const index = dbg.test;
  const tests = useMemo(() => level.tests.map((tt, i) => ({ tt, i })).filter((x): x is { tt: JsTest; i: number } => x.tt.kind === 'js'), [level]);
  const samples = state?.samples ?? NO_SAMPLES;
  if (index === null) return null;
  const test = level.tests[index];
  if (!test || test.kind !== 'js') return null;
  const res = dbg.result?.test === index ? dbg.result : null;
  const verdict = res?.verdict;
  const detail = verdict?.detail;
  const err = res && !res.ok ? res.error : undefined;
  const running = dbg.running;
  const keys = seriesKeys(samples);
  const groups = splitSeries(keys);
  const slots = Object.fromEntries(keys.map((k, i) => [k, i + 1]));

  return (
    <section className="island ml-panel ml-debug" aria-label={t('ml.debug.label')} data-testid="js-test-debug">
      <header className="ml-panel__head">
        <h2 className="ml-panel__title ml-debug__title">{t('ml.debug.title')}</h2>
        <select className="ml-select ml-debug__pick" value={index} aria-label={t('ml.debug.pick')} onChange={(e) => void js.debug(Number(e.target.value))} disabled={running}>
          {tests.map(({ tt, i }) => (
            <option key={i} value={i}>
              {jsTestLabel(tt, i)}
            </option>
          ))}
        </select>
        <span className="ml-panel__spacer" />
        {running ? (
          <button type="button" className="ml-btn ml-btn--stop ml-btn--sm" onClick={() => void js.stop()}>
            <StopGlyph />
            {t('ml.run.stop')}
          </button>
        ) : (
          <button type="button" className="ml-btn ml-btn--primary ml-btn--sm" disabled={readOnly} title={t('ml.debug.rerunTitle')} onClick={() => void js.debug(index)}>
            <PlayGlyph />
            {t('ml.debug.rerun')}
          </button>
        )}
        <button type="button" className="ml-icon-btn" title={t('ml.debug.close')} aria-label={t('ml.debug.close')} onClick={js.closeDebug}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="ml-panel__body">
        <p className="ml-debug__call">
          <code>{callLabel({ entry: test.entry, args: test.args ?? [] })}</code>
          <span>{t('ml.debug.seed', { seed: test.seed ?? 1 })}</span>
          <span>{t('ml.debug.limit', { s: Math.round((test.timeoutMs ?? 10_000) / 100) / 10 })}</span>
        </p>
        {running && <p className="ml-faint">{t('ml.debug.running')}</p>}
        {verdict && !running && (
          <div className={`ml-debug__verdict ${verdict.pass ? 'is-pass' : 'is-fail'}`} role="status">
            <strong>{verdict.pass ? t('ml.debug.pass') : t('ml.debug.fail')}</strong>
            {verdict.message && <p>{verdict.message}</p>}
            {verdict.summary && <p className="ml-faint">{verdict.summary}</p>}
          </div>
        )}
        {err && !running && (
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
        {test.metric && (
          <div className="ml-out">
            <div className="ml-out__head">
              <span>{t('ml.debug.metric', { name: test.metric.name })}</span>
            </div>
            {detail?.metric ? (
              <MetricRange value={detail.metric.value} min={detail.metric.min} max={detail.metric.max} ok={detail.metric.ok} />
            ) : (
              <span className="ml-faint">{t('ml.debug.metricNeeds', { range: rangeText(test.metric.min, test.metric.max) })}</span>
            )}
          </div>
        )}
        {groups.loss.length > 0 && <LineChart title={t('ml.debug.lossChart')} keys={groups.loss} slots={slots} samples={samples} height={140} />}
        {groups.metrics.length > 0 && <LineChart title={t('ml.train.metricChart')} keys={groups.metrics} slots={slots} samples={samples} height={110} />}
        {test.expect !== undefined && (
          <div className="ml-out">
            <div className="ml-out__head">
              <span>{t('ml.debug.compare')}</span>
            </div>
            <p className="ml-debug__tol">{t('ml.debug.tolerance', { tol: showTol(test.tolerance ?? 1e-6) })}</p>
            {detail?.diff ? (
              <>
                {detail.mismatches.length > 0 && (
                  <ul className="ml-debug__mismatches">
                    {detail.mismatches.slice(0, 5).map((m, k) => (
                      <li key={k}>{m.message}</li>
                    ))}
                    {detail.mismatches.length > 5 && <li className="ml-faint">{t('ml.debug.more', { n: detail.mismatches.length - 5 })}</li>}
                  </ul>
                )}
                <div className="ml-diff" role="tree">
                  <DiffNode node={detail.diff} label="result" depth={0} />
                </div>
              </>
            ) : (
              <pre className="ml-result">{JSON.stringify(test.expect, null, 1)?.slice(0, 2000)}</pre>
            )}
          </div>
        )}
        {test.expect === undefined && !test.metric && <p className="ml-faint">{t('ml.debug.noCheck')}</p>}
        <div className="ml-out">
          <div className="ml-out__head">
            <span>{t('ml.run.output')}</span>
          </div>
          <pre className="ml-console" aria-live="polite">
            {state?.log ? state.log : <span className="ml-faint">{t('ml.run.noOutput')}</span>}
          </pre>
        </div>
      </div>
    </section>
  );
}

const showTol = (v: number): string => (v > 0 && v < 1e-3 ? v.toExponential() : String(v));

function rangeText(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `[${min}, ${max}]`;
  if (min !== undefined) return `≥ ${min}`;
  if (max !== undefined) return `≤ ${max}`;
  return t('panels.test.anyValue');
}

function short(v: unknown): string {
  if (typeof v === 'number') return formatNumber(v);
  if (v === undefined) return 'undefined';
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/** One node of the expected-vs-actual tree; failing branches start open. */
function DiffNode({ node, label, depth }: { node: JsDiffNode; label: string; depth: number }) {
  const mark = <span className={`ml-diff__mark ${node.ok ? 'is-ok' : 'is-bad'}`}>{node.ok ? '✓' : '✗'}</span>;
  if (node.kind === 'object' || node.kind === 'array') {
    const children = node.kind === 'object' ? node.entries.map((e) => ({ key: e.key, node: e.node })) : node.items.map((n, i) => ({ key: `[${i}]`, node: n }));
    const count = node.kind === 'array' ? t('ml.debug.items', { n: node.actualLength ?? 0, want: node.expectedLength }) : '';
    return (
      <details className="ml-diff__node" open={!node.ok || depth === 0} role="treeitem" aria-expanded={!node.ok || depth === 0}>
        <summary>
          {mark}
          <span className="ml-diff__key">{label}</span>
          {count && <span className="ml-faint">{count}</span>}
          {node.message && <span className="ml-diff__msg">{node.message}</span>}
        </summary>
        <div className="ml-diff__children">
          {children.map((c) => (
            <DiffNode key={c.key} node={c.node} label={c.key} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }
  if (node.kind === 'tensor') return <TensorDiff node={node} label={label} />;
  if (node.kind === 'number') {
    const got = node.actual;
    const delta = typeof got === 'number' && Number.isFinite(got) ? got - node.expected : null;
    return (
      <div className={`ml-diff__leaf ${node.ok ? '' : 'is-bad'}`} role="treeitem">
        {mark}
        <span className="ml-diff__key">{label}</span>
        <span>
          {t('ml.debug.expected')} <b>{formatNumber(node.expected)}</b>
        </span>
        <span>
          {t('ml.debug.got')} <b className={node.ok ? '' : 'ml-diff__bad'}>{short(got)}</b>
        </span>
        {!node.ok && delta !== null && <span className="ml-faint">Δ {formatNumber(delta)}</span>}
      </div>
    );
  }
  return (
    <div className={`ml-diff__leaf ${node.ok ? '' : 'is-bad'}`} role="treeitem">
      {mark}
      <span className="ml-diff__key">{label}</span>
      {node.ok ? (
        <span>{short(node.actual)}</span>
      ) : (
        <span className="ml-diff__msg">{node.message ?? `${t('ml.debug.expected')} ${short(node.expected)}, ${t('ml.debug.got')} ${short(node.actual)}`}</span>
      )}
    </div>
  );
}

/** "[1][2]" for a flat index in a shape. */
function multiIndex(flat: number, shape: readonly number[]): string {
  const out: number[] = [];
  let rest = flat;
  for (let k = shape.length - 1; k >= 0; k--) {
    const d = shape[k]!;
    out.unshift(d > 0 ? rest % d : 0);
    rest = d > 0 ? Math.floor(rest / d) : 0;
  }
  return out.map((x) => `[${x}]`).join('');
}

/** Most cells drawn in a tensor grid. */
const MAX_ROWS = 24;
const MAX_COLS = 16;

function TensorDiff({ node, label }: { node: Extract<JsDiffNode, { kind: 'tensor' }>; label: string }) {
  const [showExpected, setShowExpected] = useState(false);
  const shape = node.expectedShape;
  const bad = useMemo(() => new Set(node.bad), [node.bad]);
  const total = shape.reduce((a, b) => a * b, 1);
  const sameShape = !!node.actualShape && node.actualShape.length === shape.length && node.actualShape.every((d, i) => d === shape[i]);
  // Grid: the last axis as columns, everything before it as rows.
  const cols = shape.length ? shape[shape.length - 1]! : 1;
  const rows = cols ? Math.ceil(total / cols) : 0;
  const values = showExpected ? node.expected : node.actual;
  return (
    <details className="ml-diff__node" open={!node.ok} role="treeitem" aria-expanded={!node.ok}>
      <summary>
        <span className={`ml-diff__mark ${node.ok ? 'is-ok' : 'is-bad'}`}>{node.ok ? '✓' : '✗'}</span>
        <span className="ml-diff__key">{label}</span>
        <span className="ml-faint">
          {t('ml.debug.shape', { shape: `[${shape.join(', ')}]` })}
          {node.actualShape && !sameShape ? ` ${t('ml.debug.gotShape', { shape: `[${node.actualShape.join(', ')}]` })}` : ''}
        </span>
        {!node.ok && sameShape && <span className="ml-diff__msg">{t('ml.debug.badCount', { n: node.badCount, total })}</span>}
        {node.message && <span className="ml-diff__msg">{node.message}</span>}
      </summary>
      {sameShape && values && (
        <div className="ml-tensor">
          <div className="ml-tensor__bar">
            <button type="button" className="ml-link ml-link--quiet" aria-pressed={showExpected} onClick={() => setShowExpected(!showExpected)}>
              {showExpected ? t('ml.debug.showGot') : t('ml.debug.showExpected')}
            </button>
            {node.truncated && <span className="ml-faint">{t('ml.debug.truncated')}</span>}
          </div>
          <table className="ml-tensor__grid">
            <tbody>
              {Array.from({ length: Math.min(rows, MAX_ROWS) }, (_, r) => (
                <tr key={r}>
                  {shape.length > 1 && <th scope="row">{r}</th>}
                  {Array.from({ length: Math.min(cols, MAX_COLS) }, (_, c) => {
                    const i = r * cols + c;
                    const isBad = bad.has(i);
                    const v = values[i];
                    return (
                      <td
                        key={c}
                        className={isBad ? 'is-bad' : ''}
                        title={`${label}${multiIndex(i, shape)}: ${t('ml.debug.expected')} ${formatNumber(node.expected[i] ?? null)}, ${t('ml.debug.got')} ${formatNumber(node.actual?.[i] ?? null)}`}
                      >
                        {v === undefined ? '' : formatNumber(v)}
                      </td>
                    );
                  })}
                  {cols > MAX_COLS && <td className="ml-faint">…</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {rows > MAX_ROWS && <p className="ml-faint">{t('ml.debug.moreRows', { n: rows - MAX_ROWS })}</p>}
        </div>
      )}
    </details>
  );
}
