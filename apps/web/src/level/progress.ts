/**
 * Pure progress and unlock logic (LVL-01, LVL-06). No storage, no DOM: this is
 * what the tests exercise.
 */
import { mergeProgress, Progress, type Level, type PartType } from '@ground-up/schema';

export type LevelState = 'locked' | 'open' | 'completed';

export const emptyProgress = (): Progress => ({ kind: 'ground-up/progress', version: 1, levels: {} });

/** A level opens once every level it requires is completed. The sandbox is always open. */
export function isUnlocked(level: Level, completed: ReadonlySet<string> | readonly string[]): boolean {
  if (level.track === 'sandbox') return true;
  const done = completed instanceof Set ? completed : new Set(completed as readonly string[]);
  return level.requires.every((id) => done.has(id));
}

export function levelState(level: Level, completed: readonly string[]): LevelState {
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

/** Record a completion. Never moves a level backward (mergeProgress semantics). */
export function withCompleted(p: Progress, level: Level, now = new Date()): Progress {
  const entry = { status: 'completed' as const, levelVersion: level.version, completedAt: now.toISOString() };
  return mergeProgress(p, { kind: 'ground-up/progress', version: 1, levels: { [level.id]: entry } });
}

/** E-DATA-06: completed on an older version of the level. Stays completed; shows a badge. */
export function isOutdated(p: Progress, level: Level): boolean {
  const e = p.levels[level.id];
  return e?.status === 'completed' && e.levelVersion < level.version;
}

/** Levels in play order: by track, then phase, then order. */
export function sortLevels(levels: readonly Level[]): Level[] {
  return [...levels].sort((a, b) => a.track.localeCompare(b.track) || a.phase - b.phase || a.order - b.order);
}

/** The level after `level` in its track, if any. */
export function nextLevel(level: Level, levels: readonly Level[]): Level | undefined {
  if (level.track === 'sandbox') return undefined;
  const same = sortLevels(levels.filter((l) => l.track === level.track));
  const i = same.findIndex((l) => l.id === level.id);
  return i >= 0 ? same[i + 1] : undefined;
}

/** Parts that the next level adds to the palette: "Unlocked: NOT". */
export function newlyUnlockedParts(level: Level, next: Level | undefined): PartType[] {
  if (!next) return [];
  const have = new Set(level.palette);
  return next.palette.filter((p) => !have.has(p));
}

export interface LevelGroup {
  track: Level['track'];
  phase: number;
  levels: Level[];
}

/** Group levels for the level map: one group per track and phase, sandbox first. */
export function groupLevels(levels: readonly Level[]): LevelGroup[] {
  const groups: LevelGroup[] = [];
  const sorted = sortLevels(levels).sort((a, b) => Number(b.track === 'sandbox') - Number(a.track === 'sandbox'));
  for (const l of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.track === l.track && last.phase === l.phase) last.levels.push(l);
    else groups.push({ track: l.track, phase: l.phase, levels: [l] });
  }
  return groups;
}

/** Import limits (Versioning rules, E-DATA-03). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_DEPTH = 64;
const BANNED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class ImportError extends Error {
  constructor(readonly code: 'too-large' | 'not-json' | 'too-deep' | 'invalid') {
    super(code);
    this.name = 'ImportError';
  }
}

/** Parse untrusted JSON: size limit, prototype keys stripped, depth limit. */
export function parseUntrustedJson(text: string): unknown {
  if (new Blob([text]).size > MAX_IMPORT_BYTES) throw new ImportError('too-large');
  let data: unknown;
  try {
    data = JSON.parse(text, (key, value: unknown) => (BANNED_KEYS.has(key) ? undefined : value));
  } catch {
    throw new ImportError('not-json');
  }
  const depth = (v: unknown, d: number): void => {
    if (d > MAX_DEPTH) throw new ImportError('too-deep');
    if (v && typeof v === 'object') for (const c of Object.values(v)) depth(c, d + 1);
  };
  depth(data, 0);
  return data;
}

/** Validate an imported progress file and merge it into the current one. */
export function importProgress(current: Progress, text: string): Progress {
  const parsed = Progress.safeParse(parseUntrustedJson(text));
  if (!parsed.success) throw new ImportError('invalid');
  return mergeProgress(current, parsed.data);
}

export const exportProgress = (p: Progress): string => JSON.stringify(p, null, 2);
