import { Level } from '@build-a-computer/schema';
import { CATALOG } from './catalog.data';
import { SANDBOX } from './sandbox';

/**
 * The light level catalog (`@build-a-computer/content`): what the level map,
 * progress, unlock rules and achievements read, for every level, without the
 * heavy payloads (tutorials, tests, code libraries, compiled programs and
 * disks). `loadLevel` brings in a level's full definition by importing its
 * phase group, which the app bundles as a separate chunk loaded when a level
 * of that group opens. catalog.data.ts is generated from the full levels
 * (catalog.test.ts checks it is current; UPDATE_CATALOG=1 rewrites it).
 */

/** The module a level is defined in: one lazily loaded chunk per group. */
export type LevelGroup =
  | 'sandbox'
  | 'phase0-2'
  | 'phase3-4'
  | 'phase5'
  | 'phase6'
  | 'phase7'
  | 'phase8'
  | 'phase9'
  | 'track2-1-3'
  | 'track2-4-7';

/** Catalog entry: the light fields of a level, its hint count and its group. */
export type LevelInfo = Pick<
  Level,
  'id' | 'version' | 'track' | 'phase' | 'order' | 'title' | 'goal' | 'palette' | 'requires' | 'mode' | 'optional' | 'draft'
> & {
  /** `hints.length` of the full level. */
  hintCount: number;
  group: LevelGroup;
};

/** Every level in game order (light entries). */
export const LEVELS: readonly LevelInfo[] = CATALOG;

export const levelById = (id: string): LevelInfo | undefined => LEVELS.find((l) => l.id === id);

const GROUPS: Record<LevelGroup, () => Promise<readonly Level[]>> = {
  sandbox: () => Promise.resolve([SANDBOX]),
  'phase0-2': async () => (await import('./phase0-2')).PHASE0_2_LEVELS,
  'phase3-4': async () => (await import('./phase3-4')).PHASE3_4_LEVELS,
  phase5: async () => (await import('./phase5')).PHASE5_LEVELS,
  phase6: async () => (await import('./phase6')).PHASE6_LEVELS,
  phase7: async () => (await import('./phase7')).PHASE7_LEVELS,
  phase8: async () => (await import('./phase8')).PHASE8_LEVELS,
  phase9: async () => (await import('./phase9')).PHASE9_LEVELS,
  'track2-1-3': async () => (await import('./track2/phase1-3')).TRACK2_P1_3_LEVELS,
  'track2-4-7': async () => (await import('./track2/phase4-7')).TRACK2_P4_7_LEVELS,
};

const groups = new Map<LevelGroup, Promise<Map<string, Level>>>();
const loaded = new Map<string, Level>();

/** Load and validate a whole group (same pipeline as `full.ts`: resources joined, Level.parse). */
function loadGroup(g: LevelGroup): Promise<Map<string, Level>> {
  let p = groups.get(g);
  if (!p) {
    p = Promise.all([GROUPS[g](), import('./resources')]).then(([levels, { RESOURCES }]) => {
      const out = new Map<string, Level>();
      for (const l of levels) {
        const full = Level.parse({ ...l, resources: RESOURCES[l.id] ?? l.resources });
        out.set(full.id, full);
        loaded.set(full.id, full);
      }
      return out;
    });
    // A failed chunk load (offline, new deploy) may be retried later.
    p.catch(() => groups.delete(g));
    groups.set(g, p);
  }
  return p;
}

/** The full definition of a built-in level, or undefined for an unknown id. Cached after the first load. */
export async function loadLevel(id: string): Promise<Level | undefined> {
  const info = levelById(id);
  if (!info) return undefined;
  return loaded.get(id) ?? (await loadGroup(info.group)).get(id);
}

/** The full level when it has already been loaded (`loadLevel`), else undefined. */
export const loadedLevel = (id: string): Level | undefined => loaded.get(id);
