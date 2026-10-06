/**
 * Unlock graph and progress rules (LVL-01, LVL-06), shared by every track.
 * Pure: no storage, no DOM, no clock (callers pass the time).
 */
import { mergeProgress, PROGRESS_KIND, type Level, type PartType, type Progress } from '@build-a-computer/schema';
import { trackOf } from './builtin';

/** What ordering needs: catalog entries and full levels both qualify. */
export type Sortable = Pick<Level, 'track' | 'phase' | 'order'>;

export type LevelState = 'locked' | 'open' | 'completed';

export const emptyProgress = (): Progress => ({ kind: PROGRESS_KIND, version: 1, levels: {} });

/** A level opens once every level it requires is completed. Free-play tracks (the sandbox) are always open. */
export function isUnlocked(level: Pick<Level, 'track' | 'requires'>, completed: ReadonlySet<string> | readonly string[]): boolean {
  if (trackOf(level.track).freePlay) return true;
  const done = completed instanceof Set ? completed : new Set(completed as readonly string[]);
  return level.requires.every((id) => done.has(id));
}

export function levelState(level: Pick<Level, 'id' | 'track' | 'requires'>, completed: readonly string[]): LevelState {
  if (completed.includes(level.id)) return 'completed';
  return isUnlocked(level, completed) ? 'open' : 'locked';
}

/** Ids of completed levels, in a stable order. */
export function completedIds(p: Progress): string[] {
  return Object.entries(p.levels)
    .filter(([, e]) => e.status === 'completed')
    .map(([id]) => id)
    .sort();
}

/** Record a completion at `now`. Never moves a level backward (mergeProgress semantics). */
export function withCompleted(p: Progress, level: Pick<Level, 'id' | 'version'>, now: Date): Progress {
  const entry = { status: 'completed' as const, levelVersion: level.version, completedAt: now.toISOString() };
  return mergeProgress(p, { kind: PROGRESS_KIND, version: 1, levels: { [level.id]: entry } });
}

/** E-DATA-06: completed on an older version of the level. Stays completed; shows a badge. */
export function isOutdated(p: Progress, level: Pick<Level, 'id' | 'version'>): boolean {
  const e = p.levels[level.id];
  return e?.status === 'completed' && e.levelVersion < level.version;
}

/** Levels in play order: by track, then phase, then order. */
export function sortLevels<T extends Sortable>(levels: readonly T[]): T[] {
  return [...levels].sort((a, b) => a.track.localeCompare(b.track) || a.phase - b.phase || a.order - b.order);
}

/** The level after `level` in its track, if any (free-play tracks have none). */
export function nextLevel<T extends Sortable & Pick<Level, 'id'>>(level: Pick<Level, 'id' | 'track'>, levels: readonly T[]): T | undefined {
  if (trackOf(level.track).freePlay) return undefined;
  const same = sortLevels(levels.filter((l) => l.track === level.track));
  const i = same.findIndex((l) => l.id === level.id);
  return i >= 0 ? same[i + 1] : undefined;
}

/** Parts that the next level adds to the palette: "Unlocked: NOT". */
export function newlyUnlockedParts(level: Pick<Level, 'palette'>, next: Pick<Level, 'palette'> | undefined): PartType[] {
  if (!next) return [];
  const have = new Set(level.palette);
  return next.palette.filter((p) => !have.has(p));
}

export interface LevelGroup<T extends Sortable = Sortable> {
  track: Level['track'];
  phase: number;
  levels: T[];
}

/** Group levels for the level map: one group per track and phase, free-play tracks first. */
export function groupLevels<T extends Sortable>(levels: readonly T[]): LevelGroup<T>[] {
  const groups: LevelGroup<T>[] = [];
  const free = (l: T) => Number(trackOf(l.track).freePlay);
  const sorted = sortLevels(levels).sort((a, b) => free(b) - free(a));
  for (const l of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.track === l.track && last.phase === l.phase) last.levels.push(l);
    else groups.push({ track: l.track, phase: l.phase, levels: [l] });
  }
  return groups;
}
