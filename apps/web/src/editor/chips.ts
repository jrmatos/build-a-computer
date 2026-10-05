/**
 * Custom chip editing: make chip, enter/exit with breadcrumbs, registry sync.
 * STUB: the chips UI agent implements these. Other code calls them.
 */
import { useEditor } from './store';

/** Enter the chip used by this part instance (double-click). */
export function enterChip(_partId: string): void {}

/** Leave chip editing; `depth` = how many levels to keep (0 = back to the level's board). */
export function exitChip(depth = useEditor.getState().editStack.length - 1): void {
  void depth;
}

/** Open the "Make chip" dialog for the current board. */
export function openMakeChip(): void {}
