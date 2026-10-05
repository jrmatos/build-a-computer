import { z } from 'zod';
import { Board } from './board';
import { ChipMap } from './chip';

export const SAVE_VERSION = 2;

export const SaveV1 = z.object({
  kind: z.literal('ground-up/save'),
  version: z.literal(1),
  levelId: z.string().min(1).max(64),
  levelVersion: z.number().int().min(1),
  updatedAt: z.string().datetime(),
  board: Board,
  source: z.string().max(1_000_000).optional(),
});

/** v2 embeds the custom chips the board uses (transitively), so a save is self-contained. */
export const SaveV2 = SaveV1.extend({
  version: z.literal(2),
  chips: ChipMap.default({}),
});
export type Save = z.infer<typeof SaveV2>;
export const Save = SaveV2;

/** Migrations are pure functions from version N to N+1. Index i migrates i+1 -> i+2. */
export const SAVE_MIGRATIONS: ((data: Record<string, unknown>) => Record<string, unknown>)[] = [
  // 1 -> 2: no custom chips existed yet.
  (d) => ({ ...d, version: 2, chips: {} }),
];

export class NewerVersionError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(`This file was written by a newer version of Ground Up (format ${found}). Reload the app to update.`);
    this.name = 'NewerVersionError';
  }
}

/**
 * Migrate any known save version to the latest. Refuses newer versions so they are
 * never overwritten (E-DATA-04). Returns a new object; the input is untouched (E-DATA-05).
 */
export function migrateSave(input: unknown): Save {
  if (typeof input !== 'object' || input === null) throw new TypeError('Save must be an object');
  let data = structuredClone(input) as Record<string, unknown>;
  const version = typeof data.version === 'number' ? data.version : NaN;
  if (!Number.isInteger(version) || version < 1) throw new TypeError('Save has no valid version');
  if (version > SAVE_VERSION) throw new NewerVersionError(version, SAVE_VERSION);
  for (let v = version; v < SAVE_VERSION; v++) {
    const step = SAVE_MIGRATIONS[v - 1];
    if (!step) throw new Error(`Missing migration from version ${v}`);
    data = step(data);
  }
  return Save.parse(data);
}
