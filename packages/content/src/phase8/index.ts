import type { Level } from '@build-a-computer/schema';
import { PHASE8 } from './phase8';

export { PHASE7_LAST_REQUIRED_ID } from './common';

/**
 * Track 1, Phase 8 (C): 8 code levels in play order, the last one optional.
 * The first is assembly (translating C by hand); the rest are C, compiled by
 * @build-a-computer/cc and linked with libc. Phase 8 starts after the last
 * required Phase 7 level. DRAFT (owner approves curriculum text).
 */
export const PHASE8_LEVELS: Level[] = PHASE8;
