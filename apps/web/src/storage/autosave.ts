/**
 * Autosave into a connected file, Excalidraw style: a change marks the
 * workspace dirty, and it is written ~2 s after the last change (or right away
 * on flush, e.g. when the tab hides or on Ctrl+S). One write at a time; changes
 * during a write trigger another one afterwards. Failures keep the dirty flag so
 * nothing is lost: IndexedDB stays the source of truth on this device.
 *
 * Pure apart from the injected timers, so the state machine is unit-tested
 * with a fake provider.
 */
import { StorageError, toStorageError, type StorageErrorCode } from './provider';

export type SyncStatus =
  /** No file connected. */
  | 'none'
  /** The file has everything. */
  | 'saved'
  /** Changes not written yet (a write is scheduled). */
  | 'dirty'
  | 'saving'
  /** The last write failed; see `error`. */
  | 'error';

export interface SyncState {
  status: SyncStatus;
  fileName: string | null;
  error: StorageErrorCode | null;
  /** Epoch ms of the last successful write. */
  savedAt: number | null;
}

export interface SyncTarget {
  /** Write the text to the connected file. Throws StorageError. */
  write(text: string): Promise<void>;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

export interface FileSyncOptions {
  target: SyncTarget;
  /** Current workspace as file text. */
  serialize(): Promise<string>;
  delayMs?: number;
  onState?(s: SyncState): void;
  onError?(e: StorageError): void;
  timers?: Timers;
  now?(): number;
}

export const AUTOSAVE_DELAY_MS = 2000;

/** Errors that need the player (a click, a new file) before writing again. */
const NEEDS_PLAYER: ReadonlySet<StorageErrorCode> = new Set(['permission', 'not-found', 'changed', 'unsupported']);

export class FileSync {
  private st: SyncState = { status: 'none', fileName: null, error: null, savedAt: null };
  private dirty = false;
  private timer: unknown = null;
  private inflight: Promise<void> | null = null;
  private again = false;
  private readonly delay: number;
  private readonly timers: Timers;
  private readonly now: () => number;

  constructor(private readonly o: FileSyncOptions) {
    this.delay = o.delayMs ?? AUTOSAVE_DELAY_MS;
    this.timers = o.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };
    this.now = o.now ?? (() => Date.now());
  }

  get state(): SyncState {
    return this.st;
  }

  get connected(): boolean {
    return this.st.fileName !== null;
  }

  private set(patch: Partial<SyncState>): void {
    this.st = { ...this.st, ...patch };
    this.o.onState?.(this.st);
  }

  /**
   * Start autosaving into `fileName`. With `write` (the default) the workspace
   * is written at once, so the file matches this device.
   */
  async connect(fileName: string, write = true): Promise<void> {
    this.cancelTimer();
    this.set({ fileName, status: 'saved', error: null, savedAt: write ? null : this.now() });
    this.dirty = write;
    if (write) await this.flush();
  }

  disconnect(): void {
    this.cancelTimer();
    this.dirty = false;
    this.again = false;
    this.set({ status: 'none', fileName: null, error: null, savedAt: null });
  }

  /** Something in the workspace changed. */
  markDirty(): void {
    if (!this.connected) return;
    this.dirty = true;
    if (this.st.status === 'error' && this.st.error && NEEDS_PLAYER.has(this.st.error)) return;
    if (this.st.status !== 'saving') this.set({ status: 'dirty' });
    this.schedule();
  }

  private schedule(): void {
    this.cancelTimer();
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.flush();
    }, this.delay);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  /** Write now if there is anything to write. `force` writes even when clean (Ctrl+S). Never throws. */
  flush(force = false): Promise<void> {
    if (!this.connected) return Promise.resolve();
    this.cancelTimer();
    if (force) this.dirty = true;
    if (this.inflight) {
      if (this.dirty) this.again = true;
      return this.inflight;
    }
    if (!this.dirty) return Promise.resolve();
    this.inflight = this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async run(): Promise<void> {
    do {
      this.again = false;
      this.dirty = false;
      const file = this.st.fileName;
      this.set({ status: 'saving' });
      try {
        const text = await this.o.serialize();
        await this.o.target.write(text);
      } catch (e) {
        this.dirty = true;
        if (file !== this.st.fileName) return;
        const err = toStorageError(e);
        this.set({ status: 'error', error: err.code });
        this.o.onError?.(err);
        return;
      }
      // Disconnected or switched files during the write: that state wins.
      if (file !== this.st.fileName) return;
      this.set({ status: this.dirty ? 'dirty' : 'saved', error: null, savedAt: this.now() });
    } while (this.again && this.dirty);
  }
}
