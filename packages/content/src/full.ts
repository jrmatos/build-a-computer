import { Level } from '@build-a-computer/schema';
import { SANDBOX } from './sandbox';
import { RESOURCES } from './resources';
import { PHASE0_2_LEVELS } from './phase0-2';
import { PHASE3_4_LEVELS } from './phase3-4';
import { PHASE5_LEVELS } from './phase5';
import { PHASE6_LEVELS } from './phase6';
import { PHASE7_LEVELS } from './phase7';
import { TRACK2_P1_3_LEVELS } from './track2/phase1-3';
import { TRACK2_P4_7_LEVELS } from './track2/phase4-7';
import { PHASE8_LEVELS } from './phase8';
import { PHASE9_LEVELS } from './phase9';

/**
 * Every level of the game, complete, aggregated from one module per phase group
 * (`@build-a-computer/content/full`). Node tests and tools use it; the app uses the
 * light catalog (`@build-a-computer/content`) and `loadLevel`, so level payloads
 * load per phase group when a level opens.
 * DRAFT: tutorial text, hints and resources still need owner approval (human
 * review gate). Resources come from `resources.ts`, where every URL was fetched
 * and verified by an agent (resource policy). Level ids never change: saves depend on them.
 * CNT-01 will move these to YAML + MDX compiled at build time.
 */

/** Every level, validated at load. A schema error here fails the build. */
export const LEVELS: Level[] = [SANDBOX, ...PHASE0_2_LEVELS, ...PHASE3_4_LEVELS, ...PHASE5_LEVELS, ...PHASE6_LEVELS, ...PHASE7_LEVELS, ...PHASE8_LEVELS, ...PHASE9_LEVELS, ...TRACK2_P1_3_LEVELS, ...TRACK2_P4_7_LEVELS].map((l) =>
  Level.parse({ ...l, resources: RESOURCES[l.id] ?? l.resources }),
);

export const levelById = (id: string): Level | undefined => LEVELS.find((l) => l.id === id);
export { defineLevel, type LevelDraft } from './define';
export * from './toy8';
