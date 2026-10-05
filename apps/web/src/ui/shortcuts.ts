/** Shortcut labels shown in the UI chrome. Key handling itself lives in the editor. */
import type { Level, PartType } from '@ground-up/schema';
import { PART_ORDER } from '../editor/parts';
import { isPartAllowed, paletteShortcuts } from '../editor/tools';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Format a shortcut like "Mod+Shift+Z" for the current platform. */
export function kbd(combo: string): string {
  if (!isMac) return combo.replace(/Mod/g, 'Ctrl');
  return combo
    .replace(/Mod\+/g, '⌘')
    .replace(/Shift\+/g, '⇧')
    .replace(/Alt\+/g, '⌥');
}

/** Parts the player may place, in toolbar order. No level (sandbox) allows everything. */
export function paletteParts(level: Level | null): PartType[] {
  return PART_ORDER.filter((p) => isPartAllowed(level, p));
}

/** Number keys 3..9 for the palette, from the same source as the keyboard handler. */
export function paletteKeys(level: Level | null): Map<PartType, number> {
  return new Map(paletteShortcuts(level).map((s) => [s.type, Number(s.key)]));
}

export { isPartAllowed };

/** Mime type for dragging a part from the toolbar or library to the canvas. */
export const PART_DRAG_MIME = 'application/x-ground-up-part';
