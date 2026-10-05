/**
 * File `kind` tags. The project was renamed from "Ground Up" to "Build a Computer";
 * files written before the rename carry `ground-up/<name>` kinds. Readers accept
 * both (normalizing legacy kinds to the current ones before validation); writers
 * always emit the current `build-a-computer/<name>` kinds.
 */
export const KIND_PREFIX = 'build-a-computer/';
/** Prefix of kinds written before the rename. Read-only compatibility; never written. */
export const LEGACY_KIND_PREFIX = 'ground-up/';

export const SAVE_KIND = 'build-a-computer/save';
export const WORKSPACE_KIND = 'build-a-computer/workspace';
export const PROGRESS_KIND = 'build-a-computer/progress';
export const CLIPBOARD_KIND = 'build-a-computer/clipboard';

/** Map a legacy `ground-up/<name>` kind to `build-a-computer/<name>`; anything else is returned unchanged. */
export function normalizeKind(kind: unknown): unknown {
  return typeof kind === 'string' && kind.startsWith(LEGACY_KIND_PREFIX) ? KIND_PREFIX + kind.slice(LEGACY_KIND_PREFIX.length) : kind;
}
