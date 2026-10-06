/**
 * Progress and unlock logic (LVL-01, LVL-06) plus progress-file import
 * (E-DATA-03). No storage: this is what the tests exercise.
 */
import type { LevelInfo } from '@build-a-computer/content';
import { withCompleted as coreWithCompleted, type LevelGroup as CoreLevelGroup } from '@build-a-computer/platform-core';
import { mergeProgress, Progress, type Level } from '@build-a-computer/schema';

/**
 * The unlock graph and progress rules live in platform-core (PLAT-01,
 * ADR-010); they are re-exported here so existing imports keep working.
 */
export {
  completedIds,
  emptyProgress,
  groupLevels,
  isOutdated,
  isUnlocked,
  levelState,
  newlyUnlockedParts,
  nextLevel,
  sortLevels,
  type LevelState,
} from '@build-a-computer/platform-core';

/** Level-map group; catalog entries (LevelInfo) by default. */
export type LevelGroup<T extends Pick<Level, 'track' | 'phase' | 'order'> = LevelInfo> = CoreLevelGroup<T>;

/** Record a completion (now, by default). Never moves a level backward (mergeProgress semantics). */
export function withCompleted(p: Progress, level: Pick<Level, 'id' | 'version'>, now = new Date()): Progress {
  return coreWithCompleted(p, level, now);
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
