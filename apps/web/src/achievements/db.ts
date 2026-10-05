/**
 * Achievements on this device (ADR-008: nothing leaves the browser except in
 * the workspace file the player exports). A database of its own so the level
 * and community databases keep their schemas. The record is validated on
 * read; writes merge with what is stored, so two tabs never erase each
 * other's unlocks. Falls back to memory when IndexedDB is unavailable.
 */
import Dexie, { type Table } from 'dexie';
import { WorkspaceAchievements } from '@build-a-computer/schema';
import { emptySaved, mergeSaved, type SavedAchievements } from './engine';

export interface AchievementStorage {
  readonly mode: 'indexeddb' | 'memory';
  get(): Promise<SavedAchievements>;
  /** Merge `saved` into the stored record and return the merged result. */
  merge(saved: SavedAchievements): Promise<SavedAchievements>;
}

export const ACHIEVEMENT_DB = {
  name: 'build-a-computer-achievements',
  version: 1,
  stores: { state: '' },
} as const;
const KEY = 'state';

/** Never throws: an unreadable record reads as empty (and is overwritten by the next merge). */
export function decodeSaved(raw: unknown): SavedAchievements {
  const r = WorkspaceAchievements.safeParse(raw);
  return r.success ? r.data : emptySaved();
}

class AchievementDb extends Dexie {
  state!: Table<unknown, string>;
  constructor() {
    super(ACHIEVEMENT_DB.name);
    this.version(ACHIEVEMENT_DB.version).stores(ACHIEVEMENT_DB.stores);
  }
}

export function memoryAchievementStorage(): AchievementStorage {
  let saved = emptySaved();
  return {
    mode: 'memory',
    get: async () => structuredClone(saved),
    merge: async (s) => {
      saved = mergeSaved(saved, s);
      return structuredClone(saved);
    },
  };
}

async function openDb(timeoutMs = 3000): Promise<AchievementStorage> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
  const db = new AchievementDb();
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
    get: async () => decodeSaved(await db.state.get(KEY)),
    merge: (s) =>
      db.transaction('rw', db.state, async () => {
        const merged = mergeSaved(decodeSaved(await db.state.get(KEY)), s);
        await db.state.put(merged, KEY);
        return merged;
      }),
  };
}

let storage: AchievementStorage | null = null;
let opening: Promise<AchievementStorage> | null = null;

/** The achievements store, opened once; memory when IndexedDB fails. */
export function achievementDb(): Promise<AchievementStorage> {
  if (storage) return Promise.resolve(storage);
  opening ??= openDb()
    .catch((e: unknown) => {
      console.error(e);
      return memoryAchievementStorage();
    })
    .then((s) => (storage = s));
  return opening;
}

/** Merge into storage; on a storage error switch to memory so the session keeps working. */
export async function persistSaved(saved: SavedAchievements): Promise<SavedAchievements> {
  const s = await achievementDb();
  try {
    return await s.merge(saved);
  } catch (e) {
    console.error(e);
    if (s.mode === 'memory') return saved;
    storage = memoryAchievementStorage();
    return storage.merge(saved);
  }
}
