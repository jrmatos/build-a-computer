/**
 * Files and the whole workspace (STO-01..05): export / import, Excalidraw-style
 * "Save to file…" that keeps autosaving into the chosen file, "Open file…",
 * reconnecting to the last file on the next visit, and the fallbacks for
 * browsers without the File System Access API.
 *
 * IndexedDB autosave (level/persist.ts) stays the source of truth on this
 * device; the file is a copy the player owns. A failing file never blocks or
 * loses in-browser saves (E-PLAT-02).
 */
import { isSourceLevel } from '@build-a-computer/platform-core';
import { SANDBOX } from '@build-a-computer/content';
import {
  isPackData,
  NewerVersionError,
  parseImportFile,
  parseUntrustedJson,
  WORKSPACE_LIMITS,
  WORKSPACE_VERSION,
  type ImportedFile,
  type Save,
  type Workspace,
} from '@build-a-computer/schema';
import { rootBoard, setChips } from '../editor/chips';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { adoptBoard, applyImport, workspaceData } from '../level/persist';
import { makeSave, sourceFor, sourceToSave } from '../level/saves';
import { FileSync } from './autosave';
import { forgetLastHandle, loadLastHandle, saveLastHandle } from './handles';
import { isNoopMerge, mergeWorkspace, resolveImport, type Side } from './merge';
import { requestPersistentStorage } from './persistence';
import { DownloadProvider, LocalFileProvider, StorageError, type FileHandleLike } from './provider';
import { useFileUi, type ImportPreview } from './state';
import { emitAchievement } from '../achievements/events';
import { achievementsForExport, importAchievements, onAchievementsChange } from '../achievements/runtime';

const editor = () => useEditor.getState();
const ui = () => useFileUi.getState();
const toast = (key: string, tone: 'info' | 'error' | 'success' = 'info', vars?: Record<string, string | number>) =>
  editor().toast(t(key, vars), tone);

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? undefined;

export const local = new LocalFileProvider();
export const download = new DownloadProvider();

/** Providers in menu order. GoogleDriveProvider / DropboxProvider join this list later (see provider.ts). */
export const providers = [local, download] as const;

const sync = new FileSync({
  target: { write: (text) => local.write(text) },
  serialize: async () => JSON.stringify(await buildWorkspace(), null, 2),
  onState: (s) => ui().set({ sync: s }),
  onError: (e) => onSyncError(e),
});

/** A handle from a previous visit, waiting for a click (permission) to reconnect. */
let remembered: FileHandleLike | null = null;

const today = () => new Date().toISOString().slice(0, 10);
export const workspaceFileName = (d = today()) => `build-a-computer-workspace-${d}.json`;

// ---------------------------------------------------------------- workspace

export async function buildWorkspace(): Promise<Workspace> {
  const { progress, saves } = await workspaceData();
  const achievements = await achievementsForExport();
  const { chips, theme, showGrid } = editor();
  return {
    kind: 'build-a-computer/workspace',
    version: WORKSPACE_VERSION,
    exportedAt: new Date().toISOString(),
    ...(APP_VERSION ? { appVersion: APP_VERSION } : {}),
    progress,
    saves,
    chips,
    settings: { theme, showGrid },
    achievements,
  };
}

/** "Export everything…": download the whole workspace. */
export async function exportAll(): Promise<void> {
  const name = workspaceFileName();
  try {
    await download.save(JSON.stringify(await buildWorkspace(), null, 2), name);
    toast('storage.exported', 'success', { file: name });
    emitAchievement({ type: 'workspace-exported' });
  } catch (e) {
    console.error(e);
    toast('storage.exportFailed', 'error');
  }
  void askPersist();
}

/** Download only the current level's board (single-board save). */
export function exportBoard(): void {
  const { chips, level, source } = editor();
  const lv = level ?? SANDBOX;
  const save: Save = makeSave(lv, rootBoard(), chips, undefined, sourceToSave(lv, source));
  const name = `build-a-computer-${save.levelId}.json`;
  void download.save(JSON.stringify(save, null, 2), name);
  toast('storage.boardExported', 'success', { file: name });
}

// ---------------------------------------------------------------- reading files

function reason(e: unknown): string {
  return e instanceof Error ? (e.message.split('\n')[0] ?? e.message) : String(e);
}

function parse(text: string): ImportedFile | null {
  try {
    return parseImportFile(text);
  } catch (e) {
    // E-DATA-04: a newer file is reported and never loaded or overwritten.
    if (e instanceof NewerVersionError) editor().toast(e.message, 'error');
    else if (e instanceof SyntaxError || (e as { name?: string }).name === 'ImportError') toast('storage.loadFailed', 'error', { reason: reason(e) });
    else toast('storage.invalid', 'error');
    console.error(e);
    return null;
  }
}

/** Pack files are told apart by their top-level `kind` (a cheap text check first, then the parsed object). */
function looksLikePack(text: string): boolean {
  if (!text.includes('build-a-computer/pack')) return false;
  try {
    return isPackData(parseUntrustedJson(text, WORKSPACE_LIMITS));
  } catch {
    return false;
  }
}

/** A single-board save loads onto the current board (undoable), as before. */
function loadSave(save: Save): void {
  const { commit, level } = editor();
  commit(() => adoptBoard(save), []);
  // Code levels: the file's source replaces the editor text (undoable inside the code editor).
  if (level && isSourceLevel(level) && save.levelId === level.id && save.source !== undefined) editor().set({ source: sourceFor(level, save) });
  if (level && save.levelId !== level.id) toast('storage.otherLevel', 'info', { id: save.levelId });
  else toast('storage.boardLoaded', 'success');
}

function blockedByEditor(): boolean {
  if (editor().readOnly) {
    toast('storage.readOnly', 'error');
    return true;
  }
  return false;
}

/** Handle a file's text: load a board, or preview a workspace merge. */
async function receive(text: string, fileName: string, mode: ImportPreview['mode'], handle?: FileHandleLike, lastModified?: number): Promise<void> {
  // An empty file (just created, or never written) has nothing to lose: start autosaving into it.
  if (mode === 'open' && handle && !text.trim()) {
    await connectHandle(handle, lastModified);
    toast('storage.connected', 'success', { file: fileName });
    return;
  }
  // Community level packs (COM-03) come in through Import too; they are checked, never merged.
  if (looksLikePack(text)) {
    const { importPackText } = await import('../community/packImport');
    await importPackText(text, fileName);
    return;
  }
  const file = parse(text);
  if (!file) return;
  if (file.kind === 'save') {
    if (blockedByEditor()) return;
    loadSave(file.save);
    if (mode === 'open') toast('storage.boardNotConnected', 'info');
    return;
  }
  if (blockedByEditor()) return;
  const { progress, saves } = await workspaceData();
  const merge = mergeWorkspace({ progress, saves, chips: editor().chips }, file.workspace);
  const preview: ImportPreview = { fileName, mode, workspace: file.workspace, merge, handle, lastModified };
  if (isNoopMerge(merge)) {
    if (mode === 'open') await applyPreview(preview, {});
    else {
      // Achievements merge without asking: a union never loses anything.
      const gained = await importAchievements(file.workspace.achievements);
      if (gained) toast('ach.import.gained', 'success', { count: gained });
      else toast('storage.nothingNew', 'info', { file: fileName });
    }
    return;
  }
  ui().set({ preview });
}

/** The player confirmed the import dialog. */
export async function applyPreview(p: ImportPreview, choices: Record<string, Side>): Promise<void> {
  ui().set({ preview: null });
  if (blockedByEditor()) return;
  const r = resolveImport(p.merge, choices);
  if (p.merge.chipsChanged.length) setChips(p.merge.chips);
  await applyImport({ progress: p.merge.progress, saves: r.write, backups: r.backups });
  await importAchievements(p.workspace.achievements);
  const s = p.workspace.settings;
  if (s) editor().set({ ...(s.theme ? { theme: s.theme } : {}), ...(s.showGrid !== undefined ? { showGrid: s.showGrid } : {}) });
  if (p.mode === 'open' && p.handle) {
    await connectHandle(p.handle, p.lastModified);
    toast('storage.opened', 'success', { file: p.fileName });
  } else {
    const n = Object.keys(r.write).length;
    toast('storage.imported', 'success', { boards: n, chips: p.merge.chipsChanged.length, levels: p.merge.progressGained.length });
  }
}

export function cancelPreview(): void {
  ui().set({ preview: null });
}

/** "Import…": upload a save or a workspace and merge it. Never connects the file. */
export async function importFile(): Promise<void> {
  try {
    const f = await download.open();
    if (f) await receive(f.text, f.name, 'import');
  } catch (e) {
    console.error(e);
    toast('storage.loadFailed', 'error', { reason: reason(e) });
  }
}

/** "Open file…" (Ctrl+O): pick a file, merge it, then keep autosaving into it. Falls back to Import. */
export async function openFile(): Promise<void> {
  void askPersist();
  if (!ui().fsa) return importFile();
  try {
    const picked = await local.pickOpen();
    if (picked) await receive(picked.text, picked.name, 'open', picked.handle, picked.lastModified);
  } catch (e) {
    reportFileError(e, null);
  }
}

// ---------------------------------------------------------------- writing files

async function connectHandle(handle: FileHandleLike, lastModified?: number): Promise<void> {
  local.connect(handle, lastModified);
  remembered = null;
  ui().set({ reconnect: null });
  void saveLastHandle(handle);
  await sync.connect(handle.name, true);
}

/** "Save to file…": pick a file and autosave into it (E-PLAT-03: download where unsupported). */
export async function saveToFile(): Promise<void> {
  void askPersist();
  if (!ui().fsa) return exportAll();
  try {
    const handle = await local.pickSave(sync.state.fileName ?? workspaceFileName());
    if (!handle) return;
    await connectHandle(handle);
    if (sync.state.status === 'saved') toast('storage.connected', 'success', { file: handle.name });
  } catch (e) {
    reportFileError(e, null);
  }
}

/** Ctrl+S: write now to the connected file, or set one up. */
export async function saveNow(): Promise<void> {
  const st = sync.state;
  if (st.fileName && st.status !== 'error') {
    await sync.flush(true);
    if (sync.state.status === 'saved') toast('storage.savedTo', 'success', { file: st.fileName });
    return;
  }
  if (st.fileName && st.status === 'error') return fixError();
  if (ui().reconnect) return reconnect();
  return saveToFile();
}

/** Stop autosaving into the file. Data in this browser is untouched. */
export function disconnectFile(): void {
  const name = sync.state.fileName;
  void sync.flush().finally(() => {
    sync.disconnect();
    local.disconnect();
    void forgetLastHandle();
    if (name) toast('storage.disconnected', 'info', { file: name });
  });
}

/** The status indicator was clicked while in error: do what the error needs. */
export async function fixError(): Promise<void> {
  const { error, fileName } = sync.state;
  const handle = local.connectedHandle;
  if (error === 'permission' && handle) {
    if ((await LocalFileProvider.permission(handle, true)) === 'granted') await sync.flush(true);
    else toast('storage.error.permissionDenied', 'error', { file: fileName ?? '' });
  } else if (error === 'changed' && handle) {
    // Someone else wrote the file: merge it in (player picks per level), then write.
    try {
      const f = await LocalFileProvider.read(handle);
      await receive(f.text, f.name, 'open', handle, f.lastModified);
    } catch (e) {
      reportFileError(e, fileName);
    }
  } else if (error === 'not-found' || !handle) {
    await saveToFile();
  } else {
    await sync.flush(true);
  }
}

/** "Reconnect to <name>": ask permission (needs this click), read the file, merge, autosave again. */
export async function reconnect(): Promise<void> {
  const handle = remembered;
  if (!handle) return;
  if ((await LocalFileProvider.permission(handle, true)) !== 'granted') {
    toast('storage.error.permissionDenied', 'error', { file: handle.name });
    return;
  }
  try {
    const f = await LocalFileProvider.read(handle);
    await receive(f.text, f.name, 'open', handle, f.lastModified);
  } catch (e) {
    reportFileError(e, handle.name);
    if (e instanceof StorageError && e.code === 'not-found') forgetReconnect();
  }
}

export function forgetReconnect(): void {
  remembered = null;
  ui().set({ reconnect: null });
  void forgetLastHandle();
}

function reportFileError(e: unknown, file: string | null): void {
  const err = e instanceof StorageError ? e : new StorageError('write-failed', reason(e));
  if (err.code === 'cancelled') return;
  console.error(e);
  toast(`storage.error.${err.code}`, 'error', { file: file ?? '', reason: err.message });
}

function onSyncError(e: StorageError): void {
  reportFileError(e, sync.state.fileName);
}

// ---------------------------------------------------------------- persistent storage (E-PLAT-04)

let persistAsked = false;
async function askPersist(): Promise<void> {
  if (persistAsked) return;
  persistAsked = true;
  ui().set({ persist: await requestPersistentStorage() });
}

// ---------------------------------------------------------------- startup

let started = false;

export function startStorage(): void {
  if (started) return;
  started = true;
  ui().set({ fsa: local.available() });

  // Any change to the workspace marks the connected file dirty (autosave ~2 s later).
  useEditor.subscribe((s, prev) => {
    const changed =
      rootBoard(s) !== rootBoard(prev) || s.source !== prev.source || s.chips !== prev.chips || s.completed !== prev.completed || s.theme !== prev.theme || s.showGrid !== prev.showGrid;
    if (!changed) return;
    sync.markDirty();
    // The first real edit is a meaningful save: ask the browser to keep our data.
    if (prev.level && s.level === prev.level && (rootBoard(s) !== rootBoard(prev) || s.source !== prev.source)) void askPersist();
  });
  onAchievementsChange(() => sync.markDirty());
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void sync.flush();
    });
    window.addEventListener('pagehide', () => void sync.flush());
  }
  if (local.available()) void restoreHandle();
}

/** Resolves once persistence has opened the first level (so IndexedDB is ready). */
function levelLoaded(): Promise<void> {
  if (editor().level) return Promise.resolve();
  return new Promise((resolve) => {
    const off = useEditor.subscribe((s) => {
      if (!s.level) return;
      off();
      resolve();
    });
  });
}

/** Offer the last file again. Connect silently only when allowed and the file adds nothing new. */
async function restoreHandle(): Promise<void> {
  const rec = await loadLastHandle();
  if (!rec) return;
  await levelLoaded();
  remembered = rec.handle;
  ui().set({ reconnect: { name: rec.name } });
  if ((await LocalFileProvider.permission(rec.handle, false)) !== 'granted') return;
  try {
    const f = await LocalFileProvider.read(rec.handle);
    const file = parseImportFile(f.text);
    if (file.kind !== 'workspace' || editor().readOnly) return;
    await importAchievements(file.workspace.achievements);
    const { progress, saves } = await workspaceData();
    const merge = mergeWorkspace({ progress, saves, chips: editor().chips }, file.workspace);
    if (isNoopMerge(merge) && remembered === rec.handle) await connectHandle(rec.handle, f.lastModified);
  } catch (e) {
    // Moved, deleted or unreadable: keep the Reconnect offer; clicking it explains.
    console.error(e);
  }
}

/** For tests and debugging. */
export const _internal = { sync };
