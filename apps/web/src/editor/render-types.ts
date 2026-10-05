import type { Board, PartType } from '@ground-up/schema';
import type { Snapshot } from '@ground-up/worker';
import type { Pt, Rect } from './geometry';
import type { SpatialIndex } from './hit';
import type { Camera, Theme } from './store';

/** Transient drawing on top of the board, owned by the Canvas interaction code. */
export interface Overlay {
  /** Box selection rectangle in world cells. */
  box?: Rect;
  /** Wire being drawn: an already-routed path in world cells. */
  wirePreview?: Pt[];
  /** Part about to be placed, at a grid position. */
  ghost?: { type: PartType; x: number; y: number };
  /** Pin under the cursor, highlighted as a wiring target. */
  hoverPin?: Pt;
  /** Part or wire under the cursor. */
  hoverId?: string;
  /** Ids to flash, e.g. after clicking a diagnostic. */
  flashIds?: string[];
}

export interface Scene {
  board: Board;
  index: SpatialIndex;
  camera: Camera;
  theme: Theme;
  showGrid: boolean;
  selection: ReadonlySet<string>;
  snapshot: Snapshot | null;
  overlay: Overlay;
  /** CSS pixels. */
  width: number;
  height: number;
  /** ms since page load, for pulsing contention and unstable highlights. */
  time: number;
}

/** Plan: custom Canvas 2D renderer behind this interface; PixiJS only if the 60 fps benchmark fails. */
export interface Renderer {
  resize(width: number, height: number, dpr: number): void;
  draw(scene: Scene): void;
  /** True while something animates (pulses), so the canvas keeps requesting frames. */
  readonly animating: boolean;
}
