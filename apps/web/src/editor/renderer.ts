/**
 * Canvas 2D board renderer (EDIT-01).
 *
 * Look: a Turing Complete board (dark grid, chunky tiles, glowing wires)
 * under Excalidraw selection chrome (violet outlines, dashed group box,
 * square handles).
 *
 * Every frame is drawn from scratch in a few passes, each tuned to keep GPU
 * path rasterization (the expensive part of Canvas 2D) off the hot path:
 *  1. Background and grid as 1-device-pixel rectangles.
 *  2. Wires: orthogonal segments drawn as rectangles, culled per segment and
 *     grouped per signal state. Glows and halos use opaque pre-mixed colors so
 *     overlapping segments never double up.
 *  3. Parts: each distinct look (type, rotation, flip, lock, state) is drawn
 *     once with vector paths into a sprite atlas at the current zoom, then
 *     stamped with drawImage. Very high zoom (few parts on screen) draws
 *     vectors directly. Leads and pins are drawn on top, colored by value.
 *  4. Text (captions, labels) in screen space, only when zoomed in enough.
 *  5. Overlays: hover, selection, previews, flashes and diagnostics.
 */
import type { Part, PartType } from '@ground-up/schema';
import type { Snapshot } from '@ground-up/worker';
import type { Pt, Rect } from './geometry';
import type { SpatialIndex } from './hit';
import { mix, PALETTES, type Palette } from './palette';
import { geomOf, geomOfType } from './parts';
import type { Renderer, Scene } from './render-types';
import { GRID } from './store';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

/** Wire stroke width in cells (never thinner than MIN_WIRE_PX on screen). */
const WIRE_W = 0.16;
const MIN_WIRE_PX = 2;
const DASH = 0.32;
const GAP = 0.22;

/** Zoom levels (screen pixels per cell) at which details appear. */
export const LOD = { symbols: 3.5, pins: 9, labels: 12, captions: 22 } as const;

/** Above this many device pixels per cell, parts are drawn as vectors instead of sprites. */
const SPRITE_MAX_K = 64;
const ATLAS_SIZE = 2048;
/** Parts-layer cache tile size in device pixels, and how many tiles to keep. */
const CHUNK = 512;
const MAX_CHUNKS = 48;
/** Re-render sprites at the exact zoom once it has been still this long. */
const ZOOM_SETTLE_MS = 120;

/* ------------------------------------------------------------------ */
/* Part matrix                                                         */
/* ------------------------------------------------------------------ */

type Mat = [number, number, number, number, number, number];

/**
 * Affine matrix [a, b, c, d, e, f] mapping part-local cells to world cells,
 * matching geometry.toWorld: world = (a*x + c*y + e, b*x + d*y + f).
 */
export function partMatrix(part: Part): Mat {
  const [px, py] = geomOf(part).pivot;
  const f = part.flip ? -1 : 1;
  const r = ((part.rot / 90) | 0) & 3;
  const cos = r === 0 ? 1 : r === 2 ? -1 : 0;
  const sin = r === 1 ? 1 : r === 3 ? -1 : 0;
  const a = f * cos;
  const b = f * sin;
  const c = -sin;
  const d = cos;
  return [a, b, c, d, part.x + px - (a * px + c * py), part.y + py - (b * px + d * py)];
}

/** Builds world-space paths from part-local coordinates. Arcs stay exact because part matrices are orthonormal. */
class Mapper {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  th = 0;
  fl = false;
  t: Path2D = null!;

  set(part: Part): void {
    [this.a, this.b, this.c, this.d, this.e, this.f] = partMatrix(part);
    this.th = (part.rot * Math.PI) / 180;
    this.fl = !!part.flip;
  }
  X(x: number, y: number): number {
    return this.a * x + this.c * y + this.e;
  }
  Y(x: number, y: number): number {
    return this.b * x + this.d * y + this.f;
  }
  M(x: number, y: number): this {
    this.t.moveTo(this.X(x, y), this.Y(x, y));
    return this;
  }
  L(x: number, y: number): this {
    this.t.lineTo(this.X(x, y), this.Y(x, y));
    return this;
  }
  Q(cx: number, cy: number, x: number, y: number): this {
    this.t.quadraticCurveTo(this.X(cx, cy), this.Y(cx, cy), this.X(x, y), this.Y(x, y));
    return this;
  }
  A(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): this {
    const fl = this.fl;
    this.t.arc(
      this.X(cx, cy),
      this.Y(cx, cy),
      r,
      (fl ? Math.PI - a0 : a0) + this.th,
      (fl ? Math.PI - a1 : a1) + this.th,
      fl ? !ccw : ccw,
    );
    return this;
  }
  /** Full circle as its own subpath. */
  O(cx: number, cy: number, r: number): this {
    const x = this.X(cx, cy);
    const y = this.Y(cx, cy);
    this.t.moveTo(x + r, y);
    this.t.arc(x, y, r, 0, TAU);
    return this;
  }
  Z(): this {
    this.t.closePath();
    return this;
  }
}

/** World-space body rectangle of a part (axis-aligned: rotations are multiples of 90 degrees). */
function bodyRectWith(P: Mapper, part: Part): Rect {
  const g = geomOf(part).body;
  P.set(part);
  const x0 = P.X(g.x, g.y);
  const y0 = P.Y(g.x, g.y);
  const x1 = P.X(g.x + g.w, g.y + g.h);
  const y1 = P.Y(g.x + g.w, g.y + g.h);
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/* ------------------------------------------------------------------ */
/* Part shapes, in local cells                                         */
/* ------------------------------------------------------------------ */

// Two-input gate frame: body (0,-0.5) 3x3, inputs at y=0 and y=2, output (3,1).
const GX0 = 0.55;
const GX1 = 2.38;
const GY0 = -0.22;
const GY1 = 2.22;
const GCY = 1;
const GR = (GY1 - GY0) / 2;
const BUBBLE = 0.17;
const XOR_SHIFT = 0.24;

function andShape(P: Mapper): void {
  P.M(GX0, GY0).L(GX1 - GR, GY0).A(GX1 - GR, GCY, GR, -HALF_PI, HALF_PI).L(GX0, GY1).Z();
}

function orShape(P: Mapper, x0: number): void {
  P.M(x0, GY0)
    .Q(x0 + 1.05, GY0, GX1, GCY)
    .Q(x0 + 1.05, GY1, x0, GY1)
    .Q(x0 + 0.46, GCY, x0, GY0)
    .Z();
}

const NOT_TIP = 1.42;

function notShape(P: Mapper): void {
  P.M(0.42, 0.28).L(NOT_TIP, 1).L(0.42, 1.72).Z();
}

const INVERTED = new Set<PartType>(['nand', 'nor', 'xnor', 'not']);

const CAPTION: Partial<Record<PartType, [string, number]>> = {
  and: ['AND', 1.3],
  nand: ['NAND', 1.3],
  or: ['OR', 1.38],
  nor: ['NOR', 1.38],
  xor: ['XOR', 1.5],
  xnor: ['XNOR', 1.5],
};

/**
 * Lead lines from each pin to the edge of the symbol: [pin, x0, y0, x1, y1]
 * in local cells. They stop at the symbol outline (the OR back curve crosses
 * y=0 and y=2 about 0.075 cells in), so they can be drawn after the sprites.
 */
const LEADS: Partial<Record<PartType, [string, number, number, number, number][]>> = (() => {
  const gate = (inEnd: number, out0: number): [string, number, number, number, number][] => [
    ['a', 0, 0, inEnd, 0],
    ['b', 0, 2, inEnd, 2],
    ['out', out0, 1, 3, 1],
  ];
  const bubbled = GX1 + 2 * BUBBLE;
  return {
    and: gate(GX0, GX1),
    nand: gate(GX0, bubbled),
    or: gate(GX0 + 0.07, GX1),
    nor: gate(GX0 + 0.07, bubbled),
    xor: gate(GX0 + 0.05, GX1),
    xnor: gate(GX0 + 0.05, bubbled),
    not: [
      ['in', 0, 1, 0.42, 1],
      ['out', NOT_TIP + 2 * BUBBLE, 1, 2, 1],
    ],
    switch: [['out', 1.62, 1, 2, 1]],
    clock: [['out', 1.62, 1, 2, 1]],
    lamp: [['in', 0, 1, 0.4, 1]],
    dff: [
      ['d', 0, 0, 0.55, 0],
      ['clk', 0, 2, 0.55, 2],
      ['q', 2.3, 1, 3, 1],
    ],
  };
})();

/* ------------------------------------------------------------------ */
/* Caches keyed on immutable inputs                                    */
/* ------------------------------------------------------------------ */

interface Junction {
  x: number;
  y: number;
  wire: string;
}

const junctionCache = new WeakMap<SpatialIndex, Junction[]>();

/** Points shared by two or more wires (fan-out at a pin, shared corners). */
export function findJunctions(paths: ReadonlyMap<string, readonly Pt[]>): Junction[] {
  const seen = new Map<string, Junction & { n: number; last: string }>();
  for (const [id, path] of paths) {
    for (const p of path) {
      const key = `${p.x},${p.y}`;
      const e = seen.get(key);
      if (!e) seen.set(key, { x: p.x, y: p.y, wire: id, n: 1, last: id });
      else if (e.last !== id) {
        e.n++;
        e.last = id;
      }
    }
  }
  const out: Junction[] = [];
  for (const e of seen.values()) if (e.n >= 2) out.push({ x: e.x, y: e.y, wire: e.wire });
  return out;
}

function junctionsOf(index: SpatialIndex): Junction[] {
  let j = junctionCache.get(index);
  if (!j) junctionCache.set(index, (j = findJunctions(index.paths)));
  return j;
}

const pinKeyCache = new WeakMap<Part, string[]>();
function pinKeys(part: Part): string[] {
  let k = pinKeyCache.get(part);
  if (!k) pinKeyCache.set(part, (k = geomOf(part).pins.map((p) => `${part.id}:${p.name}`)));
  return k;
}

const switchCache = new WeakMap<Snapshot, Set<string>>();
function switchesOn(snap: Snapshot): Set<string> {
  let s = switchCache.get(snap);
  if (!s) switchCache.set(snap, (s = new Set(snap.switchesOn)));
  return s;
}

/** 0 = no snapshot, 1 = value 0, 2 = value 1, 3 = X. */
export const bucketOf = (v: number | undefined): number => (v === 0 ? 1 : v === 1 ? 2 : v === 2 ? 3 : 0);

/**
 * Everything value-dependent in a part's sprite: switch or clock state and
 * the signal bucket of each pin (leads are colored by value).
 */
function spriteState(part: Part, snap: Snapshot | null): string {
  let key = '';
  if (part.type === 'switch') key = (snap ? switchesOn(snap).has(part.id) : !!part.on) ? '1' : '0';
  else if (part.type === 'clock') key = snap?.clock ? '1' : '0';
  if (snap) for (const k of pinKeys(part)) key += bucketOf(snap.pins[k]);
  return key;
}

/** A minimal snapshot that reproduces a sprite state for a sprite clone. */
function stateSnapshot(clone: Part, state: string): Snapshot | null {
  const io = clone.type === 'switch' || clone.type === 'clock';
  const on = io && state[0] === '1';
  const buckets = io ? state.slice(1) : state;
  if (!buckets && !io) return null;
  const pins: Record<string, number> = {};
  const keys = pinKeys(clone);
  for (let i = 0; i < buckets.length; i++) {
    const v = [undefined, 0, 1, 2][Number(buckets[i])];
    if (v !== undefined) pins[keys[i]!] = v;
  }
  return fakeSnap({ pins, switchesOn: clone.type === 'switch' && on ? [clone.id] : [], clock: clone.type === 'clock' && on ? 1 : 0 });
}

function fakeSnap(patch: Partial<Snapshot>): Snapshot {
  return {
    wires: {},
    buses: {},
    busPins: {},
    switchValues: {},
    pins: {},
    switchesOn: [],
    powered: true,
    running: false,
    ticks: 0,
    clock: 0,
    stable: true,
    unstablePins: [],
    contentionPins: [],
    ...patch,
  };
}

/* ------------------------------------------------------------------ */
/* Sprite atlas                                                        */
/* ------------------------------------------------------------------ */

interface Slot {
  /** Atlas pixel rect, including a 1px transparent border. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** World offset of the sprite's top-left from the part origin (cells). */
  ox: number;
  oy: number;
}

/** Shelf-packed sprite cache, valid for one zoom level and theme. */
class Atlas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private x = 0;
  private y = 0;
  private rowH = 0;
  readonly slots = new Map<string, Slot>();
  k = 0;
  theme = '';
  full = false;

  constructor(readonly size: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Bumped on every reset, so caches built from slots know they are stale. */
  gen = 0;

  reset(k: number, theme: string): void {
    this.gen++;
    this.k = k;
    this.theme = theme;
    this.x = this.y = this.rowH = 0;
    this.full = false;
    this.slots.clear();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.size, this.size);
  }

  alloc(w: number, h: number): { x: number; y: number } | null {
    if (w > this.size || h > this.size) return null;
    if (this.x + w > this.size) {
      this.x = 0;
      this.y += this.rowH;
      this.rowH = 0;
    }
    if (this.y + h > this.size) {
      this.full = true;
      return null;
    }
    const at = { x: this.x, y: this.y };
    this.x += w;
    this.rowH = Math.max(this.rowH, h);
    return at;
  }
}

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

interface Frame {
  ctx: CanvasRenderingContext2D;
  p: Palette;
  cam: Scene['camera'];
  /** Screen (CSS) pixels per cell. */
  s: number;
  dpr: number;
  /** World-to-device transform: device = world * k + t. */
  k: number;
  tx: number;
  ty: number;
  view: Rect;
  snap: Snapshot | null;
  wireW: number;
  hair: number;
}

const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const SPRITE_ID = '\u0000sprite';
const SPRITE_MARGIN = 0.3;

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const main = canvas.getContext('2d', { alpha: false }) ?? canvas.getContext('2d')!;
  let dpr = 1;
  let animating = false;
  /** True while sprites are stamped at a stale zoom and need a crisp redraw. */
  let settling = false;
  let lastK = 0;
  let lastKChange = 0;
  const chunks = new Map<string, { canvas: HTMLCanvasElement; sig: number; used: number }>();
  const pool: HTMLCanvasElement[] = [];
  let chunkK = 0;
  let chunkGen = -1;
  let frameNo = 0;
  const P = new Mapper();
  let atlas: Atlas | null = null;
  const stripeCache = new Map<string, CanvasPattern | null>();
  const reducedMotion =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;

  /** Diagonal amber stripes for lamps showing X. */
  function stripes(ctx: CanvasRenderingContext2D, p: Palette): CanvasPattern | null {
    const key = p.sigX + p.inset;
    if (stripeCache.has(key)) return stripeCache.get(key)!;
    let pat: CanvasPattern | null;
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d')!;
      g.fillStyle = p.inset;
      g.fillRect(0, 0, 16, 16);
      g.strokeStyle = p.sigX;
      g.lineWidth = 5;
      g.beginPath();
      for (const o of [-16, 0, 16]) {
        g.moveTo(o - 2, 18);
        g.lineTo(o + 18, -2);
      }
      g.stroke();
      pat = ctx.createPattern(c, 'repeat');
      pat?.setTransform(new DOMMatrix([0.03, 0, 0, 0.03, 0, 0]));
    } catch {
      pat = null;
    }
    stripeCache.set(key, pat);
    return pat;
  }

  const world = (F: Frame): void => F.ctx.setTransform(F.k, 0, 0, F.k, F.tx, F.ty);
  const screen = (F: Frame): void => F.ctx.setTransform(F.dpr, 0, 0, F.dpr, 0, 0);
  const device = (F: Frame): void => F.ctx.setTransform(1, 0, 0, 1, 0, 0);
  const sx = (F: Frame, wx: number): number => (wx - F.cam.x) * F.s;
  const sy = (F: Frame, wy: number): number => (wy - F.cam.y) * F.s;
  const inView = (v: Rect, x: number, y: number): boolean => x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h;

  /* ---------------- grid ---------------- */

  function drawBackground(F: Frame, w: number, h: number, showGrid: boolean): void {
    const ctx = F.ctx;
    device(F);
    ctx.globalAlpha = 1;
    ctx.fillStyle = F.p.board;
    const W = Math.ceil(w * F.dpr);
    const H = Math.ceil(h * F.dpr);
    ctx.fillRect(0, 0, W, H);
    if (!showGrid) return;
    const lw = Math.max(1, Math.round(F.dpr));
    const levels = [1, 5, 25];
    const fade = (px: number): number => Math.min(1, Math.max(0, (px - 6) / 10));
    for (let li = 0; li < levels.length; li++) {
      const step = levels[li]!;
      const next = levels[li + 1];
      const alpha = fade(step * F.s);
      if (alpha <= 0) continue;
      // Lines of the next level are drawn by that level once it is visible.
      const skipNext = next !== undefined && fade(next * F.s) > 0;
      ctx.fillStyle = step === 1 ? F.p.gridMinor : F.p.gridMajor;
      ctx.globalAlpha = alpha;
      for (let i = Math.ceil(F.cam.x / step) * step; i <= F.cam.x + w / F.s; i += step) {
        if (skipNext && i % next === 0) continue;
        ctx.fillRect(Math.round((i - F.cam.x) * F.k), 0, lw, H);
      }
      for (let j = Math.ceil(F.cam.y / step) * step; j <= F.cam.y + h / F.s; j += step) {
        if (skipNext && j % next === 0) continue;
        ctx.fillRect(0, Math.round((j - F.cam.y) * F.k), W, lw);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- wires ---------------- */

  /**
   * Fill an axis-aligned world segment (x0 <= x1, y0 <= y1) as a rectangle of
   * width `w` cells, snapped to device pixels (device transform set). Snapped
   * rectangles are crisp and the cheapest thing Canvas 2D can draw.
   */
  function segRect(F: Frame, x0: number, y0: number, x1: number, y1: number, w: number, caps: boolean): void {
    const k = F.k;
    const wd = Math.max(1, Math.round(w * k));
    const cap = caps ? wd / 2 : 0;
    if (y1 - y0 > x1 - x0) {
      const X = Math.round(x0 * k + F.tx - wd / 2);
      const Y0 = Math.round(y0 * k + F.ty - cap);
      F.ctx.fillRect(X, Y0, wd, Math.round(y1 * k + F.ty + cap) - Y0);
    } else {
      const Y = Math.round(y0 * k + F.ty - wd / 2);
      const X0 = Math.round(x0 * k + F.tx - cap);
      F.ctx.fillRect(X0, Y, Math.round(x1 * k + F.tx + cap) - X0, wd);
    }
  }

  /** Fill the visible segments of an orthogonal path as rectangles of width `w` cells (device transform set). */
  function fillPath(F: Frame, path: readonly Pt[], w: number): void {
    const v = F.view;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const x0 = a.x < b.x ? a.x : b.x;
      const x1 = a.x < b.x ? b.x : a.x;
      const y0 = a.y < b.y ? a.y : b.y;
      const y1 = a.y < b.y ? b.y : a.y;
      if (x1 < v.x || x0 > v.x + v.w || y1 < v.y || y0 > v.y + v.h) continue;
      segRect(F, x0, y0, x1, y1, w, true);
    }
  }

  /**
   * Thin wires (up to 4 device px) far out, where there are many: one 1px
   * hairline path stroked `wd` times with a 1px offset. Hairlines are much
   * cheaper for the GPU than thousands of rectangles or a wide stroke.
   */
  function hairlines(F: Frame, paths: readonly (readonly Pt[])[], wd: number, color: string, dashed = false): void {
    const v = F.view;
    const k = F.k;
    const o = 0.5 - Math.floor(wd / 2);
    const path = new Path2D();
    for (const pts of paths) {
      let down = false;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        if (Math.max(a.x, b.x) < v.x || Math.min(a.x, b.x) > v.x + v.w || Math.max(a.y, b.y) < v.y || Math.min(a.y, b.y) > v.y + v.h) {
          down = false;
          continue;
        }
        if (!down) path.moveTo(Math.round(a.x * k + F.tx) + o, Math.round(a.y * k + F.ty) + o);
        path.lineTo(Math.round(b.x * k + F.tx) + o, Math.round(b.y * k + F.ty) + o);
        down = true;
      }
    }
    const ctx = F.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.lineCap = dashed ? 'butt' : 'square';
    ctx.lineJoin = 'miter';
    if (dashed) ctx.setLineDash([Math.max(2, DASH * k), Math.max(1.5, GAP * k)]);
    for (let i = 0; i < wd; i++) {
      ctx.setTransform(1, 0, 0, 1, i, i);
      ctx.stroke(path);
    }
    if (dashed) ctx.setLineDash([]);
    device(F);
  }

  /** Dashed version of fillPath, for X (unknown) values. */
  function dashPath(F: Frame, path: readonly Pt[], w: number): void {
    const v = F.view;
    let phase = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const visible = !(
        Math.max(a.x, b.x) < v.x ||
        Math.min(a.x, b.x) > v.x + v.w ||
        Math.max(a.y, b.y) < v.y ||
        Math.min(a.y, b.y) > v.y + v.h
      );
      if (visible && len > 0) {
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        let t = -phase;
        while (t < len) {
          const t0 = Math.max(0, t);
          const t1 = Math.min(len, t + DASH);
          if (t1 > t0) {
            const xa = a.x + ux * t0;
            const ya = a.y + uy * t0;
            const xb = a.x + ux * t1;
            const yb = a.y + uy * t1;
            segRect(F, Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb), w, false);
          }
          t += DASH + GAP;
        }
      }
      phase = (phase + len) % (DASH + GAP);
    }
  }

  function drawWires(F: Frame, scene: Scene): void {
    const { index, selection, overlay } = scene;
    const ctx = F.ctx;
    const p = F.p;
    const wires = F.snap?.wires;
    const groups: (readonly Pt[])[][] = [[], [], [], []];
    for (const [id, path] of index.paths) groups[wires ? bucketOf(wires[id]) : 0]!.push(path);
    device(F);
    const w = F.wireW;

    // Halos under wires: hover, selection (opaque pre-mixed so overlaps stay even).
    const hp = overlay.hoverId && !selection.has(overlay.hoverId) ? index.paths.get(overlay.hoverId) : undefined;
    if (hp) {
      ctx.fillStyle = mix(p.board, p.accent, 0.3);
      fillPath(F, hp, w + 6 / F.s);
    }
    if (selection.size) {
      ctx.fillStyle = mix(p.board, p.accent, 0.5);
      for (const id of selection) {
        const path = index.paths.get(id);
        if (path) fillPath(F, path, w + 8 / F.s);
      }
    }

    // Glow under every wire carrying 1 (once it is wide enough to see), then the cores.
    if (groups[2]!.length && F.s >= LOD.pins) {
      ctx.fillStyle = mix(p.board, p.sig1, p.glowAlpha);
      for (const path of groups[2]!) fillPath(F, path, w * 3.2);
    }
    const colors = [p.wire, p.sig0, p.sig1];
    const wd = Math.max(1, Math.round(w * F.k));
    for (let b = 0; b < 3; b++) {
      if (!groups[b]!.length) continue;
      if (wd <= 4) {
        hairlines(F, groups[b]!, wd, colors[b]!);
        continue;
      }
      ctx.fillStyle = colors[b]!;
      for (const path of groups[b]!) fillPath(F, path, w);
    }
    if (groups[3]!.length) {
      if (wd <= 4) hairlines(F, groups[3]!, wd, p.sigX, true);
      else {
        ctx.fillStyle = p.sigX;
        for (const path of groups[3]!) dashPath(F, path, w);
      }
    }

    // Junction dots, once they are big enough to read.
    if (F.s < LOD.pins) return;
    const v = F.view;
    const dots: number[][] = [[], [], [], []];
    for (const j of junctionsOf(index)) {
      if (!inView(v, j.x, j.y)) continue;
      dots[wires ? bucketOf(wires[j.wire]) : 0]!.push(j.x, j.y);
    }
    const r = Math.max(w * 1.75, 2.5 / F.s);
    const dotColors = [p.wire, p.sig0, p.sig1, p.sigX];
    for (let b = 0; b < 4; b++) if (dots[b]!.length) stampDots(F, dots[b]!, r, dotColors[b]!, null);
  }

  /* ---------------- dots (pins, junctions) ---------------- */

  /**
   * Draw many identical dots at world points [x0, y0, x1, y1, ...]. Tiny dots
   * are squares; larger ones are stamped from an atlas sprite.
   */
  function stampDots(F: Frame, pts: number[], r: number, color: string, ring: { color: string; w: number } | null): void {
    const ctx = F.ctx;
    const rd = r * F.k;
    const outer = ring ? (r + ring.w) * F.k : rd;
    device(F);
    if (F.ctx === atlas?.ctx) {
      // Drawing a sprite into the atlas itself: plain vector circles.
      world(F);
      const path = new Path2D();
      const ringPath = new Path2D();
      for (let i = 0; i < pts.length; i += 2) {
        if (ring) {
          ringPath.moveTo(pts[i]! + r + ring.w, pts[i + 1]!);
          ringPath.arc(pts[i]!, pts[i + 1]!, r + ring.w, 0, TAU);
        }
        path.moveTo(pts[i]! + r, pts[i + 1]!);
        path.arc(pts[i]!, pts[i + 1]!, r, 0, TAU);
      }
      if (ring) {
        ctx.fillStyle = ring.color;
        ctx.fill(ringPath);
      }
      ctx.fillStyle = color;
      ctx.fill(path);
      return;
    }
    if (rd < 3 || !atlas) {
      const d = Math.max(1.5, rd * 1.8);
      ctx.fillStyle = color;
      for (let i = 0; i < pts.length; i += 2) {
        ctx.fillRect(pts[i]! * F.k + F.tx - d / 2, pts[i + 1]! * F.k + F.ty - d / 2, d, d);
      }
      return;
    }
    const key = `dot|${color}|${ring?.color ?? ''}|${rd.toFixed(2)}|${outer.toFixed(2)}`;
    // While the atlas is held at another zoom (mid-gesture), draw vectors instead.
    const exact = atlas.k === F.k;
    let slot = exact ? atlas.slots.get(key) : undefined;
    if (!slot && exact) {
      const size = Math.ceil(outer * 2) + 2;
      const at = atlas.alloc(size, size);
      if (at) {
        const g = atlas.ctx;
        const c = at.x + size / 2;
        const cy = at.y + size / 2;
        g.setTransform(1, 0, 0, 1, 0, 0);
        if (ring) {
          g.beginPath();
          g.arc(c, cy, outer, 0, TAU);
          g.fillStyle = ring.color;
          g.fill();
        }
        g.beginPath();
        g.arc(c, cy, rd, 0, TAU);
        g.fillStyle = color;
        g.fill();
        slot = { x: at.x, y: at.y, w: size, h: size, ox: 0, oy: 0 };
        atlas.slots.set(key, slot);
      }
    }
    if (!slot) {
      world(F);
      const path = new Path2D();
      for (let i = 0; i < pts.length; i += 2) {
        path.moveTo(pts[i]! + r, pts[i + 1]!);
        path.arc(pts[i]!, pts[i + 1]!, r, 0, TAU);
      }
      ctx.fillStyle = color;
      ctx.fill(path);
      return;
    }
    const half = slot.w / 2;
    for (let i = 0; i < pts.length; i += 2) {
      ctx.drawImage(
        atlas.canvas,
        slot.x,
        slot.y,
        slot.w,
        slot.h,
        Math.round(pts[i]! * F.k + F.tx - half),
        Math.round(pts[i + 1]! * F.k + F.ty - half),
        slot.w,
        slot.h,
      );
    }
  }

  /* ---------------- parts: vector drawing ---------------- */

  /** Tiles and symbols of the given parts, as batched vector paths in F's world transform. */
  function drawPartBodies(F: Frame, parts: readonly Part[]): void {
    if (!parts.length) return;
    const ctx = F.ctx;
    const p = F.p;
    const s = F.s;
    const snap = F.snap;

    const shadow = new Path2D();
    const tiles = new Path2D();
    const lockedEdge = new Path2D();
    const sym = new Path2D();
    const symLine = new Path2D();
    const bubbles = new Path2D();
    const inkLine = new Path2D();
    const insets = new Path2D();
    const lit = new Path2D();
    const halo = new Path2D();
    const knobs = new Path2D();
    const striped = new Path2D();
    const clockOn = new Path2D();
    const clockOff = new Path2D();
    const locks = new Path2D();
    const shackles = new Path2D();
    let anyLocked = false;
    let anyHalo = false;
    let anyStriped = false;

    const radius = 0.2;
    const inset = 0.08;

    for (const part of parts) {
      const body = bodyRectWith(P, part);
      const x = body.x + inset;
      const y = body.y + inset;
      const w = body.w - 2 * inset;
      const h = body.h - 2 * inset;

      shadow.roundRect(x, y + 0.12, w, h, radius);
      tiles.roundRect(x, y, w, h, radius);
      if (part.locked) {
        anyLocked = true;
        lockedEdge.roundRect(x, y, w, h, radius);
        if (s >= LOD.captions) {
          // Small padlock in the top-right corner, always upright.
          const lx = x + w - 0.42;
          const ly = y + 0.2;
          locks.roundRect(lx, ly + 0.13, 0.28, 0.21, 0.04);
          shackles.moveTo(lx + 0.06, ly + 0.14);
          shackles.lineTo(lx + 0.06, ly + 0.08);
          shackles.arc(lx + 0.14, ly + 0.08, 0.08, Math.PI, 0);
          shackles.lineTo(lx + 0.22, ly + 0.14);
        }
      }

      P.t = sym;
      switch (part.type) {
        case 'and':
        case 'nand':
          andShape(P);
          break;
        case 'or':
        case 'nor':
          orShape(P, GX0);
          break;
        case 'xor':
        case 'xnor':
          orShape(P, GX0 + XOR_SHIFT);
          P.t = symLine;
          P.M(GX0 - 0.02, GY0).Q(GX0 + 0.44, GCY, GX0 - 0.02, GY1);
          break;
        case 'not':
          notShape(P);
          break;
        case 'dff': {
          P.M(0.55, -0.22).L(2.3, -0.22).L(2.3, 2.22).L(0.55, 2.22).Z();
          P.t = inkLine;
          P.M(0.55, 1.68).L(0.95, 2).L(0.55, 2.32);
          break;
        }
        case 'switch': {
          const on = snap ? switchesOn(snap).has(part.id) : !!part.on;
          P.t = on ? lit : insets;
          P.M(0.74, 0.64).L(1.26, 0.64).A(1.26, 1, 0.36, -HALF_PI, HALF_PI).L(0.74, 1.36).A(0.74, 1, 0.36, HALF_PI, 3 * HALF_PI).Z();
          P.t = knobs;
          P.O(on ? 1.26 : 0.74, 1, 0.27);
          break;
        }
        case 'lamp': {
          const v = snap?.pins[pinKeys(part)[0]!];
          if (v === 1) {
            P.t = halo;
            P.O(1, 1, 0.92);
            anyHalo = true;
            P.t = lit;
          } else if (v === 2) {
            P.t = striped;
            anyStriped = true;
          } else P.t = insets;
          P.O(1, 1, 0.6);
          break;
        }
        case 'clock': {
          P.t = snap?.clock ? clockOn : clockOff;
          P.M(0.36, 1.28).L(0.68, 1.28).L(0.68, 0.72).L(1.0, 0.72).L(1.0, 1.28).L(1.32, 1.28).L(1.32, 0.72).L(1.62, 0.72);
          break;
        }
      }
      if (INVERTED.has(part.type)) {
        P.t = bubbles;
        P.O(part.type === 'not' ? NOT_TIP + BUBBLE : GX1 + BUBBLE, part.type === 'not' ? 1 : GCY, BUBBLE);
      }
    }

    world(F);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.fillStyle = p.tileShadow;
    ctx.fill(shadow);
    ctx.fillStyle = p.tile;
    ctx.fill(tiles);
    ctx.strokeStyle = p.tileEdge;
    ctx.lineWidth = F.hair;
    ctx.stroke(tiles);
    if (anyLocked) {
      ctx.strokeStyle = p.locked;
      ctx.lineWidth = Math.max(0.09, 1.75 / s);
      ctx.stroke(lockedEdge);
      ctx.fillStyle = p.locked;
      ctx.fill(locks);
      ctx.lineWidth = 0.05;
      ctx.stroke(shackles);
    }

    if (anyHalo) {
      const a = ctx.globalAlpha;
      ctx.fillStyle = p.sig1;
      ctx.globalAlpha = a * p.glowAlpha;
      ctx.fill(halo);
      ctx.globalAlpha = a;
    }

    ctx.fillStyle = p.symbolFill;
    ctx.fill(sym);
    ctx.strokeStyle = p.symbolStroke;
    ctx.lineWidth = Math.max(0.07, 1.25 / s);
    ctx.stroke(sym);
    ctx.lineWidth = Math.max(0.1, 1.5 / s);
    ctx.stroke(symLine);

    ctx.fillStyle = p.tile;
    ctx.fill(bubbles);
    ctx.lineWidth = Math.max(0.08, 1.25 / s);
    ctx.stroke(bubbles);

    ctx.strokeStyle = p.symbolText;
    ctx.lineWidth = Math.max(0.06, 1 / s);
    ctx.stroke(inkLine);

    ctx.fillStyle = p.inset;
    ctx.fill(insets);
    ctx.strokeStyle = p.tileEdge;
    ctx.lineWidth = F.hair;
    ctx.stroke(insets);
    if (anyStriped) {
      ctx.fillStyle = stripes(ctx, p) ?? p.sigX;
      ctx.fill(striped);
      ctx.strokeStyle = p.sigX;
      ctx.stroke(striped);
    }
    ctx.fillStyle = p.sig1;
    ctx.fill(lit);
    ctx.fillStyle = p.knob;
    ctx.fill(knobs);
    ctx.strokeStyle = p.tileEdge;
    ctx.stroke(knobs);

    ctx.lineWidth = Math.max(0.1, 1.5 / s);
    ctx.strokeStyle = p.sig1;
    ctx.stroke(clockOn);
    ctx.strokeStyle = p.label;
    ctx.stroke(clockOff);
  }

  /* ---------------- parts: sprites ---------------- */

  function spriteFor(F: Frame, part: Part): Slot | null {
    const a = atlas!;
    const state = spriteState(part, F.snap);
    const key = `${part.type}|${part.rot}|${part.flip ? 1 : 0}|${part.locked ? 1 : 0}|${state}`;
    const hit = a.slots.get(key);
    if (hit) return hit;
    if (a.full) return null;
    const clone: Part = { id: SPRITE_ID, type: part.type, x: 0, y: 0, rot: part.rot, flip: part.flip, locked: part.locked };
    const body = bodyRectWith(P, clone);
    const ox = body.x - SPRITE_MARGIN;
    const oy = body.y - SPRITE_MARGIN;
    const w = Math.ceil((body.w + 2 * SPRITE_MARGIN) * F.k) + 2;
    const h = Math.ceil((body.h + 2 * SPRITE_MARGIN) * F.k) + 2;
    const at = a.alloc(w, h);
    if (!at) return null;
    const SF: Frame = {
      ...F,
      ctx: a.ctx,
      tx: at.x + 1 - ox * F.k,
      ty: at.y + 1 - oy * F.k,
      snap: stateSnapshot(clone, state),
    };
    a.ctx.globalAlpha = 1;
    drawPartBodies(SF, [clone]);
    drawLeads(SF, [clone]);
    drawPins(SF, [clone]);
    const slot = { x: at.x, y: at.y, w, h, ox, oy };
    a.slots.set(key, slot);
    return slot;
  }

  function drawParts(F: Frame, parts: readonly Part[], index: SpatialIndex): void {
    const ctx = F.ctx;
    if (F.s < LOD.symbols) {
      // Far out: flat tiles only.
      world(F);
      ctx.fillStyle = F.p.tileEdge;
      for (const part of parts) {
        const r = bodyRectWith(P, part);
        ctx.fillRect(r.x + 0.15, r.y + 0.15, r.w - 0.3, r.h - 0.3);
      }
      const locked = parts.filter((q) => q.locked);
      if (locked.length) {
        ctx.fillStyle = F.p.locked;
        for (const part of locked) {
          const r = bodyRectWith(P, part);
          ctx.fillRect(r.x + 0.15, r.y + 0.15, r.w - 0.3, r.h - 0.3);
        }
      }
      return;
    }
    if (F.k > SPRITE_MAX_K || !atlas) {
      drawPartBodies(F, parts);
      drawLeads(F, parts);
    } else {
      // During a zoom gesture keep stamping the sprites of a nearby zoom,
      // scaled, and re-render them crisply once the zoom settles.
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      if (F.k !== lastK) {
        lastK = F.k;
        lastKChange = now;
      }
      const ratio = atlas.k ? F.k / atlas.k : 0;
      if (
        atlas.theme !== F.p.board ||
        atlas.full ||
        ratio < 0.8 ||
        ratio > 1.25 ||
        (ratio !== 1 && now - lastKChange > ZOOM_SETTLE_MS)
      ) {
        atlas.reset(F.k, F.p.board);
      }
      const scale = F.k / atlas.k;
      settling = scale !== 1;
      const fallback = drawChunks(F, index, scale);
      drawPartBodies(F, fallback);
      drawLeads(F, fallback);
      drawPins(F, fallback);
      return;
    }
    drawPins(F, parts);
  }

  /**
   * Parts layer cache: the board is cut into CHUNK x CHUNK device-pixel tiles
   * (aligned to world space, so panning reuses them). Each tile is rebuilt
   * from atlas sprites only when the sprites or positions inside it change,
   * so a still or panning board costs a few dozen drawImage calls per frame
   * instead of one per part. Returns parts that got no sprite.
   */
  function drawChunks(F: Frame, index: SpatialIndex, scale: number): Part[] {
    const a = atlas!;
    // Chunks are laid out at the atlas zoom; mid-gesture they are stamped scaled.
    const k = a.k;
    // Sprites are always rendered at the atlas zoom.
    const AF: Frame = scale === 1 ? F : { ...F, k, s: k / F.dpr, wireW: Math.max(WIRE_W, (MIN_WIRE_PX * F.dpr) / k), hair: Math.max(0.05, F.dpr / k) };    if (chunkK !== k || chunkGen !== a.gen) {
      for (const c of chunks.values()) pool.push(c.canvas);
      chunks.clear();
      chunkK = k;
      chunkGen = a.gen;
    }
    frameNo++;
    const v = F.view;
    const cw = CHUNK / k;
    const i0 = Math.floor(v.x / cw);
    const i1 = Math.floor((v.x + v.w) / cw);
    const j0 = Math.floor(v.y / cw);
    const j1 = Math.floor((v.y + v.h) / cw);
    const nI = i1 - i0 + 1;
    const nJ = j1 - j0 + 1;
    const sigs = new Int32Array(nI * nJ).fill(-2128831035);
    const items: number[][] = Array.from({ length: nI * nJ }, () => []);
    const parts = index.partsIn({ x: i0 * cw - 1, y: j0 * cw - 1, w: nI * cw + 2, h: nJ * cw + 2 });
    const fallback: Part[] = [];
    for (const part of parts) {
      const slot = spriteFor(AF, part);
      if (!slot) {
        fallback.push(part);
        continue;
      }
      const x0 = Math.round((part.x + slot.ox) * k) - 1;
      const y0 = Math.round((part.y + slot.oy) * k) - 1;
      const ci0 = Math.max(i0, Math.floor(x0 / CHUNK));
      const ci1 = Math.min(i1, Math.floor((x0 + slot.w) / CHUNK));
      const cj0 = Math.max(j0, Math.floor(y0 / CHUNK));
      const cj1 = Math.min(j1, Math.floor((y0 + slot.h) / CHUNK));
      for (let ci = ci0; ci <= ci1; ci++) {
        for (let cj = cj0; cj <= cj1; cj++) {
          const n = (cj - j0) * nI + (ci - i0);
          let h = sigs[n]!;
          h = Math.imul(h ^ slot.x, 16777619);
          h = Math.imul(h ^ slot.y, 16777619);
          h = Math.imul(h ^ x0, 16777619);
          h = Math.imul(h ^ y0, 16777619);
          sigs[n] = h;
          items[n]!.push(slot.x, slot.y, slot.w, slot.h, x0 - ci * CHUNK, y0 - cj * CHUNK);
        }
      }
    }
    const ctx = F.ctx;
    device(F);
    for (let cj = j0; cj <= j1; cj++) {
      for (let ci = i0; ci <= i1; ci++) {
        const n = (cj - j0) * nI + (ci - i0);
        const list = items[n]!;
        if (!list.length) continue;
        const key = `${ci},${cj}`;
        let c = chunks.get(key);
        if (!c || c.sig !== sigs[n]) {
          if (!c) {
            c = { canvas: takeCanvas(), sig: 0, used: 0 };
            chunks.set(key, c);
          }
          const g = c.canvas.getContext('2d')!;
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.clearRect(0, 0, CHUNK, CHUNK);
          for (let i = 0; i < list.length; i += 6) {
            g.drawImage(a.canvas, list[i]!, list[i + 1]!, list[i + 2]!, list[i + 3]!, list[i + 4]!, list[i + 5]!, list[i + 2]!, list[i + 3]!);
          }
          c.sig = sigs[n]!;
        }
        c.used = frameNo;
        if (scale === 1) ctx.drawImage(c.canvas, Math.round(ci * CHUNK + F.tx), Math.round(cj * CHUNK + F.ty));
        else ctx.drawImage(c.canvas, ci * CHUNK * scale + F.tx, cj * CHUNK * scale + F.ty, CHUNK * scale, CHUNK * scale);
      }
    }
    return fallback;
  }

  /** A blank chunk canvas: from the pool, by evicting the least recently used chunk, or new. */
  function takeCanvas(): HTMLCanvasElement {
    const pooled = pool.pop();
    if (pooled) return pooled;
    if (chunks.size >= MAX_CHUNKS) {
      let oldest: string | undefined;
      let used = Infinity;
      for (const [key, c] of chunks) {
        if (c.used < used) {
          used = c.used;
          oldest = key;
        }
      }
      const c = chunks.get(oldest!)!;
      chunks.delete(oldest!);
      return c.canvas;
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CHUNK;
    return canvas;
  }

  /** Lead lines from pins to symbols, as pixel-snapped rectangles colored by the value each pin sees. */
  function drawLeads(F: Frame, parts: readonly Part[]): void {
    if (!parts.length) return;
    const ctx = F.ctx;
    const p = F.p;
    const pins = F.snap?.pins;
    const leads: number[][] = [[], [], [], []];
    for (const part of parts) {
      const g = geomOf(part);
      const keys = pinKeys(part);
      P.set(part);
      for (const [name, x0, y0, x1, y1] of LEADS[part.type] ?? []) {
        const i = name === g.pins[0]!.name ? 0 : name === g.pins[1]?.name ? 1 : 2;
        const b = pins ? bucketOf(pins[keys[i]!]) : 0;
        leads[b]!.push(P.X(x0, y0), P.Y(x0, y0), P.X(x1, y1), P.Y(x1, y1));
      }
    }
    device(F);
    const colors = [p.wire, p.sig0, p.sig1, p.sigX];
    for (let b = 0; b < 4; b++) {
      const L = leads[b]!;
      if (!L.length) continue;
      ctx.fillStyle = colors[b]!;
      for (let i = 0; i < L.length; i += 4) {
        segRect(F, Math.min(L[i]!, L[i + 2]!), Math.min(L[i + 1]!, L[i + 3]!), Math.max(L[i]!, L[i + 2]!), Math.max(L[i + 1]!, L[i + 3]!), F.wireW, false);
      }
    }
  }

  /** Pin dots with a board-colored ring, colored by value. */
  function drawPins(F: Frame, parts: readonly Part[]): void {
    if (F.s < LOD.pins) return;
    const p = F.p;
    const pins = F.snap?.pins;
    const dots: number[][] = [[], [], [], []];
    for (const part of parts) {
      const g = geomOf(part);
      const keys = pinKeys(part);
      P.set(part);
      for (let i = 0; i < g.pins.length; i++) {
        const pin = g.pins[i]!;
        dots[pins ? bucketOf(pins[keys[i]!]) : 0]!.push(P.X(pin.x, pin.y), P.Y(pin.x, pin.y));
      }
    }
    const pinColors = [p.label, p.sig0, p.sig1, p.sigX];
    const r = Math.max(0.13, 2 / F.s);
    for (let b = 0; b < 4; b++) {
      if (dots[b]!.length) stampDots(F, dots[b]!, r, pinColors[b]!, { color: p.pinRing, w: Math.max(0.06, 1.25 / F.s) });
    }
  }

  function drawPartText(F: Frame, parts: readonly Part[]): void {
    const s = F.s;
    if (s < LOD.labels) return;
    const ctx = F.ctx;
    screen(F);
    ctx.textAlign = 'center';
    const p = F.p;

    if (s >= LOD.captions) {
      ctx.textBaseline = 'middle';
      ctx.fillStyle = p.symbolText;
      ctx.font = `700 ${Math.round(0.36 * s)}px ${MONO}`;
      for (const part of parts) {
        const cap = CAPTION[part.type];
        if (!cap) continue;
        P.set(part);
        ctx.fillText(cap[0], sx(F, P.X(cap[1], GCY)), sy(F, P.Y(cap[1], GCY)) + 0.5);
      }
      ctx.font = `700 ${Math.round(0.5 * s)}px ${MONO}`;
      for (const part of parts) {
        if (part.type !== 'dff') continue;
        P.set(part);
        ctx.fillText('D', sx(F, P.X(0.92, 0.02)), sy(F, P.Y(0.92, 0.02)));
        ctx.fillText('Q', sx(F, P.X(1.95, 1.02)), sy(F, P.Y(1.95, 1.02)));
      }
    }

    // Labels sit above the tile, upright, in monospace.
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${Math.round(Math.min(15, Math.max(10, 0.55 * s)))}px ${MONO}`;
    for (const part of parts) {
      if (!part.label) continue;
      const r = bodyRectWith(P, part);
      ctx.fillStyle = part.locked ? p.locked : p.label;
      ctx.fillText(part.label, sx(F, r.x + r.w / 2), sy(F, r.y) - 5);
    }
  }

  /* ---------------- overlays ---------------- */

  function screenRect(F: Frame, r: Rect, pad: number): Rect {
    return { x: sx(F, r.x) - pad, y: sy(F, r.y) - pad, w: r.w * F.s + 2 * pad, h: r.h * F.s + 2 * pad };
  }

  function pathRect(path: readonly Pt[]): Rect {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of path) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function handles(F: Frame, r: Rect): void {
    const ctx = F.ctx;
    const hs = 8;
    ctx.beginPath();
    for (const [x, y] of [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x, r.y + r.h],
      [r.x + r.w, r.y + r.h],
    ] as const) {
      ctx.roundRect(Math.round(x - hs / 2) + 0.5, Math.round(y - hs / 2) + 0.5, hs, hs, 2);
    }
    ctx.fillStyle = F.p.handleFill;
    ctx.fill();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = F.p.accent;
    ctx.stroke();
  }

  function crispRect(ctx: CanvasRenderingContext2D, r: Rect): void {
    ctx.rect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
  }

  function drawSelection(F: Frame, scene: Scene): void {
    const { index, selection, overlay } = scene;
    const ctx = F.ctx;
    screen(F);

    const hovered = overlay.hoverId && !selection.has(overlay.hoverId) ? index.parts.get(overlay.hoverId) : undefined;
    if (hovered) {
      ctx.beginPath();
      const r = screenRect(F, bodyRectWith(P, hovered), 3);
      ctx.roundRect(r.x, r.y, r.w, r.h, 6);
      ctx.strokeStyle = F.p.accent;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (!selection.size) return;
    const rects: Rect[] = [];
    ctx.beginPath();
    for (const id of selection) {
      const part = index.parts.get(id);
      if (part) {
        const r = screenRect(F, bodyRectWith(P, part), 4);
        rects.push(r);
        crispRect(ctx, r);
        continue;
      }
      const path = index.paths.get(id);
      if (path) rects.push(screenRect(F, pathRect(path), 6));
    }
    ctx.strokeStyle = F.p.accent;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (!rects.length) return;
    if (rects.length === 1) {
      handles(F, rects[0]!);
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    const g = { x: x0 - 6, y: y0 - 6, w: x1 - x0 + 12, h: y1 - y0 + 12 };
    ctx.beginPath();
    crispRect(ctx, g);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = F.p.accent;
    ctx.stroke();
    ctx.setLineDash([]);
    handles(F, g);
  }

  function drawPreviews(F: Frame, scene: Scene): void {
    const { overlay } = scene;
    const ctx = F.ctx;
    const p = F.p;
    if (overlay.ghost) {
      const ghost: Part = { id: '\u0000ghost', type: overlay.ghost.type, x: overlay.ghost.x, y: overlay.ghost.y, rot: 0, flip: false };
      const GF: Frame = { ...F, snap: null };
      ctx.globalAlpha = 0.5;
      drawPartBodies(GF, [ghost]);
      drawLeads(GF, [ghost]);
      drawPins(GF, [ghost]);
      drawPartText(GF, [ghost]);
      ctx.globalAlpha = 1;
    }
    if (overlay.wirePreview && overlay.wirePreview.length > 1) {
      const path = new Path2D();
      const pts = overlay.wirePreview;
      path.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) path.lineTo(pts[i]!.x, pts[i]!.y);
      world(F);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = p.accent;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = F.wireW * 3;
      ctx.stroke(path);
      ctx.globalAlpha = 1;
      ctx.lineWidth = F.wireW;
      ctx.setLineDash([0.4, 0.3]);
      ctx.stroke(path);
      ctx.setLineDash([]);
      const end = pts[pts.length - 1]!;
      ctx.beginPath();
      ctx.arc(end.x, end.y, Math.max(0.2, 3 / F.s), 0, TAU);
      ctx.fillStyle = p.accent;
      ctx.fill();
    }
    if (overlay.hoverPin) {
      const { x, y } = overlay.hoverPin;
      world(F);
      const r = Math.max(0.36, 6 / F.s);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = p.accent;
      ctx.globalAlpha = 0.22;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = Math.max(0.1, 2 / F.s);
      ctx.stroke();
    }
    if (overlay.box) {
      screen(F);
      const r = screenRect(F, overlay.box, 0);
      ctx.beginPath();
      crispRect(ctx, r);
      ctx.fillStyle = p.accentFill;
      ctx.fill();
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawFlashes(F: Frame, scene: Scene, reduce: boolean): boolean {
    const ids = scene.overlay.flashIds;
    if (!ids?.length) return false;
    const ctx = F.ctx;
    const a = reduce ? 1 : pulse(scene.time);
    device(F);
    ctx.fillStyle = F.p.accent;
    ctx.globalAlpha = 0.25 + 0.45 * a;
    for (const id of ids) {
      const path = scene.index.paths.get(id);
      if (path) fillPath(F, path, F.wireW + (8 + 6 * a) / F.s);
    }
    screen(F);
    ctx.beginPath();
    for (const id of ids) {
      const part = scene.index.parts.get(id);
      if (!part) continue;
      const r = screenRect(F, bodyRectWith(P, part), 6 + 3 * a);
      ctx.roundRect(r.x, r.y, r.w, r.h, 8);
    }
    ctx.strokeStyle = F.p.accent;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.35 + 0.65 * a;
    ctx.stroke();
    ctx.globalAlpha = 1;
    return !reduce;
  }

  /** Pulsing red rings on pins with contention (solid, filled) or unstable nets (dashed). */
  function drawDiagnostics(F: Frame, scene: Scene, reduce: boolean): boolean {
    const snap = scene.snapshot;
    if (!snap || (!snap.contentionPins.length && !snap.unstablePins.length)) return false;
    const ctx = F.ctx;
    world(F);
    const a = reduce ? 1 : pulse(scene.time);
    const r = Math.max(0.42, 7 / F.s) + (reduce ? 0 : 0.18 * a);
    const ring = (keys: readonly string[]): Path2D => {
      const path = new Path2D();
      for (const key of keys) {
        const cut = key.lastIndexOf(':');
        const part = scene.index.parts.get(key.slice(0, cut));
        if (!part) continue;
        const pin = geomOf(part).pins.find((q) => q.name === key.slice(cut + 1));
        if (!pin) continue;
        P.set(part);
        const x = P.X(pin.x, pin.y);
        const y = P.Y(pin.x, pin.y);
        if (!inView(F.view, x, y)) continue;
        path.moveTo(x + r, y);
        path.arc(x, y, r, 0, TAU);
      }
      return path;
    };
    ctx.strokeStyle = F.p.danger;
    ctx.fillStyle = F.p.danger;
    ctx.lineWidth = Math.max(0.1, 2 / F.s);
    const contention = ring(snap.contentionPins);
    ctx.globalAlpha = 0.2 * a;
    ctx.fill(contention);
    ctx.globalAlpha = 0.5 + 0.5 * a;
    ctx.stroke(contention);
    ctx.setLineDash([0.18, 0.14]);
    ctx.stroke(ring(snap.unstablePins));
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    return !reduce;
  }

  return {
    get animating() {
      return animating;
    },
    resize(w, h, ratio) {
      dpr = ratio || 1;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      main.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    draw(scene: Scene) {
      if (!atlas && typeof document !== 'undefined') atlas = new Atlas(ATLAS_SIZE);
      const p = PALETTES[scene.theme] ?? PALETTES.dark;
      const cam = scene.camera;
      const s = cam.zoom * GRID;
      const k = s * dpr;
      const margin = 1;
      const F: Frame = {
        ctx: main,
        p,
        cam,
        s,
        dpr,
        k,
        tx: -cam.x * k,
        ty: -cam.y * k,
        view: { x: cam.x - margin, y: cam.y - margin, w: scene.width / s + 2 * margin, h: scene.height / s + 2 * margin },
        snap: scene.snapshot,
        wireW: Math.max(WIRE_W, MIN_WIRE_PX / s),
        hair: Math.max(0.05, 1 / s),
      };
      const reduce = !!reducedMotion?.matches;

      settling = false;
      main.globalAlpha = 1;
      main.setLineDash([]);
      drawBackground(F, scene.width, scene.height, scene.showGrid);
      const visible = scene.index.partsIn(F.view);
      drawWires(F, scene);
      drawParts(F, visible, scene.index);
      drawPartText(F, visible);
      drawSelection(F, scene);
      const flashing = drawFlashes(F, scene, reduce);
      const diag = drawDiagnostics(F, scene, reduce);
      drawPreviews(F, scene);
      animating = flashing || diag || settling;
    },
  };
}

function pulse(time: number): number {
  return 0.5 + 0.5 * Math.sin(time / 160);
}
