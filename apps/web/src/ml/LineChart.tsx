/**
 * Training curves as an SVG line chart: one y-scale, several series, optional
 * log scale, recessive grid, direct labels at the line ends (up to four
 * series) plus a legend, and a crosshair tooltip on hover or arrow keys.
 * Colors come from the --ml-series-N tokens (ml.css), fixed per key.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { MlSample } from '@build-a-computer/worker';
import { t } from '../i18n';
import { downsample, formatNumber, logTicks, niceTicks, tickLabel } from './model';

interface LineChartProps {
  title: string;
  /** Series keys in legend order. */
  keys: readonly string[];
  /** Color slot (1-based) for each key; stays fixed as series come and go. */
  slots: Readonly<Record<string, number>>;
  samples: readonly MlSample[];
  log?: boolean;
  height?: number;
}

const M = { top: 10, right: 12, bottom: 22, left: 44 };

/** Index of the sample whose step is closest to `step` (samples sorted by step). */
function nearest(samples: readonly MlSample[], step: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.step < step) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(samples[lo - 1]!.step - step) <= Math.abs(samples[lo]!.step - step)) return lo - 1;
  return lo;
}

const usable = (v: number | null | undefined, log: boolean): v is number => typeof v === 'number' && Number.isFinite(v) && (!log || v > 0);

export function LineChart({ title, keys, slots, samples, log = false, height = 168 }: LineChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(160, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const direct = keys.length <= 4;
  // Room on the right for direct labels at the line ends.
  const labelRoom = direct ? Math.min(96, 10 + Math.max(0, ...keys.map((k) => k.length)) * 7) : 0;
  const plotW = Math.max(40, width - M.left - M.right - labelRoom);
  const plotH = height - M.top - M.bottom;

  const pts = useMemo(() => downsample(samples, Math.max(50, plotW * 2)), [samples, plotW]);

  const geom = useMemo(() => {
    if (!pts.length) return null;
    const x0 = pts[0]!.step;
    const x1 = Math.max(pts[pts.length - 1]!.step, x0 + 1);
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts)
      for (const k of keys) {
        const v = p.values[k];
        if (usable(v, log)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    if (!Number.isFinite(lo)) return null;
    let ticks: number[];
    let f: (v: number) => number;
    if (log) {
      ticks = logTicks(lo, hi);
      const a = Math.log10(ticks[0] ?? lo);
      const b = Math.max(Math.log10(ticks[ticks.length - 1] ?? hi), a + 1e-9);
      f = (v) => (Math.log10(v) - a) / (b - a);
    } else {
      // Accuracy-like series sit in [0, 1]: anchor the axis at 0 when values are non-negative.
      const yl = lo >= 0 ? 0 : lo - (hi - lo) * 0.05;
      const yh = hi === yl ? yl + 1 : hi + (hi - yl) * 0.05;
      ticks = niceTicks(yl, yh, 4);
      const a = Math.min(yl, ticks[0] ?? yl);
      const b = Math.max(yh, ticks[ticks.length - 1] ?? yh);
      f = (v) => (v - a) / (b - a || 1);
    }
    const sx = (s: number) => M.left + ((s - x0) / (x1 - x0)) * plotW;
    const sy = (v: number) => M.top + (1 - f(v)) * plotH;
    const paths: Record<string, string> = {};
    const ends: Record<string, { x: number; y: number; v: number }> = {};
    for (const k of keys) {
      let d = '';
      let pen = false;
      for (const p of pts) {
        const v = p.values[k];
        if (!usable(v, log)) {
          pen = false;
          continue;
        }
        const x = sx(p.step);
        const y = sy(v);
        d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
        pen = true;
        ends[k] = { x, y, v };
      }
      paths[k] = d;
    }
    return { x0, x1, sx, sy, ticks, xticks: niceTicks(x0, x1, Math.max(2, Math.floor(plotW / 90))), paths, ends };
  }, [pts, keys, log, plotW, plotH]);

  // Keep direct labels from overlapping: nudge them apart vertically.
  const labels = useMemo(() => {
    if (!geom || !direct) return [];
    const ls = keys.filter((k) => geom.ends[k]).map((k) => ({ k, y: geom.ends[k]!.y }));
    ls.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ls.length; i++) if (ls[i]!.y - ls[i - 1]!.y < 13) ls[i]!.y = ls[i - 1]!.y + 13;
    return ls;
  }, [geom, keys, direct]);

  const hoverIdx = hover !== null && pts.length ? Math.min(hover, pts.length - 1) : null;
  const hp = hoverIdx !== null ? pts[hoverIdx]! : null;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!geom) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const step = geom.x0 + ((x - M.left) / plotW) * (geom.x1 - geom.x0);
    setHover(nearest(pts, step));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!pts.length) return;
    const cur = hoverIdx ?? pts.length - 1;
    const by = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') setHover(Math.max(0, cur - by));
    else if (e.key === 'ArrowRight') setHover(Math.min(pts.length - 1, cur + by));
    else if (e.key === 'Home') setHover(0);
    else if (e.key === 'End') setHover(pts.length - 1);
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  const color = (k: string) => `var(--ml-series-${slots[k] ?? 1})`;
  const tipLeft = hp && geom ? geom.sx(hp.step) : 0;
  const tipFlip = tipLeft > width / 2;

  return (
    <figure className="ml-chart">
      <figcaption className="ml-chart__head">
        <span className="ml-chart__title">{title}</span>
        {keys.length > 1 && (
          <span className="ml-chart__legend">
            {keys.map((k) => (
              <span key={k} className="ml-chart__key">
                <span className="ml-chart__swatch" style={{ background: color(k) }} aria-hidden />
                {k}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <div ref={wrap} className="ml-chart__plot" style={{ height }}>
        <svg
          width={width}
          height={height}
          role="img"
          tabIndex={0}
          aria-label={t('ml.train.chartLabel', { title })}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          {geom && (
            <>
              <g className="ml-chart__grid">
                {geom.ticks.map((v) => (
                  <g key={v}>
                    <line x1={M.left} x2={M.left + plotW} y1={geom.sy(v)} y2={geom.sy(v)} />
                    <text x={M.left - 6} y={geom.sy(v)} dy="0.32em" textAnchor="end">
                      {tickLabel(v)}
                    </text>
                  </g>
                ))}
              </g>
              <g className="ml-chart__axis">
                <line x1={M.left} x2={M.left + plotW} y1={M.top + plotH} y2={M.top + plotH} />
                {geom.xticks.map((s) => (
                  <text key={s} x={geom.sx(s)} y={M.top + plotH + 15} textAnchor="middle">
                    {tickLabel(s)}
                  </text>
                ))}
              </g>
              {keys.map((k) => (
                <path key={k} className="ml-chart__line" d={geom.paths[k]} stroke={color(k)} />
              ))}
              {labels.map(({ k, y }) => (
                <g key={k}>
                  <circle className="ml-chart__end" cx={geom.ends[k]!.x} cy={geom.ends[k]!.y} r={3} fill={color(k)} />
                  <text className="ml-chart__label" x={M.left + plotW + 8} y={y} dy="0.32em">
                    {k}
                  </text>
                </g>
              ))}
              {hp && (
                <g className="ml-chart__hover" aria-hidden>
                  <line x1={geom.sx(hp.step)} x2={geom.sx(hp.step)} y1={M.top} y2={M.top + plotH} />
                  {keys.map((k) => {
                    const v = hp.values[k];
                    return usable(v, log) ? <circle key={k} cx={geom.sx(hp.step)} cy={geom.sy(v)} r={4} fill={color(k)} /> : null;
                  })}
                </g>
              )}
            </>
          )}
        </svg>
        {hp && geom && (
          <div className="ml-chart__tip" style={tipFlip ? { right: width - tipLeft + 10 } : { left: tipLeft + 10 }} role="status">
            <div className="ml-chart__tip-step">
              {t('ml.train.stepAxis')} {hp.step}
            </div>
            {keys.map((k) => (
              <div key={k} className="ml-chart__tip-row">
                <span className="ml-chart__swatch" style={{ background: color(k) }} aria-hidden />
                <span className="ml-chart__tip-key">{k}</span>
                <span className="ml-chart__tip-val">{hp.values[k] === undefined ? '–' : formatNumber(hp.values[k] as number | null)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
