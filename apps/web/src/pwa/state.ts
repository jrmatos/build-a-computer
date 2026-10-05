/** Tiny external store for the update prompt; read with useSyncExternalStore. */
export type UpdateStatus = 'idle' | 'ready' | 'activated' | 'reloading' | 'incompatible';

let status: UpdateStatus = 'idle';
const listeners = new Set<() => void>();

export const getStatus = (): UpdateStatus => status;

export function setStatus(next: UpdateStatus): void {
  if (next === status) return;
  status = next;
  for (const l of listeners) l();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
