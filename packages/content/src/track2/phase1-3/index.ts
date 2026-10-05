import type { Level } from '@build-a-computer/schema';
import { PHASE1 } from './phase1';
import { PHASE2 } from './phase2';
import { PHASE3 } from './phase3';

/**
 * Track 2 (Neuron to LLM), phases 1 to 3: Numbers (4 levels), Learning (5)
 * and Networks (4), in play order. Track 2 runs alongside Track 1, so its
 * first level requires nothing. Levels are 'js' mode: the player writes
 * main.js and tests call its exports (docs/js-levels.md). Modules unlock as
 * the player builds them by hand: none in Phase 1, 'tensor' from Phase 2,
 * 'autograd' after the autograd level, then 'nn', 'optim' and 'data'.
 * DRAFT (owner approves curriculum text).
 */
export const TRACK2_P1_3_LEVELS: Level[] = [...PHASE1, ...PHASE2, ...PHASE3];
