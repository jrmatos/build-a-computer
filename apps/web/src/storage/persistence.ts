/**
 * E-PLAT-04: browsers may evict site storage (IndexedDB) under pressure. After
 * the first meaningful save or user gesture we ask for persistent storage; if
 * the browser says no, the file status indicator gently reminds the player to
 * export a copy.
 */

export type PersistResult = 'granted' | 'denied' | 'unsupported';

export interface StorageManagerLike {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
}

/** Ask once for persistent storage. Feature-detected; never throws. */
export async function requestPersistentStorage(
  sm: StorageManagerLike | undefined = (globalThis as { navigator?: { storage?: StorageManagerLike } }).navigator?.storage,
): Promise<PersistResult> {
  if (!sm || typeof sm.persist !== 'function') return 'unsupported';
  try {
    if (typeof sm.persisted === 'function' && (await sm.persisted())) return 'granted';
    return (await sm.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
