import type { Board, Level } from '@build-a-computer/schema';
import { solutionFor as phase0to2 } from './phase0-2/index';
import { phase3_4Solution } from './phase3-4/index';
import { phase5Solution } from './phase5/index';
import { phase6Source } from './phase6/index';
import { phase7Source } from './phase7/index';
import { track2P1_3Source } from './track2/phase1-3/index';
import { track2P4_7Source } from './track2/phase4-7/index';
import { phase8Source } from './phase8/index';
import { phase9Source } from './phase9/index';

/**
 * The reference solution board for any level, or undefined when none exists.
 * The game loads this module lazily (its own chunk) only when a player asks
 * to see a solution (ADR-007); it is never part of the first-level bundle.
 */
export function referenceSolution(level: Level): Board | undefined {
  return phase0to2(level) ?? phase3_4Solution(level) ?? phase5Solution(level);
}

/**
 * The reference source for a code level (the player's main.s or main.c) or a
 * Track 2 'js' level (main.js), or undefined. Loaded lazily like `referenceSolution`.
 */
export function referenceSource(level: Level): string | undefined {
  return phase6Source(level) ?? phase7Source(level) ?? phase8Source(level) ?? phase9Source(level) ?? track2P1_3Source(level) ?? track2P4_7Source(level);
}
