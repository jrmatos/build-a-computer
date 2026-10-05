import { useEffect, useMemo, useRef } from 'react';
import { LEVELS, levelById } from '@build-a-computer/content';
import type { Level } from '@build-a-computer/schema';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { CheckIcon, CrossIcon, LockIcon } from './icons';
import { phaseName } from './LevelPanel';
import { exportProgressFile, getProgress, importProgressFile, openLevel } from './persist';
import { groupLevels, isOutdated, levelState } from './progress';
import './level.css';

/** Modal level map (LVL-06): levels grouped by track and phase; locked, open or completed. */
export function LevelSelect() {
  const open = useEditor((s) => s.levelsOpen);
  if (!open) return null;
  return <LevelMap />;
}

function LevelMap() {
  const completed = useEditor((s) => s.completed);
  const current = useEditor((s) => s.level?.id);
  const groups = useMemo(() => groupLevels(LEVELS), []);
  const dialog = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const close = () => useEditor.getState().set({ levelsOpen: false });
  const progress = getProgress();
  const total = LEVELS.filter((l) => l.track !== 'sandbox').length;
  const done = LEVELS.filter((l) => l.track !== 'sandbox' && completed.includes(l.id)).length;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = dialog.current;
    (el?.querySelector<HTMLElement>('.lm-card.is-current:not([aria-disabled="true"])') ??
      el?.querySelector<HTMLElement>('.lm-card:not([aria-disabled="true"])'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'Tab' && el) {
        // Keep focus inside the dialog.
        const items = [...el.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')].filter(
          (n) => !n.hasAttribute('disabled') && n.offsetParent !== null,
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="lm-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="island lm-dialog" role="dialog" aria-modal="true" aria-labelledby="lm-title" ref={dialog}>
        <header className="lm-head">
          <div>
            <h2 id="lm-title">{t('level.map.title')}</h2>
            <p className="lp-muted">{t('level.map.progress', { done, total })}</p>
          </div>
          <button type="button" className="lv-icon-btn" onClick={close} aria-label={t('level.map.close')} title={t('level.map.close')}>
            <CrossIcon />
          </button>
        </header>
        <div className="lm-scroll">
          {groups.map((g) => (
            <section key={`${g.track}:${g.phase}`} className="lm-group" aria-label={groupTitle(g.track, g.phase)}>
              <h3>
                {g.track !== 'sandbox' && <span className="lm-phase-num">{g.phase}</span>}
                {groupTitle(g.track, g.phase)}
              </h3>
              <div className="lm-grid">
                {g.levels.map((l) => (
                  <LevelCard
                    key={l.id}
                    level={l}
                    state={levelState(l, completed)}
                    current={l.id === current}
                    outdated={isOutdated(progress, l)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
        <footer className="lm-foot">
          <span className="lp-muted small">{t('level.map.progressFile')}</span>
          <button type="button" className="lv-btn ghost" onClick={exportProgressFile}>
            {t('level.map.export')}
          </button>
          <button type="button" className="lv-btn ghost" onClick={() => file.current?.click()}>
            {t('level.map.import')}
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importProgressFile(f);
            }}
          />
        </footer>
      </div>
    </div>
  );
}

function groupTitle(track: Level['track'], phase: number): string {
  if (track === 'sandbox') return t('level.map.sandbox');
  return `${t(`level.track.${track}`)} · ${phaseName(phase)}`;
}

function LevelCard(props: { level: Level; state: 'locked' | 'open' | 'completed'; current: boolean; outdated: boolean }) {
  const { level, state, current, outdated } = props;
  const locked = state === 'locked';
  const missing = level.requires.filter((id) => !useEditor.getState().completed.includes(id));
  const requires = missing.map((id) => levelById(id)?.title ?? id).join(', ');
  const label = `${level.title}. ${
    locked ? t('level.map.lockedRequires', { list: requires }) : state === 'completed' ? t('level.completed') : t('level.map.open')
  }`;
  return (
    <button
      type="button"
      className={`lm-card is-${state} ${current ? 'is-current' : ''}`}
      aria-disabled={locked}
      aria-label={label}
      aria-current={current ? 'true' : undefined}
      onClick={() => {
        if (!locked) void openLevel(level.id);
      }}
    >
      <span className="lm-card-top">
        <span className="lm-order">{level.track === 'sandbox' ? '∞' : level.order}</span>
        <span className="lm-state" aria-hidden="true">
          {locked ? <LockIcon size={16} /> : state === 'completed' ? <CheckIcon size={16} /> : null}
        </span>
      </span>
      <span className="lm-card-title">{level.title}</span>
      <span className="lm-card-sub">
        {locked ? t('level.map.requires', { list: requires }) : level.track === 'sandbox' ? t('level.map.free') : level.goal}
      </span>
      <span className="lm-badges">
        {current && <span className="lv-chip accent">{t('level.map.current')}</span>}
        {outdated && <span className="lv-chip">{t('level.map.updated')}</span>}
        {level.draft && level.track !== 'sandbox' && <span className="lv-chip">{t('level.draft')}</span>}
      </span>
    </button>
  );
}
