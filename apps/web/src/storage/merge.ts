/**
 * Pure merge rules for importing a workspace into this device:
 *
 * - Progress never moves backward (mergeProgress, E-PLAT-01).
 * - Chips merge like a save's embedded chips (adoptSaveChips): never downgrade
 *   a local chip; an id clash with different content gets a re-id'd copy.
 * - Boards: a level only in the file is added. A level on both sides with the
 *   same board is left alone. A level whose boards differ is a conflict the
 *   player resolves ("Keep mine" / "Use file"), the newer `updatedAt` chosen by
 *   default. Nothing is dropped silently: a local board replaced by the file's is
 *   kept as a backup record.
 */
import { mergeProgress, type ChipDef, type ChipMap, type Progress, type Save, type Workspace } from '@ground-up/schema';
import { closure } from '@ground-up/sim-logic';
import { mergeChips, remapBoardChips, stableStringify } from '../ui/chips/logic';
import { completedIds } from '../level/progress';

export interface LocalWorkspace {
  progress: Progress;
  saves: Record<string, Save>;
  chips: ChipMap;
}

export type Side = 'local' | 'incoming';

export interface SaveConflict {
  levelId: string;
  local: Save;
  incoming: Save;
  /** Which side has the later `updatedAt` (local on a tie). */
  newer: Side;
}

export interface WorkspaceMerge {
  progress: Progress;
  /** Levels newly completed by the import. */
  progressGained: string[];
  chips: ChipMap;
  /** Chip ids added or updated in the library. */
  chipsChanged: string[];
  /** Levels this device had no board for. */
  added: Record<string, Save>;
  conflicts: SaveConflict[];
  /** Levels whose boards are already identical. */
  unchanged: string[];
}

/** Chips embedded in the file's saves plus its library; the higher version wins per id. */
function incomingChips(ws: Workspace): ChipMap {
  const out: ChipMap = {};
  const take = (c: ChipDef) => {
    const cur = out[c.id];
    if (!cur || c.version > cur.version) out[c.id] = c;
  };
  for (const s of Object.values(ws.saves)) Object.values(s.chips).forEach(take);
  Object.values(ws.chips).forEach(take);
  return out;
}

const sameBoard = (a: Save, b: Save) => stableStringify(a.board) === stableStringify(b.board);

export function mergeWorkspace(local: LocalWorkspace, ws: Workspace): WorkspaceMerge {
  const progress = mergeProgress(local.progress, ws.progress);
  const before = new Set(completedIds(local.progress));
  const progressGained = completedIds(progress).filter((id) => !before.has(id));

  const m = mergeChips(local.chips, incomingChips(ws));
  const chips = m.changed.length ? m.chips : local.chips;

  const added: Record<string, Save> = {};
  const conflicts: SaveConflict[] = [];
  const unchanged: string[] = [];
  for (const [id, raw] of Object.entries(ws.saves)) {
    const board = remapBoardChips(raw.board, m.remap);
    const incoming: Save = { ...raw, board, chips: closure(board, chips) };
    const mine = local.saves[id];
    if (!mine) added[id] = incoming;
    else if (sameBoard(mine, incoming)) unchanged.push(id);
    else conflicts.push({ levelId: id, local: mine, incoming, newer: Date.parse(incoming.updatedAt) > Date.parse(mine.updatedAt) ? 'incoming' : 'local' });
  }
  conflicts.sort((a, b) => a.levelId.localeCompare(b.levelId));
  return { progress, progressGained, chips, chipsChanged: m.changed, added, conflicts, unchanged: unchanged.sort() };
}

/** True when importing would change nothing on this device. */
export function isNoopMerge(m: WorkspaceMerge): boolean {
  return !m.progressGained.length && !m.chipsChanged.length && !Object.keys(m.added).length && !m.conflicts.length;
}

/** Default choice per conflict: the newer board. */
export function defaultChoices(m: WorkspaceMerge): Record<string, Side> {
  return Object.fromEntries(m.conflicts.map((c) => [c.levelId, c.newer]));
}

export interface ResolvedImport {
  /** Saves to write under their level id. */
  write: Record<string, Save>;
  /** Local boards being replaced, kept under `<levelId>~before-import-<time>` so nothing is lost. */
  backups: Record<string, Save>;
}

/** Apply the player's choices. Conflicts without a choice keep the local board. */
export function resolveImport(m: WorkspaceMerge, choices: Record<string, Side>, now = new Date()): ResolvedImport {
  const write: Record<string, Save> = { ...m.added };
  const backups: Record<string, Save> = {};
  for (const c of m.conflicts) {
    if (choices[c.levelId] !== 'incoming') continue;
    write[c.levelId] = c.incoming;
    backups[`${c.levelId}~before-import-${now.getTime()}`] = c.local;
  }
  return { write, backups };
}
