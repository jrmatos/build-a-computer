import { describe, expect, it } from 'vitest';
import {
  decideDb,
  LOCAL_STEP,
  mapLegacyKey,
  MIGRATION_DONE_KEY,
  planLocalCopies,
  readDone,
  runLegacyMigration,
  type DbBackend,
  type DbSpec,
  type KeyValue,
  type TableRows,
} from './legacy-migration';

class FakeKv implements KeyValue {
  constructor(readonly map = new Map<string, string>()) {}
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

type Db = Record<string, TableRows>;
class FakeDb implements DbBackend {
  constructor(readonly dbs = new Map<string, Db>()) {}
  failOn = new Set<string>();
  async readLegacy(name: string) {
    if (this.failOn.has(name)) throw new Error('boom');
    return this.dbs.get(name) ?? null;
  }
  async countTarget(spec: DbSpec) {
    return Object.values(this.dbs.get(spec.name) ?? {}).reduce((n, r) => n + r.length, 0);
  }
  async writeIfEmpty(spec: DbSpec, tables: Db) {
    if ((await this.countTarget(spec)) > 0) return false;
    this.dbs.set(spec.name, structuredClone(tables));
    return true;
  }
}

const LEVEL: DbSpec = { name: 'build-a-computer', version: 1, stores: { saves: '', progress: '' } };
const CHIPS: DbSpec = { name: 'build-a-computer-chips', version: 1, stores: { chips: '' } };
const DBS = [
  { from: 'ground-up', to: LEVEL },
  { from: 'ground-up-chips', to: CHIPS },
];
const quiet = () => {};
const legacyLevel = (): Db => ({
  saves: [{ key: 'meet-nand', value: { kind: 'ground-up/save', levelId: 'meet-nand' } }],
  progress: [{ key: 'progress', value: { kind: 'ground-up/progress', version: 1, levels: {} } }],
});

describe('legacy migration: pure decisions', () => {
  it('maps only ground-up: keys', () => {
    expect(mapLegacyKey('ground-up:dock')).toBe('build-a-computer:dock');
    expect(mapLegacyKey('ground-up:strip-float-width')).toBe('build-a-computer:strip-float-width');
    expect(mapLegacyKey('build-a-computer:dock')).toBeNull();
    expect(mapLegacyKey('other')).toBeNull();
  });

  it('plans copies only where the new key is absent', () => {
    const present = new Set(['build-a-computer:dock']);
    expect(planLocalCopies(['ground-up:dock', 'ground-up:last-level', 'x'], (k) => present.has(k))).toEqual([
      ['ground-up:last-level', 'build-a-computer:last-level'],
    ]);
  });

  it('copies a database only when legacy has rows and the target is empty', () => {
    expect(decideDb(null, 0)).toBe('no-legacy');
    expect(decideDb(0, 0)).toBe('legacy-empty');
    expect(decideDb(3, 1)).toBe('target-has-data');
    expect(decideDb(3, 0)).toBe('copy');
  });

  it('reads a damaged done marker as nothing done', () => {
    expect(readDone(new FakeKv(new Map([[MIGRATION_DONE_KEY, '{oops']])))).toEqual(new Set());
    expect(readDone(new FakeKv(new Map([[MIGRATION_DONE_KEY, '["a",1]']])))).toEqual(new Set(['a']));
  });
});

describe('legacy migration: runLegacyMigration with fakes', () => {
  it('copies legacy databases and keys, keeps the legacy data, and marks them done', async () => {
    const kv = new FakeKv(new Map([['ground-up:dock', '{"a":1}'], ['ground-up:last-level', 'meet-nand']]));
    const db = new FakeDb(new Map([['ground-up', legacyLevel()]]));
    const r = await runLegacyMigration(kv, db, DBS, quiet);
    expect(r.failed).toEqual([]);
    expect(r.copied).toEqual(['ground-up:dock', 'ground-up:last-level', 'ground-up']);
    expect(db.dbs.get('build-a-computer')).toEqual(legacyLevel());
    expect(db.dbs.get('ground-up')).toEqual(legacyLevel()); // backup kept
    expect(kv.getItem('build-a-computer:dock')).toBe('{"a":1}');
    expect(kv.getItem('ground-up:dock')).toBe('{"a":1}');
    // Chips db had no legacy copy: not marked done, so it is checked again next boot.
    expect(readDone(kv)).toEqual(new Set([LOCAL_STEP, 'ground-up']));
  });

  it('never overwrites newer data', async () => {
    const newer: Db = { saves: [{ key: 'meet-nand', value: { new: true } }], progress: [] };
    const kv = new FakeKv(new Map([['ground-up:dock', 'old'], ['build-a-computer:dock', 'new']]));
    const db = new FakeDb(new Map([['ground-up', legacyLevel()], ['build-a-computer', newer]]));
    const r = await runLegacyMigration(kv, db, DBS, quiet);
    expect(r.copied).toEqual([]);
    expect(db.dbs.get('build-a-computer')).toEqual(newer);
    expect(kv.getItem('build-a-computer:dock')).toBe('new');
    expect(readDone(kv).has('ground-up')).toBe(true);
  });

  it('is idempotent: a second run copies nothing, even after the new data changes', async () => {
    const kv = new FakeKv(new Map([['ground-up:dock', 'old']]));
    const db = new FakeDb(new Map([['ground-up', legacyLevel()]]));
    await runLegacyMigration(kv, db, DBS, quiet);
    db.dbs.set('build-a-computer', { saves: [], progress: [] }); // player cleared everything
    kv.map.delete('build-a-computer:dock'); // and reset the dock
    const r = await runLegacyMigration(kv, db, DBS, quiet);
    expect(r).toEqual({ copied: [], failed: [] });
    expect(kv.getItem('build-a-computer:dock')).toBeNull();
  });

  it('a failing database is reported, not thrown, and retried next run', async () => {
    const kv = new FakeKv();
    const db = new FakeDb(new Map([['ground-up', legacyLevel()], ['ground-up-chips', { chips: [{ key: 'half', value: {} }] }]]));
    db.failOn.add('ground-up');
    const r = await runLegacyMigration(kv, db, DBS, quiet);
    expect(r.failed).toEqual(['ground-up']);
    expect(r.copied).toEqual(['ground-up-chips']);
    db.failOn.clear();
    const again = await runLegacyMigration(kv, db, DBS, quiet);
    expect(again.copied).toEqual(['ground-up']);
  });

  it('works without localStorage or IndexedDB', async () => {
    expect(await runLegacyMigration(null, null, DBS, quiet)).toEqual({ copied: [], failed: [] });
  });
});
