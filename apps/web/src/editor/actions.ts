/**
 * Editor actions shared by keyboard shortcuts, the context menu, the
 * properties panel and the toolbar. Each one is a single undoable step.
 */
import type { PartType } from '@ground-up/schema';
import { t } from '../i18n';
import { screenToWorld, viewport } from './camera';
import { copyIds, deleteIds, duplicateIds, flipIds, pasteClip, rotateIds, updatePart, type Clip } from './ops';
import { allowedParts, useEditor } from './store';

const sel = () => new Set(useEditor.getState().selection);

export function deleteSelection(): void {
  useEditor.getState().commit((b) => deleteIds(b, sel()), []);
}

export function rotateSelection(dir: 1 | -1 = 1): void {
  useEditor.getState().commit((b) => rotateIds(b, sel(), dir));
}

export function flipSelection(): void {
  useEditor.getState().commit((b) => flipIds(b, sel()));
}

export function duplicateSelection(): void {
  const { board, commit } = useEditor.getState();
  const r = duplicateIds(board, sel());
  if (r.ids.length) commit(() => r.board, r.ids);
}

export function selectAll(): void {
  const { board, setSelection, setTool } = useEditor.getState();
  setTool('select');
  setSelection([...board.parts.map((p) => p.id), ...board.wires.map((w) => w.id)]);
}

export function setPartLabel(id: string, label: string): void {
  const trimmed = label.trim().slice(0, 40);
  useEditor.getState().commit((b) => updatePart(b, id, { label: trimmed || undefined }));
}

/** In-app clipboard; the system clipboard also gets JSON so copies work across tabs. */
let clip: Clip | null = null;

export function copySelection(): Clip | null {
  const { board, selection } = useEditor.getState();
  if (!selection.length) return null;
  clip = copyIds(board, new Set(selection));
  return clip;
}

export function cutSelection(): Clip | null {
  const c = copySelection();
  if (c) deleteSelection();
  return c;
}

export function isClip(v: unknown): v is Clip {
  return typeof v === 'object' && v !== null && (v as Clip).kind === 'ground-up/clipboard';
}

/** Paste at a world point, or at the viewport center. Drops parts the level does not allow. */
export function paste(from: Clip | null = clip, at?: { x: number; y: number }): void {
  if (!from) return;
  const { board, camera, commit, level, toast } = useEditor.getState();
  const p = at ?? screenToWorld(camera, viewport.width / 2, viewport.height / 2);
  const r = pasteClip(board, from, Math.round(p.x), Math.round(p.y), allowedPartsWithStarter());
  if (r.dropped.length) toast(t('toast.dropped', { parts: r.dropped.map((d) => t(`part.${d}`)).join(', ') }), 'error');
  if (r.ids.length) commit(() => r.board, r.ids);
  void level;
}

/** Players may paste the level's palette parts; the sandbox allows everything. */
function allowedPartsWithStarter(): Set<PartType> {
  return allowedParts(useEditor.getState().level);
}
