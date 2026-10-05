/**
 * Pure save handling: validate what storage returns, migrate old formats and
 * refuse newer ones (E-DATA-04, E-DATA-05).
 */
import { migrateSave, NewerVersionError, Progress, SAVE_VERSION, type Board, type ChipMap, type Level, type Save } from '@build-a-computer/schema';
import { closure, findChipCycle } from '@build-a-computer/sim-logic';
import { mergeChips, remapBoardChips } from '../ui/chips/logic';

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
    // E-SIM-05: a chip that contains itself can never be simulated; refuse the save.
    const cycle = findChipCycle(save.chips);
    if (cycle) return { kind: 'invalid', error: chipCycleMessage(save.chips, cycle) };
    return { kind: 'ok', save, migrated: version !== SAVE_VERSION };
  } catch (e) {
    if (e instanceof NewerVersionError) return { kind: 'newer', found: e.found };
    return { kind: 'invalid', error: e instanceof Error ? e.message : String(e) };
  }
}

/** Readable E-SIM-05 error: "A chip cannot contain itself: Adder → Half → Adder". */
export function chipCycleMessage(chips: ChipMap, cycle: string[]): string {
  return `A chip cannot contain itself: ${cycle.map((id) => chips[id]?.name ?? id).join(' → ')}`;
}

/** A save embeds every chip its board uses, transitively, so it loads anywhere. */
export function makeSave(level: Level, board: Board, chips: ChipMap = {}, now = new Date()): Save {
  return {
    kind: 'build-a-computer/save',
    chips: closure(board, chips),
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

/**
 * Merge a save's embedded chips into the local library (never downgrading a
 * local chip) and point the board at the ids they ended up with.
 */
export function adoptSaveChips(local: ChipMap, save: Pick<Save, 'board' | 'chips'>): { chips: ChipMap; board: Board; changed: string[] } {
  const m = mergeChips(local, save.chips);
  return { chips: m.changed.length ? m.chips : local, board: remapBoardChips(save.board, m.remap), changed: m.changed };
}
