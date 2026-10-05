/**
 * Achievements UI: the layer (starts the runtime, shows unlock toasts and the
 * dialog), the dialog itself, the level map trophy chip and the success card
 * list. Excalidraw-style islands, tier colors from achievements.css.
 */
import { useEffect, useMemo, useState } from 'react';
import { LEVELS } from '@build-a-computer/content';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { Dialog } from '../ui/Dialog';
import { IconClose } from '../ui/icons';
import {
  ACHIEVEMENTS,
  CATEGORIES,
  TIER_POINTS,
  achievementById,
  type AchievementDef,
  type Category,
} from './definitions';
import { contextOf, points, progressOf } from './engine';
import { AchievementIcon, SmallLockIcon, TrophyIcon } from './icons';
import {
  closeAchievements,
  dismissAchievementToast,
  openAchievements,
  startAchievements,
  useAchievements,
  type AchievementToast,
} from './runtime';
import './achievements.css';

const title = (d: AchievementDef) => t(`ach.${d.id}.title`);
const desc = (d: AchievementDef) => t(`ach.${d.id}.desc`);

/** Mounted once (from the main menu): starts the runtime, renders toasts and the dialog. */
export function AchievementsLayer() {
  const open = useAchievements((s) => s.dialogOpen);
  useEffect(() => {
    void startAchievements();
  }, []);
  return (
    <>
      <AchievementToasts />
      {open && <AchievementsDialog />}
    </>
  );
}

// ---------------------------------------------------------------- medal

function Medal({
  def,
  unlocked,
  size = 'md',
}: {
  def: AchievementDef;
  unlocked: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const secret = def.hidden && !unlocked;
  return (
    <span
      className={`ach-medal ach-medal--${size} tier-${def.tier} ${unlocked ? 'is-unlocked' : 'is-locked'}`}
      aria-hidden="true"
    >
      {secret ? (
        <span className="ach-medal__q">?</span>
      ) : (
        <AchievementIcon name={def.icon} size={size === 'sm' ? 16 : size === 'lg' ? 26 : 22} />
      )}
      {!unlocked && !secret && (
        <span className="ach-medal__lock">
          <SmallLockIcon size={9} />
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- toasts

function AchievementToasts() {
  const toasts = useAchievements((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="ach-toasts" role="region" aria-label={t('ach.toast.label')}>
      <div role="status" aria-live="polite" className="ach-toasts__stack">
        {toasts.map((toast) => (
          <ToastCard key={toast.key} toast={toast} />
        ))}
      </div>
    </div>
  );
}

function ToastCard({ toast }: { toast: AchievementToast }) {
  const defs = toast.ids.map(achievementById).filter((d): d is AchievementDef => !!d);
  const first = defs[0];
  if (!first) return null;
  const many = defs.length > 1;
  const top = many
    ? defs.reduce((a, b) => (TIER_POINTS[b.tier] > TIER_POINTS[a.tier] ? b : a))
    : first;
  const view = () => {
    dismissAchievementToast(toast.key);
    openAchievements();
  };
  return (
    <div className={`island ach-toast tier-${top.tier}`}>
      <Medal def={top} unlocked size="lg" />
      <div className="ach-toast__text">
        <span className="ach-toast__kicker">
          {many
            ? t('ach.toast.many', { count: defs.length })
            : `${t('ach.toast.kicker')} · ${t(`ach.tier.${first.tier}`)}`}
        </span>
        <strong>{many ? defs.map(title).join(', ') : title(first)}</strong>
        {!many && <span className="ach-toast__desc">{desc(first)}</span>}
      </div>
      <div className="ach-toast__actions">
        <button type="button" className="gu-btn ach-toast__view" onClick={view}>
          {t('ach.toast.open')}
        </button>
        <button
          type="button"
          className="gu-icon-btn gu-icon-btn--sm"
          aria-label={t('toasts.dismiss')}
          onClick={() => dismissAchievementToast(toast.key)}
        >
          <IconClose size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- dialog

type Filter = 'all' | 'unlocked' | 'locked';
const FILTERS: Filter[] = ['all', 'unlocked', 'locked'];

function useCtx() {
  const saved = useAchievements((s) => s.saved);
  const session = useAchievements((s) => s.session);
  const completed = useEditor((s) => s.completed);
  return useMemo(
    () => contextOf({ saved, session }, { levels: LEVELS, completed: new Set(completed) }),
    [saved, session, completed],
  );
}

function AchievementsDialog() {
  const ctx = useCtx();
  const [filter, setFilter] = useState<Filter>('all');
  const unlocked = ctx.saved.unlocked;
  const done = ACHIEVEMENTS.filter((d) => unlocked[d.id]).length;
  const total = ACHIEVEMENTS.length;
  const pts = points(ctx.saved);
  const maxPts = ACHIEVEMENTS.reduce((s, d) => s + TIER_POINTS[d.tier], 0);
  const date = useMemo(() => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }), []);
  const pct = Math.round((done / total) * 100);

  const shown = (d: AchievementDef) =>
    filter === 'all' || (filter === 'unlocked') === !!unlocked[d.id];

  return (
    <Dialog title={t('ach.dialog.title')} onClose={closeAchievements} size="lg">
      <div className="ach-summary">
        <div className="ach-ring" style={{ ['--pct' as string]: `${pct}%` }} aria-hidden="true">
          <TrophyIcon size={22} />
        </div>
        <div className="ach-summary__text">
          <strong>{t('ach.dialog.summary', { done, total })}</strong>
          <span>
            {t('ach.dialog.points', { points: pts })} <span className="ach-faint">/ {maxPts}</span>
          </span>
          <span className="ach-faint small">{t('ach.dialog.local')}</span>
        </div>
        <div className="ach-tiers" aria-hidden="true">
          {(['bronze', 'silver', 'gold', 'platinum'] as const).map((tier) => {
            const all = ACHIEVEMENTS.filter((d) => d.tier === tier);
            return (
              <span
                key={tier}
                className={`ach-tier-count tier-${tier}`}
                title={t(`ach.tier.${tier}`)}
              >
                <span className="ach-dot" />
                {all.filter((d) => unlocked[d.id]).length}/{all.length}
              </span>
            );
          })}
        </div>
      </div>
      <div className="ach-filter" role="radiogroup" aria-label={t('ach.dialog.filterLabel')}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={filter === f}
            className={filter === f ? 'is-on' : ''}
            onClick={() => setFilter(f)}
            data-autofocus={f === 'all' ? true : undefined}
          >
            {t(`ach.dialog.filter.${f}`)}
          </button>
        ))}
      </div>
      {CATEGORIES.map((cat) => (
        <CategorySection
          key={cat}
          cat={cat}
          defs={ACHIEVEMENTS.filter((d) => d.category === cat && shown(d))}
          ctx={ctx}
          date={date}
        />
      ))}
      <p className="ach-note">{t('ach.dialog.skillNote')}</p>
    </Dialog>
  );
}

function CategorySection({
  cat,
  defs,
  ctx,
  date,
}: {
  cat: Category;
  defs: AchievementDef[];
  ctx: ReturnType<typeof useCtx>;
  date: Intl.DateTimeFormat;
}) {
  if (!defs.length) return null;
  const all = ACHIEVEMENTS.filter((d) => d.category === cat);
  const done = all.filter((d) => ctx.saved.unlocked[d.id]).length;
  return (
    <section className="ach-cat" aria-label={t(`ach.cat.${cat}`)}>
      <h3>
        {t(`ach.cat.${cat}`)}
        <span className="ach-faint">
          {done}/{all.length}
        </span>
      </h3>
      <ul className="ach-grid">
        {defs.map((d) => (
          <Card key={d.id} def={d} ctx={ctx} date={date} />
        ))}
      </ul>
    </section>
  );
}

function Card({
  def,
  ctx,
  date,
}: {
  def: AchievementDef;
  ctx: ReturnType<typeof useCtx>;
  date: Intl.DateTimeFormat;
}) {
  const u = ctx.saved.unlocked[def.id];
  const secret = def.hidden && !u;
  const p = u || secret ? null : progressOf(def, ctx);
  const showBar = p && p.target > 1;
  return (
    <li className={`ach-card tier-${def.tier} ${u ? 'is-unlocked' : 'is-locked'}`}>
      <Medal def={def} unlocked={!!u} />
      <div className="ach-card__body">
        <div className="ach-card__head">
          <strong>{secret ? t('ach.dialog.secret') : title(def)}</strong>
          <span className="ach-tier-pill">{t(`ach.tier.${def.tier}`)}</span>
        </div>
        <p>{secret ? t('ach.dialog.secretDesc') : desc(def)}</p>
        {u && (
          <span className="ach-card__date">
            {t('ach.dialog.unlockedOn', { date: date.format(new Date(u.at)) })}
          </span>
        )}
        {showBar && (
          <div className="ach-progress">
            <div
              className="ach-progress__bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={p.target}
              aria-valuenow={Math.min(p.value, p.target)}
              aria-label={title(def)}
            >
              <span style={{ width: `${Math.min(100, (p.value / p.target) * 100)}%` }} />
            </div>
            <span className="ach-progress__num">
              {t('ach.dialog.progress', { value: Math.min(p.value, p.target), target: p.target })}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- level map chip

/** Trophy chip for the level map header: unlocked count; opens the dialog. */
export function TrophyChip({ onOpen }: { onOpen?: () => void }) {
  const unlocked = useAchievements((s) => s.saved.unlocked);
  const done = ACHIEVEMENTS.filter((d) => unlocked[d.id]).length;
  const label = t('ach.chip.title', { done, total: ACHIEVEMENTS.length });
  return (
    <button
      type="button"
      className="ach-chip"
      title={label}
      aria-label={label}
      onClick={() => {
        onOpen?.();
        openAchievements();
      }}
    >
      <TrophyIcon size={15} />
      <span>
        {done}
        <span className="ach-faint">/{ACHIEVEMENTS.length}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- success card

/** Achievements the latest completion of this level unlocked. */
export function SuccessUnlocks({ levelId }: { levelId: string }) {
  const last = useAchievements((s) => s.lastCompletion);
  if (!last || last.levelId !== levelId || !last.ids.length) return null;
  const defs = last.ids.map(achievementById).filter((d): d is AchievementDef => !!d);
  return (
    <div className="ach-success">
      <span className="ach-success__label">{t('ach.success.title')}</span>
      <ul>
        {defs.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              className={`ach-success__item tier-${d.tier}`}
              onClick={openAchievements}
              title={desc(d)}
            >
              <Medal def={d} unlocked size="sm" />
              <span>{title(d)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
