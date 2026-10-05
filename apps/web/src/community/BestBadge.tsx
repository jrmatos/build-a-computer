import { t } from '../i18n';
import { useBest, type BestEntry } from './best';

/** "4 parts · 9 wires · 12 ticks" for an entry (empty when nothing is measured). */
export function bestText(e: BestEntry): string {
  const n = (key: string, v: number) => t(v === 1 ? `${key}.one` : key, { n: v.toLocaleString() });
  const list: string[] = [];
  if (e.parts !== undefined) list.push(n('community.best.parts', e.parts));
  if (e.wires !== undefined) list.push(n('community.best.wires', e.wires));
  if (e.cycles !== undefined) list.push(n(`community.best.${e.cycleUnit ?? 'ticks'}`, e.cycles));
  return list.join(' · ');
}

/** Level map: "Best: N parts" under a completed card (COM-04). */
export function BestBadge({ levelId }: { levelId: string }) {
  const e = useBest((s) => s.best[levelId]);
  if (!e) return null;
  const text = bestText(e);
  if (!text) return null;
  return (
    <span className="lm-best" title={t('community.best.honor')}>
      {t('community.best.label', { list: text })}
    </span>
  );
}

/** Success card line: the best so far, and "New best!" when this run improved it. */
export function BestLine({ levelId }: { levelId: string }) {
  const e = useBest((s) => s.best[levelId]);
  const last = useBest((s) => (s.last?.levelId === levelId ? s.last : null));
  if (!e) return null;
  const text = bestText(e);
  if (!text) return null;
  return (
    <p className="lp-best" title={t('community.best.honor')}>
      {last && last.improved.length > 0 && <strong>{t('community.best.new')} </strong>}
      {t('community.best.label', { list: text })}
    </p>
  );
}
