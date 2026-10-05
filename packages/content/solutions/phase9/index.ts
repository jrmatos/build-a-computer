import type { Level } from '@build-a-computer/schema';
import { PHASE9_SOLUTIONS } from './solutions.data';

export { PHASE9_SOLUTIONS };

/**
 * The reference source (the player's main.c or main.s) for a Phase 9 level,
 * or undefined. Generated from packages/os-kit (solutions.data.ts). Loaded
 * by the game only on "Show solution" (ADR-007).
 */
export function phase9Source(level: Level): string | undefined {
  return PHASE9_SOLUTIONS[level.id];
}
