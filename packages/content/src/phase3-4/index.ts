import type { Level } from '@ground-up/schema';
import { PHASE3 } from './phase3';
import { PHASE4 } from './phase4';

export { P3_ALL } from './phase3';

/**
 * Track 1, Phases 3-4 (Memory and time, Toy CPU): 10 + 10 levels in play
 * order. Phase 3 starts after the last Phase 2 level ('alu-32bit').
 * DRAFT (owner approves curriculum text). The CPU is Toy-8: docs/toy8.md.
 */
export const PHASE3_4_LEVELS: Level[] = [...PHASE3, ...PHASE4];
