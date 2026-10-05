import type { Level } from '@build-a-computer/schema';
import { PHASE5 } from './phase5';

export { P5_ALL, PHASE4_LAST_ID } from './phase5';

/**
 * Track 1, Phase 5 (RISC-V CPU): 8 levels plus an optional pipeline
 * challenge, in play order. Starts after the last Phase 4 level
 * ('first-program'). DRAFT (owner approves curriculum text). The datapath
 * and its conventions are in docs/rv32-datapath.md.
 */
export const PHASE5_LEVELS: Level[] = PHASE5;
