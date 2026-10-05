/**
 * Community data on this device (ADR-008: nothing is uploaded): installed
 * level packs and local best results. A database of its own, so the level
 * saves database (level/db.ts) keeps its schema. Records are stored raw and
 * validated on read. Falls back to memory when IndexedDB is unavailable.
 */
import Dexie, { type Table } from 'dexie';

export interface CommunityStorage {
  readonly mode: 'indexeddb' | 'memory';
  /** Every record of a table by key. */
  all(table: 'packs' | 'best'): Promise<Map<string, unknown>>;
  put(table: 'packs' | 'best', key: string, value: unknown): Promise<void>;
  remove(table: 'packs' | 'best', key: string): Promise<void>;
}

export const COMMUNITY_DB = { name: 'build-a-computer-community', version: 1, stores: { packs: '', best: '' } } as const;

class CommunityDb extends Dexie {
  packs!: Table<unknown, string>;
  best!: Table<unknown, string>;
  constructor() {
    super(COMMUNITY_DB.name);
    this.version(COMMUNITY_DB.version).stores(COMMUNITY_DB.stores);
  }
}

export function memoryCommunityStorage(): CommunityStorage {
  const tables = { packs: new Map<string, unknown>(), best: new Map<string, unknown>() };
  return {
    mode: 'memory',
    all: async (t) => new Map([...tables[t]].map(([k, v]) => [k, structuredClone(v)])),
    put: async (t, k, v) => {
      tables[t].set(k, structuredClone(v));
    },
    remove: async (t, k) => {
      tables[t].delete(k);
    },
  };
}

export async function openCommunityDb(timeoutMs = 3000): Promise<CommunityStorage> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
  const db = new CommunityDb();
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
    all: async (t) => {
      const keys = await db[t].toCollection().primaryKeys();
      const values = await db[t].bulkGet(keys);
      return new Map(keys.map((k, i) => [k, values[i]]));
    },
    put: async (t, k, v) => {
      await db[t].put(v, k);
    },
    remove: async (t, k) => {
      await db[t].delete(k);
    },
  };
}

let storage: CommunityStorage | null = null;
let opening: Promise<CommunityStorage> | null = null;

/** The community store, opened once; memory when IndexedDB fails. */
export function communityDb(): Promise<CommunityStorage> {
  if (storage) return Promise.resolve(storage);
  opening ??= openCommunityDb()
    .catch((e: unknown) => {
      console.error(e);
      return memoryCommunityStorage();
    })
    .then((s) => (storage = s));
  return opening;
}

/** Write, falling back to memory on any storage error so the session keeps working. */
export async function communityWrite(fn: (s: CommunityStorage) => Promise<void>): Promise<void> {
  const s = await communityDb();
  try {
    await fn(s);
  } catch (e) {
    console.error(e);
    if (s.mode === 'memory') return;
    storage = memoryCommunityStorage();
    await fn(storage);
  }
}
