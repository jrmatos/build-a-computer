/**
 * Storage providers: where a workspace file lives outside the browser.
 *
 * v1 has no backend (owner decision 2026-10-05). IndexedDB on this device is
 * always the source of truth; a provider only keeps a copy the player owns.
 *
 * - LocalFileProvider: a real file on disk through the File System Access API
 *   (Chrome, Edge). Keeps the file handle so the workspace autosaves into it.
 * - DownloadProvider: everywhere else (Firefox, Safari): upload with a file
 *   picker, save as a download. No autosave.
 *
 * Later providers plug in here, next to these two, with no change to callers:
 * - GoogleDriveProvider (id 'gdrive'): open() = Drive file picker, save() =
 *   files.update on the remembered file id; canAutosave = true.
 * - DropboxProvider (id 'dropbox'): open() = Chooser, save() = files/upload
 *   with mode=overwrite on the remembered path; canAutosave = true.
 * Both need OAuth and network code, which v1 deliberately does not contain.
 * They report failures as StorageError codes so the autosave state machine
 * and the toasts stay the same.
 */
import { downloadJson } from '../level/download';

export type StorageErrorCode =
  /** The player closed a picker. Not an error to report. */
  | 'cancelled'
  /** Permission to the file was denied or has lapsed (needs a click to ask again). */
  | 'permission'
  /** The file was deleted or moved. */
  | 'not-found'
  /** Someone else wrote the file since our last save (another tab, device or editor). */
  | 'changed'
  /** Anything else: disk full, locked file, I/O error. */
  | 'write-failed'
  | 'unsupported';

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/** Map a DOMException from the File System Access API (or anything else) to a StorageError. */
export function toStorageError(e: unknown): StorageError {
  if (e instanceof StorageError) return e;
  const name = (e as { name?: string } | null)?.name ?? '';
  const message = e instanceof Error ? e.message : String(e);
  if (name === 'AbortError') return new StorageError('cancelled', message);
  if (name === 'NotAllowedError' || name === 'SecurityError') return new StorageError('permission', message);
  if (name === 'NotFoundError') return new StorageError('not-found', message);
  return new StorageError('write-failed', message);
}

export interface StorageFile {
  name: string;
  text: string;
}

export interface StorageProvider {
  readonly id: string;
  readonly label: string;
  /** Whether it can write to the same target again without a prompt. */
  readonly canAutosave: boolean;
  available(): boolean;
  /** Let the player pick a file and read it. Resolves null when they cancel. */
  open(): Promise<StorageFile | null>;
  /**
   * Write `text`. With `name` (or with no connected target) the player picks
   * where; otherwise it writes to the connected target. Throws StorageError
   * ('cancelled' when a picker is closed).
   */
  save(text: string, name?: string): Promise<void>;
  /** Name of the connected target, or null. */
  connectedName(): string | null;
  disconnect(): void;
}

// ---------------------------------------------------------------- File System Access API

/** The parts of FileSystemFileHandle we use (permission methods are not in lib.dom yet). */
export interface FileHandleLike {
  readonly kind?: 'file';
  readonly name: string;
  getFile(): Promise<{ text(): Promise<string>; lastModified: number }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
  queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

/** window.showOpenFilePicker / showSaveFilePicker, injectable for tests. */
export interface FilePickers {
  showOpenFilePicker?(o: { types: PickerType[]; excludeAcceptAllOption?: boolean; multiple?: false; id?: string }): Promise<FileHandleLike[]>;
  showSaveFilePicker?(o: { types: PickerType[]; suggestedName?: string; id?: string }): Promise<FileHandleLike>;
}

const JSON_TYPES: PickerType[] = [{ description: 'Build a Computer workspace', accept: { 'application/json': ['.json'] } }];
const PICKER_ID = 'build-a-computer-workspace';

export const hasFileSystemAccess = (w: FilePickers | undefined = globalThis as FilePickers): boolean =>
  typeof w?.showSaveFilePicker === 'function' && typeof w.showOpenFilePicker === 'function';

/** A file on disk through the File System Access API. */
export class LocalFileProvider implements StorageProvider {
  readonly id = 'local-file';
  readonly label = 'File on this device';
  readonly canAutosave = true;
  private handle: FileHandleLike | null = null;
  /** lastModified after our own last read or write; a later value means someone else wrote. */
  private known: number | undefined;

  constructor(private readonly pickers: FilePickers = globalThis as FilePickers) {}

  available(): boolean {
    return hasFileSystemAccess(this.pickers);
  }

  connectedName(): string | null {
    return this.handle?.name ?? null;
  }

  get connectedHandle(): FileHandleLike | null {
    return this.handle;
  }

  /** Use `handle` for later saves (after a picker or a reconnect). */
  connect(handle: FileHandleLike, lastModified?: number): void {
    this.handle = handle;
    this.known = lastModified;
  }

  disconnect(): void {
    this.handle = null;
    this.known = undefined;
  }

  /** Pick a file and read it, without connecting (the caller decides after a preview). */
  async pickOpen(): Promise<{ handle: FileHandleLike; name: string; text: string; lastModified: number } | null> {
    if (!this.pickers.showOpenFilePicker) throw new StorageError('unsupported');
    let handle: FileHandleLike | undefined;
    try {
      [handle] = await this.pickers.showOpenFilePicker({ types: JSON_TYPES, multiple: false, id: PICKER_ID });
    } catch (e) {
      const err = toStorageError(e);
      if (err.code === 'cancelled') return null;
      throw err;
    }
    if (!handle) return null;
    return { handle, ...(await LocalFileProvider.read(handle)) };
  }

  /** Read a handle (e.g. one restored from IndexedDB). */
  static async read(handle: FileHandleLike): Promise<{ name: string; text: string; lastModified: number }> {
    try {
      const file = await handle.getFile();
      return { name: handle.name, text: await file.text(), lastModified: file.lastModified };
    } catch (e) {
      throw toStorageError(e);
    }
  }

  /** Permission state for read/write; 'granted' when the browser has no permission API. */
  static async permission(handle: FileHandleLike, request: boolean): Promise<PermissionState> {
    try {
      const fn = request ? handle.requestPermission : handle.queryPermission;
      return fn ? await fn.call(handle, { mode: 'readwrite' }) : 'granted';
    } catch (e) {
      // requestPermission without a user gesture throws SecurityError.
      console.error(e);
      return 'denied';
    }
  }

  async open(): Promise<StorageFile | null> {
    const picked = await this.pickOpen();
    if (!picked) return null;
    this.connect(picked.handle, picked.lastModified);
    return { name: picked.name, text: picked.text };
  }

  /** Show the save picker; resolves the new handle, or null when cancelled. Does not connect. */
  async pickSave(suggestedName: string): Promise<FileHandleLike | null> {
    if (!this.pickers.showSaveFilePicker) throw new StorageError('unsupported');
    try {
      return await this.pickers.showSaveFilePicker({ types: JSON_TYPES, suggestedName, id: PICKER_ID });
    } catch (e) {
      const err = toStorageError(e);
      if (err.code === 'cancelled') return null;
      throw err;
    }
  }

  async save(text: string, name?: string): Promise<void> {
    if (name !== undefined || !this.handle) {
      const handle = await this.pickSave(name ?? 'build-a-computer-workspace.json');
      if (!handle) throw new StorageError('cancelled');
      this.connect(handle);
    }
    await this.write(text);
  }

  /** Write to the connected file. Refuses if permission lapsed, the file is gone or changed elsewhere. */
  async write(text: string): Promise<void> {
    const handle = this.handle;
    if (!handle) throw new StorageError('not-found', 'No file connected');
    if ((await LocalFileProvider.permission(handle, false)) !== 'granted') throw new StorageError('permission');
    let file: { lastModified: number };
    try {
      file = await handle.getFile();
    } catch (e) {
      throw toStorageError(e);
    }
    if (this.known !== undefined && file.lastModified > this.known) throw new StorageError('changed');
    let writable: Awaited<ReturnType<FileHandleLike['createWritable']>> | undefined;
    try {
      writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
    } catch (e) {
      // An aborted writable leaves the old file contents in place.
      await writable?.abort?.().catch(() => undefined);
      const err = toStorageError(e);
      throw err.code === 'cancelled' ? new StorageError('write-failed', err.message) : err;
    }
    try {
      this.known = (await handle.getFile()).lastModified;
    } catch {
      this.known = undefined;
    }
  }
}

// ---------------------------------------------------------------- download / upload fallback

/** Firefox, Safari, or anything without the File System Access API: file input in, download out. */
export class DownloadProvider implements StorageProvider {
  readonly id = 'download';
  readonly label = 'Download';
  readonly canAutosave = false;

  available(): boolean {
    return typeof document !== 'undefined';
  }

  connectedName(): string | null {
    return null;
  }

  disconnect(): void {}

  open(): Promise<StorageFile | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      const done = () => input.remove();
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        done();
        if (!file) return resolve(null);
        file.text().then((text) => resolve({ name: file.name, text }), (e: unknown) => reject(toStorageError(e)));
      });
      input.addEventListener('cancel', () => {
        done();
        resolve(null);
      });
      document.body.append(input);
      input.click();
    });
  }

  save(text: string, name = 'build-a-computer-workspace.json'): Promise<void> {
    downloadJson(name, text);
    return Promise.resolve();
  }
}
