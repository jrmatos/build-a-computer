/**
 * Pure save handling: validate what storage returns, migrate old formats and
 * refuse newer ones (E-DATA-04, E-DATA-05).
 */
import { migrateSave, NewerVersionError, Progress, SAVE_VERSION, type Board, type Level, type Save } from '@ground-up/schema';

export type Decoded =
  | { kind: 'ok'; save: Save; migrated: boolean }
  | { kind: 'newer'; found: number }
  | { kind: 'invalid'; error: string };

/** Decode a stored record. Never throws. */
export function decodeSave(raw: unknown, levelId: string): Decoded {
  try {
    const version = (raw as { version?: unknown } | null)?.version;
    const save = migrateSave(raw);
    if (save.levelId !== levelId) return { kind: 'invalid', error: `Save belongs to ${save.levelId}` };
    return { kind: 'ok', save, migrated: version !== SAVE_VERSION };
  } catch (e) {
    if (e instanceof NewerVersionError) return { kind: 'newer', found: e.found };
    return { kind: 'invalid', error: e instanceof Error ? e.message : String(e) };
  }
}

export function makeSave(level: Level, board: Board, now = new Date()): Save {
  return {
    kind: 'ground-up/save',
    chips: {},
    version: SAVE_VERSION,
    levelId: level.id,
    levelVersion: level.version,
    updatedAt: now.toISOString(),
    board,
  };
}

/** Progress from storage, or null if it is unreadable or from a newer version. */
export function decodeProgress(raw: unknown): { kind: 'ok'; progress: Progress } | { kind: 'newer' } | { kind: 'invalid' } {
  if (raw === undefined || raw === null) return { kind: 'invalid' };
  const version = (raw as { version?: unknown }).version;
  if (typeof version === 'number' && version > 1) return { kind: 'newer' };
  const parsed = Progress.safeParse(raw);
  return parsed.success ? { kind: 'ok', progress: parsed.data } : { kind: 'invalid' };
}
