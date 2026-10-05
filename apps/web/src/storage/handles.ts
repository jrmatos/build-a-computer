/**
 * The last connected file handle, kept in its own IndexedDB database
 * ('ground-up-files') so the next visit can offer "Reconnect to <name>".
 * File handles are structured-cloneable; permission is not kept with them and
 * must be asked again with a click.
 */
import Dexie, { type Table } from 'dexie';
import type { FileHandleLike } from './provider';

export interface HandleRecord {
  handle: FileHandleLike;
  name: string;
  /** Epoch ms when it was connected. */
  at: number;
}

const KEY = 'last';

class FilesDb extends Dexie {
  handles!: Table<HandleRecord, string>;
  constructor() {
    super('ground-up-files');
    this.version(1).stores({ handles: '' });
  }
}

let db: FilesDb | null = null;

function open(): FilesDb | null {
  if (typeof indexedDB === 'undefined') return null;
  db ??= new FilesDb();
  return db;
}

export async function loadLastHandle(): Promise<HandleRecord | null> {
  try {
    const rec = await open()?.handles.get(KEY);
    return rec && typeof rec.handle?.getFile === 'function' ? rec : null;
  } catch (e) {
    console.error(e);
    return null;
  }
}

export async function saveLastHandle(handle: FileHandleLike): Promise<void> {
  try {
    await open()?.handles.put({ handle, name: handle.name, at: Date.now() }, KEY);
  } catch (e) {
    // Some browsers cannot store handles (or IndexedDB is gone): reconnecting is just unavailable.
    console.error(e);
  }
}

export async function forgetLastHandle(): Promise<void> {
  try {
    await open()?.handles.delete(KEY);
  } catch (e) {
    console.error(e);
  }
}
