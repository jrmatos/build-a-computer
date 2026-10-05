/**
 * Pointer interaction for the board canvas, kept free of the DOM so it can be
 * driven from tests. Canvas.tsx turns DOM events into the plain inputs below.
 *
 * Feel: Excalidraw for the canvas (pan, zoom, box select, Alt+drag copies,
 * tool lock), Turing Complete for the content (drag from a pin to wire, click
 * a switch to flip it, everything snaps to the grid).
 */
import type { Board, PartType, PinRef } from '@ground-up/schema';
import { panBy, scaleOf, screenToWorld, zoomBy } from './camera';
import { normRect, pinPos, routeWire, type Pt } from './geometry';
import { SpatialIndex, type Hit } from './hit';
import { addPart, addWire, duplicateIds, moveIds } from './ops';
import { GEOMETRY } from './parts';
import type { Overlay } from './render-types';
import { useEditor, type Tool } from './store';
import { isPartAllowed } from './tools';

/** Screen pixels the pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 4;
export const TOUCH_DRAG_THRESHOLD = 8;
/** Hit tolerance in screen pixels, converted to cells at the current zoom. */
const HIT_TOLERANCE_PX = 6;
/** Pixels per wheel "line" when the browser reports deltaMode 1. */
const LINE_PX = 16;
/** Wheel zoom speed; clamped so one mouse notch is about 25%. */
const ZOOM_SPEED = 0.006;
const MAX_ZOOM_DELTA = 50;

export interface PointerInput {
  id: number;
  /** CSS pixels relative to the canvas. */
  x: number;
  y: number;
  button: number;
  shift: boolean;
  alt: boolean;
  /** Ctrl or Meta. */
  mod: boolean;
  pointerType: 'mouse' | 'pen' | 'touch' | string;
}

export interface WheelInput {
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  /** Ctrl or Meta held, which is also how browsers report a trackpad pinch. */
  mod: boolean;
  shift: boolean;
}

export type WheelAction = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number };

/** Turn a wheel event into a pan or a zoom, Excalidraw style. */
export function wheelAction(w: WheelInput, pageHeight = 800): WheelAction {
  const unit = w.deltaMode === 1 ? LINE_PX : w.deltaMode === 2 ? pageHeight : 1;
  let dx = w.deltaX * unit;
  let dy = w.deltaY * unit;
  if (w.mod) {
    const d = Math.max(-MAX_ZOOM_DELTA, Math.min(MAX_ZOOM_DELTA, dy));
    return { kind: 'zoom', factor: Math.exp(-d * ZOOM_SPEED) };
  }
  // A mouse wheel with Shift scrolls sideways; some platforms already swap the axes.
  if (w.shift && dx === 0) [dx, dy] = [dy, 0];
  return { kind: 'pan', dx, dy };
}

/** Nearest grid point. */
export const snap = (p: Pt): Pt => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** Whole-cell offset of a drag from `from` to `to`, in world cells. */
export const snapDelta = (from: Pt, to: Pt): Pt => ({ x: Math.round(to.x - from.x), y: Math.round(to.y - from.y) });

/** Part origin that centers the part body on the cursor, on whole cells. */
export function ghostOrigin(type: PartType, world: Pt): Pt {
  const b = GEOMETRY[type].body;
  return { x: Math.round(world.x - b.x - b.w / 2), y: Math.round(world.y - b.y - b.h / 2) };
}

/** Place-tool part type, or null for the other tools. */
export function placeType(tool: Tool): PartType | null {
  return tool.startsWith('place:') ? (tool.slice(6) as PartType) : null;
}

type PinHit = Extract<Hit, { kind: 'pin' }>;

type Mode =
  | { kind: 'idle' }
  | { kind: 'pan'; pointer: number; last: Pt }
  | { kind: 'pinch' }
  /** Pressed on a part or wire; becomes a move once dragged. */
  | { kind: 'press'; pointer: number; start: Pt; startWorld: Pt; id: string; shift: boolean; alt: boolean; wasSelected: boolean; isSwitch: boolean }
  | { kind: 'move'; pointer: number; startWorld: Pt; ids: Set<string>; base: Board; delta: Pt }
  | { kind: 'box'; pointer: number; start: Pt; startWorld: Pt; base: string[]; dragging: boolean }
  /** Pressed on a pin; dragging draws a wire. */
  | { kind: 'wireDrag'; pointer: number; start: Pt; from: PinHit; dragging: boolean }
  /** Click-to-route: each click adds a waypoint until a pin is clicked. */
  | { kind: 'route'; from: PinHit; points: [number, number][] };

export interface InteractionDeps {
  toggleSwitch: (partId: string) => void;
}

const sameRef = (a: PinRef, b: PinRef) => a.part === b.part && a.pin === b.pin;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export class Interaction {
  mode: Mode = { kind: 'idle' };
  overlay: Overlay = {};
  cursor = 'default';
  spaceHeld = false;
  /** Last pointer position in world cells, for paste. */
  lastWorld: Pt = { x: 0, y: 0 };
  /** Called whenever the overlay or the cursor changes. */
  onChange: () => void = () => {};

  private indexCache: SpatialIndex | null = null;
  private lastScreen: Pt | null = null;
  private touches = new Map<number, Pt>();
  private pinchPrev: { mid: Pt; dist: number } | null = null;
  /** Set when a right-click cancelled routing, so no context menu opens. */
  private swallowMenu = false;

  constructor(private readonly deps: InteractionDeps) {}

  /** Spatial index for the current board, rebuilt only when the board object changes. */
  index(board = useEditor.getState().board): SpatialIndex {
    if (this.indexCache?.board !== board) this.indexCache = new SpatialIndex(board);
    return this.indexCache;
  }

  get busy(): boolean {
    return this.mode.kind !== 'idle';
  }

  private world(x: number, y: number): Pt {
    return screenToWorld(useEditor.getState().camera, x, y);
  }

  private hitAt(x: number, y: number): Hit | undefined {
    const { camera } = useEditor.getState();
    return this.index().hit(this.world(x, y), HIT_TOLERANCE_PX / scaleOf(camera));
  }

  private panning(): boolean {
    return this.spaceHeld || useEditor.getState().tool === 'hand';
  }

  // ---------------------------------------------------------------- pointer

  down(e: PointerInput): void {
    const st = useEditor.getState();
    if (st.contextMenu) st.set({ contextMenu: null });
    const p = { x: e.x, y: e.y };
    this.lastScreen = p;
    this.lastWorld = this.world(e.x, e.y);

    if (e.pointerType === 'touch') {
      this.touches.set(e.id, p);
      if (this.touches.size >= 2) {
        this.cancel();
        this.mode = { kind: 'pinch' };
        this.pinchPrev = this.pinchState();
        return;
      }
    }

    if (e.button === 2) {
      if (this.mode.kind === 'route' || this.mode.kind === 'wireDrag') {
        this.cancel();
        this.swallowMenu = true;
      }
      return;
    }
    if (e.button === 1 || (e.button === 0 && this.panning())) {
      if (this.mode.kind !== 'route') this.cancel();
      this.mode = { kind: 'pan', pointer: e.id, last: p };
      this.update();
      return;
    }
    if (e.button !== 0) return;

    const world = this.lastWorld;
    if (this.mode.kind === 'route') {
      this.routeClick(e);
      return;
    }

    const ghost = placeType(st.tool);
    if (ghost) {
      this.place(ghost, world);
      return;
    }

    const hit = this.hitAt(e.x, e.y);
    if (hit?.kind === 'pin' && !st.readOnly) {
      this.mode = { kind: 'wireDrag', pointer: e.id, start: p, from: hit, dragging: false };
      this.update();
      return;
    }
    const id = hit?.kind === 'pin' ? hit.ref.part : hit?.id;
    if (id) {
      const wasSelected = st.selection.includes(id);
      if (e.shift) {
        if (!wasSelected) st.setSelection([...st.selection, id]);
      } else if (!wasSelected) {
        st.setSelection([id]);
      }
      const part = this.index().parts.get(id);
      this.mode = {
        kind: 'press',
        pointer: e.id,
        start: p,
        startWorld: world,
        id,
        shift: e.shift,
        alt: e.alt,
        wasSelected,
        isSwitch: part?.type === 'switch',
      };
      this.update();
      return;
    }

    // Empty canvas: start a box selection.
    const base = e.shift ? st.selection : [];
    if (!e.shift && st.selection.length) st.setSelection([]);
    this.mode = { kind: 'box', pointer: e.id, start: p, startWorld: world, base, dragging: false };
    this.update();
  }

  move(e: PointerInput): void {
    const p = { x: e.x, y: e.y };
    const prevScreen = this.lastScreen;
    this.lastScreen = p;
    this.lastWorld = this.world(e.x, e.y);
    if (e.pointerType === 'touch' && this.touches.has(e.id)) this.touches.set(e.id, p);

    const m = this.mode;
    const threshold = e.pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD : DRAG_THRESHOLD;
    switch (m.kind) {
      case 'pinch': {
        const now = this.pinchState();
        const prev = this.pinchPrev;
        if (now && prev) {
          if (prev.dist > 0 && now.dist > 0) zoomBy(now.dist / prev.dist, prev.mid.x, prev.mid.y);
          panBy(prev.mid.x - now.mid.x, prev.mid.y - now.mid.y);
        }
        this.pinchPrev = now;
        return;
      }
      case 'pan': {
        if (e.id !== m.pointer) return;
        panBy(m.last.x - p.x, m.last.y - p.y);
        m.last = p;
        this.lastWorld = this.world(e.x, e.y);
        return;
      }
      case 'press': {
        if (e.id !== m.pointer || dist(m.start, p) < threshold) return;
        this.startMove(m);
        this.move(e);
        return;
      }
      case 'move': {
        if (e.id !== m.pointer) return;
        const d = snapDelta(m.startWorld, this.lastWorld);
        if (d.x !== m.delta.x || d.y !== m.delta.y) {
          m.delta = d;
          useEditor.getState().setTransient(moveIds(m.base, m.ids, d.x, d.y));
        }
        return;
      }
      case 'box': {
        if (e.id !== m.pointer) return;
        if (!m.dragging && dist(m.start, p) < threshold) return;
        m.dragging = true;
        const rect = normRect(m.startWorld, this.lastWorld);
        const inside = this.index().inside(rect);
        const sel = [...new Set([...m.base, ...inside])];
        const cur = useEditor.getState().selection;
        if (sel.length !== cur.length || sel.some((id, i) => cur[i] !== id)) useEditor.getState().setSelection(sel);
        this.overlay = { ...this.overlay, box: rect };
        this.onChange();
        return;
      }
      case 'wireDrag': {
        if (e.id !== m.pointer) return;
        if (!m.dragging && dist(m.start, p) >= threshold) m.dragging = true;
        this.update();
        return;
      }
      default:
        if (prevScreen?.x !== p.x || prevScreen?.y !== p.y) this.update();
    }
  }

  up(e: PointerInput): void {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.id);
      if (this.mode.kind === 'pinch') {
        if (this.touches.size < 2) {
          this.mode = { kind: 'idle' };
          this.pinchPrev = null;
          this.touches.clear();
        } else this.pinchPrev = this.pinchState();
        return;
      }
    }
    const m = this.mode;
    if (m.kind === 'idle' || m.kind === 'route' || m.kind === 'pinch') return;
    if (m.pointer !== e.id) return;
    const st = useEditor.getState();
    switch (m.kind) {
      case 'pan':
        break;
      case 'press': {
        // A click without a drag.
        if (m.shift) {
          if (m.wasSelected) st.setSelection(st.selection.filter((id) => id !== m.id));
        } else {
          st.setSelection([m.id]);
          if (m.isSwitch) this.deps.toggleSwitch(m.id);
        }
        break;
      }
      case 'move':
        st.endTransient();
        break;
      case 'box':
        break;
      case 'wireDrag': {
        const target = this.targetPin(e.x, e.y, m.from);
        if (m.dragging && target) {
          this.finishWire(m.from, target, []);
          break;
        }
        // A click on a pin, or a drag released away from a pin: keep routing by clicks.
        const points: [number, number][] = [];
        if (m.dragging) {
          const s = snap(this.lastWorld);
          if (s.x !== m.from.x || s.y !== m.from.y) points.push([s.x, s.y]);
        }
        this.mode = { kind: 'route', from: m.from, points };
        this.update();
        return;
      }
    }
    this.mode = { kind: 'idle' };
    this.overlay = { ...this.overlay, box: undefined };
    this.update();
  }

  /** Context menu request at a canvas point; client coordinates are where the menu opens. */
  contextMenu(x: number, y: number, clientX: number, clientY: number): void {
    if (this.swallowMenu) {
      this.swallowMenu = false;
      return;
    }
    if (this.mode.kind === 'route' || this.mode.kind === 'wireDrag') {
      this.cancel();
      return;
    }
    const st = useEditor.getState();
    const hit = this.hitAt(x, y);
    const id = hit?.kind === 'pin' ? hit.ref.part : hit?.id;
    if (id && !st.selection.includes(id)) {
      if (st.tool !== 'select' && st.tool !== 'hand') st.setTool('select');
      st.setSelection([id]);
    }
    st.set({ contextMenu: { x: clientX, y: clientY, world: this.world(x, y) } });
  }

  /** Double-click: edit the label of the part under the pointer. */
  doubleClick(x: number, y: number): void {
    const st = useEditor.getState();
    if (st.readOnly || placeType(st.tool) || this.panning()) return;
    const hit = this.hitAt(x, y);
    if (hit?.kind !== 'part') return;
    this.cancel();
    st.setSelection([hit.id]);
    st.set({ editingLabel: hit.id });
  }

  wheel(w: WheelInput, pageHeight?: number): void {
    const a = wheelAction(w, pageHeight);
    if (a.kind === 'zoom') zoomBy(a.factor, w.x, w.y);
    else panBy(a.dx, a.dy);
    this.lastWorld = this.world(w.x, w.y);
    if (this.mode.kind === 'route' || placeType(useEditor.getState().tool)) this.update();
  }

  /** Pointer left the canvas: drop hover feedback but keep any active gesture. */
  leave(): void {
    if (this.mode.kind !== 'idle') return;
    this.lastScreen = null;
    this.setOverlay({});
  }

  setSpace(held: boolean): void {
    if (this.spaceHeld === held) return;
    this.spaceHeld = held;
    this.update();
  }

  // ---------------------------------------------------------------- actions

  /** Abort the current gesture. Returns true if there was one. */
  cancel(): boolean {
    const m = this.mode;
    this.mode = { kind: 'idle' };
    this.pinchPrev = null;
    if (m.kind === 'move') {
      const st = useEditor.getState();
      if (st.transientBase) st.setTransient(st.transientBase);
      st.endTransient();
    }
    this.overlay = { ...this.overlay, box: undefined, wirePreview: undefined };
    this.update();
    return m.kind !== 'idle';
  }

  /** Place a part from the library (drop) or the place tool, and select it. */
  place(type: PartType, world: Pt): string | null {
    const st = useEditor.getState();
    if (st.readOnly || !isPartAllowed(st.level, type)) return null;
    const o = ghostOrigin(type, world);
    const [board, part] = addPart(st.board, type, o.x, o.y);
    st.commit(() => board, [part.id]);
    if (!useEditor.getState().toolLocked) useEditor.getState().setTool('select');
    this.update();
    return part.id;
  }

  /** Ghost for an HTML5 drag from the library sidebar. */
  dragOver(type: PartType | null, x: number, y: number): void {
    this.lastWorld = this.world(x, y);
    if (!type) return this.setOverlay({});
    const o = ghostOrigin(type, this.lastWorld);
    this.setOverlay({ ghost: { type, x: o.x, y: o.y } });
  }

  // ---------------------------------------------------------------- internals

  private startMove(m: Extract<Mode, { kind: 'press' }>): void {
    const st = useEditor.getState();
    if (st.readOnly) {
      // Read-only boards still allow selecting; a drag simply does nothing.
      this.mode = { kind: 'idle' };
      return;
    }
    let ids = new Set(st.selection.includes(m.id) ? st.selection : [m.id]);
    st.beginTransient();
    if (m.alt) {
      const r = duplicateIds(st.board, ids, 0);
      if (r.ids.length) {
        st.setTransient(r.board);
        st.setSelection(r.ids);
        ids = new Set(r.ids);
      }
    }
    this.mode = { kind: 'move', pointer: m.pointer, startWorld: m.startWorld, ids, base: useEditor.getState().board, delta: { x: 0, y: 0 } };
    this.setOverlay({});
  }

  private routeClick(e: PointerInput): void {
    const m = this.mode;
    if (m.kind !== 'route') return;
    const hit = this.hitAt(e.x, e.y);
    if (hit?.kind === 'pin') {
      if (sameRef(hit.ref, m.from.ref)) this.cancel();
      else this.finishWire(m.from, hit, m.points);
      return;
    }
    const s = snap(this.lastWorld);
    const last = m.points[m.points.length - 1];
    if (!last || last[0] !== s.x || last[1] !== s.y) m.points.push([s.x, s.y]);
    this.update();
  }

  private finishWire(from: PinHit, to: PinHit, points: [number, number][]): void {
    const st = useEditor.getState();
    this.mode = { kind: 'idle' };
    if (!sameRef(from.ref, to.ref) && pinPos(st.board, from.ref) && pinPos(st.board, to.ref)) {
      st.commit((b) => addWire(b, from.ref, to.ref, points)[0]);
    }
    this.overlay = { ...this.overlay, wirePreview: undefined };
    this.update();
  }

  /** A pin under the point other than `from`. */
  private targetPin(x: number, y: number, from: PinHit): PinHit | undefined {
    const hit = this.hitAt(x, y);
    return hit?.kind === 'pin' && !sameRef(hit.ref, from.ref) ? hit : undefined;
  }

  private wirePreview(from: PinHit, points: [number, number][], x: number, y: number): Overlay {
    const st = useEditor.getState();
    const a = pinPos(st.board, from.ref);
    if (!a) return {};
    const target = this.targetPin(x, y, from);
    const tp = target ? pinPos(st.board, target.ref) : undefined;
    const end = tp ? { x: tp.wx, y: tp.wy } : snap(this.lastWorld);
    const path = routeWire({ x: a.wx, y: a.wy }, a.wdir, end, tp?.wdir, points);
    return { wirePreview: path, hoverPin: tp ? { x: tp.wx, y: tp.wy } : undefined };
  }

  private pinchState(): { mid: Pt; dist: number } | null {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return null;
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: dist(a, b) };
  }

  private setOverlay(next: Overlay): void {
    const prev = this.overlay;
    const keys: (keyof Overlay)[] = ['box', 'wirePreview', 'ghost', 'hoverPin', 'hoverId', 'flashIds'];
    if (keys.every((k) => JSON.stringify(prev[k]) === JSON.stringify(next[k]))) {
      this.overlay = next;
      return;
    }
    this.overlay = next;
    this.onChange();
  }

  private setCursor(c: string): void {
    if (c === this.cursor) return;
    this.cursor = c;
    this.onChange();
  }

  /** Recompute the overlay and cursor from the mode and the last pointer position. */
  update(): void {
    const st = useEditor.getState();
    const m = this.mode;
    const p = this.lastScreen;
    const keep = { flashIds: this.overlay.flashIds };
    switch (m.kind) {
      case 'pan':
        this.setCursor('grabbing');
        return;
      case 'pinch':
        return;
      case 'move':
        this.setCursor('move');
        return;
      case 'box':
        this.setCursor('default');
        this.setOverlay({ ...keep, box: this.overlay.box });
        return;
      case 'wireDrag':
      case 'route': {
        this.setCursor('crosshair');
        if (!p) return;
        const points = m.kind === 'route' ? m.points : [];
        const showPreview = m.kind === 'route' || m.dragging;
        this.setOverlay({ ...keep, ...(showPreview ? this.wirePreview(m.from, points, p.x, p.y) : {}) });
        return;
      }
      case 'press':
        this.setCursor(m.isSwitch ? 'pointer' : 'move');
        return;
    }
    if (this.panning()) {
      this.setCursor('grab');
      this.setOverlay(keep);
      return;
    }
    if (!p) {
      this.setCursor('default');
      this.setOverlay(keep);
      return;
    }
    const ghost = placeType(st.tool);
    if (ghost) {
      const o = ghostOrigin(ghost, this.lastWorld);
      this.setCursor('crosshair');
      this.setOverlay({ ...keep, ghost: st.readOnly ? undefined : { type: ghost, x: o.x, y: o.y } });
      return;
    }
    const hit = this.hitAt(p.x, p.y);
    if (hit?.kind === 'pin') {
      if (st.readOnly) {
        const isSwitch = this.index().parts.get(hit.ref.part)?.type === 'switch';
        this.setCursor(isSwitch ? 'pointer' : 'default');
        this.setOverlay({ ...keep, hoverId: hit.ref.part });
      } else {
        this.setCursor('crosshair');
        this.setOverlay({ ...keep, hoverPin: { x: hit.x, y: hit.y } });
      }
      return;
    }
    if (hit?.kind === 'part') {
      const isSwitch = this.index().parts.get(hit.id)?.type === 'switch';
      this.setCursor(isSwitch ? 'pointer' : st.readOnly ? 'default' : 'move');
      this.setOverlay({ ...keep, hoverId: hit.id });
      return;
    }
    this.setCursor('default');
    this.setOverlay({ ...keep, hoverId: hit?.id });
  }
}
