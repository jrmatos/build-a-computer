import { z } from 'zod';
import { normalizeKind, PROGRESS_KIND } from './kinds';

export const LevelStatus = z.enum(['locked', 'open', 'completed']);
export type LevelStatus = z.infer<typeof LevelStatus>;

export const Progress = z.object({
  /** Legacy 'ground-up/progress' is accepted and normalized. */
  kind: z.preprocess(normalizeKind, z.literal(PROGRESS_KIND)),
  version: z.literal(1),
  levels: z.record(
    z.string(),
    z.object({
      status: LevelStatus,
      levelVersion: z.number().int().min(1),
      completedAt: z.string().datetime().optional(),
    }),
  ),
});
export type Progress = z.infer<typeof Progress>;

const RANK: Record<LevelStatus, number> = { locked: 0, open: 1, completed: 2 };

/** Merge two progress records. Status never moves backward (E-PLAT-01). */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const levels = { ...a.levels };
  for (const [id, entry] of Object.entries(b.levels)) {
    const cur = levels[id];
    if (!cur || RANK[entry.status] > RANK[cur.status]) levels[id] = entry;
  }
  return { ...a, levels };
}
