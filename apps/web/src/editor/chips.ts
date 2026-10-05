/**
 * Custom chip editing (CHIP-01..03): the global chip library, "Make chip",
 * placing chips, entering and leaving a chip's board with breadcrumbs, and
 * keeping every instance in sync with the definition.
 *
 * Edits inside a chip commit to its ChipDef continuously (version bumped);
 * wires to pins that no longer exist are dropped when leaving the chip.
 */
import type { Board, ChipDef, ChipMap } from '@ground-up/schema';
import { levelById } from '@ground-up/content';
import {
  makeChipFromBoard,
  newChipId,
  tombstone,
  usagesOf,
  wouldCreateCycle,
  type ChipUsage,
} from '@ground-up/sim-logic';
import { t } from '../i18n';
import { loadChips, putChips, savedBoards } from '../ui/chips/db';
import {
  changedChips,
  copyName,
  pruneChipWires,
  syncPorts,
  type DroppedWire,
} from '../ui/chips/logic';
import { useChipUi } from '../ui/chips/state';
import { screenToWorld, viewport, zoomToFit } from './camera';
import { addPart } from './ops';
import { geomOf, setChipRegistry } from './parts';
import { isTypingTarget } from './shortcuts';
import { useEditor, type Camera, type EditorState } from './store';

const editor = () => useEditor.getState();

/** The level's own board, even while editing inside a chip. */
export function rootBoard(s: Pick<EditorState, 'board' | 'editStack'> = editor()): Board {
  return s.editStack.length ? s.editStack[0]!.parentBoard : s.board;
}

/** Chip being edited (innermost), or null at the level's board. */
export function currentChipId(s: Pick<EditorState, 'editStack'> = editor()): string | null {
  return s.editStack[s.editStack.length - 1]?.chipId ?? null;
}

/** Live (not deleted) chips, sorted by name. */
export function liveChips(chips: ChipMap): ChipDef[] {
  return Object.values(chips)
    .filter((c) => !c.deleted)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- library

/** Replace the library; keeps the part geometry registry in sync. */
export function setChips(chips: ChipMap): void {
  setChipRegistry(chips);
  editor().set({ chips });
}

function updateChip(id: string, patch: Partial<ChipDef>): void {
  const def = editor().chips[id];
  if (!def) return;
  setChips({ ...editor().chips, [id]: { ...def, ...patch, version: def.version + 1 } });
}

let libraryStarted = false;

/** Load the chip library from IndexedDB and persist every later change. Call before the first sim load. */
export async function startChipLibrary(): Promise<void> {
  if (libraryStarted) return;
  libraryStarted = true;
  const stored = await loadChips();
  // Keep anything added before the load finished (e.g. merged from a save).
  setChips({ ...stored, ...editor().chips });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let persisted = stored;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const next = editor().chips;
    const dirty = changedChips(persisted, next);
    persisted = next;
    void putChips(dirty);
  };
  useEditor.subscribe((s, prev) => {
    if (s.chips === prev.chips) return;
    setChipRegistry(s.chips);
    clearTimeout(timer);
    timer = setTimeout(flush, 400);
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    document.addEventListener(
      'visibilitychange',
      () => document.visibilityState === 'hidden' && flush(),
    );
  }
  startChipSync();
}

// ---------------------------------------------------------------- live sync of the edited chip

let syncing = false;

/** Inside a chip, every board change is written to its definition (and blocked if it would self-include). */
function startChipSync(): void {
  useEditor.subscribe((s, prev) => {
    if (syncing || s.board === prev.board || !s.editStack.length || s.transientBase) return;
    commitCurrentChip();
  });
  // A drag ends: transientBase clears with the board unchanged.
  useEditor.subscribe((s, prev) => {
    if (prev.transientBase && !s.transientBase && s.editStack.length) commitCurrentChip();
  });
}

/** Write the board being edited into its chip definition. */
export function commitCurrentChip(): void {
  const s = editor();
  const id = currentChipId(s);
  if (!id) return;
  const def = s.chips[id];
  if (!def || def.board === s.board) return;
  // E-SIM-05: nothing on a chip's board may contain the chip itself.
  const bad = s.board.parts.find(
    (p) => p.type === 'chip' && p.chip && wouldCreateCycle(s.chips, id, p.chip),
  );
  if (bad) {
    syncing = true;
    try {
      if (s.past.length) s.undo();
      else s.set({ board: def.board });
    } finally {
      syncing = false;
    }
    s.toast(t('chips.cycle', { chip: def.name }), 'error');
    return;
  }
  const ports = syncPorts(def.ports, s.board);
  setChips({ ...s.chips, [id]: { ...def, board: s.board, ports, version: def.version + 1 } });
}

/** Drop wires to chip pins that no longer exist, everywhere in the library. */
function pruneLibrary(): DroppedWire[] {
  const chips = editor().chips;
  let next: ChipMap | null = null;
  const all: DroppedWire[] = [];
  for (const def of Object.values(chips)) {
    const r = pruneChipWires(def.board, chips);
    if (!r.dropped.length) continue;
    next ??= { ...chips };
    next[def.id] = { ...def, board: r.board, version: def.version + 1 };
    all.push(...r.dropped);
  }
  if (next) setChips(next);
  return all;
}

function reportDropped(dropped: DroppedWire[]): void {
  if (!dropped.length) return;
  const ends = [...new Set(dropped.map((d) => d.end))];
  const list = ends.slice(0, 6).join(', ') + (ends.length > 6 ? ` +${ends.length - 6}` : '');
  editor().toast(t('chips.wiresDropped', { count: dropped.length, list }), 'info');
}

/** Prune the board in the editor as one undoable step (after the definitions it uses changed). */
function pruneCurrentBoard(): DroppedWire[] {
  const s = editor();
  const r = pruneChipWires(s.board, s.chips);
  if (r.dropped.length) s.commit(() => r.board);
  return r.dropped;
}

// ---------------------------------------------------------------- enter / exit

const cameras: Camera[] = [];

/** Open a chip's definition for editing (from an instance or the library). */
export function openChipDef(chipId: string): void {
  const s = editor();
  const def = s.chips[chipId];
  if (!def || def.deleted) {
    s.toast(t('chips.missing'), 'error');
    return;
  }
  const at = s.editStack.findIndex((f) => f.chipId === chipId);
  if (at >= 0) {
    exitChip(at + 1);
    return;
  }
  if (s.transientBase) s.endTransient();
  commitCurrentChip();
  cameras.push(s.camera);
  const frame = {
    chipId,
    parentBoard: s.board,
    parentPast: s.past,
    parentFuture: s.future,
    parentSelection: s.selection,
  };
  syncing = true;
  try {
    editor().set({
      editStack: [...s.editStack, frame],
      board: editor().chips[chipId]!.board,
      past: [],
      future: [],
      selection: [],
      contextMenu: null,
      editingLabel: null,
      testRun: null,
      tool: 'select',
    });
  } finally {
    syncing = false;
  }
  fitSoon();
}

/** Enter the chip used by this part instance (double-click). */
export function enterChip(partId: string): void {
  const part = editor().board.parts.find((p) => p.id === partId);
  if (!part || part.type !== 'chip' || !part.chip) return;
  openChipDef(part.chip);
}

/** Leave chip editing; `depth` = how many levels to keep (0 = back to the level's board). */
export function exitChip(depth = editor().editStack.length - 1): void {
  const start = editor();
  if (depth < 0 || depth >= start.editStack.length) return;
  if (start.transientBase) start.endTransient();
  commitCurrentChip();
  const dropped: DroppedWire[] = [];
  let camera: Camera | undefined;
  while (editor().editStack.length > depth) {
    const s = editor();
    const frame = s.editStack[s.editStack.length - 1]!;
    camera = cameras.pop();
    syncing = true;
    try {
      s.set({
        editStack: s.editStack.slice(0, -1),
        board: frame.parentBoard,
        past: frame.parentPast,
        future: frame.parentFuture,
        selection: frame.parentSelection,
        contextMenu: null,
        editingLabel: null,
      });
    } finally {
      syncing = false;
    }
    dropped.push(...pruneLibrary());
    dropped.push(...pruneCurrentBoard());
  }
  reportDropped(dropped);
  if (camera) editor().setCamera(camera);
}

function fitSoon(): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => zoomToFit());
  else zoomToFit();
}

// ---------------------------------------------------------------- make, place, manage

/** Open the "Make chip" dialog for the current board. */
export function openMakeChip(): void {
  const s = editor();
  if (s.readOnly) return;
  if (!s.board.parts.some((p) => p.type === 'switch' || p.type === 'lamp')) {
    s.toast(t('chips.make.noPorts'), 'error');
    return;
  }
  useChipUi.getState().set({ make: true });
}

export interface MakeChipInput {
  name: string;
  color?: string;
  inputs: string[];
  outputs: string[];
}

/** Turn the current board into a chip in the library. Returns the new chip, or null on error (toasted). */
export function makeChip(input: MakeChipInput): ChipDef | null {
  const s = editor();
  try {
    const def = makeChipFromBoard(s.board, {
      name: input.name.trim().slice(0, 40),
      inputs: input.inputs,
      outputs: input.outputs,
      ...(input.color ? { color: input.color } : {}),
      taken: Object.keys(s.chips),
    });
    setChips({ ...s.chips, [def.id]: def });
    s.toast(t('chips.made', { name: def.name }), 'success');
    return def;
  } catch (e) {
    s.toast(e instanceof Error ? e.message : String(e), 'error');
    return null;
  }
}

/** Why a chip cannot be placed here, or null. */
export function placeBlocker(chipId: string): string | null {
  const s = editor();
  const def = s.chips[chipId];
  if (!def || def.deleted) return t('chips.missing');
  if (s.readOnly) return t('chips.readOnly');
  const here = currentChipId(s);
  if (here && wouldCreateCycle(s.chips, here, chipId)) {
    return t('chips.cycle', { chip: s.chips[here]?.name ?? here });
  }
  return null;
}

/** Place a chip instance at a world point (default: the middle of the view). E-SIM-05 is checked first. */
export function placeChip(chipId: string, world?: { x: number; y: number }): string | null {
  const s = editor();
  const why = placeBlocker(chipId);
  if (why) {
    s.toast(why, 'error');
    return null;
  }
  const at = world ?? screenToWorld(s.camera, viewport.width / 2, viewport.height / 2);
  const g = geomOf({ id: 'probe', type: 'chip', chip: chipId, x: 0, y: 0, rot: 0, flip: false });
  const x = Math.round(at.x - g.body.w / 2);
  const y = Math.round(at.y - (g.body.h - 1) / 2);
  const [board, part] = addPart(s.board, 'chip', x, y, { chip: chipId });
  s.commit(() => board, [part.id]);
  return part.id;
}

export function renameChip(id: string, name: string): void {
  const n = name.trim().slice(0, 40);
  if (n) updateChip(id, { name: n });
}

export function recolorChip(id: string, color: string | undefined): void {
  const def = editor().chips[id];
  if (!def) return;
  const next: ChipDef = { ...def, version: def.version + 1 };
  if (color) next.color = color;
  else delete next.color;
  setChips({ ...editor().chips, [id]: next });
}

export function duplicateChip(id: string): ChipDef | null {
  const chips = editor().chips;
  const def = chips[id];
  if (!def) return null;
  const name = copyName(def.name, chips);
  const copy: ChipDef = {
    ...structuredClone(def),
    id: newChipId(name, Object.keys(chips)),
    name,
    version: 1,
  };
  delete copy.deleted;
  setChips({ ...chips, [copy.id]: copy });
  return copy;
}

/** Every saved level board and chip that uses `id` (E-DATA-08). */
export async function chipUsages(id: string): Promise<ChipUsage[]> {
  const s = editor();
  const saved = await savedBoards();
  const levelId = s.level?.id;
  const boards = saved
    .filter((b) => b.levelId !== levelId)
    .map((b) => ({ name: levelById(b.levelId)?.title ?? b.levelId, board: b.board }));
  if (s.level) boards.unshift({ name: s.level.title, board: rootBoard(s) });
  // Inner boards being edited are already in the chips map (committed continuously).
  return usagesOf(id, boards, s.chips);
}

/** Delete a chip from the library, leaving a tombstone so boards that use it still load (E-DATA-08). */
export function deleteChip(id: string): boolean {
  const s = editor();
  if (s.editStack.some((f) => f.chipId === id)) {
    s.toast(t('chips.delete.open'), 'error');
    return false;
  }
  setChips(tombstone(s.chips, id));
  return true;
}

// ---------------------------------------------------------------- keys

/** Ctrl+Shift+M: Make chip. Esc at depth > 0: leave one level, only when nothing else wants Esc. */
export function installChipKeys(): () => void {
  const modalOpen = () =>
    typeof document !== 'undefined' && !!document.querySelector('[aria-modal="true"]');
  const onKey = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
    const s = editor();
    if (
      (e.ctrlKey || e.metaKey) &&
      e.shiftKey &&
      !e.altKey &&
      (e.code === 'KeyM' || e.key.toLowerCase() === 'm')
    ) {
      if (modalOpen()) return;
      e.preventDefault();
      openMakeChip();
      return;
    }
    if (e.key !== 'Escape' || !s.editStack.length || e.ctrlKey || e.metaKey || e.altKey) return;
    // Lower priority than every other Esc use: menus, dialogs, gestures, tools, selection.
    if (
      modalOpen() ||
      s.helpOpen ||
      s.levelsOpen ||
      s.libraryOpen ||
      s.contextMenu ||
      s.editingLabel
    )
      return;
    if (s.transientBase || s.tool !== 'select' || s.selection.length) return;
    if (document.querySelector('.gu-dropdown')) return;
    exitChip();
  };
  // Capture phase: decide from the state before the board shortcuts react to the same Esc.
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}
