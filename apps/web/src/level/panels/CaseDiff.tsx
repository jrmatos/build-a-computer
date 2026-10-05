/**
 * Why a code or JS test case failed, compactly, for the test strip's detail
 * row: one line per failing check (registers, exit code, memory bytes, UART
 * text with the first difference marked) or per JS mismatch, plus a metric
 * against its range.
 */
import type { CaseResult } from '@build-a-computer/sim-logic';
import type { RvCheck } from '@build-a-computer/worker';
import { t } from '../../i18n';
import { caseChecks, caseDetail, caseSummaryLine, checkLabel, checkLine, memoryBytes, showReg, splitUart, visible } from './testDiff';
import './caseDiff.css';

const MAX_LINES = 6;

/** The tooltip for a strip column: "Case 3", plus the first problem when it failed. */
export function caseDiffTitle(base: string, r: CaseResult | undefined): string {
  const line = caseSummaryLine(r);
  return line ? `${base} — ${line}` : base;
}

export function CaseDiffSummary({ result }: { result: CaseResult }) {
  const checks = caseChecks(result);
  const detail = caseDetail(result);
  if (checks) {
    const bad = checks.filter((c) => !c.ok);
    if (!bad.length) return null;
    return (
      <ul className="cd-list" aria-label={t('panels.test.diffLabel')}>
        {bad.slice(0, MAX_LINES).map((c, k) => (
          <li key={k}>
            <CheckDiff c={c} />
          </li>
        ))}
        {bad.length > MAX_LINES && <li className="cd-more">{t('panels.test.more', { n: bad.length - MAX_LINES })}</li>}
      </ul>
    );
  }
  if (detail) {
    const m = detail.metric;
    if (!detail.mismatches.length && !m) return null;
    return (
      <ul className="cd-list" aria-label={t('panels.test.diffLabel')}>
        {m && (
          <li>
            <span className="cd-label">{m.name}</span> <MetricRange value={m.value} min={m.min} max={m.max} ok={m.ok} />
          </li>
        )}
        {!m &&
          detail.mismatches.slice(0, MAX_LINES).map((x, k) => (
            <li key={k} className="cd-mono">
              {x.message}
            </li>
          ))}
        {!m && detail.mismatches.length > MAX_LINES && <li className="cd-more">{t('panels.test.more', { n: detail.mismatches.length - MAX_LINES })}</li>}
      </ul>
    );
  }
  return null;
}

/** One failing check, with values. */
export function CheckDiff({ c }: { c: RvCheck }) {
  if (c.kind === 'uart') {
    const off = c.offset ?? 0;
    const sp = splitUart(c.expected, c.actual);
    return (
      <span className="cd-uart">
        <span className="cd-label">{checkLabel(c)}</span>
        <span className="cd-row">
          <span className="cd-k">{t('panels.test.expected')}</span>
          <code>
            {off > 0 && '…'}
            {visible(sp.same)}
            <mark className="cd-want">{visible(sp.want) || ' '}</mark>
          </code>
        </span>
        <span className="cd-row">
          <span className="cd-k">{t('panels.test.got')}</span>
          <code>
            {off > 0 && '…'}
            {visible(sp.same)}
            <mark className="cd-got">{visible(sp.got) || t('panels.test.nothingMore')}</mark>
          </code>
        </span>
      </span>
    );
  }
  if (c.kind === 'memory' && c.actual !== null) {
    const bytes = memoryBytes(c).slice(0, 16);
    return (
      <span className="cd-mem">
        <span className="cd-label">{checkLabel(c)}</span>
        <span className="cd-row">
          <span className="cd-k">{t('panels.test.expected')}</span>
          <code>
            {bytes.map((b, i) => (
              <span key={i} className={b.bad ? 'cd-byte bad' : 'cd-byte'}>
                {b.want}
              </span>
            ))}
          </code>
        </span>
        <span className="cd-row">
          <span className="cd-k">{t('panels.test.got')}</span>
          <code>
            {bytes.map((b, i) => (
              <span key={i} className={b.bad ? 'cd-byte bad got' : 'cd-byte'}>
                {b.got ?? '??'}
              </span>
            ))}
          </code>
        </span>
      </span>
    );
  }
  if (c.kind === 'reg')
    return (
      <span className="cd-mono">
        <span className="cd-label">{c.name}</span> {t('panels.test.expected')} <b>{showReg(c.expected)}</b>, {t('panels.test.got')} <b className="cd-bad">{showReg(c.actual)}</b>
      </span>
    );
  return <span className="cd-mono">{checkLine(c)}</span>;
}

/** A value against [min, max] on a small bar. */
export function MetricRange({ value, min, max, ok }: { value: number | null; min?: number | undefined; max?: number | undefined; ok: boolean }) {
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4))));
  const range = min !== undefined && max !== undefined ? `[${fmt(min)}, ${fmt(max)}]` : min !== undefined ? `≥ ${fmt(min)}` : max !== undefined ? `≤ ${fmt(max)}` : t('panels.test.anyValue');
  // Scale: the range plus the value, with some room.
  const pts = [min, max, value ?? undefined].filter((v): v is number => v !== undefined && Number.isFinite(v));
  let lo = Math.min(...pts);
  let hi = Math.max(...pts);
  if (lo === hi) {
    lo -= Math.abs(lo) * 0.5 || 1;
    hi += Math.abs(hi) * 0.5 || 1;
  }
  const pad = (hi - lo) * 0.15;
  lo -= pad;
  hi += pad;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <span className="cd-metric">
      <span className={ok ? 'cd-value ok' : 'cd-value bad'}>{value === null ? 'NaN' : fmt(value)}</span>
      <span className="cd-k">{t('panels.test.needs', { range })}</span>
      {pts.length > 0 && (
        <span className="cd-bar" aria-hidden="true">
          <span className="cd-bar-range" style={{ left: min !== undefined ? x(min) : '0%', right: max !== undefined ? `calc(100% - ${x(max)})` : '0%' }} />
          {value !== null && Number.isFinite(value) && <span className={ok ? 'cd-bar-dot ok' : 'cd-bar-dot bad'} style={{ left: x(value) }} />}
        </span>
      )}
    </span>
  );
}
