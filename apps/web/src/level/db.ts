/**
 * Storage behind a small interface so the logic can be tested without
 * IndexedDB. Records are stored raw and validated on read (persist.ts).
 */
import Dexie, { type Table } from 'dexie';

export interface Storage {
  readonly mode: 'indexeddb' | 'memory';
  getSave(levelId: string): Promise<unknown>;
  putSave(levelId: string, save: unknown): Promise<void>;
  getProgress(): Promise<unknown>;
  putProgress(progress: unknown): Promise<void>;
}

const PROGRESS_KEY = 'progress';

class GroundUpDb extends Dexie {
  saves!: Table<unknown, string>;
  progress!: Table<unknown, string>;
  constructor() {
    super('ground-up');
    // Out-of-line keys: saves by level id, progress under a single key.
    this.version(1).stores({ saves: '', progress: '' });
  }
}

export async function openIndexedDb(timeoutMs = 3000): Promise<Storage> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
  const db = new GroundUpDb();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.open(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('IndexedDB open timed out')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  return {
    mode: 'indexeddb',
    getSave: (id) => db.saves.get(id),
    putSave: async (id, save) => {
      await db.saves.put(save, id);
    },
    getProgress: () => db.progress.get(PROGRESS_KEY),
    putProgress: async (p) => {
      await db.progress.put(p, PROGRESS_KEY);
    },
  };
}

/** In-memory fallback (E-DATA-02). Nothing survives a reload; the banner says so. */
export function memoryStorage(fallback?: Storage): Storage {
  const saves = new Map<string, unknown>();
  let progress: unknown;
  return {
    mode: 'memory',
    // Reads fall through to the old storage (if any) so a quota error mid-session loses nothing.
    getSave: async (id) =>
      saves.has(id) ? structuredClone(saves.get(id)) : await fallback?.getSave(id).catch(() => undefined),
    putSave: async (id, s) => {
      saves.set(id, structuredClone(s));
    },
    getProgress: async () =>
      progress !== undefined ? structuredClone(progress) : await fallback?.getProgress().catch(() => undefined),
    putProgress: async (p) => {
      progress = structuredClone(p);
    },
  };
}
