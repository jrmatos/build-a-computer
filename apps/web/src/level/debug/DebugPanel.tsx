/**
 * Case debugger (bottom dock tab, board levels): one test case loaded on the
 * live board. Shows the inputs, expected and actual outputs with a ✓/✗ and a
 * bit-level diff, a plain-English reason, the fan-in path of an output
 * (highlighted on the canvas), the selected part's pin values, and for clocked
 * cases a tick-by-tick timeline with the test's checkpoints.
 */
import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { Board, Level, Part } from '@build-a-computer/schema';
import type { DebugTrace } from '@build-a-computer/sim-logic';
import { pinsOf } from '@build-a-computer/sim-logic';
import { zoomToFit } from '../../editor/camera';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { probeValue } from '../../ui/Probe';
import type { Port } from '../testStripModel';
import { fanInCone } from './cone';
import {
  cycleTarget,
  describeFrame,
  explain,
  failureRank,
  neighborCase,
  outputVerdicts,
  showValue,
  valuesAt,
  type OutputVerdict,
} from './model';
import { canDebug, closeDebug, debugColumn, rerun, resultsByColumn, seek, setFocusOutput, stripPlan, useDebug, type DebugSession } from './store';
import './debug.css';

export function DebugPanel() {
  const level = useEditor((s) => s.level);
  const session = useDebug((s) => s.session);
  if (!level || !canDebug(level)) return <p className="dk-empty">{t('debug.unavailable')}</p>;
  if (!session || session.levelId !== level.id) return <EmptyDebugger level={level} />;
  return <Debugger level={level} session={session} />;
}

function EmptyDebugger({ level }: { level: Level }) {
  const run = useEditor((s) => s.testRun);
  const firstFail = useMemo(() => {
    if (!run) return -1;
    return resultsByColumn(level).findIndex((r) => r && !r.pass);
  }, [level, run]);
  return (
    <div className="dbg-empty">
      <h3>{t('debug.empty.title')}</h3>
      <p>{t('debug.empty.body')}</p>
      <div className="dbg-row">
        {firstFail >= 0 && (
          <button type="button" className="dk-btn primary" onClick={() => void debugColumn(firstFail)}>
            <BugIcon />
            {t('debug.empty.firstFail', { n: firstFail + 1 })}
          </button>
        )}
        <button type="button" className="dk-btn" onClick={() => void debugColumn(0)}>
          {t('debug.empty.first')}
        </button>
      </div>
    </div>
  );
}

function Debugger({ level, session }: { level: Level; session: DebugSession }) {
  const { trace, target } = session;
  const onlyFailing = useDebug((s) => s.onlyFailing);
  const showPath = useDebug((s) => s.showPath);
  const focusOutput = useDebug((s) => s.focusOutput);
  const run = useEditor((s) => s.testRun);
  const board = useEditor((s) => s.board);
  const plan = stripPlan(level);
  const results = useMemo(() => (run ? resultsByColumn(level) : []), [level, run]);
  const lastResult = results[target.column];
  const widths = useMemo(() => new Map([...plan.inputs, ...plan.outputs].map((p) => [p.label, p.width])), [plan]);
  const rank = failureRank(results, target.column);
  const stale = session.board !== board;

  const root = useRef<HTMLDivElement>(null);
  // Focus the debugger when a case opens, so the arrow keys step it right away.
  useEffect(() => {
    if (!root.current?.contains(document.activeElement)) root.current?.focus({ preventScroll: true });
  }, [target.column]);

  const check = trace?.checks[session.check];
  // The case's own checkpoint decides pass or fail; the table follows the timeline.
  const focusIdx = trace ? Math.min(trace.focus, trace.checks.length - 1) : -1;
  const own = trace?.checks[focusIdx];
  const outPorts: Port[] = useMemo(() => (trace ? trace.outputs.map((l) => ({ label: l, width: widths.get(l) ?? guessWidth(trace, l) })) : []), [trace, widths]);
  const inPorts: Port[] = useMemo(() => (trace ? trace.inputs.map((l) => ({ label: l, width: widths.get(l) ?? guessWidth(trace, l) })) : []), [trace, widths]);
  const verdicts = useMemo(() => outputVerdicts(check, outPorts), [check, outPorts]);
  const pass = !!own?.pass && !trace?.error;
  const timeline = !!trace && (target.kind === 'sequence' || target.kind === 'program');
  const testSpec = level.tests[target.test];
  const why = useMemo(() => {
    if (!trace || !check) return trace?.error ? [trace.error] : [];
    const step = testSpec?.kind === 'sequence' ? testSpec.steps[check.step] : undefined;
    return explain(check, verdicts, {
      kind: target.kind,
      inputs: valuesAt(trace, trace.inputs, check.frame),
      widths: new Map([...widths, ...outPorts.map((p) => [p.label, p.width] as const), ...inPorts.map((p) => [p.label, p.width] as const)]),
      ...(step ? { step: { set: step.set ?? {}, ticks: step.ticks ?? 0, power: step.power === 'cycle' } } : {}),
      ...(trace.cycles !== undefined ? { cycles: trace.cycles } : {}),
      ...(trace.halted !== undefined ? { halted: trace.halted } : {}),
    });
  }, [trace, check, verdicts, target.kind, testSpec, widths, outPorts, inPorts]);
  // The replay should agree with the last test run; say so when it does not.
  const differs = !!lastResult && !!own && lastResult.pass !== own.pass && !stale;

  const go = (dir: 1 | -1) => {
    const n = neighborCase(results, plan.count, target.column, dir, onlyFailing);
    if (n !== null) void debugColumn(n);
  };
  const frames = trace?.frames.length ?? 0;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' && !['range', 'checkbox'].includes((e.target as HTMLInputElement).type)) return;
    if (tag === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
    const f = session.frame;
    let handled = true;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      if (trace) void seek(e.shiftKey ? cycleTarget(trace.frames, f, dir) : f + dir);
    } else if (e.key === 'Home') void seek(0);
    else if (e.key === 'End') void seek(frames - 1);
    else if (e.key === 'Enter') void rerun();
    else if (e.key === 'PageDown') go(1);
    else if (e.key === 'PageUp') go(-1);
    else handled = false;
    if (handled) e.preventDefault();
  };

  const n = target.column + 1;
  return (
    <div className="dbg" ref={root} tabIndex={-1} onKeyDown={onKey} aria-label={t('debug.label')} role="region">
      <div className="dk-toolbar dbg-bar">
        <span className={`dbg-badge ${session.loading ? '' : pass ? 'pass' : 'fail'}`}>
          {session.loading ? <span className="lv-spinner" aria-hidden="true" /> : pass ? <Check /> : <Cross />}
          {session.loading ? '' : pass ? t('debug.verdict.pass') : t('debug.verdict.fail')}
        </span>
        <span className="dk-title">{t('debug.title', { n: n.toLocaleString() })}</span>
        <span className="dbg-muted dbg-kind">{t(`debug.kind.${target.kind}`, { step: target.index + 1 })}</span>
        <span className="dbg-nav" role="group" aria-label={t('debug.label')}>
          <button type="button" className="dk-btn icon" onClick={() => go(-1)} title={onlyFailing ? t('debug.prevFail') : t('debug.prev')} aria-label={onlyFailing ? t('debug.prevFail') : t('debug.prev')} disabled={neighborCase(results, plan.count, target.column, -1, onlyFailing) === null}>
            ‹
          </button>
          <button type="button" className="dk-btn icon" onClick={() => go(1)} title={onlyFailing ? t('debug.nextFail') : t('debug.next')} aria-label={onlyFailing ? t('debug.nextFail') : t('debug.next')} disabled={neighborCase(results, plan.count, target.column, 1, onlyFailing) === null}>
            ›
          </button>
          <label className="dbg-check">
            <input type="checkbox" checked={onlyFailing} onChange={(e) => useDebug.setState({ onlyFailing: e.target.checked })} />
            {t('debug.onlyFailing')}
          </label>
          <span className="dbg-muted">
            {!run ? '' : rank.total === 0 ? t('debug.noFailures') : rank.rank ? t('debug.failRank', { rank: rank.rank, total: rank.total.toLocaleString() }) : t('debug.failCount', { total: rank.total.toLocaleString() })}
          </span>
        </span>
        <span className="dk-spacer" />
        <button type="button" className={`dk-btn ${showPath ? 'is-active' : ''}`} aria-pressed={showPath} onClick={() => useDebug.setState({ showPath: !showPath })} title={t('debug.path.title')}>
          <PathIcon />
          {t('debug.path')}
        </button>
        <button type="button" className="dk-btn" onClick={() => void rerun()} title={t('debug.rerun.title')}>
          {t('debug.rerun')} <kbd>⏎</kbd>
        </button>
        <button type="button" className="dk-btn icon" onClick={() => void closeDebug()} title={t('debug.close')} aria-label={t('debug.close')}>
          ×
        </button>
      </div>

      <div className="dbg-body">
        <section className="dbg-col dbg-why">
          {session.error ? (
            <p className="dbg-why-line fail" role="alert">
              {session.error}
            </p>
          ) : !trace ? (
            <p className="dbg-muted">{t('debug.loading')}</p>
          ) : (
            <>
              {target.kind === 'sequence' && check && session.check !== focusIdx && (
                <p className="dbg-small dbg-muted dbg-other-check">
                  {t('debug.otherCheck', { n: check.step + 1, own: target.index + 1 })}
                </p>
              )}
              <div className={`dbg-reason ${check?.pass && !trace.error ? 'pass' : 'fail'}`} role="status" aria-live="polite">
                {why.map((line, k) => (
                  <p key={k}>{line}</p>
                ))}
                {stale && <p className="dbg-muted">{t('debug.stale')}</p>}
                {differs && <p className="dbg-muted">{t('debug.differs')}</p>}
              </div>
              <ValuesTable trace={trace} frame={session.frame} checkFrame={check?.frame ?? 0} inPorts={inPorts} verdicts={verdicts} focus={focusOutput} />
            </>
          )}
        </section>
        {timeline && trace && <Timeline level={level} trace={trace} session={session} widths={widths} />}
        {trace && <PathColumn board={board} label={focusOutput} verdicts={verdicts} showPath={showPath} />}
      </div>
      <p className="dbg-keys dbg-muted">{t('debug.keys')}</p>
    </div>
  );
}

function guessWidth(trace: DebugTrace, label: string): number {
  const max = Math.max(0, ...(trace.series[label] ?? []).map((v) => v ?? 0));
  return max > 1 ? 32 - Math.clz32(max) : 1;
}

function ValuesTable(props: { trace: DebugTrace; frame: number; checkFrame: number; inPorts: Port[]; verdicts: OutputVerdict[]; focus: string | null }) {
  const { trace, frame, checkFrame } = props;
  const showNow = frame !== checkFrame;
  return (
    <table className="dbg-table">
      <caption className="visually-hidden">{t('debug.values')}</caption>
      <thead>
        <tr>
          <th scope="col">{t('debug.col.signal')}</th>
          <th scope="col">{t('debug.col.expected')}</th>
          <th scope="col">{t('debug.col.actual')}</th>
          <th scope="col" aria-label={t('debug.verdict.pass')} />
          {showNow && <th scope="col">{t('debug.col.now')}</th>}
        </tr>
      </thead>
      <tbody>
        {props.inPorts.length > 0 && (
          <tr className="dbg-group">
            <th scope="rowgroup" colSpan={showNow ? 5 : 4}>
              {t('debug.inputs')}
            </th>
          </tr>
        )}
        {props.inPorts.map((p) => (
          <tr key={`i${p.label}`}>
            <th scope="row">{p.label}</th>
            <td className="dbg-mono" colSpan={3}>
              {showValue(trace.series[p.label]?.[checkFrame], p.width)}
            </td>
            {showNow && <td className="dbg-mono">{showValue(trace.series[p.label]?.[frame], p.width)}</td>}
          </tr>
        ))}
        <tr className="dbg-group">
          <th scope="rowgroup" colSpan={showNow ? 5 : 4}>
            {t('debug.outputs')}
          </th>
        </tr>
        {props.verdicts.map((v) => (
          <OutputRow key={v.label} v={v} now={showNow ? trace.series[v.label]?.[frame] : undefined} showNow={showNow} focused={props.focus === v.label} />
        ))}
      </tbody>
    </table>
  );
}

function OutputRow({ v, now, showNow, focused }: { v: OutputVerdict; now: number | null | undefined; showNow: boolean; focused: boolean }) {
  const status = t(`debug.status.${v.status}`);
  return (
    <>
      <tr className={`dbg-out is-${v.status} ${focused ? 'is-focus' : ''}`}>
        <th scope="row">
          <button type="button" className="dbg-link" aria-pressed={focused} onClick={() => setFocusOutput(v.label)} title={t('debug.showPath', { label: v.label })}>
            {v.label}
          </button>
        </th>
        <td className="dbg-mono">{v.status === 'unchecked' ? '–' : showValue(v.want, v.width)}</td>
        <td className="dbg-mono dbg-actual">{v.got === undefined ? '–' : showValue(v.got, v.width)}</td>
        <td className="dbg-mark" title={status}>
          {v.status === 'ok' ? <Check /> : v.status === 'unchecked' ? null : <Cross />}
          <span className="visually-hidden">{status}</span>
        </td>
        {showNow && <td className="dbg-mono">{showValue(now, v.width)}</td>}
      </tr>
      {v.diff && (
        <tr className="dbg-bits">
          <td colSpan={showNow ? 5 : 4}>
            <BitRow name={t('debug.bits.expected')} text={v.diff.want} differ={v.diff.differ} />
            <BitRow name={t('debug.bits.actual')} text={v.diff.got} differ={v.diff.differ} actual />
          </td>
        </tr>
      )}
    </>
  );
}

function BitRow({ name, text, differ, actual }: { name: string; text: string; differ: number[]; actual?: boolean }) {
  const w = text.length;
  return (
    <div className="dbg-bitrow">
      <span className="dbg-muted">{name}</span>
      <span className="dbg-mono">
        {[...text].map((ch, i) => {
          const bit = w - 1 - i;
          const bad = differ.includes(bit);
          return (
            <span key={i} className={`dbg-bit ${bad ? (actual ? 'bad' : 'want') : ''} ${bit % 4 === 0 && bit > 0 ? 'gap' : ''}`} title={`bit ${bit}`}>
              {ch}
            </span>
          );
        })}
      </span>
    </div>
  );
}

const LANE_FRAMES = 600;

function Timeline({ level, trace, session, widths }: { level: Level; trace: DebugTrace; session: DebugSession; widths: Map<string, number> }) {
  const frames = trace.frames.length;
  const f = session.frame;
  const kind = session.target.kind;
  const test = level.tests[session.target.test];
  const pct = (i: number) => (frames > 1 ? (i / (frames - 1)) * 100 : 0);
  return (
    <section className="dbg-col dbg-time" aria-label={t('debug.timeline')}>
      <div className="dbg-row dbg-transport">
        <button type="button" className="dk-btn icon" onClick={() => void seek(0)} title={t('debug.start')} aria-label={t('debug.start')} disabled={f === 0}>
          ⏮
        </button>
        <button type="button" className="dk-btn icon" onClick={() => void seek(cycleTarget(trace.frames, f, -1))} title={t('debug.cycleBack')} aria-label={t('debug.cycleBack')} disabled={f === 0}>
          «
        </button>
        <button type="button" className="dk-btn icon" onClick={() => void seek(f - 1)} title={t('debug.tickBack')} aria-label={t('debug.tickBack')} disabled={f === 0}>
          ‹
        </button>
        <button type="button" className="dk-btn icon" onClick={() => void seek(f + 1)} title={t('debug.tickFwd')} aria-label={t('debug.tickFwd')} disabled={f >= frames - 1}>
          ›
        </button>
        <button type="button" className="dk-btn icon" onClick={() => void seek(cycleTarget(trace.frames, f, 1))} title={t('debug.cycleFwd')} aria-label={t('debug.cycleFwd')} disabled={f >= frames - 1}>
          »
        </button>
        <button type="button" className="dk-btn icon" onClick={() => void seek(frames - 1)} title={t('debug.end')} aria-label={t('debug.end')} disabled={f >= frames - 1}>
          ⏭
        </button>
        <span className="dbg-frame">
          <strong>{describeFrame(trace.frames[f], kind)}</strong>
          <span className="dbg-muted"> · {t('debug.frameOf', { n: f + 1, total: frames.toLocaleString() })}</span>
        </span>
      </div>
      <div className="dbg-scrub">
        <div className="dbg-marks">
          {trace.checks.map((c, k) => {
            const nothing = Object.keys(c.expect).length === 0 && c.pass;
            if (nothing) return null;
            return (
              <button
                key={k}
                type="button"
                className={`dbg-markpin ${c.pass ? 'pass' : 'fail'} ${k === session.check ? 'is-current' : ''} ${k === trace.focus ? 'is-focus' : ''}`}
                style={{ left: `${pct(c.frame)}%` }}
                onClick={() => void seek(c.frame, k)}
                title={t('debug.checkpoint.go', { n: c.step + 1, status: c.pass ? t('debug.verdict.pass') : t('debug.verdict.fail') })}
                aria-label={t('debug.checkpoint.go', { n: c.step + 1, status: c.pass ? t('debug.verdict.pass') : t('debug.verdict.fail') })}
              />
            );
          })}
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0, frames - 1)}
          value={f}
          aria-label={t('debug.scrub')}
          aria-valuetext={describeFrame(trace.frames[f], kind)}
          onChange={(e) => void seek(Number(e.target.value))}
          onKeyDown={(e) => {
            // The debugger's keys (tick / cycle) win over the slider's own arrows.
            if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') e.preventDefault();
          }}
        />
      </div>
      {frames <= LANE_FRAMES && <Lanes trace={trace} frame={f} widths={widths} />}
      {trace.truncated && <p className="dbg-muted">{t('debug.truncated', { n: frames.toLocaleString() })}</p>}
      {kind === 'program' && test?.kind === 'program' && trace.cycles !== undefined && (
        <p className="dbg-muted">
          {trace.halted ? t('debug.program.halted', { cycles: trace.cycles.toLocaleString(), max: test.maxCycles.toLocaleString() }) : t('debug.program.ran', { cycles: trace.cycles.toLocaleString(), max: test.maxCycles.toLocaleString() })}
        </p>
      )}
      {kind === 'sequence' && <Checkpoints trace={trace} session={session} />}
      <p className="dbg-muted dbg-small">{t('debug.pinned')}</p>
    </section>
  );
}

function Checkpoints({ trace, session }: { trace: DebugTrace; session: DebugSession }) {
  return (
    <ol className="dbg-checks" aria-label={t('debug.checkpoints')}>
      {trace.checks.map((c, k) => {
        const exp = Object.entries(c.expect);
        return (
          <li key={k}>
            <button
              type="button"
              className={`dbg-checkbtn ${exp.length === 0 && c.pass ? 'none' : c.pass ? 'pass' : 'fail'} ${k === session.check ? 'is-current' : ''} ${k === trace.focus ? 'is-focus' : ''}`}
              onClick={() => void seek(c.frame, k)}
            >
              <span className="dbg-checkn">{t('debug.checkpoint', { n: c.step + 1 })}</span>
              {exp.length === 0 && c.pass ? <span className="dbg-muted">{t('debug.checkpoint.none')}</span> : c.pass ? <Check /> : <Cross />}
              <span className="dbg-mono dbg-checkvals">
                {exp.map(([l, v]) => {
                  const got = c.actual[l];
                  return got === v ? `${l}=${v}` : `${l}=${got === null || got === undefined ? 'X' : got}≠${v}`;
                }).join(' ')}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Tiny waveform of the case's labelled signals, with the current frame and checkpoints; click to seek. */
function Lanes({ trace, frame, widths }: { trace: DebugTrace; frame: number; widths: Map<string, number> }) {
  const labels = [...trace.inputs, ...trace.outputs];
  const n = trace.frames.length;
  const W = 600;
  const LH = 18;
  const H = labels.length * LH;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * (W - 8) + 4 : 4);
  const seekAt = (e: ReactMouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    void seek(Math.round(((fx - 4) / (W - 8)) * (n - 1)));
  };
  return (
    <div className="dbg-lanes">
      <div className="dbg-lane-names" aria-hidden="true">
        {labels.map((l) => (
          <span key={l} style={{ height: LH }}>
            {l}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" height={H} onClick={seekAt} role="img" aria-label={t('debug.timeline')}>
        {trace.checks.map((c, k) => (
          <line key={`c${k}`} x1={x(c.frame)} x2={x(c.frame)} y1={0} y2={H} className={`dbg-lane-check ${c.pass ? 'pass' : 'fail'}`} />
        ))}
        {labels.map((l, row) => {
          const series = trace.series[l] ?? [];
          const width = widths.get(l) ?? 1;
          const top = row * LH + 3;
          const bottom = top + LH - 6;
          if (width <= 1) {
            let d = '';
            series.forEach((v, i) => {
              const y = v === 1 ? top : v === 0 ? bottom : (top + bottom) / 2;
              d += i === 0 ? `M${x(0)} ${y}` : `H${x(i)} V${y}`;
            });
            d += `H${W - 4}`;
            return <path key={l} d={d} className={`dbg-lane ${trace.outputs.includes(l) ? 'out' : 'in'}`} />;
          }
          const segs: ReactNode[] = [];
          let start = 0;
          for (let i = 1; i <= series.length; i++) {
            if (i < series.length && series[i] === series[start]) continue;
            const x0 = x(start);
            const x1 = i < series.length ? x(i) : W - 4;
            segs.push(
              <g key={`${l}${start}`}>
                <rect x={x0} y={top} width={Math.max(0.5, x1 - x0)} height={bottom - top} rx={2} className={`dbg-bus ${trace.outputs.includes(l) ? 'out' : 'in'}`} />
                {x1 - x0 > 22 && (
                  <text x={(x0 + x1) / 2} y={(top + bottom) / 2 + 3.5} textAnchor="middle" className="dbg-bus-text">
                    {series[start] === null ? 'X' : String(series[start])}
                  </text>
                )}
              </g>,
            );
            start = i;
          }
          return <g key={l}>{segs}</g>;
        })}
        <line x1={x(frame)} x2={x(frame)} y1={0} y2={H} className="dbg-cursor" />
      </svg>
    </div>
  );
}

function partName(p: Part | undefined): string {
  if (!p) return '?';
  return p.label?.trim() || t(`part.${p.type}`);
}

function PathColumn({ board, label, verdicts, showPath }: { board: Board; label: string | null; verdicts: OutputVerdict[]; showPath: boolean }) {
  const chips = useEditor((s) => s.chips);
  const selection = useEditor((s) => s.selection);
  const snapshot = useEditor((s) => s.snapshot);
  const lamp = label ? board.parts.find((p) => p.label === label && p.type === 'lamp') : undefined;
  const cone = useMemo(() => (lamp ? fanInCone(board, lamp.id, chips) : null), [board, lamp, chips]);
  const byId = useMemo(() => new Map(board.parts.map((p) => [p.id, p])), [board]);
  const selected = selection.length === 1 ? byId.get(selection[0]!) : undefined;
  const list = cone ? cone.parts.filter((id) => id !== lamp?.id) : [];
  const MAX = 24;

  const pinValue = (part: Part, pin: string, width: number): string => {
    const { value } = probeValue(board, snapshot, { kind: 'pin', ref: { part: part.id, pin } });
    if (!value) return '–';
    return value.x ? 'X' : showValue(value.v >>> 0, width);
  };
  const outValue = (part: Part): string => {
    const outs = pinsOf(part, chips).filter((q) => q.dir === 'out');
    return outs.length === 1 ? pinValue(part, outs[0]!.name, outs[0]!.width) : '';
  };
  const pick = (id: string) => {
    useEditor.getState().setSelection([id]);
    zoomToFit([id, ...(cone ? cone.parts : [])]);
  };

  return (
    <section className="dbg-col dbg-path" aria-label={label ? t('debug.path.heading', { label }) : t('debug.path')}>
      <div className="dbg-row dbg-outs" role="group" aria-label={t('debug.outputs')}>
        {verdicts.map((v) => (
          <button key={v.label} type="button" className={`dbg-chip is-${v.status} ${label === v.label ? 'is-focus' : ''}`} aria-pressed={label === v.label} onClick={() => setFocusOutput(v.label)}>
            {v.status === 'ok' ? <Check /> : v.status === 'unchecked' ? null : <Cross />}
            {v.label}
          </button>
        ))}
      </div>
      {!label ? (
        <p className="dbg-muted">{t('debug.path.none')}</p>
      ) : !lamp ? (
        <p className="dbg-muted">{t('debug.path.noLamp', { label })}</p>
      ) : (
        cone && (
          <>
            <p className={`dbg-small ${showPath ? '' : 'dbg-muted'}`}>{t('debug.path.summary', { parts: list.length, wires: cone.wires.length, label })}</p>
            <ul className="dbg-parts" aria-label={t('debug.path.parts')}>
              {list.slice(0, MAX).map((id) => {
                const p = byId.get(id);
                return (
                  <li key={id}>
                    <button type="button" className={`dbg-part ${selected?.id === id ? 'is-selected' : ''}`} onClick={() => p && pick(id)}>
                      <span>{partName(p)}</span>
                      {p && <span className="dbg-mono dbg-muted">{outValue(p)}</span>}
                    </button>
                  </li>
                );
              })}
              {list.length > MAX && <li className="dbg-muted dbg-small">{t('debug.path.more', { n: list.length - MAX })}</li>}
            </ul>
          </>
        )
      )}
      <div className="dbg-selected">
        <h4>{t('debug.selected')}</h4>
        {selected ? (
          <>
            <p className="dbg-small">
              <strong>{partName(selected)}</strong>
            </p>
            <dl className="dbg-pins">
              {pinsOf(selected, chips).map((q) => (
                <div key={q.name} className={q.dir === 'out' ? 'out' : 'in'}>
                  <dt title={t(`debug.pin.${q.dir}`)}>
                    {q.dir === 'out' ? '→ ' : ''}
                    {q.name}
                  </dt>
                  <dd className="dbg-mono">{pinValue(selected, q.name, q.width)}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p className="dbg-muted dbg-small">{t('debug.selected.hint')}</p>
        )}
      </div>
    </section>
  );
}

const Check = () => (
  <svg className="dbg-ico pass" width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M1.5 5.2 4 7.6 8.6 2.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Cross = () => (
  <svg className="dbg-ico fail" width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M2 2 8 8M8 2 2 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const PathIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="5" cy="6" r="2" />
    <circle cx="5" cy="18" r="2" />
    <circle cx="19" cy="12" r="2" />
    <path d="M7 6h4l4 6M7 18h4l4-6" />
  </svg>
);

/** Bug icon for Debug buttons. */
export const BugIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="7" y="7" width="10" height="13" rx="5" />
    <path d="M9 7a3 3 0 0 1 6 0M12 11v9M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 20l3-2M20 20l-3-2" />
  </svg>
);
