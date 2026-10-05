/**
 * Test strip: one column per test case, rows for every
 * input, desired output and current output. 1-bit values are "leaves" (green 1,
 * red 0, told apart by which corner is sharp too); wider values are number
 * pills. Columns are virtualized so 65,536-case tests stay smooth.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Level } from '@ground-up/schema';
import type { TestRun } from '../editor/store';
import { t } from '../i18n';
import { loadCaseInputs } from './runTests';
import {
  actualValue,
  assignResults,
  cellFor,
  columnState,
  columnWidth,
  formatNum,
  planStrip,
  type Cell,
  type PlanColumn,
  type Port,
  type StreamedCase,
  type TestKind,
} from './testStripModel';
import './TestStrip.css';

const ROW_H = 24;
const HEAD_H = 20;
const PROGRAM_W = 112;
const OVERSCAN = 6;
const RADIX_KEY = 'ground-up:strip-radix';
const OPEN_KEY = 'ground-up:strip-open';
const FLOAT_KEY = 'ground-up:strip-float';
const FLOAT_W_KEY = 'ground-up:strip-float-width';

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

interface Seg {
  kind: TestKind | 'extra';
  start: number;
  count: number;
  width: number;
  x: number;
}

/** Column geometry: uniform width per test, program columns wide. */
function layout(segments: { kind: TestKind; start: number; count: number }[], extra: number, base: number): { segs: Seg[]; total: number } {
  const segs: Seg[] = [];
  let x = 0;
  for (const s of segments) {
    const width = s.kind === 'program' ? Math.max(PROGRAM_W, base) : base;
    segs.push({ ...s, width, x });
    x += s.count * width;
  }
  if (extra > 0) {
    const start = segments.reduce((n, s) => n + s.count, 0);
    segs.push({ kind: 'extra', start, count: extra, width: base, x });
    x += extra * base;
  }
  return { segs, total: x };
}

function segOf(segs: Seg[], i: number): Seg | undefined {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid]!.start <= i) lo = mid;
    else hi = mid - 1;
  }
  return segs[lo];
}
const colX = (segs: Seg[], i: number): number => {
  const s = segOf(segs, i);
  return s ? s.x + (i - s.start) * s.width : 0;
};
const colW = (segs: Seg[], i: number): number => segOf(segs, i)?.width ?? 26;
function colAt(segs: Seg[], x: number): number {
  for (let k = segs.length - 1; k >= 0; k--) {
    const s = segs[k]!;
    if (x >= s.x) return Math.min(s.start + s.count - 1, s.start + Math.floor((x - s.x) / s.width));
  }
  return 0;
}

/** The column as shown: streamed values win over the plan (the worker is the source of truth). */
interface ShownColumn {
  plan: PlanColumn | undefined;
  result: StreamedCase | undefined;
  inputs: Record<string, number> | undefined;
  expect: Record<string, number> | undefined;
}

export function TestStrip({ level, run, floating = false }: { level: Level; run: TestRun | null; floating?: boolean }) {
  const plan = useMemo(() => planStrip(level), [level]);
  const cases = run?.cases as StreamedCase[] | undefined;
  const { byColumn, extra } = useMemo(() => assignResults(plan, cases ?? []), [plan, cases]);
  const count = plan.count + extra.length;
  const running = !!run?.running;

  const [radix, setRadix] = useState<'hex' | 'dec'>(() => (readPref(RADIX_KEY, 'dec') === 'hex' ? 'hex' : 'dec'));
  const [selected, setSelected] = useState<number | null>(null);
  const [note, setNote] = useState<string>('');
  const [shake, setShake] = useState<number | null>(null);

  // Rows: every planned port, plus any label that only shows up in results.
  const { inputs, outputs } = useMemo(() => {
    const ins: Port[] = [...plan.inputs];
    const outs: Port[] = [...plan.outputs];
    const add = (list: Port[], label: string, v: number | undefined) => {
      if (!list.some((p) => p.label === label)) list.push({ label, width: v !== undefined && v > 1 ? 32 - Math.clz32(v) : 1 });
    };
    for (const c of extra) {
      Object.entries(c.inputs ?? {}).forEach(([k, v]) => add(ins, k, v));
      Object.entries(c.expected ?? {}).forEach(([k, v]) => add(outs, k, v));
    }
    return { inputs: ins, outputs: outs };
  }, [plan, extra]);
  const multiBit = [...inputs, ...outputs].some((p) => p.width > 1);
  const hasSeq = plan.segments.some((s) => s.kind === 'sequence');
  const hasProgram = plan.segments.some((s) => s.kind === 'program');
  const base = columnWidth([...inputs, ...outputs], radix);
  const { segs, total: totalW } = useMemo(() => layout(plan.segments, extra.length, base), [plan, extra.length, base]);

  // Run cursor, counts and first failure.
  const { next, passed, failed, firstFail } = useMemo(() => {
    let last = -1;
    let passed = 0;
    let failed = 0;
    let firstFail = -1;
    for (let i = 0; i < plan.count; i++) {
      const r = byColumn[i];
      if (!r) continue;
      last = i;
      if (r.pass) passed++;
      else {
        failed++;
        if (firstFail < 0) firstFail = i;
      }
    }
    extra.forEach((r, k) => {
      last = plan.count + k;
      if (r.pass) passed++;
      else {
        failed++;
        if (firstFail < 0) firstFail = plan.count + k;
      }
    });
    return { next: last + 1, passed, failed, firstFail };
  }, [byColumn, extra, plan.count]);

  const column = useCallback(
    (i: number): ShownColumn => {
      const p = i < plan.count ? plan.column(i) : undefined;
      const r = i < plan.count ? byColumn[i] : extra[i - plan.count];
      const rIn = r?.inputs && Object.keys(r.inputs).length ? r.inputs : undefined;
      const rEx = r?.expected && Object.keys(r.expected).length ? r.expected : undefined;
      return { plan: p, result: r, inputs: rIn ?? p?.inputs, expect: rEx ?? p?.expect };
    },
    [plan, byColumn, extra],
  );

  // Viewport size and scroll, for virtualization.
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 260 });
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const update = () => setView({ left: el.scrollLeft, width: el.clientWidth });
    update();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro?.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);

  const scrollTo = useCallback(
    (i: number, align: 'nearest' | 'center' = 'nearest') => {
      const el = viewport.current;
      if (!el || i < 0) return;
      const x = colX(segs, i);
      const w = colW(segs, i);
      let left = el.scrollLeft;
      if (align === 'center') left = x - (el.clientWidth - w) / 2;
      else if (x < left) left = x - w;
      else if (x + w > left + el.clientWidth) left = x + 2 * w - el.clientWidth;
      left = Math.max(0, Math.min(left, totalW - el.clientWidth));
      if (Math.abs(left - el.scrollLeft) > 0.5) el.scrollLeft = left;
    },
    [segs, totalW],
  );

  // Follow the run; jump to the first failure once and shake it.
  const shownFail = useRef(-1);
  useEffect(() => {
    if (!run || run.cases.length === 0) shownFail.current = -1;
  }, [run]);
  useEffect(() => {
    if (firstFail >= 0 && shownFail.current !== firstFail) {
      shownFail.current = firstFail;
      scrollTo(firstFail, 'center');
      setShake(firstFail);
      const id = setTimeout(() => setShake(null), 500);
      return () => clearTimeout(id);
    }
    if (running && firstFail < 0) scrollTo(Math.min(next, count - 1));
    return undefined;
  }, [firstFail, next, running, count, scrollTo]);

  // Keep the case in focus when column widths change (radix toggle, new rows).
  const anchorRef = useRef(-1);
  useLayoutEffect(() => {
    anchorRef.current = selected ?? (firstFail >= 0 ? firstFail : running ? next : -1);
  });
  useLayoutEffect(() => {
    if (anchorRef.current >= 0) scrollTo(anchorRef.current, 'center');
  }, [base, scrollTo]);

  // A new run clears the selection.
  const runStarted = running && (run?.cases.length ?? 0) === 0;
  const [seenStart, setSeenStart] = useState(runStarted);
  if (runStarted !== seenStart) {
    setSeenStart(runStarted);
    if (runStarted) {
      setSelected(null);
      setNote('');
    }
  }

  const select = useCallback(
    (i: number) => {
      if (count === 0) return;
      const k = Math.max(0, Math.min(count - 1, i));
      setSelected(k);
      scrollTo(k);
      const c = column(k);
      if (!c.inputs) {
        setNote(t('level.strip.pending'));
        return;
      }
      const values = c.inputs;
      void loadCaseInputs(values).then((missed) =>
        setNote(
          missed.length
            ? t('level.strip.notLoaded', { list: missed.join(', ') })
            : t('level.strip.loaded', { n: k + 1 }),
        ),
      );
    },
    [count, column, scrollTo],
  );

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(1, Math.floor(view.width / base) - 1);
    const cur = selected ?? (firstFail >= 0 ? firstFail : -1);
    const moves: Record<string, number> = {
      ArrowRight: cur + 1,
      ArrowLeft: cur < 0 ? 0 : cur - 1,
      Home: 0,
      End: count - 1,
      PageDown: cur + page,
      PageUp: cur - page,
    };
    if (e.key in moves) {
      e.preventDefault();
      select(moves[e.key]!);
    } else if ((e.key === 'Enter' || e.key === ' ') && cur >= 0) {
      e.preventDefault();
      select(cur);
    } else if (e.key === 'Escape' && selected !== null) {
      setSelected(null);
      setNote('');
    }
  };

  // Visible window.
  const first = Math.max(0, colAt(segs, view.left) - OVERSCAN);
  const last = Math.min(count - 1, colAt(segs, view.left + view.width) + OVERSCAN);
  const cols: ReactNode[] = [];
  for (let i = first; i <= last && count > 0; i++) {
    const c = column(i);
    const state = columnState(c.result, i, next, running);
    const program = c.plan?.kind === 'program';
    cols.push(
      <StripColumn
        key={i}
        i={i}
        c={c}
        x={colX(segs, i)}
        w={colW(segs, i)}
        state={state}
        selected={selected === i}
        shake={shake === i}
        firstFail={firstFail === i}
        inputs={inputs}
        outputs={outputs}
        radix={radix}
        seqRow={hasSeq}
        programRow={hasProgram}
        program={program}
        onClick={() => select(i)}
      />,
    );
  }

  const labels: string[] = [
    ...inputs.map((p) => t('level.strip.input', { label: p.label })),
    ...outputs.flatMap((p) => [t('level.strip.desired', { label: p.label }), t('level.strip.current', { label: p.label })]),
  ];
  if (hasSeq) labels.push(t('level.strip.ticks'));
  if (hasProgram) labels.push(t('level.strip.cycles'));
  const outStart = inputs.length;
  const SEP = 6;
  const trackH = HEAD_H + labels.length * ROW_H + SEP * (outputs.length + (hasSeq || hasProgram ? 1 : 0));

  const done = run ? passed + failed : 0;
  const totalCases = Math.max(run?.total ?? 0, count);
  const detailIdx = selected ?? (firstFail >= 0 ? firstFail : null);
  const detail = detailIdx !== null && detailIdx < count ? column(detailIdx) : null;

  return (
    <div className={`ts ${floating ? 'is-floating' : ''}`}>
      <div className="ts-bar">
        <span className="ts-counts" role="status" aria-live="polite">
          {run ? (
            <>
              <span className={`ts-count pass ${passed ? '' : 'zero'}`}>
                <PassMark /> {passed}
              </span>
              <span className={`ts-count fail ${failed ? '' : 'zero'}`}>
                <FailMark /> {failed}
              </span>
              <span className="ts-count total">{t('level.strip.of', { n: totalCases.toLocaleString() })}</span>
              <span className="visually-hidden">
                {running
                  ? t('level.tests.progress', { done, total: totalCases })
                  : t('level.tests.summary', { passed, total: totalCases })}
              </span>
            </>
          ) : (
            <span className="ts-count total">{t('level.strip.cases', { n: totalCases.toLocaleString() })}</span>
          )}
        </span>
        {multiBit && (
          <span className="ts-radix" role="group" aria-label={t('level.strip.radix')}>
            {(['dec', 'hex'] as const).map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={radix === r}
                onClick={() => {
                  setRadix(r);
                  writePref(RADIX_KEY, r);
                }}
              >
                {t(`level.strip.${r}`)}
              </button>
            ))}
          </span>
        )}
      </div>
      {run && (
        <div
          className={`ts-progress ${failed ? 'has-fail' : ''} ${!running && !failed && done > 0 ? 'is-done' : ''}`}
          role="progressbar"
          aria-label={t('level.strip.progress')}
          aria-valuemin={0}
          aria-valuemax={totalCases}
          aria-valuenow={done}
        >
          <span style={{ width: `${totalCases ? (done / totalCases) * 100 : 0}%` }} />
        </div>
      )}
      <div className="ts-panel" style={{ ['--ts-row' as string]: `${ROW_H}px`, ['--ts-head' as string]: `${HEAD_H}px` }}>
        <div className="ts-labels" aria-hidden="true">
          <div className="ts-head-cell" />
          {labels.map((l, k) => (
            <div key={k} className={`ts-label ${labelClass(k, outStart, outputs.length)}`}>
              {l}
            </div>
          ))}
        </div>
        <div
          className="ts-viewport"
          ref={viewport}
          style={floating ? { flex: '0 1 auto', width: totalW + 2 } : undefined}
          tabIndex={0}
          role="listbox"
          aria-orientation="horizontal"
          aria-label={t('level.strip.label')}
          aria-describedby="ts-help"
          aria-activedescendant={selected !== null ? `ts-col-${selected}` : undefined}
          onKeyDown={onKey}
        >
          <div className="ts-track" style={{ width: totalW, height: trackH }}>
            {cols}
          </div>
        </div>
      </div>
      <p id="ts-help" className="visually-hidden">
        {t('level.strip.help')}
      </p>
      {detail && detailIdx !== null && (
        <Detail i={detailIdx} c={detail} inputs={inputs} outputs={outputs} radix={radix} isSelected={selected !== null} />
      )}
      {note && (
        <p className="ts-note" aria-live="polite">
          {note}
        </p>
      )}
    </div>
  );
}

/** Row label classes: a gap before each desired/current pair and before the tick rows. */
function labelClass(k: number, outStart: number, outputs: number): string {
  const outEnd = outStart + outputs * 2;
  if (k >= outEnd) return k === outEnd ? 'sep' : '';
  if (k < outStart) return '';
  return (k - outStart) % 2 === 0 ? 'sep' : 'cur';
}

interface ColumnProps {
  i: number;
  c: ShownColumn;
  x: number;
  w: number;
  state: ReturnType<typeof columnState>;
  selected: boolean;
  shake: boolean;
  firstFail: boolean;
  inputs: Port[];
  outputs: Port[];
  radix: 'hex' | 'dec';
  seqRow: boolean;
  programRow: boolean;
  program: boolean;
  onClick: () => void;
}

function StripColumn(p: ColumnProps) {
  const { c } = p;
  const cells: ReactNode[] = [];
  for (const port of p.inputs) {
    cells.push(<ValueCell key={`i${port.label}`} cell={cellFor(c.inputs?.[port.label], port.width)} width={port.width} radix={p.radix} />);
  }
  p.outputs.forEach((port) => {
    const want = c.expect?.[port.label];
    const got = actualValue(c.result, port.label);
    const wrong = !!c.result && got !== undefined && want !== undefined && got !== want;
    cells.push(
      <ValueCell key={`d${port.label}`} cell={cellFor(want, port.width)} width={port.width} radix={p.radix} sep />,
      <ValueCell key={`c${port.label}`} cell={cellFor(got, port.width)} width={port.width} radix={p.radix} wrong={wrong} current />,
    );
  });
  if (p.seqRow) {
    const ticks = c.plan?.ticks;
    cells.push(
      <div key="ticks" className="ts-cell ts-ticks sep">
        {c.plan?.power ? <span title={t('level.strip.power')}>⏻</span> : null}
        {ticks !== undefined ? `+${ticks}` : ''}
      </div>,
    );
  }
  if (p.programRow) {
    const used = c.result?.cycle;
    cells.push(
      <div key="cycles" className={`ts-cell ts-ticks ${p.seqRow ? '' : 'sep'}`}>
        {p.program ? `${used ?? '–'} / ${c.plan?.maxCycles ?? '–'}` : ''}
      </div>,
    );
  }

  const status = p.state === 'pass' ? t('level.tests.pass') : p.state === 'fail' ? t('level.tests.fail') : t('level.strip.notRun');
  return (
    <div
      id={`ts-col-${p.i}`}
      role="option"
      aria-selected={p.selected}
      aria-label={`${t('level.strip.case', { n: p.i + 1 })}: ${describe(c, p.inputs, p.outputs, p.radix)}. ${status}`}
      className={`ts-col is-${p.state} ${p.selected ? 'is-selected' : ''} ${p.shake ? 'is-shaking' : ''} ${p.firstFail ? 'is-first-fail' : ''} ${p.program ? 'is-program' : ''}`}
      style={{ left: p.x, width: p.w }}
      onClick={p.onClick}
      title={t('level.strip.case', { n: p.i + 1 })}
    >
      <div className="ts-head-cell">
        {p.state === 'pass' ? <PassMark /> : p.state === 'fail' ? <FailMark /> : p.program ? t('level.strip.program') : null}
      </div>
      {cells}
    </div>
  );
}

function ValueCell(props: { cell: Cell; width: number; radix: 'hex' | 'dec'; wrong?: boolean; current?: boolean; sep?: boolean }) {
  const { cell } = props;
  let body: ReactNode;
  if (cell.kind === 'leaf') body = <span className={`ts-bit b${cell.bit}`}>{cell.bit}</span>;
  else if (cell.kind === 'unknown') body = props.width > 1 ? <span className="ts-pill x">X</span> : <span className="ts-bit x">X</span>;
  else if (cell.kind === 'num') body = <span className={`ts-pill ${props.wrong ? 'wrong' : ''}`}>{formatNum(cell.value, props.width, props.radix)}</span>;
  else body = props.width > 1 ? <span className="ts-pill empty" /> : <span className="ts-bit empty">·</span>;
  return <div className={`ts-cell ${props.sep ? 'sep' : ''} ${props.current ? 'cur' : ''} ${props.wrong ? 'wrong' : ''}`}>{body}</div>;
}

function show(v: number | 'x' | undefined, width: number, radix: 'hex' | 'dec'): string {
  if (v === undefined) return '–';
  if (v === 'x') return 'X';
  return width > 1 ? formatNum(v, width, radix) : String(v);
}

function describe(c: ShownColumn, inputs: Port[], outputs: Port[], radix: 'hex' | 'dec'): string {
  const parts = inputs.map((p) => `${p.label} ${show(c.inputs?.[p.label], p.width, radix)}`);
  for (const p of outputs) {
    parts.push(`${t('level.strip.desired', { label: p.label })} ${show(c.expect?.[p.label], p.width, radix)}`);
    if (c.result) parts.push(`${t('level.strip.current', { label: p.label })} ${show(actualValue(c.result, p.label), p.width, radix)}`);
  }
  return parts.join(', ');
}

function Detail(props: { i: number; c: ShownColumn; inputs: Port[]; outputs: Port[]; radix: 'hex' | 'dec'; isSelected: boolean }) {
  const { c, i } = props;
  const fail = c.result && !c.result.pass;
  const ins = props.inputs.map((p) => `${p.label}=${show(c.inputs?.[p.label], p.width, props.radix)}`).join(' ');
  const wrongs = props.outputs
    .map((p) => ({ p, want: c.expect?.[p.label], got: actualValue(c.result, p.label) }))
    .filter((o) => c.result && o.got !== o.want);
  return (
    <div className={`ts-detail ${fail ? 'fail' : c.result ? 'pass' : ''}`} role={fail && !props.isSelected ? 'alert' : undefined}>
      <div className="ts-detail-head">
        {fail ? <FailMark /> : c.result ? <PassMark /> : null}
        <strong>{fail && !props.isSelected ? t('level.strip.firstFail', { n: i + 1 }) : t('level.strip.case', { n: i + 1 })}</strong>
        <code>{ins}</code>
      </div>
      {wrongs.length > 0 && !(fail && c.result?.message) && (
        <p className="ts-detail-line">
          {wrongs.map(({ p, want, got }) => (
            <span key={p.label}>
              {t('level.strip.mismatch', {
                label: p.label,
                want: show(want, p.width, props.radix),
                got: show(got, p.width, props.radix),
              })}
            </span>
          ))}
        </p>
      )}
      {fail && c.result?.message && <p className="ts-detail-line">{c.result.message}</p>}
      {c.result?.summary && <p className="ts-detail-line muted">{c.result.summary}</p>}
    </div>
  );
}

const PassMark = () => (
  <svg className="ts-mark pass" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M1.5 5.2 4 7.6 8.6 2.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const FailMark = () => (
  <svg className="ts-mark fail" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M2 2 8 8M8 2 2 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/**
 * The strip with its header: collapse, and pop out into a wide bottom-center
 * island above the bottom dock (resizable by its side edges).
 */
export function TestStripSection({ level, run }: { level: Level; run: TestRun | null }) {
  const [open, setOpen] = useState(() => readPref(OPEN_KEY, '1') === '1');
  const [floating, setFloating] = useState(() => readPref(FLOAT_KEY, '0') === '1');
  const toggleOpen = () => {
    setOpen(!open);
    writePref(OPEN_KEY, open ? '0' : '1');
  };
  const toggleFloat = () => {
    setFloating(!floating);
    writePref(FLOAT_KEY, floating ? '0' : '1');
    if (!open) {
      setOpen(true);
      writePref(OPEN_KEY, '1');
    }
  };
  const [layer, setLayer] = useState<Element | null>(null);
  useEffect(() => {
    // The layer mounts in the same commit as this panel: look it up on the next frame.
    const id = requestAnimationFrame(() => setLayer(document.querySelector('.app .layer')));
    return () => cancelAnimationFrame(id);
  }, []);

  const head = (
    <div className="ts-section-head">
      <button type="button" className="ts-toggle" aria-expanded={open} onClick={toggleOpen}>
        <Chevron open={open} />
        <span>{t('level.strip.title')}</span>
      </button>
      <button
        type="button"
        className="ts-icon-btn"
        onClick={toggleFloat}
        aria-pressed={floating}
        title={floating ? t('level.strip.dock') : t('level.strip.popOut')}
        aria-label={floating ? t('level.strip.dock') : t('level.strip.popOut')}
      >
        {floating ? <DockIcon /> : <PopIcon />}
      </button>
    </div>
  );

  if (floating && layer) {
    return (
      <>
        <p className="ts-floating-note">
          <span>{t('level.strip.floating')}</span>
          <button type="button" className="ts-link" onClick={toggleFloat}>
            {t('level.strip.dock')}
          </button>
        </p>
        {createPortal(
          <FloatIsland>
            {head}
            {open && <TestStrip level={level} run={run} floating />}
          </FloatIsland>,
          layer,
        )}
      </>
    );
  }
  return (
    <div className="ts-section">
      {head}
      {open && <TestStrip level={level} run={run} />}
    </div>
  );
}

function FloatIsland({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(() => Number(readPref(FLOAT_W_KEY, '0')) || 0);
  const [bottom, setBottom] = useState(16);
  // Sit above whatever the bottom dock shows (waveforms, diagnostics).
  useEffect(() => {
    const dock = document.querySelector('.bottom-dock');
    if (!dock) return;
    const update = () => {
      const h = (dock as HTMLElement).getBoundingClientRect().height;
      setBottom(16 + (h > 0 ? h + 10 : 0));
    };
    update();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    ro?.observe(dock);
    return () => ro?.disconnect();
  }, []);

  const drag = (side: -1 | 1) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = (e.currentTarget.parentElement as HTMLElement | null) ?? null;
    const startW = el?.getBoundingClientRect().width ?? 600;
    const startX = e.clientX;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let w = startW;
    const move = (ev: PointerEvent) => {
      // Centered island: each side moves half, so the width changes by twice the drag.
      w = Math.max(320, Math.min(window.innerWidth - 32, startW + side * 2 * (ev.clientX - startX)));
      setWidth(Math.round(w));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      writePref(FLOAT_W_KEY, String(Math.round(w)));
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  const nudge = (side: -1 | 1) => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 40 * side : e.key === 'ArrowLeft' ? -40 * side : 0;
    if (!step) return;
    e.preventDefault();
    const cur = width || (e.currentTarget.parentElement?.getBoundingClientRect().width ?? 600);
    const w = Math.max(320, Math.min(window.innerWidth - 32, cur + step));
    setWidth(w);
    writePref(FLOAT_W_KEY, String(w));
  };

  return (
    <div className="ts-float-wrap" style={{ bottom }}>
      <section className="island ts-float" style={width ? { width } : undefined} aria-label={t('level.strip.label')}>
        {([-1, 1] as const).map((side) => (
          <div
            key={side}
            className={`ts-resize ${side < 0 ? 'left' : 'right'}`}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('level.strip.resize')}
            tabIndex={0}
            onPointerDown={drag(side)}
            onKeyDown={nudge(side)}
          />
        ))}
        {children}
      </section>
    </div>
  );
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : undefined }}>
    <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const PopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 14h18" />
    <path d="m9 10 3-3 3 3" />
  </svg>
);
const DockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
    <path d="m10 9 3 3-3 3" />
  </svg>
);
