/**
 * Test cases view: every test and case of the level in one searchable,
 * virtualized table, readable before running. Board tests get one column per
 * input, expected and actual output; code and JS tests get name, expectation
 * and actual columns. The side pane shows everything the selected case sets
 * and checks, and after a run why it passed or failed (every check, satisfied
 * or not). Rows can be copied, and the shown rows exported as CSV.
 */
import { useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Level } from '@build-a-computer/schema';
import { useEditor, type TestRun } from '../../editor/store';
import { t } from '../../i18n';
import { useFocusTrap } from '../../ui/Dialog';
import { IconClose } from '../../ui/icons';
import { useCaseDebug } from '../panels/caseDebug';
import { CaseDiffSummary, MetricRange } from '../panels/CaseDiff';
import { caseDetail } from '../panels/testDiff';
import { assignResults, type StreamedCase } from '../testStripModel';
import { useCaseRun } from '../panels/caseRun';
import { csvLine, csvText, downloadCsv } from './csv';
import {
  buildCaseTable,
  caseReasons,
  caseRow,
  caseSpec,
  cellText,
  cellWrong,
  csvHeader,
  csvRow,
  filterRows,
  rowStatus,
  type CaseRow,
  type CaseTable,
  type Radix,
  type StatusFilter,
  type TableCol,
} from './model';
import { closeTestCases, useCasesUi } from './store';
import './cases.css';

const ROW_H = 28;
const OVERSCAN = 8;
const RADIX_KEY = 'build-a-computer:strip-radix';

function readRadix(): Radix {
  try {
    return localStorage.getItem(RADIX_KEY) === 'hex' ? 'hex' : 'dec';
  } catch {
    return 'dec';
  }
}
function writeRadix(r: Radix): void {
  try {
    localStorage.setItem(RADIX_KEY, r);
  } catch {
    /* ignore */
  }
}

/** Mount once: shows the view while it is open for the current level. */
export function TestCasesHost() {
  const open = useCasesUi((s) => s.open);
  const focus = useCasesUi((s) => s.focus);
  const level = useEditor((s) => s.level);
  const run = useEditor((s) => s.testRun);
  // Another level closes the view.
  const levelId = level?.id;
  useEffect(() => closeTestCases, [levelId]);
  if (!open || !level || level.track === 'sandbox') return null;
  return createPortal(<TestCasesDialog key={level.id} level={level} run={run} focus={focus} onClose={closeTestCases} />, document.body);
}

/** The button that opens the view (level panel, test strip). */
export function TestCasesButton({ className = 'lv-btn ghost', compact = false }: { className?: string; compact?: boolean }) {
  return (
    <button type="button" className={className} onClick={() => useCasesUi.setState({ open: true, focus: null })} title={t('cases.openTitle')} aria-label={compact ? t('cases.open') : undefined}>
      <TableIcon />
      {!compact && <span>{t('cases.open')}</span>}
    </button>
  );
}

function colWidth(c: TableCol, radix: Radix, layout: CaseTable['layout'], single = false): string {
  switch (c.role) {
    case 'test':
      return '46px';
    case 'case':
      return '64px';
    case 'in':
    case 'want':
    case 'got': {
      const w = c.port?.width ?? 1;
      const chars = w <= 1 ? 1 : radix === 'hex' ? 2 + Math.ceil(w / 4) : String(2 ** Math.min(w, 32) - 1).length;
      // A group of one column (one output) still fits its group label.
      return `${Math.max(single ? 96 : 44, Math.round(Math.max(chars, c.label.length) * 7.6 + 20))}px`;
    }
    case 'steps':
      return '104px';
    case 'status':
      return '72px';
    case 'name':
      return 'minmax(130px, 1fr)';
    case 'expect':
    case 'actual':
      return layout === 'text' ? 'minmax(170px, 1.4fr)' : '240px';
    case 'why':
      return '240px';
  }
}

interface Props {
  level: Level;
  run: TestRun | null;
  focus: number | null;
  onClose: () => void;
}

function TestCasesDialog({ level, run, focus, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, onClose);

  const table = useMemo(() => buildCaseTable(level), [level]);
  const cases = run?.cases as StreamedCase[] | undefined;
  const byColumn = useMemo(() => assignResults(table.plan, cases ?? []).byColumn, [table, cases]);

  const [radix, setRadixState] = useState<Radix>(readRadix);
  const setRadix = (r: Radix) => {
    setRadixState(r);
    writeRadix(r);
  };
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [test, setTest] = useState<number | null>(null);
  const [note, setNote] = useState('');

  // Counts per test and overall.
  const counts = useMemo(() => {
    const per = table.tests.map(() => ({ pass: 0, fail: 0 }));
    let pass = 0;
    let fail = 0;
    let firstFail = -1;
    for (let i = 0; i < table.count; i++) {
      const r = byColumn[i];
      if (!r) continue;
      const c = per[table.plan.column(i).test];
      if (r.pass) {
        pass++;
        if (c) c.pass++;
      } else {
        fail++;
        if (c) c.fail++;
        if (firstFail < 0) firstFail = i;
      }
    }
    return { per, pass, fail, firstFail };
  }, [table, byColumn]);

  const filtering = deferredQuery.trim() !== '' || status !== 'all' || test !== null;
  const rows = useMemo(
    () => (filtering ? filterRows(level, table, byColumn, { query: deferredQuery, status, test }) : null),
    [filtering, level, table, byColumn, deferredQuery, status, test],
  );
  const n = rows ? rows.length : table.count;
  const rowAt = useCallback((k: number) => (rows ? rows[k]! : k), [rows]);

  const [selected, setSelected] = useState<number | null>(() => focus ?? (counts.firstFail >= 0 ? counts.firstFail : table.count ? 0 : null));
  const row = selected !== null && selected < table.count ? caseRow(table, selected, byColumn) : null;

  // Virtualized body.
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 400 });
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro?.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);

  const posOf = useCallback((i: number) => (rows ? rows.indexOf(i) : i), [rows]);
  const scrollToPos = useCallback((k: number, center = false) => {
    const el = viewport.current;
    if (!el || k < 0) return;
    const head = (el.querySelector('.tc-thead') as HTMLElement | null)?.offsetHeight ?? 0;
    const y = k * ROW_H;
    const h = el.clientHeight - head;
    if (center) el.scrollTop = Math.max(0, y - h / 2);
    else if (y < el.scrollTop) el.scrollTop = y;
    else if (y + ROW_H > el.scrollTop + h) el.scrollTop = y + ROW_H - h;
  }, []);
  // Show the focused case when the view opens.
  useLayoutEffect(() => {
    if (selected !== null) scrollToPos(posOf(selected), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (k: number) => {
    if (n === 0) return;
    const pos = Math.max(0, Math.min(n - 1, k));
    setSelected(rowAt(pos));
    scrollToPos(pos);
  };

  const debugHandlers = useCaseDebug((s) => s.handlers);
  const runHandlers = useCaseRun((s) => s.handlers);
  const target = (r: CaseRow) => ({ column: r.i, test: r.test, index: r.index, kind: r.kind });
  const debugOf = (r: CaseRow): (() => void) | undefined => {
    const fn = debugHandlers[r.kind];
    return fn
      ? () => {
          onClose();
          fn(target(r));
        }
      : undefined;
  };
  const runOf = (r: CaseRow): (() => void) | undefined => {
    const fn = runHandlers[r.kind];
    return fn ? () => void fn(target(r)) : undefined;
  };

  const flash = (s: string) => {
    setNote(s);
    window.setTimeout(() => setNote((cur) => (cur === s ? '' : cur)), 1800);
  };
  const copy = (text: string) => {
    const done = () => flash(t('cases.copied'));
    const fail = () => flash(t('cases.copyFailed'));
    try {
      void navigator.clipboard.writeText(text).then(done, fail);
    } catch {
      fail();
    }
  };
  const copyRow = (r: CaseRow) => copy(`${csvLine(csvHeader(table))}\r\n${csvLine(csvRow(level, table, r, radix))}\r\n`);
  const allCsv = () => {
    const lines: string[][] = [csvHeader(table)];
    for (let k = 0; k < n; k++) lines.push(csvRow(level, table, caseRow(table, rowAt(k), byColumn), radix));
    return csvText(lines);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = selected !== null ? posOf(selected) : -1;
    const page = Math.max(1, Math.floor(view.height / ROW_H) - 2);
    const moves: Record<string, number> = { ArrowDown: cur + 1, ArrowUp: Math.max(0, cur - 1), PageDown: cur + page, PageUp: cur - page, Home: 0, End: n - 1 };
    if (e.key in moves) {
      e.preventDefault();
      select(moves[e.key]!);
    } else if (e.key === 'Enter' && row) {
      e.preventDefault();
      debugOf(row)?.();
    }
  };

  // Grid columns: the table's, plus actions.
  const single = (c: TableCol) => table.columns.filter((x) => x.role === c.role).length === 1;
  const widths = [...table.columns.map((c) => colWidth(c, radix, table.layout, single(c))), '96px'];
  const template = widths.join(' ');
  const gridStyle = { gridTemplateColumns: template } as CSSProperties;
  // Fixed widths and minmax() minimums: the table scrolls sideways below this.
  const minWidth = widths.reduce((sum, w) => sum + (Number(/(\d+)px/.exec(w)?.[1]) || 0), 0);
  const first = Math.max(0, Math.floor(view.top / ROW_H) - OVERSCAN);
  const last = Math.min(n - 1, Math.ceil((view.top + view.height) / ROW_H) + OVERSCAN);
  const body: ReactNode[] = [];
  for (let k = first; k <= last; k++) {
    const r = caseRow(table, rowAt(k), byColumn);
    body.push(
      <TableRow
        key={r.i}
        level={level}
        table={table}
        row={r}
        radix={radix}
        top={k * ROW_H}
        style={gridStyle}
        selected={selected === r.i}
        onSelect={() => setSelected(r.i)}
        onDebug={debugOf(r)}
        onRun={runOf(r)}
        onCopy={() => copyRow(r)}
      />,
    );
  }

  // Group header (board tests): inputs, expected, actual.
  const groups: { label: string; span: number; cls: string }[] = [];
  for (const c of table.columns) {
    const g = c.role === 'in' ? t('cases.spec.inputs') : c.role === 'want' ? t('cases.col.expect') : c.role === 'got' ? t('cases.col.actual') : '';
    const cls = c.role === 'in' || c.role === 'want' || c.role === 'got' ? c.role : '';
    const lastG = groups[groups.length - 1];
    if (lastG && lastG.label === g) lastG.span++;
    else groups.push({ label: g, span: 1, cls });
  }
  groups.push({ label: '', span: 1, cls: '' });

  const statusLabel = (s: StatusFilter) => t(`cases.filter.${s}`);
  const ran = counts.pass + counts.fail > 0;

  return (
    <div className="gu-backdrop tc-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="island gu-dialog tc-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-testid="test-cases">
        <header className="tc-head">
          <h2 id={titleId}>{t('cases.title', { title: level.title })}</h2>
          <span className="tc-counts" role="status">
            {ran && (
              <>
                <span className="tc-count pass">✓ {counts.pass.toLocaleString('en-US')}</span>
                <span className="tc-count fail">✗ {counts.fail.toLocaleString('en-US')}</span>
              </>
            )}
            <span className="tc-count">{filtering ? t('cases.shown', { shown: n.toLocaleString('en-US'), n: table.count.toLocaleString('en-US') }) : t('cases.count', { n: table.count.toLocaleString('en-US') })}</span>
          </span>
          <button type="button" className="gu-icon-btn" aria-label={t('dialog.close')} onClick={onClose}>
            <IconClose size={18} />
          </button>
        </header>

        <div className="tc-toolbar">
          <input
            type="search"
            className="tc-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('cases.searchPlaceholder')}
            aria-label={t('cases.search')}
            data-autofocus
          />
          <span className="tc-seg" role="group" aria-label={t('cases.filter')}>
            {(['all', 'fail', 'pass', 'pending'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>
                {statusLabel(s)}
              </button>
            ))}
          </span>
          {table.multiBit && table.layout === 'ports' && (
            <span className="tc-seg" role="group" aria-label={t('cases.radix')}>
              {(['dec', 'hex'] as const).map((r) => (
                <button key={r} type="button" aria-pressed={radix === r} onClick={() => setRadix(r)}>
                  {t(`cases.${r}`)}
                </button>
              ))}
            </span>
          )}
          <span className="tc-spacer" />
          <button type="button" className="lv-btn ghost small" onClick={() => copy(allCsv())} disabled={n === 0}>
            {t('cases.copyCsv')}
          </button>
          <button type="button" className="lv-btn ghost small" onClick={() => downloadCsv(`${level.id}-test-cases.csv`, allCsv())} disabled={n === 0}>
            {t('cases.downloadCsv')}
          </button>
          <span className="tc-note" aria-live="polite">
            {note}
          </span>
        </div>

        <div className="tc-main">
          <nav className="tc-tests" aria-label={t('cases.test')}>
            <button type="button" className="tc-test" aria-pressed={test === null} onClick={() => setTest(null)}>
              <span className="tc-test-title">{t('cases.allTests')}</span>
              <span className="tc-test-rule">{t('cases.count', { n: table.count.toLocaleString('en-US') })}</span>
            </button>
            {table.tests.map((x) => {
              const c = counts.per[x.test];
              return (
                <button key={x.test} type="button" className="tc-test" aria-pressed={test === x.test} onClick={() => setTest(x.test)}>
                  <span className="tc-test-title">
                    {x.title} <span className="tc-kind">{t(`cases.kind.${x.kind}`)}</span>
                  </span>
                  <span className="tc-test-rule">{x.rule}</span>
                  {c && c.pass + c.fail > 0 && (
                    <span className="tc-test-counts">
                      <span className="pass">✓ {c.pass.toLocaleString('en-US')}</span> <span className="fail">✗ {c.fail.toLocaleString('en-US')}</span> / {x.count.toLocaleString('en-US')}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="tc-table-wrap">
            <div
              className="tc-viewport"
              ref={viewport}
              tabIndex={0}
              role="grid"
              aria-label={t('cases.table')}
              aria-rowcount={n + 1}
              onKeyDown={onKey}
            >
              <div className="tc-thead" role="rowgroup" style={{ minWidth }}>
                {table.layout === 'ports' && (
                  <div className="tc-tr tc-groups" style={gridStyle} aria-hidden="true">
                    {groups.map((g, k) => (
                      <div key={k} className={`tc-th tc-group ${g.cls}`} style={{ gridColumn: `span ${g.span}` }}>
                        {g.label}
                      </div>
                    ))}
                  </div>
                )}
                <div className="tc-tr" role="row" style={gridStyle}>
                  {table.columns.map((c) => (
                    <div key={c.id} role="columnheader" className={`tc-th ${c.role}`}>
                      {c.label}
                    </div>
                  ))}
                  <div role="columnheader" className="tc-th">
                    <span className="visually-hidden">{t('cases.debug')}</span>
                  </div>
                </div>
              </div>
              <div className="tc-tbody" role="rowgroup" style={{ height: n * ROW_H, minWidth }}>
                {body}
              </div>
              {n === 0 && <p className="tc-empty">{table.count ? t('cases.empty') : t('cases.none')}</p>}
            </div>
          </div>

          <aside className="tc-side" aria-label={t('cases.spec.title')}>
            {row ? <CaseDetailPane level={level} table={table} row={row} radix={radix} onDebug={debugOf(row)} onRun={runOf(row)} onCopy={() => copyRow(row)} /> : <p className="tc-muted">{t('cases.pickRow')}</p>}
          </aside>
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  level: Level;
  table: CaseTable;
  row: CaseRow;
  radix: Radix;
  top: number;
  style: CSSProperties;
  selected: boolean;
  onSelect: () => void;
  onDebug: (() => void) | undefined;
  onRun: (() => void) | undefined;
  onCopy: () => void;
}

function TableRow({ level, table, row, radix, top, style, selected, onSelect, onDebug, onRun, onCopy }: RowProps) {
  const st = rowStatus(row);
  return (
    <div
      role="row"
      aria-selected={selected}
      className={`tc-tr tc-row is-${st} ${selected ? 'is-selected' : ''} ${row.index === 0 && row.i > 0 ? 'is-test-start' : ''}`}
      style={{ ...style, top }}
      onClick={onSelect}
      onDoubleClick={onDebug}
    >
      {table.columns.map((c) => {
        const text = cellText(level, table, row, c, radix);
        const wrong = cellWrong(row, c);
        return (
          <div key={c.id} role="gridcell" className={`tc-td ${c.role} ${wrong ? 'wrong' : ''}`} title={c.role === 'expect' || c.role === 'actual' || c.role === 'name' ? text : undefined}>
            {c.role === 'status' ? <StatusMark status={st} /> : text}
          </div>
        );
      })}
      <div role="gridcell" className="tc-td tc-actions">
        {onDebug && (
          <button type="button" className="tc-act" onClick={(e) => (e.stopPropagation(), onDebug())} title={t('cases.debugTitle')} aria-label={t('cases.debugTitle')}>
            <BugIcon />
          </button>
        )}
        {onRun && (
          <button type="button" className="tc-act" onClick={(e) => (e.stopPropagation(), onRun())} title={t('cases.runTitle')} aria-label={t('cases.runTitle')}>
            <PlayIcon />
          </button>
        )}
        <button type="button" className="tc-act" onClick={(e) => (e.stopPropagation(), onCopy())} title={t('cases.copyRow')} aria-label={t('cases.copyRow')}>
          <CopyIcon />
        </button>
      </div>
    </div>
  );
}

function StatusMark({ status }: { status: ReturnType<typeof rowStatus> }) {
  if (status === 'pass') return <span className="tc-status pass">✓ {t('cases.pass')}</span>;
  if (status === 'fail') return <span className="tc-status fail">✗ {t('cases.fail')}</span>;
  return <span className="tc-status pending">{t('cases.notRun')}</span>;
}

function CaseDetailPane(props: { level: Level; table: CaseTable; row: CaseRow; radix: Radix; onDebug: (() => void) | undefined; onRun: (() => void) | undefined; onCopy: () => void }) {
  const { level, table, row, radix } = props;
  const st = rowStatus(row);
  const info = table.tests[row.test];
  const spec = caseSpec(level, table, row, radix);
  const reasons = caseReasons(level, row, radix, table.widths);
  const metric = row.result ? caseDetail(row.result)?.metric : undefined;
  return (
    <div className="tc-detail">
      <div className="tc-detail-head">
        <h3>
          {table.layout === 'text' ? (info?.title ?? '') : t('cases.caseOf', { test: row.test + 1, n: row.index + 1 })}
        </h3>
        <StatusMark status={st} />
      </div>
      {info && (
        <p className="tc-muted">
          {t(`cases.kind.${row.kind}`)} — {info.rule}
        </p>
      )}
      <div className="tc-detail-actions">
        {props.onDebug && (
          <button type="button" className="lv-btn primary small" onClick={props.onDebug} title={t('cases.debugTitle')}>
            <BugIcon />
            {t('cases.debug')}
          </button>
        )}
        {props.onRun && (
          <button type="button" className="lv-btn ghost small" onClick={props.onRun} title={t('cases.runTitle')}>
            <PlayIcon />
            {t('cases.run')}
          </button>
        )}
        <button type="button" className="lv-btn ghost small" onClick={props.onCopy}>
          <CopyIcon />
          {t('cases.copyRow')}
        </button>
      </div>

      <section className={`tc-why is-${st}`}>
        <h4>{st === 'pass' ? t('cases.why.title') : st === 'fail' ? t('cases.why.titleFail') : t('cases.why.titlePending')}</h4>
        {st === 'pending' ? (
          <p className="tc-muted">{t('cases.why.pending')}</p>
        ) : (
          <ul className="tc-reasons">
            {reasons.map((r, k) => (
              <li key={k} className={r.ok ? 'ok' : 'bad'}>
                {r.text}
              </li>
            ))}
          </ul>
        )}
        {st === 'fail' && row.result?.message && !reasons.some((r) => r.text === row.result?.message) && <p className="tc-muted tc-message">{row.result.message}</p>}
        {metric && <MetricRange value={metric.value} min={metric.min} max={metric.max} ok={metric.ok} />}
        {st === 'fail' && row.result && (row.kind === 'riscv' || row.kind === 'js') && <CaseDiffSummary result={row.result} />}
        {row.result?.summary && <p className="tc-muted">{row.result.summary}</p>}
      </section>

      <section>
        <h4>{t('cases.spec.title')}</h4>
        <dl className="tc-spec">
          {spec.map((s, k) => (
            <div key={k} className={s.block ? 'is-block' : ''}>
              <dt>{s.label}</dt>
              <dd>{s.block ? <pre>{s.value}</pre> : s.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

const svg = (children: ReactNode) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);
export const TableIcon = () =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M3 14h18M9 9v11" />
    </>,
  );
const BugIcon = () =>
  svg(
    <>
      <rect x="7" y="7" width="10" height="13" rx="5" />
      <path d="M9 7a3 3 0 0 1 6 0M12 11v9M3 13h4M17 13h4" />
    </>,
  );
const PlayIcon = () => svg(<path d="M7 5v14l11-7Z" />);
const CopyIcon = () =>
  svg(
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a1 1 0 0 1 1-1h9" />
    </>,
  );
