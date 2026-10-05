/**
 * File shortcuts, kept out of the canvas shortcut module: Ctrl/Cmd+S saves
 * (to the connected file, or asks where), Ctrl/Cmd+Shift+S always asks where,
 * Ctrl/Cmd+O opens. They also work while typing, and always stop the browser's
 * own "Save page" / "Open file" dialogs.
 */
export type FileKey = 'save' | 'saveAs' | 'open';

/** Pure: which file command a key press means, or null. */
export function fileKeyFor(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): FileKey | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === 's') return e.shiftKey ? 'saveAs' : 'save';
  if (key === 'o' && !e.shiftKey) return 'open';
  return null;
}

export function installFileKeys(run: Record<FileKey, () => void>, target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const onKey = (e: KeyboardEvent) => {
    const k = fileKeyFor(e);
    if (!k) return;
    e.preventDefault();
    if (e.repeat) return;
    run[k]();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
