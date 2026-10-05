import type { Level } from '@build-a-computer/schema';
import { PHASE1_2_SOLUTIONS } from './phase1-2';
import { PHASE3_SOLUTIONS } from './phase3';

/**
 * Reference main.js for every Track 2 level of phases 1 to 3, by level id.
 * Loaded by the game only on "Show solution" (ADR-007).
 */
export const TRACK2_P1_3_SOLUTIONS: Record<string, string> = { ...PHASE1_2_SOLUTIONS, ...PHASE3_SOLUTIONS };

/** The reference main.js for a Track 2 phase 1-3 level, or undefined. */
export function track2P1_3Source(level: Level): string | undefined {
  return level.track === 'neuron-to-llm' ? TRACK2_P1_3_SOLUTIONS[level.id] : undefined;
}
