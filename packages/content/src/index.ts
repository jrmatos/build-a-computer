import { PART_TYPES, Level, type PartType } from '@build-a-computer/schema';
import { PHASE0_2_LEVELS } from './phase0-2';
import { PHASE3_4_LEVELS } from './phase3-4';
import { PHASE5_LEVELS } from './phase5';
import { PHASE6_LEVELS } from './phase6';
import { PHASE7_LEVELS } from './phase7';

/**
 * Every level of the game, aggregated from one module per phase group.
 * DRAFT: tutorial text, hints and resources still need owner approval (human
 * review gate). Resources stay empty until an agent fetches and verifies each
 * URL (resource policy). Level ids never change: saves depend on them.
 * CNT-01 will move these to YAML + MDX compiled at build time.
 */

/** The sandbox allows every built-in part; custom chips are always allowed separately. */
const ALL: PartType[] = PART_TYPES.filter((t) => t !== 'chip');

const SANDBOX = Level.parse({
  id: 'sandbox',
  version: 1,
  track: 'sandbox',
  phase: 0,
  order: 0,
  title: 'Sandbox',
  goal: 'Free building. Every part is unlocked and nothing is checked.',
  palette: ALL,
  starter: { parts: [], wires: [] },
  draft: true,
});

/** Every level, validated at load. A schema error here fails the build. */
export const LEVELS: Level[] = [SANDBOX, ...PHASE0_2_LEVELS, ...PHASE3_4_LEVELS, ...PHASE5_LEVELS, ...PHASE6_LEVELS, ...PHASE7_LEVELS].map((l) => Level.parse(l));

export const levelById = (id: string): Level | undefined => LEVELS.find((l) => l.id === id);
export { defineLevel, type LevelDraft } from './define';
export * from './toy8';
