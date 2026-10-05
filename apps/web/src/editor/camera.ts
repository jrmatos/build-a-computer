import { boardBounds, type Pt } from './geometry';
import { GRID, MAX_ZOOM, MIN_ZOOM, useEditor, type Camera } from './store';

/** Canvas size in CSS pixels; kept current by the Canvas component. */
export const viewport = {
  width: typeof window === 'undefined' ? 1280 : window.innerWidth,
  height: typeof window === 'undefined' ? 800 : window.innerHeight,
};

export const scaleOf = (c: Camera): number => c.zoom * GRID;

export function screenToWorld(c: Camera, sx: number, sy: number): Pt {
  const s = scaleOf(c);
  return { x: sx / s + c.x, y: sy / s + c.y };
}

export function worldToScreen(c: Camera, wx: number, wy: number): Pt {
  const s = scaleOf(c);
  return { x: (wx - c.x) * s, y: (wy - c.y) * s };
}

const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Zoom keeping the world point under (sx, sy) fixed. Defaults to the viewport center. */
export function zoomTo(zoom: number, sx = viewport.width / 2, sy = viewport.height / 2): void {
  const { camera, setCamera } = useEditor.getState();
  const z = clampZoom(zoom);
  const before = screenToWorld(camera, sx, sy);
  const s = z * GRID;
  setCamera({ zoom: z, x: before.x - sx / s, y: before.y - sy / s });
}

export const zoomBy = (factor: number, sx?: number, sy?: number): void =>
  zoomTo(useEditor.getState().camera.zoom * factor, sx, sy);

/** Excalidraw-style zoom steps for the +/- buttons. */
export const zoomIn = (): void => zoomBy(1.25);
export const zoomOut = (): void => zoomBy(0.8);
export const resetZoom = (): void => zoomTo(1);

export function panBy(dxScreen: number, dyScreen: number): void {
  const { camera, setCamera } = useEditor.getState();
  const s = scaleOf(camera);
  setCamera({ ...camera, x: camera.x + dxScreen / s, y: camera.y + dyScreen / s });
}

/** Screen space covered by floating panels, in CSS px; zoomToFit keeps content out from under them. */
export const insets = { top: 72, right: 340, bottom: 72, left: 240 };

/** Fit everything, or only the given ids, into view with a margin, avoiding `insets`. */
export function zoomToFit(ids?: string[]): void {
  const { board, setCamera } = useEditor.getState();
  const r = boardBounds(board, ids?.length ? new Set(ids) : undefined);
  if (!r) {
    setCamera({ zoom: 1, x: -viewport.width / 2 / GRID, y: -viewport.height / 2 / GRID });
    return;
  }
  const margin = 3;
  const w = Math.max(100, viewport.width - insets.left - insets.right);
  const h = Math.max(100, viewport.height - insets.top - insets.bottom);
  const zoom = clampZoom(Math.min(w / ((r.w + margin * 2) * GRID), h / ((r.h + margin * 2) * GRID), 2));
  const s = zoom * GRID;
  // Center the content in the free area between the panels.
  const cx = insets.left + w / 2;
  const cy = insets.top + h / 2;
  setCamera({ zoom, x: r.x + r.w / 2 - cx / s, y: r.y + r.h / 2 - cy / s });
}
