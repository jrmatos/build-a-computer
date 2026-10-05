import type { Board, Level } from '@ground-up/schema';
import { solutionFor as phase0to2 } from './phase0-2/index';
import { phase3_4Solution } from './phase3-4/index';

/**
 * The reference solution board for any level, or undefined when none exists.
 * The game loads this module lazily (its own chunk) only when a player asks
 * to see a solution (ADR-007); it is never part of the first-level bundle.
 */
export function referenceSolution(level: Level): Board | undefined {
  return phase0to2(level) ?? phase3_4Solution(level);
}
