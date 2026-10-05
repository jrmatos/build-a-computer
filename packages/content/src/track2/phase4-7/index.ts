import type { Level } from '@build-a-computer/schema';
import { PHASE4 } from './phase4';
import { PHASE5 } from './phase5';
import { PHASE6 } from './phase6';
import { PHASE7 } from './phase7';

export { PHASE3_LAST_ID } from './common';

/**
 * Track 2 (Neuron to LLM), phases 4 to 7: Text (4 levels), Transformer (6),
 * Tiny GPT (4) and Beyond (4), in play order. Phase 4 starts after the last
 * Phase 3 level. 'js' mode: the player writes main.js and tests call its
 * exports (docs/js-levels.md). Phases 6 and 7 add the read-only gpt.js
 * library; text comes from the 'text-macbeth' and 'text-sonnets' datasets
 * (content/datasets/text, LICENSES.md). DRAFT (owner approves curriculum text).
 */
export const TRACK2_P4_7_LEVELS: Level[] = [...PHASE4, ...PHASE5, ...PHASE6, ...PHASE7];
