/**
 * Chip library storage: a separate IndexedDB database ('ground-up-chips') so the
 * level save database keeps its schema. Records are validated on read; bad ones
 * are skipped (and logged) instead of breaking startup. Falls back to memory.
 */
import Dexie, { type Table } from 'dexie';
import { ChipDef, type Board, type ChipMap } from '@ground-up/schema';

class ChipDb extends Dexie {
  chips!: Table<unknown, string>;
  constructor() {
    super('ground-up-chips');
    this.version(1).stores({ chips: '' });
  }
}

/** Read-only view of the level saves database, for listing chip usages (E-DATA-08). */
class SavesDb extends Dexie {
  saves!: Table<unknown, string>;
  progress!: Table<unknown, string>;
  constructor() {
    super('ground-up');
    // Must match level/db.ts.
    this.version(1).stores({ saves: '', progress: '' });
  }
}

let db: ChipDb | null = null;
const memory = new Map<string, ChipDef>();

async function open(): Promise<ChipDb | null> {
  if (db) return db;
  if (typeof indexedDB === 'undefined') return null;
  try {
    const d = new ChipDb();
    await Promise.race([
      d.open(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]);
    db = d;
    return d;
  } catch (e) {
    console.error('Chip library storage unavailable', e);
    return null;
  }
}

export async function loadChips(): Promise<ChipMap> {
  const d = await open();
  const out: ChipMap = {};
  if (!d) {
    for (const [id, c] of memory) out[id] = structuredClone(c);
    return out;
  }
  try {
    const keys = await d.chips.toCollection().primaryKeys();
    const values = await d.chips.bulkGet(keys);
    keys.forEach((k, i) => {
      const parsed = ChipDef.safeParse(values[i]);
      if (parsed.success) out[parsed.data.id] = parsed.data;
      else console.error('Unreadable chip record', k, parsed.error);
    });
  } catch (e) {
    console.error(e);
  }
  return out;
}

export async function putChips(chips: ChipDef[]): Promise<void> {
  if (!chips.length) return;
  const d = await open();
  for (const c of chips) memory.set(c.id, c);
  if (!d) return;
  try {
    await d.chips.bulkPut(
      chips,
      chips.map((c) => c.id),
    );
  } catch (e) {
    console.error('Could not store chips', e);
  }
}

/** Every saved level board, raw `board` fields only (validated loosely by the caller). */
export async function savedBoards(): Promise<{ levelId: string; board: Board }[]> {
  if (typeof indexedDB === 'undefined') return [];
  const d = new SavesDb();
  try {
    await d.open();
    const keys = await d.saves.toCollection().primaryKeys();
    const values = await d.saves.bulkGet(keys);
    const out: { levelId: string; board: Board }[] = [];
    keys.forEach((k, i) => {
      if (k.includes('~')) return; // quarantined unreadable copies
      const b = (values[i] as { board?: Board } | undefined)?.board;
      if (b && Array.isArray(b.parts)) out.push({ levelId: k, board: b });
    });
    return out;
  } catch (e) {
    console.error(e);
    return [];
  } finally {
    d.close();
  }
}
