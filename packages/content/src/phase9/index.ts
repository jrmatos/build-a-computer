import type { Level } from '@build-a-computer/schema';
import { PHASE9 } from './phase9';

export { PHASE8_LAST_REQUIRED_ID } from './common';

/**
 * Track 1, Phase 9 (Operating system): 10 code levels in play order, from
 * the bootloader to a game running on the player's kernel. Phase 9 starts
 * after the last required Phase 8 level. DRAFT (owner approves curriculum
 * text). Kernel design: docs/os.md; sources: packages/os-kit.
 */
export const PHASE9_LEVELS: Level[] = PHASE9;
