import type { Level, PartType } from '@build-a-computer/schema';
import { PART_ORDER } from './parts';

export interface PaletteShortcut {
  /** The key to press: '3' to '9'. */
  key: string;
  type: PartType;
}

/** Keys 1 and 2 are select and wire; parts start at 3. */
const FIRST_PART_KEY = 3;
const LAST_PART_KEY = 9;

/** Can the player place this part? The sandbox (no level) allows everything. */
export function isPartAllowed(level: Pick<Level, 'palette'> | null, type: PartType): boolean {
  return !level || level.palette.includes(type);
}

/**
 * Number keys for the level's parts, in PART_ORDER. Shared by the keyboard
 * handler and the toolbar so both show the same numbers.
 */
export function paletteShortcuts(level: Pick<Level, 'palette'> | null): PaletteShortcut[] {
  return PART_ORDER.filter((type) => isPartAllowed(level, type))
    .slice(0, LAST_PART_KEY - FIRST_PART_KEY + 1)
    .map((type, i) => ({ key: String(FIRST_PART_KEY + i), type }));
}
