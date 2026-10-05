/**
 * Training checkpoints per level (E-ML-06): the last state the player's code
 * passed to checkpoint(state), plus the curve so far, in their own IndexedDB
 * database ('build-a-computer-ml') so the level save database keeps its
 * schema. Records are checked on read; anything malformed is ignored. Falls
 * back to memory when IndexedDB is unavailable.
 */
import Dexie, { type Table } from 'dexie';
import type { MlSample } from '@build-a-computer/worker';
import { downsample } from './model';

/** One saved checkpoint. */
export interface Checkpoint {
  levelId: string;
  levelVersion: number;
  step: number;
  /** JSON-safe state from checkpoint(state). */
  state: unknown;
  /** Curve up to `step` (at most MAX_SAMPLES points) so a resumed run keeps its history. */
  samples: MlSample[];
  /** Epoch milliseconds. */
  savedAt: number;
}

export const ML_DB = { name: 'build-a-computer-ml', version: 1, stores: { checkpoints: '' } } as const;
const MAX_SAMPLES = 2000;
/** Larger states are not stored (a runaway model must not fill the disk). */
const MAX_BYTES = 32 * 1024 * 1024;

class MlDb extends Dexie {
  checkpoints!: Table<unknown, string>;
  constructor() {
    super(ML_DB.name);
    this.version(ML_DB.version).stores(ML_DB.stores);
  }
}

let db: MlDb | null = null;
let failed = false;
const memory = new Map<string, Checkpoint>();

async function open(): Promise<MlDb | null> {
  if (db) return db;
  if (failed || typeof indexedDB === 'undefined') return null;
  try {
    const d = new MlDb();
    await Promise.race([d.open(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
    db = d;
    return d;
  } catch (e) {
    failed = true;
    console.error('Checkpoint storage unavailable', e);
    return null;
  }
}

/** A stored record if it has the expected shape, else null. */
export function validCheckpoint(raw: unknown, levelId: string): Checkpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Checkpoint>;
  if (r.levelId !== levelId || typeof r.step !== 'number' || !Number.isFinite(r.step) || typeof r.savedAt !== 'number') return null;
  if (typeof r.levelVersion !== 'number' || !Array.isArray(r.samples)) return null;
  const samples = r.samples.filter(
    (s): s is MlSample => !!s && typeof s === 'object' && typeof (s as MlSample).step === 'number' && !!(s as MlSample).values && typeof (s as MlSample).values === 'object',
  );
  return { levelId, levelVersion: r.levelVersion, step: r.step, state: r.state, samples, savedAt: r.savedAt };
}

/** The level's checkpoint, or null (none, unreadable, or from another level version). */
export async function loadCheckpoint(levelId: string, levelVersion: number): Promise<Checkpoint | null> {
  const d = await open();
  let raw: unknown = memory.get(levelId);
  if (d) {
    try {
      raw = await d.checkpoints.get(levelId);
    } catch (e) {
      console.error(e);
    }
  }
  const cp = validCheckpoint(raw, levelId);
  return cp && cp.levelVersion === levelVersion ? cp : null;
}

/** Save (replace) the level's checkpoint. Returns false when it was too large or storage failed. */
export async function saveCheckpoint(cp: Checkpoint): Promise<boolean> {
  const record: Checkpoint = { ...cp, samples: downsample(cp.samples.filter((s) => s.step <= cp.step), MAX_SAMPLES) };
  try {
    if (JSON.stringify(record.state ?? null).length > MAX_BYTES) return false;
  } catch {
    return false;
  }
  const d = await open();
  if (!d) {
    memory.set(cp.levelId, record);
    return true;
  }
  try {
    await d.checkpoints.put(record, cp.levelId);
    return true;
  } catch (e) {
    console.error(e);
    memory.set(cp.levelId, record);
    return true;
  }
}

/** Forget the level's checkpoint. */
export async function clearCheckpoint(levelId: string): Promise<void> {
  memory.delete(levelId);
  const d = await open();
  if (!d) return;
  try {
    await d.checkpoints.delete(levelId);
  } catch (e) {
    console.error(e);
  }
}
