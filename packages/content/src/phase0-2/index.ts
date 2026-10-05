import type { Level } from '@build-a-computer/schema';
import { PHASE0 } from './phase0';
import { PHASE1 } from './phase1';
import { PHASE2 } from './phase2';

export { P1_ALL } from './phase1';
export { P2_ALL } from './phase2';
export { MODELS, ALU_OPS, alu, model, type Model } from './models';

/** Track 1, Phases 0-2 (Onboarding, Gates, Arithmetic): 3 + 10 + 12 levels, in play order. */
export const PHASE0_2_LEVELS: Level[] = [...PHASE0, ...PHASE1, ...PHASE2];
