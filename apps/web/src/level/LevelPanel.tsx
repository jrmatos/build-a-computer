import { useMemo, useState, type ReactNode } from 'react';
import { LEVELS } from '@ground-up/content';
import type { Level } from '@ground-up/schema';
import type { CaseResult } from '@ground-up/sim-logic';
import { useEditor, type TestRun } from '../editor/store';
import { t } from '../i18n';
import { BulbIcon, CheckIcon, ChevronIcon, CrossIcon, MapIcon } from './icons';
import { openLevel } from './persist';
import { newlyUnlockedParts, nextLevel } from './progress';
import { canRunTests, runLevelTests } from './runTests';
import { useLevelUi } from './ui';
import './level.css';

const COLLAPSE_KEY = 'ground-up:level-panel-collapsed';
/** Rows rendered at most; the first failure is always included. */
const MAX_ROWS = 256;

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Right-dock island: objective, hints, test runner and the success card. */
export function LevelPanel() {
  const level = useEditor((s) => s.level);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  if (!level) return null;

  const toggle = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '0' : '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <section className={`island level-panel ${collapsed ? 'is-collapsed' : ''}`} aria-label={t('level.panel.label')}>
      <header className="lp-head">
        <button
          type="button"
          className="lp-collapse"
          aria-expanded={!collapsed}
          aria-controls="level-panel-body"
          onClick={toggle}
          title={collapsed ? t('level.panel.expand') : t('level.panel.collapse')}
        >
          <ChevronIcon open={!collapsed} />
          <span className="lp-kicker">{kicker(level)}</span>
        </button>
        {level.draft && level.track !== 'sandbox' && <span className="lv-chip">{t('level.draft')}</span>}
        <button
          type="button"
          className="lv-icon-btn small"
          onClick={() => useEditor.getState().set({ levelsOpen: true })}
          title={t('level.levels')}
          aria-label={t('level.levels')}
        >
          <MapIcon />
        </button>
      </header>
      {!collapsed && (
        <div className="lp-body" id="level-panel-body">
          {level.track === 'sandbox' ? <SandboxBody /> : <LevelBody key={level.id} level={level} />}
        </div>
      )}
    </section>
  );
}

function kicker(level: Level): string {
  if (level.track === 'sandbox') return t('level.sandbox.kicker');
  return t('level.kicker', { phase: level.phase, name: phaseName(level.phase), order: level.order });
}

export function phaseName(phase: number): string {
  const key = `level.phase.${phase}`;
  const name = t(key);
  return name === key ? t('level.phase.n', { n: phase }) : name;
}

function SandboxBody() {
  return (
    <>
      <h2 className="lp-title">{t('level.sandbox.title')}</h2>
      <p className="lp-goal">{t('level.sandbox.body')}</p>
      <button type="button" className="lv-btn primary block" onClick={() => useEditor.getState().set({ levelsOpen: true })}>
        <MapIcon />
        {t('level.levels')}
      </button>
    </>
  );
}

function LevelBody({ level }: { level: Level }) {
  const testRun = useEditor((s) => s.testRun);
  const completed = useEditor((s) => s.completed.includes(level.id));
  const justCompleted = useLevelUi((s) => s.justCompleted === level.id);
  const [hints, setHints] = useState(0);
  const runnable = canRunTests(level);
  const running = !!testRun?.running;

  return (
    <>
      <h2 className="lp-title">
        {level.title}
        {completed && (
          <span className="lp-done" title={t('level.completed')}>
            <CheckIcon size={16} />
            <span className="visually-hidden">{t('level.completed')}</span>
          </span>
        )}
      </h2>
      <p className="lp-goal">{level.goal}</p>
      {level.tutorial && <p className="lp-tutorial">{level.tutorial}</p>}

      {level.hints.length > 0 && (
        <div className="lp-hints">
          {level.hints.slice(0, hints).map((h, i) => (
            <p key={i} className="lp-hint">
              <BulbIcon />
              <span>{h}</span>
            </p>
          ))}
          {hints < level.hints.length && (
            <button type="button" className="lv-btn ghost" onClick={() => setHints(hints + 1)}>
              <BulbIcon />
              {t('level.hint.show', { n: hints + 1, total: level.hints.length })}
            </button>
          )}
        </div>
      )}

      {justCompleted && <SuccessCard level={level} />}

      <div className="lp-tests">
        <button
          type="button"
          className="lv-btn primary block"
          disabled={!runnable || running}
          onClick={() => void runLevelTests()}
          title={`${t('level.tests.run')} — Ctrl+Enter`}
        >
          {running ? <span className="lv-spinner" aria-hidden="true" /> : null}
          {running ? t('level.tests.running') : t('level.tests.run')}
        </button>
        {runnable && <ResultsTable level={level} run={testRun} />}
      </div>
    </>
  );
}

function SuccessCard({ level }: { level: Level }) {
  const next = useMemo(() => nextLevel(level, LEVELS), [level]);
  const parts = newlyUnlockedParts(level, next);
  return (
    <div className="lp-success" role="status">
      <div className="lp-success-badge" aria-hidden="true">
        <CheckIcon size={22} />
      </div>
      <h3>{t('level.success.title')}</h3>
      {level.afterword && <p>{level.afterword}</p>}
      {parts.length > 0 && (
        <p className="lp-unlocked">
          <span>{t('level.success.unlocked')}</span>
          {parts.map((p) => (
            <span key={p} className="lv-chip accent">
              {t(`part.${p}`)}
            </span>
          ))}
        </p>
      )}
      <div className="lp-success-actions">
        {next ? (
          <button type="button" className="lv-btn primary" onClick={() => void openLevel(next.id)}>
            {t('level.success.next', { title: next.title })}
          </button>
        ) : (
          <p className="lp-muted">{t('level.success.trackDone')}</p>
        )}
        <button type="button" className="lv-btn ghost" onClick={() => useLevelUi.getState().set({ justCompleted: null })}>
          {t('level.success.stay')}
        </button>
      </div>
    </div>
  );
}

interface Row {
  key: number;
  inputs: Record<string, number>;
  expect: Record<string, number>;
  result?: CaseResult;
}

function ResultsTable({ level, run }: { level: Level; run: TestRun | null }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const { rows, inputs, outputs } = useMemo(() => {
    const rows: Row[] = [];
    const ins = new Set<string>();
    const outs = new Set<string>();
    for (const test of level.tests)
      for (const r of test.kind === 'truth-table' ? test.rows : []) {
        Object.keys(r.inputs).forEach((k) => ins.add(k));
        Object.keys(r.expect).forEach((k) => outs.add(k));
        rows.push({ key: rows.length, inputs: r.inputs, expect: r.expect });
      }
    return { rows, inputs: [...ins], outputs: [...outs] };
  }, [level]);

  // Results arrive in order; pair them with rows by arrival position.
  const results = run?.cases ?? [];
  const firstFail = results.findIndex((c) => !c.pass);
  const shown = rows.slice(0, MAX_ROWS);
  if (firstFail >= MAX_ROWS && rows[firstFail]) shown.push(rows[firstFail]!);
  const done = run && !run.running;

  const toggle = (i: number) => {
    const next = new Set(open);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setOpen(next);
  };

  return (
    <div className="lp-results">
      {run && (
        <p className={`lp-summary ${done ? (run.passed === run.total ? 'pass' : 'fail') : ''}`} role="status" aria-live="polite">
          {done
            ? t('level.tests.summary', { passed: run.passed, total: run.total })
            : t('level.tests.progress', { done: results.length, total: run.total })}
        </p>
      )}
      <div className="lp-table-wrap">
        <table className="lp-table">
          <thead>
            <tr>
              <th className="st" aria-label={t('level.tests.status')} />
              {inputs.map((k) => (
                <th key={`i${k}`} className="in">
                  {k}
                </th>
              ))}
              {outputs.map((k) => (
                <th key={`o${k}`} className="out" title={t('level.tests.expectedActual')}>
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const res = results[row.key];
              const isFirst = row.key === firstFail;
              const expanded = !!res && !res.pass && (open.has(row.key) !== isFirst);
              const cls = res ? (res.pass ? 'pass' : 'fail') : 'pending';
              const cells: ReactNode[] = [
                <td key="st" className="st">
                  {res ? res.pass ? <CheckIcon size={14} /> : <CrossIcon size={14} /> : <span className="dot" />}
                  <span className="visually-hidden">{res ? (res.pass ? t('level.tests.pass') : t('level.tests.fail')) : ''}</span>
                </td>,
                ...inputs.map((k) => (
                  <td key={`i${k}`} className="in">
                    {row.inputs[k] ?? '–'}
                  </td>
                )),
                ...outputs.map((k) => {
                  const want = row.expect[k];
                  const got = res?.actual[k];
                  const wrong = res && got !== undefined && want !== undefined && got !== String(want);
                  return (
                    <td key={`o${k}`} className={`out ${wrong ? 'wrong' : ''}`}>
                      {wrong ? (
                        <>
                          <span className="got">{got}</span>
                          <span className="want">{t('level.tests.want', { v: want ?? '–' })}</span>
                        </>
                      ) : (
                        <span className={res ? '' : 'exp'}>{want ?? '–'}</span>
                      )}
                    </td>
                  );
                }),
              ];
              return (
                <RowView
                  key={row.key}
                  className={`${cls} ${isFirst ? 'first-fail' : ''}`}
                  cells={cells}
                  colSpan={1 + inputs.length + outputs.length}
                  expanded={expanded}
                  message={res?.message}
                  onClick={res && !res.pass ? () => toggle(row.key) : undefined}
                />
              );
            })}
          </tbody>
        </table>
        {rows.length > shown.length && <p className="lp-muted small">{t('level.tests.more', { n: rows.length - shown.length })}</p>}
      </div>
    </div>
  );
}

function RowView(props: {
  className: string;
  cells: ReactNode[];
  colSpan: number;
  expanded: boolean;
  message?: string | undefined;
  onClick?: (() => void) | undefined;
}) {
  return (
    <>
      <tr
        className={props.className}
        onClick={props.onClick}
        tabIndex={props.onClick ? 0 : undefined}
        aria-expanded={props.onClick ? props.expanded : undefined}
        onKeyDown={(e) => {
          if (props.onClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            props.onClick();
          }
        }}
      >
        {props.cells}
      </tr>
      {props.expanded && (
        <tr className="detail">
          <td colSpan={props.colSpan}>{props.message ?? t('level.tests.mismatch')}</td>
        </tr>
      )}
    </>
  );
}
