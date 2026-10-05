import { useEffect, useMemo, useRef, useState } from 'react';
import { LEVELS } from '@build-a-computer/content';
import type { Level } from '@build-a-computer/schema';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { BulbIcon, CheckIcon, ChevronIcon, MapIcon } from './icons';
import { openLevel } from './persist';
import { newlyUnlockedParts, nextLevel } from './progress';
import { canRunTests, runLevelTests } from './runTests';
import { TestStripSection } from './TestStrip';
import { useLevelUi } from './ui';
import './level.css';
import { Markdown, inline } from './Markdown';
import { loadSolution } from './solution';
import { zoomToFit } from '../editor/camera';

const COLLAPSE_KEY = 'build-a-computer:level-panel-collapsed';

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
  const inChip = useEditor((s) => s.editStack.length > 0);
  const runnable = canRunTests(level) && !inChip;
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
      {level.tutorial && <Markdown className="lp-tutorial" text={level.tutorial} />}

      {level.hints.length > 0 && (
        <div className="lp-hints">
          {level.hints.slice(0, hints).map((h, i) => (
            <p key={i} className="lp-hint">
              <BulbIcon />
              <span>{inline(h)}</span>
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
      {level.tests.length > 0 && !inChip && <ShowSolution level={level} />}

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
        {inChip && <p className="lp-chip-note">{t('level.tests.inChip')}</p>}
        {runnable && <TestStripSection level={level} run={testRun} />}
      </div>

      {justCompleted && <SuccessCard level={level} />}
    </>
  );
}

function SuccessCard({ level }: { level: Level }) {
  const next = useMemo(() => nextLevel(level, LEVELS), [level]);
  const parts = newlyUnlockedParts(level, next);
  const ref = useRef<HTMLDivElement>(null);
  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and an
  // effect must return nothing or a cleanup function.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  return (
    <div className="lp-success" role="status" ref={ref}>
      <div className="lp-success-badge" aria-hidden="true">
        <CheckIcon size={22} />
      </div>
      <h3>{t('level.success.title')}</h3>
      {level.afterword && <Markdown text={level.afterword} />}
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

/**
 * "Show solution" (ADR-007): two clicks, so it is never pressed by accident.
 * Replaces the board as one undo step, so Ctrl+Z brings the player's attempt back.
 */
function ShowSolution({ level }: { level: Level }) {
  const [state, setState] = useState<'idle' | 'confirm' | 'loading'>('idle');
  if (state === 'idle')
    return (
      <button type="button" className="lv-btn ghost lp-solution" onClick={() => setState('confirm')}>
        {t('level.solution.show')}
      </button>
    );
  const reveal = async () => {
    setState('loading');
    const { commit, toast } = useEditor.getState();
    try {
      const board = await loadSolution(level);
      if (!board) {
        toast(t('level.solution.none'), 'info');
        return;
      }
      commit(() => board, []);
      requestAnimationFrame(() => requestAnimationFrame(() => zoomToFit()));
      toast(t('level.solution.loaded'), 'success');
    } finally {
      setState('idle');
    }
  };
  return (
    <div className="lp-solution-confirm" role="group" aria-label={t('level.solution.show')}>
      <p>{t('level.solution.confirm')}</p>
      <div>
        <button type="button" className="lv-btn primary" disabled={state === 'loading'} onClick={() => void reveal()}>
          {t('level.solution.yes')}
        </button>
        <button type="button" className="lv-btn ghost" onClick={() => setState('idle')}>
          {t('level.solution.cancel')}
        </button>
      </div>
    </div>
  );
}
