/**
 * One-time copy of browser data written before the project was renamed from
 * "Ground Up" to "Build a Computer". The IndexedDB databases and localStorage
 * keys changed name, so without this a returning player would see an empty game.
 *
 * Rules:
 * - Runs once at startup, before persistence opens the new databases (main.tsx).
 * - Copies a legacy database only when it exists, has rows, and the new database
 *   is empty: newer data is never overwritten.
 * - Copies a legacy localStorage key only when the new key is absent.
 * - Never deletes the legacy data; it stays as a backup.
 * - Records finished steps under MIGRATION_DONE_KEY so later boots skip them
 *   (idempotent). A failed step is not recorded and is retried next boot.
 * - Never throws: failures are logged and reported to the caller.
 *
 * The decisions are pure functions; IndexedDB and localStorage sit behind small
 * interfaces so the orchestration is tested with fakes.
 */
import Dexie, { type IndexableType, type IndexableTypeArrayReadonly } from 'dexie';
import { LEVEL_DB } from '../level/db';
import { CHIP_DB } from '../ui/chips/db';
import { FILES_DB } from './handles';

export interface DbSpec {
  readonly name: string;
  readonly version: number;
  readonly stores: Readonly<Record<string, string>>;
}

/** Legacy database name → the database that replaces it. */
export const LEGACY_DATABASES: readonly { from: string; to: DbSpec }[] = [
  { from: 'ground-up', to: LEVEL_DB },
  { from: 'ground-up-chips', to: CHIP_DB },
  { from: 'ground-up-files', to: FILES_DB },
];

export const LEGACY_LOCAL_PREFIX = 'ground-up:';
export const LOCAL_PREFIX = 'build-a-computer:';
export const MIGRATION_DONE_KEY = `${LOCAL_PREFIX}legacy-migration`;
/** Step id for the localStorage copy in the done list (database steps use the legacy db name). */
export const LOCAL_STEP = 'localStorage';

/** `ground-up:dock` → `build-a-computer:dock`; null for keys that are not legacy. */
export function mapLegacyKey(key: string): string | null {
  return key.startsWith(LEGACY_LOCAL_PREFIX) ? LOCAL_PREFIX + key.slice(LEGACY_LOCAL_PREFIX.length) : null;
}

/** Which legacy keys to copy: every legacy key whose new key is not already set. */
export function planLocalCopies(keys: readonly string[], has: (key: string) => boolean): [from: string, to: string][] {
  const out: [string, string][] = [];
  for (const k of keys) {
    const to = mapLegacyKey(k);
    if (to && !has(to)) out.push([k, to]);
  }
  return out;
}

export type DbDecision = 'copy' | 'no-legacy' | 'legacy-empty' | 'target-has-data';

/** Copy only when there is something to copy and nothing to overwrite. */
export function decideDb(legacyRows: number | null, targetRows: number): DbDecision {
  if (legacyRows === null) return 'no-legacy';
  if (legacyRows === 0) return 'legacy-empty';
  if (targetRows > 0) return 'target-has-data';
  return 'copy';
}

/** A step is finished (recorded) once copied or once the new store already holds data. */
export const isFinal = (d: DbDecision): boolean => d === 'copy' || d === 'target-has-data';

export function readDone(kv: KeyValue): Set<string> {
  try {
    const raw = kv.getItem(MIGRATION_DONE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** The localStorage subset used here. */
export interface KeyValue {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Rows of one table: key plus value (keys are out-of-line in every database here, but in-line works too). */
export type TableRows = { key: IndexableType; value: unknown }[];

export interface DbBackend {
  /** All rows of every table in a legacy database, or null when it does not exist. */
  readLegacy(name: string): Promise<Record<string, TableRows> | null>;
  /** Total rows across the target database's tables (0 when it does not exist yet). */
  countTarget(spec: DbSpec): Promise<number>;
  /** Write rows into the target in one transaction, only if it is still empty. Returns false if it was not. */
  writeIfEmpty(spec: DbSpec, tables: Record<string, TableRows>): Promise<boolean>;
}

export interface MigrationResult {
  /** Legacy databases and localStorage keys copied in this run. */
  copied: string[];
  /** Steps that failed (retried next boot). */
  failed: string[];
}

const rowCount = (tables: Record<string, TableRows>): number => Object.values(tables).reduce((n, rows) => n + rows.length, 0);

/** Run every pending step. Never throws. */
export async function runLegacyMigration(
  kv: KeyValue | null,
  db: DbBackend | null,
  databases: readonly { from: string; to: DbSpec }[] = LEGACY_DATABASES,
  log: (msg: string, err?: unknown) => void = (m, e) => console.warn(m, e ?? ''),
): Promise<MigrationResult> {
  const result: MigrationResult = { copied: [], failed: [] };
  const done = kv ? readDone(kv) : new Set<string>();
  const markDone = (step: string) => {
    done.add(step);
    try {
      kv?.setItem(MIGRATION_DONE_KEY, JSON.stringify([...done].sort()));
    } catch (e) {
      log('legacy migration: could not record progress', e);
    }
  };

  if (kv && !done.has(LOCAL_STEP)) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < kv.length; i++) {
        const k = kv.key(i);
        if (k !== null) keys.push(k);
      }
      const legacy = keys.filter((k) => mapLegacyKey(k) !== null);
      for (const [from, to] of planLocalCopies(legacy, (k) => kv.getItem(k) !== null)) {
        const v = kv.getItem(from);
        if (v !== null) {
          kv.setItem(to, v);
          result.copied.push(from);
        }
      }
      if (legacy.length) markDone(LOCAL_STEP);
    } catch (e) {
      log('legacy migration: localStorage copy failed', e);
      result.failed.push(LOCAL_STEP);
    }
  }

  if (db) {
    for (const { from, to } of databases) {
      if (done.has(from)) continue;
      try {
        const tables = await db.readLegacy(from);
        const decision = decideDb(tables ? rowCount(tables) : null, await db.countTarget(to));
        if (decision === 'copy' && tables) {
          const wrote = await db.writeIfEmpty(to, tables);
          if (wrote) result.copied.push(from);
        }
        if (isFinal(decision)) markDone(from);
      } catch (e) {
        log(`legacy migration: copying ${from} → ${to.name} failed`, e);
        result.failed.push(from);
      }
    }
  }
  return result;
}

/** The real IndexedDB backend, via Dexie. */
export const dexieBackend: DbBackend = {
  async readLegacy(name) {
    // No version declared: Dexie opens the existing schema, and rejects with
    // NoSuchDatabaseError (without creating anything) when the database is absent.
    const legacy = new Dexie(name, { addons: [] });
    try {
      await legacy.open();
    } catch (e) {
      if ((e as { name?: string })?.name === 'NoSuchDatabaseError') return null;
      throw e;
    }
    try {
      const out: Record<string, TableRows> = {};
      for (const table of legacy.tables) {
        const rows: TableRows = [];
        await table.toCollection().each((value, cursor) => {
          rows.push({ key: cursor.primaryKey as IndexableType, value });
        });
        out[table.name] = rows;
      }
      return out;
    } finally {
      legacy.close();
    }
  },
  async countTarget(spec) {
    const target = openTarget(spec);
    try {
      let n = 0;
      for (const table of target.tables) n += await table.count();
      return n;
    } finally {
      target.close();
    }
  },
  async writeIfEmpty(spec, tables) {
    const target = openTarget(spec);
    try {
      return await target.transaction('rw', target.tables, async () => {
        for (const table of target.tables) if ((await table.count()) > 0) return false;
        for (const table of target.tables) {
          const rows = tables[table.name];
          if (!rows?.length) continue;
          if (table.schema.primKey.keyPath) await table.bulkPut(rows.map((r) => r.value));
          else await table.bulkPut(rows.map((r) => r.value), rows.map((r) => r.key) as IndexableTypeArrayReadonly);
        }
        return true;
      });
    } finally {
      target.close();
    }
  },
};

function openTarget(spec: DbSpec): Dexie {
  const db = new Dexie(spec.name, { addons: [] });
  db.version(spec.version).stores({ ...spec.stores });
  return db;
}

function safeLocalStorage(): KeyValue | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Startup entry point. Holds a cross-tab lock when available so two tabs do not
 * copy at once, and gives up waiting after `timeoutMs` so a stuck browser API
 * never blocks the app.
 */
export async function migrateLegacyStorage(timeoutMs = 5000): Promise<MigrationResult> {
  const run = () => runLegacyMigration(safeLocalStorage(), typeof indexedDB === 'undefined' ? null : dexieBackend);
  const locked = (): Promise<MigrationResult> =>
    typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request(`${LOCAL_PREFIX}legacy-migration`, run)
      : run();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      locked(),
      new Promise<MigrationResult>((resolve) => {
        timer = setTimeout(() => resolve({ copied: [], failed: ['timeout'] }), timeoutMs);
      }),
    ]);
  } catch (e) {
    console.warn('legacy migration failed', e);
    return { copied: [], failed: ['unexpected'] };
  } finally {
    clearTimeout(timer);
  }
}
