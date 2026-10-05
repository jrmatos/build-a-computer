/**
 * Drag a chip tile from "My chips" onto the board. The canvas only knows
 * built-in part drags, so chip drags use their own MIME type and are handled
 * here, at the document level, for drops that land on the board canvas.
 */
import type { DragEvent as ReactDragEvent } from 'react';
import { placeChip } from '../../editor/chips';
import { screenToWorld } from '../../editor/camera';
import { useEditor } from '../../editor/store';

export const CHIP_DRAG_MIME = 'application/x-ground-up-chip';

export function startChipDrag(e: ReactDragEvent, chipId: string): void {
  e.dataTransfer.setData(CHIP_DRAG_MIME, chipId);
  e.dataTransfer.setData('text/plain', chipId);
  e.dataTransfer.effectAllowed = 'copy';
}

const onCanvas = (e: DragEvent): HTMLCanvasElement | null => {
  const el = e.target instanceof Element ? e.target.closest('canvas.board-canvas') : null;
  return el instanceof HTMLCanvasElement ? el : null;
};

export function installChipDrop(): () => void {
  const over = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes(CHIP_DRAG_MIME) || !onCanvas(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = useEditor.getState().readOnly ? 'none' : 'copy';
  };
  const drop = (e: DragEvent) => {
    const canvas = onCanvas(e);
    if (!canvas || !e.dataTransfer?.types.includes(CHIP_DRAG_MIME)) return;
    e.preventDefault();
    const id = e.dataTransfer.getData(CHIP_DRAG_MIME);
    if (!id) return;
    const r = canvas.getBoundingClientRect();
    const world = screenToWorld(useEditor.getState().camera, e.clientX - r.left, e.clientY - r.top);
    placeChip(id, world); // toasts why when it is blocked (E-SIM-05)
  };
  document.addEventListener('dragover', over);
  document.addEventListener('drop', drop);
  return () => {
    document.removeEventListener('dragover', over);
    document.removeEventListener('drop', drop);
  };
}
