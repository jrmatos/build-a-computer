/**
 * Persistence: autosave (EDIT-08), progress (LVL-06), level opening with unlock
 * rules (LVL-01) and the two-tab lock (E-DATA-01). Storage failures fall back to
 * memory with a banner (E-DATA-02); newer saves are refused and never
 * overwritten (E-DATA-04); old saves migrate forward (E-DATA-05).
 */
import { LEVELS, levelById } from '@build-a-computer/content';
import { mergeProgress, type Board, type Level, type Progress, type Save } from '@build-a-computer/schema';
import { zoomToFit } from '../editor/camera';
import { exitChip, rootBoard, setChips, startChipLibrary } from '../editor/chips';
import { pruneChipWires } from '../ui/chips/logic';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { memoryStorage, openIndexedDb, type Storage } from './db';
import { downloadJson } from './download';
import { acquireLock, lockName, releaseLock } from './lock';
import { completedIds, emptyProgress, exportProgress, importProgress, ImportError, isUnlocked, withCompleted } from './progress';
import { adoptSaveChips, decodeProgress, decodeSave, makeSave } from './saves';
import { useLevelUi } from './ui';

const AUTOSAVE_MS = 1000;
const LAST_LEVEL_KEY = 'build-a-computer:last-level';
const SANDBOX = 'sandbox';

let storage: Storage = memoryStorage();
let progress: Progress = emptyProgress();
/** Progress record written by a newer app: keep completions in memory, never overwrite it. */
let progressBlocked = false;
/** Level whose board is in the editor and gets autosaved. */
let currentId: string | null = null;
/** Board last loaded or written for the current level; equal means nothing to save. */
let savedBoard: Board | null = null;
/** Levels whose stored save is from a newer version (E-DATA-04). */
const blocked = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let writes: Promise<void> = Promise.resolve();
let openToken = 0;
let started = false;
let channel: BroadcastChannel | null = null;
let chipsReady = false;
let chipsLoading: Promise<void> = Promise.resolve();

const editor = () => useEditor.getState();
const toast = (key: string, tone: 'info' | 'error' | 'success' = 'info', vars?: Record<string, string | number>) =>
  editor().toast(t(key, vars), tone);

// ---------------------------------------------------------------- storage

function toMemory(reason: 'unavailable' | 'quota'): void {
  if (storage.mode === 'memory' && useLevelUi.getState().memoryReason) return;
  storage = memoryStorage(storage.mode === 'indexeddb' ? storage : undefined);
  editor().set({ storageMode: 'memory' });
  useLevelUi.getState().set({ memoryReason: reason });
}

/** Write with fallback: any storage error switches to memory mode and retries there. */
async function write(fn: (s: Storage) => Promise<void>): Promise<void> {
  try {
    await fn(storage);
  } catch (e) {
    console.error(e);
    const quota = e instanceof Error && /quota/i.test(e.name + e.message);
    toMemory(quota ? 'quota' : 'unavailable');
    await fn(storage);
  }
}

// ---------------------------------------------------------------- autosave

/** Save the current level's board now if it changed. Safe to call any time. */
export function flushSave(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  const { level, readOnly, chips } = editor();
  // Inside a chip the editor shows the chip's board; the level's own board is saved.
  const board = rootBoard();
  if (!level || level.id !== currentId || readOnly || board === savedBoard || blocked.has(level.id)) return writes;
  savedBoard = board;
  const save = makeSave(level, board, chips);
  writes = writes.then(() => write((s) => s.putSave(level.id, save))).catch((e) => console.error(e));
  return writes;
}

function scheduleSave(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void flushSave(), AUTOSAVE_MS);
}

// ---------------------------------------------------------------- progress

function publishProgress(): void {
  editor().set({ completed: completedIds(progress) });
}

async function saveProgress(): Promise<void> {
  if (progressBlocked) return;
  const p = progress;
  await write((s) => s.putProgress(p)).catch((e) => console.error(e));
}

/** Mark a level completed after all its tests pass. Never moves backward. */
export async function markCompleted(level: Level): Promise<void> {
  if (level.track === SANDBOX) return;
  progress = withCompleted(progress, level);
  publishProgress();
  await saveProgress();
}

export const getProgress = (): Progress => progress;

export function exportProgressFile(): void {
  downloadJson(`build-a-computer-progress-${new Date().toISOString().slice(0, 10)}.json`, exportProgress(progress));
}

/** Merge an imported progress file (LVL-06, E-DATA-03). Returns false and toasts on a bad file. */
export async function importProgressFile(file: File): Promise<boolean> {
  try {
    const before = completedIds(progress).length;
    progress = importProgress(progress, await file.text());
    publishProgress();
    await saveProgress();
    toast('level.import.done', 'success', { count: completedIds(progress).length - before });
    return true;
  } catch (e) {
    const code = e instanceof ImportError ? e.code : 'invalid';
    toast(`level.import.${code}`, 'error');
    return false;
  }
}

/** Download the current board as a save file (memory-mode banner, E-DATA-02). */
export function exportBoardFile(): void {
  const { level, chips } = editor();
  if (!level) return;
  downloadJson(`build-a-computer-${level.id}.json`, JSON.stringify(makeSave(level, rootBoard(), chips), null, 2));
}

// ---------------------------------------------------------------- whole workspace (STO-01)

/**
 * Progress and every readable level save on this device, after saving the
 * current board. Backup (`~`) records, unreadable and newer-version saves stay
 * in IndexedDB and are not exported.
 */
export async function workspaceData(): Promise<{ progress: Progress; saves: Record<string, Save> }> {
  await flushSave();
  const saves: Record<string, Save> = {};
  let raw = new Map<string, unknown>();
  try {
    raw = await storage.listSaves();
  } catch (e) {
    console.error(e);
  }
  for (const [id, record] of raw) {
    if (id.includes('~')) continue;
    const d = decodeSave(record, id);
    if (d.kind === 'ok') saves[id] = d.save;
  }
  return { progress, saves };
}

/**
 * Apply an imported workspace (after the player confirmed it): progress merges
 * (never backward), replaced boards are first kept under their backup keys,
 * then the chosen saves are written. The open level reloads if its board
 * changed. Chips must already be in the library (setChips) before this runs.
 */
export async function applyImport(input: { progress: Progress; saves: Record<string, Save>; backups: Record<string, Save> }): Promise<void> {
  if (editor().editStack.length) exitChip(0);
  await flushSave();
  if (!progressBlocked) {
    progress = mergeProgress(progress, input.progress);
    publishProgress();
    await saveProgress();
  }
  for (const [key, save] of Object.entries(input.backups)) await write((s) => s.putSave(key, save)).catch((e) => console.error(e));
  for (const [id, save] of Object.entries(input.saves)) {
    if (blocked.has(id)) continue;
    await write((s) => s.putSave(id, save)).catch((e) => console.error(e));
  }
  const fresh = currentId ? input.saves[currentId] : undefined;
  if (fresh && currentId && !editor().readOnly && !blocked.has(currentId)) {
    const board = adoptBoard(fresh);
    savedBoard = board;
    editor().set({ board, past: [], future: [], selection: [], testRun: null, transientBase: null });
  }
}

// ---------------------------------------------------------------- level opening

async function loadBoard(level: Level): Promise<{ board: Board; newer: boolean }> {
  let raw: unknown;
  try {
    raw = await storage.getSave(level.id);
  } catch (e) {
    console.error(e);
    toMemory('unavailable');
  }
  if (raw === undefined || raw === null) return { board: level.starter, newer: false };
  if (!chipsReady) await chipsLoading;
  const d = decodeSave(raw, level.id);
  if (d.kind === 'ok') return { board: adoptBoard(d.save), newer: false };
  if (d.kind === 'newer') {
    blocked.add(level.id);
    toast('level.save.newer', 'error');
    return { board: level.starter, newer: true };
  }
  // Unreadable save: keep a copy under another key so nothing is lost, then start fresh.
  console.error('Unreadable save', level.id, d.error);
  await write((s) => s.putSave(`${level.id}~unreadable-${Date.now()}`, raw)).catch(() => undefined);
  toast('level.save.invalid', 'error');
  return { board: level.starter, newer: false };
}

/**
 * Chips embedded in a save join the library (never downgrading a local chip);
 * wires to chip pins that no longer exist are dropped with a toast.
 */
export function adoptBoard(save: Parameters<typeof adoptSaveChips>[1]): Board {
  const a = adoptSaveChips(editor().chips, save);
  if (a.chips !== editor().chips) setChips(a.chips);
  const pruned = pruneChipWires(a.board, a.chips);
  if (pruned.dropped.length) {
    const ends = [...new Set(pruned.dropped.map((d) => d.end))];
    editor().toast(t('chips.wiresDropped', { count: pruned.dropped.length, list: ends.slice(0, 6).join(', ') }), 'info');
  }
  return pruned.board;
}

function rememberLast(id: string): void {
  try {
    localStorage.setItem(LAST_LEVEL_KEY, id);
  } catch {
    /* storage blocked: not important */
  }
}

function lastLevel(): string | null {
  try {
    return localStorage.getItem(LAST_LEVEL_KEY);
  } catch {
    return null;
  }
}

/** `?level=<id>`, `#level=<id>` or `#/level/<id>`. */
export function levelFromUrl(href: string): string | null {
  const url = new URL(href);
  const q = url.searchParams.get('level');
  if (q) return q;
  const m = /^#\/?level[=/]([a-z0-9-]+)/.exec(url.hash);
  return m?.[1] ?? null;
}

function writeUrl(id: string): void {
  try {
    const url = new URL(location.href);
    url.searchParams.delete('level');
    url.hash = id === SANDBOX ? '' : `level=${id}`;
    if (url.href !== location.href) history.replaceState(history.state, '', url.href);
  } catch {
    /* sandboxed iframe or similar */
  }
}

function onLockLost(): void {
  // The other tab already asked us to flush before stealing; writing now could clobber its save.
  clearTimeout(timer);
  editor().set({ readOnly: true });
  useLevelUi.getState().set({ lock: 'stolen' });
}

async function lockLevel(id: string, steal: boolean): Promise<boolean> {
  const ok = await acquireLock(lockName(id), steal, onLockLost);
  if (currentId !== id) return ok;
  editor().set({ readOnly: !ok });
  useLevelUi.getState().set({ lock: ok ? 'held' : 'elsewhere' });
  return ok;
}

/**
 * Open a level: save the current one, refuse locked levels, load the saved
 * board or the starter, reset history and tests, take the tab lock, zoom to fit.
 */
export async function openLevel(id: string): Promise<void> {
  const token = ++openToken;
  const st = editor();
  let level = levelById(id);
  if (!level) {
    toast('level.unknown', 'error', { id });
    if (st.level) return;
    level = levelById(SANDBOX)!;
  } else if (!isUnlocked(level, st.completed)) {
    toast('level.locked', 'error', { title: level.title });
    if (st.level) {
      writeUrl(st.level.id);
      return;
    }
    level = levelById(SANDBOX)!;
  }
  // Leave any chip being edited so its changes land and the level's board is current.
  if (editor().editStack.length) exitChip(0);
  await flushSave();
  if (token !== openToken) return;
  releaseLock();
  const { board, newer } = await loadBoard(level);
  if (token !== openToken) return;

  currentId = level.id;
  savedBoard = board;
  useLevelUi.getState().set({ newerSave: newer, justCompleted: null, lock: 'held' });
  editor().set({
    level,
    board,
    past: [],
    future: [],
    transientBase: null,
    selection: [],
    testRun: null,
    contextMenu: null,
    editingLabel: null,
    levelsOpen: false,
    readOnly: false,
  });
  rememberLast(level.id);
  writeUrl(level.id);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(() => zoomToFit()));
  await lockLevel(level.id, false);
}

/** Take the level over from another tab (E-DATA-01): ask it to save, steal the lock, reload the board. */
export async function takeOver(): Promise<void> {
  const id = currentId;
  if (!id) return;
  channel?.postMessage({ type: 'flush', id });
  await new Promise((r) => setTimeout(r, 250));
  const ok = await lockLevel(id, true);
  if (!ok || currentId !== id) return;
  const level = levelById(id);
  if (!level) return;
  if (editor().editStack.length) exitChip(0);
  const { board, newer } = await loadBoard(level);
  if (currentId !== id) return;
  savedBoard = board;
  useLevelUi.getState().set({ newerSave: newer });
  editor().set({ board, past: [], future: [], selection: [], testRun: null });
}

// ---------------------------------------------------------------- startup

export async function startPersistence(): Promise<void> {
  if (started) return;
  started = true;
  // The chip library loads before the first board, so chip parts get their pins.
  chipsLoading = startChipLibrary()
    .catch((e) => console.error(e))
    .finally(() => {
      chipsReady = true;
    });
  try {
    storage = await openIndexedDb();
    editor().set({ storageMode: 'indexeddb' });
  } catch (e) {
    console.error(e);
    toMemory('unavailable');
  }

  let raw: unknown;
  try {
    raw = await storage.getProgress();
  } catch (e) {
    console.error(e);
  }
  const d = decodeProgress(raw);
  if (d.kind === 'ok') progress = d.progress;
  else if (d.kind === 'newer') {
    progressBlocked = true;
    toast('level.progress.newer', 'error');
  } else if (raw !== undefined && raw !== null) toast('level.progress.invalid', 'error');
  publishProgress();

  // Autosave 1 s after the last change, and right away when the tab hides or unloads.
  useEditor.subscribe((s, prev) => {
    const board = rootBoard(s);
    if (board !== rootBoard(prev) && s.level?.id === currentId && board !== savedBoard && !s.readOnly) scheduleSave();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushSave();
  });
  window.addEventListener('pagehide', () => void flushSave());
  window.addEventListener('beforeunload', () => void flushSave());
  window.addEventListener('hashchange', () => {
    const id = levelFromUrl(location.href);
    if (id && id !== currentId) void openLevel(id);
  });
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('build-a-computer');
    channel.onmessage = (e: MessageEvent<{ type?: string; id?: string }>) => {
      if (e.data?.type === 'flush' && e.data.id === currentId) void flushSave();
    };
  }

  await chipsLoading;
  const wanted = levelFromUrl(location.href) ?? lastLevel() ?? SANDBOX;
  const ok = levelById(wanted) && isUnlocked(levelById(wanted)!, editor().completed);
  await openLevel(ok || levelFromUrl(location.href) ? wanted : SANDBOX);
}

/** All levels, for the level map. */
export const allLevels = (): readonly Level[] => LEVELS;
