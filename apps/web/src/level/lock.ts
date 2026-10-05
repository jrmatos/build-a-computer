/**
 * Two-tab lock (E-DATA-01) on the Web Locks API. One tab holds
 * `build-a-computer:level:<id>`; another tab opening the same level is read-only
 * until it takes the lock over. Without navigator.locks every tab can edit.
 */

interface Held {
  name: string;
  release: () => void;
}

let held: Held | null = null;

export const locksSupported = (): boolean => typeof navigator !== 'undefined' && 'locks' in navigator && !!navigator.locks;

export const lockName = (levelId: string): string => `build-a-computer:level:${levelId}`;

/**
 * Try to take the lock. Resolves true when held (or locks are unsupported).
 * `onLost` runs if another tab steals it later.
 */
export function acquireLock(name: string, steal: boolean, onLost: () => void): Promise<boolean> {
  releaseLock();
  if (!locksSupported()) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let release!: () => void;
    const until = new Promise<void>((r) => (release = r));
    const mine: Held = { name, release };
    let granted = false;
    navigator.locks
      .request(name, steal ? { steal: true } : { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        granted = true;
        held = mine;
        resolve(true);
        await until;
      })
      .catch(() => {
        // A stolen lock rejects the holder's request with AbortError.
        if (granted && held === mine) {
          held = null;
          onLost();
        } else if (!granted) resolve(false);
      });
  });
}

export function releaseLock(): void {
  held?.release();
  held = null;
}
