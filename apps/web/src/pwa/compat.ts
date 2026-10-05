/**
 * E-DATA-09: before an open tab reloads into a new build, compare the save
 * formats the new build reads with the ones this tab writes. A newer build
 * migrates older saves forward, so any build whose versions are at least ours
 * is safe. A build with lower versions (a rollback) would find saves "from the
 * future" and refuse them (E-DATA-04), so the reload is blocked.
 */
export interface BuildVersions {
  saveVersion: number;
  workspaceVersion: number;
}

export type Compat = { ok: true } | { ok: false; reason: 'older' | 'unknown' };

/** Parse an untrusted `version.json` body; null when it is not one. */
export function parseVersions(data: unknown): BuildVersions | null {
  if (!data || typeof data !== 'object') return null;
  const { saveVersion, workspaceVersion } = data as Record<string, unknown>;
  if (!Number.isInteger(saveVersion) || !Number.isInteger(workspaceVersion)) return null;
  return { saveVersion: saveVersion as number, workspaceVersion: workspaceVersion as number };
}

/**
 * `remote` is null when version.json could not be read. That never blocks a
 * reload: the waiting service worker came from the same deploy, and an
 * unreadable file says nothing about the saves.
 */
export function checkCompat(remote: BuildVersions | null, local: BuildVersions): Compat {
  if (!remote) return { ok: true };
  if (remote.saveVersion < local.saveVersion || remote.workspaceVersion < local.workspaceVersion)
    return { ok: false, reason: 'older' };
  return { ok: true };
}
