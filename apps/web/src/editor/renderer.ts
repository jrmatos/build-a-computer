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
import type { Part, PartType } from '@build-a-computer/schema';
import type { BusValue, Snapshot } from '@build-a-computer/worker';
import type { Pt, Rect } from './geometry';
import type { SpatialIndex } from './hit';
import { inkOn, mix, PALETTES, type Palette } from './palette';
import { geomOf, getChipRegistry } from './parts';
import type { Renderer, Scene } from './render-types';
import { GRID } from './store';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

/** Wire stroke width in cells (never thinner than MIN_WIRE_PX on screen). */
const WIRE_W = 0.16;
const MIN_WIRE_PX = 2;
const DASH = 0.32;
/** Bus (multi-bit wire) width in cells and its minimum on screen; the darker core line is this fraction of it. */
const BUS_W = 0.34;
const MIN_BUS_PX = 4;
const BUS_CORE = 0.36;
const GAP = 0.22;

/** Zoom levels (screen pixels per cell) at which details appear. */
export const LOD = { symbols: 3.5, pins: 9, labels: 12, values: 16, captions: 22 } as const;

/** Above this many device pixels per cell, parts are drawn as vectors instead of sprites. */
const SPRITE_MAX_K = 64;
const ATLAS_SIZE = 2048;
/** Parts-layer cache tile size in device pixels, and how many tiles to keep. */
const CHUNK = 512;
const MAX_CHUNKS = 48;
/** Re-render sprites at the exact zoom once it has been still this long. */
const ZOOM_SETTLE_MS = 120;
/** When the atlas fills up, overflowing parts are drawn as vectors; it is rebuilt at most this often. */
const FULL_RESET_MS = 400;
/** Sprites bigger than this (device px per side) are drawn as vectors instead. */
const MAX_SPRITE_PX = 420;

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
const BUF_TIP = 1.58;

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
    buffer: [
      ['in', 0, 1, 0.42, 1],
      ['out', BUF_TIP, 1, 2, 1],
    ],
    tristate: [
      ['in', 0, 1, 0.42, 1],
      // The enable stub meets the triangle's lower edge.
      ['en', 1, 2, 1, 1.72 - ((1 - 0.42) / (BUF_TIP - 0.42)) * 0.72],
      ['out', BUF_TIP, 1, 2, 1],
    ],
    switch: [['out', 1.62, 1, 2, 1]],
    clock: [['out', 1.62, 1, 2, 1]],
    button: [['out', 1.62, 1, 2, 1]],
    const: [['out', 1.62, 1, 2, 1]],
    lamp: [['in', 0, 1, 0.4, 1]],
    dff: [
      ['d', 0, 0, 0.55, 0],
      ['clk', 0, 2, 0.55, 2],
      ['q', 2.3, 1, 3, 1],
    ],
  };
})();

/** Splitter and joiner bus bar: x range of the bar, in local cells. */
const BAR0 = 0.39;
const BAR1 = 0.61;
/** Block symbols (register, ALU, chips...) sit this far inside their pins. */
const BLOCK_IN = 0.5;
const BLOCK_TOP = -0.72;

const BLOCKS = new Set<PartType>([
  'register',
  'counter',
  'ram',
  'rom',
  'mux',
  'decoder',
  'adder',
  'alu',
  'regfile',
  'immgen',
  'rvalu',
  'branchcmp',
  'lsu',
  'chip',
]);
const CLOCKED = new Set<PartType>(['dff', 'register', 'counter', 'ram', 'regfile']);

/**
 * Per-part caches that also depend on the chip registry (chip pins and names):
 * dropped whenever setChipRegistry installs a new registry.
 */
function partCache<T>(): { get(part: Part): T | undefined; set(part: Part, v: T): void } {
  let reg = getChipRegistry();
  let map = new WeakMap<Part, T>();
  const check = (): void => {
    const now = getChipRegistry();
    if (now !== reg) {
      reg = now;
      map = new WeakMap();
    }
  };
  return {
    get(part) {
      check();
      return map.get(part);
    },
    set(part, v) {
      map.set(part, v);
    },
  };
}

/** Flat list [pinIndex, x0, y0, x1, y1, ...] of lead lines, in local cells. */
const leadCache = partCache<number[]>();
export function leadsOf(part: Part): number[] {
  let L = leadCache.get(part);
  if (L) return L;
  L = [];
  const g = geomOf(part);
  const table = LEADS[part.type];
  if (table) {
    for (const [name, x0, y0, x1, y1] of table) {
      const i = g.pins.findIndex((q) => q.name === name);
      if (i >= 0) L.push(i, x0, y0, x1, y1);
    }
  } else if (part.type === 'splitter' || part.type === 'joiner') {
    g.pins.forEach((q, i) => L!.push(i, q.x, q.y, q.x < 0.5 ? BAR0 : BAR1, q.y));
  } else {
    g.pins.forEach((q, i) => L!.push(i, q.x, q.y, q.x - q.dir[0] * BLOCK_IN, q.y - q.dir[1] * BLOCK_IN));
  }
  leadCache.set(part, L);
  return L;
}

/** Layout of a block symbol in local cells: outline, title, optional value readout. */
interface BlockLayout {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  shape: 'rect' | 'mux' | 'alu';
  title: string;
  /** Title position: top row, or centered when there is no readout. */
  ty: number;
  /** Value readout box (register q, RAM address and data). */
  lcd?: { x0: number; y0: number; x1: number; y1: number };
}

const NAME_CH = 0.18;

const layoutCache = partCache<BlockLayout>();
function blockLayout(part: Part): BlockLayout {
  let L = layoutCache.get(part);
  if (L) return L;
  const g = geomOf(part);
  const rows = g.body.h - 1;
  const w = g.body.w;
  const x0 = BLOCK_IN;
  const x1 = w - BLOCK_IN;
  const y0 = BLOCK_TOP;
  const y1 = rows - 1 - BLOCK_TOP;
  const pr = part.props;
  let title: string;
  switch (part.type) {
    case 'ram':
    case 'rom':
      title = `${part.type.toUpperCase()} ${2 ** (pr?.addrWidth ?? 4)}×${pr?.width ?? 8}`;
      break;
    case 'decoder': {
      const n = pr?.selectBits ?? 2;
      title = `DEC ${n}→${2 ** n}`;
      break;
    }
    case 'adder':
      title = 'ADD';
      break;
    // Phase 5 RISC-V datapath blocks (fixed 32-bit).
    case 'regfile':
      title = 'REGS 32×32';
      break;
    case 'immgen':
      title = 'IMM';
      break;
    case 'rvalu':
      title = 'ALU';
      break;
    case 'branchcmp':
      title = 'BR?';
      break;
    case 'lsu':
      title = 'LSU';
      break;
    case 'chip': {
      const def = getChipRegistry()[part.chip ?? ''];
      title = def && !def.deleted ? def.name : '?';
      break;
    }
    default:
      title = part.type.toUpperCase();
  }
  const shape = part.type === 'mux' ? 'mux' : part.type === 'alu' || part.type === 'rvalu' ? 'alu' : 'rect';
  L = { x0, x1, y0, y1, shape, title, ty: (y0 + y1) / 2 };
  const upright = part.rot === 0 || part.rot === 180;
  if (upright && (part.type === 'register' || part.type === 'counter' || part.type === 'ram' || part.type === 'rom')) {
    const nameLen = (out: boolean): number =>
      Math.max(0, ...g.pins.filter((q) => q.output === out && q.name !== 'clk').map((q) => q.name.length));
    const lx = x0 + 0.3 + nameLen(false) * NAME_CH + 0.15;
    const rx = x1 - 0.3 - nameLen(true) * NAME_CH - 0.15;
    const cy = Math.max((rows - 1) / 2, 0.22);
    L.lcd = { x0: lx, x1: Math.max(lx + 1, rx), y0: cy - 0.38, y1: cy + 0.38 };
    L.ty = Math.min(y0 + 0.38, L.lcd.y0 - 0.32);
  }
  layoutCache.set(part, L);
  return L;
}

/** Text that never changes for a part (titles, pin names, ranges), drawn into its sprite. */
interface StaticText {
  x: number;
  y: number;
  text: string;
  /** Font size in cells. */
  size: number;
  bold: boolean;
  /** 'sym' (on a gate symbol), 'block' (on a block panel), 'label' (on the tile) or 'chip' (on a chip's color). */
  color: string;
  /** Inward direction (local) for pin names: aligns the text against that edge. */
  dir?: [number, number];
  /** Smallest zoom (screen px per cell) at which it is drawn. */
  minS: number;
}

const textCache = partCache<StaticText[]>();
function staticTexts(part: Part): StaticText[] {
  let T = textCache.get(part);
  if (T) return T;
  T = [];
  const g = geomOf(part);
  const cap = CAPTION[part.type];
  if (cap) T.push({ x: cap[1], y: GCY, text: cap[0], size: 0.36, bold: true, color: 'sym', minS: LOD.captions });
  if (part.type === 'dff') {
    T.push({ x: 0.92, y: 0.02, text: 'D', size: 0.5, bold: true, color: 'sym', minS: LOD.captions });
    T.push({ x: 1.95, y: 1.02, text: 'Q', size: 0.5, bold: true, color: 'sym', minS: LOD.captions });
  } else if (part.type === 'const') {
    const w = g.pins[0]!.width;
    const v = (part.props?.value ?? 0) >>> 0;
    const text = w > 1 ? formatValue(v, 0, w, 'hex') : String(v & 1);
    T.push({ x: 0.96, y: 1, text, size: Math.min(0.5, 1.2 / (text.length * 0.6)), bold: true, color: 'label', minS: LOD.labels });
  } else if (part.type === 'splitter' || part.type === 'joiner') {
    const c = part.props?.chunk ?? 1;
    const many = g.pins.filter((q) => q.output === (part.type === 'splitter'));
    many.forEach((q, i) => {
      const lo = i * c;
      const text = c === 1 ? String(lo) : `${lo}–${lo + c - 1}`;
      T!.push({ x: q.x < 0.5 ? 0.2 : 0.8, y: q.y - 0.32, text, size: 0.28, bold: false, color: 'label', minS: LOD.captions });
    });
  } else if (BLOCKS.has(part.type)) {
    const L = blockLayout(part);
    const def = part.type === 'chip' ? getChipRegistry()[part.chip ?? ''] : undefined;
    const ink = def && !def.deleted ? 'chip' : 'block';
    T.push({ x: (L.x0 + L.x1) / 2 + (L.shape === 'alu' ? 0.15 : 0), y: L.ty, text: L.title, size: L.lcd ? 0.36 : 0.44, bold: true, color: ink, minS: 14 });
    for (const q of g.pins) {
      if (q.name === 'clk' && CLOCKED.has(part.type)) continue;
      const inward: [number, number] = [-q.dir[0], -q.dir[1]];
      T.push({
        x: q.x + inward[0] * (BLOCK_IN + 0.14),
        y: q.y + inward[1] * (BLOCK_IN + 0.14),
        text: q.name,
        size: 0.3,
        bold: false,
        color: ink,
        dir: inward,
        minS: 20,
      });
    }
  }
  textCache.set(part, T);
  return T;
}

/**
 * A value for display. Hex pads to the width and shows '?' for nibbles with
 * unknown bits; dec/signed show '?' when any bit is unknown; bin shows 'x'
 * per unknown bit. Values are unsigned up to 32 bits.
 */
export function formatValue(v: number, x: number, w: number, format: 'hex' | 'dec' | 'signed' | 'bin' = 'hex'): string {
  const mask = w >= 32 ? 0xffffffff : 2 ** w - 1;
  v = (v & mask) >>> 0;
  x = (x & mask) >>> 0;
  if (format === 'bin') {
    let s = '';
    for (let i = w - 1; i >= 0; i--) s += (x >>> i) & 1 ? 'x' : (v >>> i) & 1 ? '1' : '0';
    return s;
  }
  if (format === 'hex' || x) {
    if (format !== 'hex') return '?';
    const n = Math.ceil(w / 4);
    let s = '';
    for (let i = n - 1; i >= 0; i--) s += (x >>> (i * 4)) & 15 ? '?' : ((v >>> (i * 4)) & 15).toString(16).toUpperCase();
    return `0x${s}`;
  }
  if (format === 'signed') {
    const neg = w < 33 && v >= 2 ** (w - 1);
    return neg ? String(v - 2 ** w) : `+${v}`;
  }
  return String(v);
}

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

/** A bus on the board: path, width, bounds, and where its width marker and value label go. */
interface BusInfo {
  id: string;
  path: readonly Pt[];
  w: number;
  box: Rect;
  /** Width marker: point on the first segment and whether that segment is horizontal. */
  mx: number;
  my: number;
  mh: boolean;
  /** Value label: middle of the longest segment, and whether it is horizontal. */
  lx: number;
  ly: number;
  lh: boolean;
  /** Length of the longest segment, in cells. */
  ll: number;
  /** The label sits on the first segment (shared with the width marker): its far end. */
  first?: Pt;
}

const wireWidthCache = new WeakMap<SpatialIndex, { widths: Map<string, number>; buses: BusInfo[] }>();

/** Width in bits of every bus (the wider of its two pins; 1-bit wires are left out), and the list of buses. */
export function wireWidths(index: SpatialIndex): { widths: Map<string, number>; buses: BusInfo[] } {
  let c = wireWidthCache.get(index);
  if (c) return c;
  const widths = new Map<string, number>();
  const buses: BusInfo[] = [];
  const pinW = (ref: { part: string; pin: string }): number => {
    const part = index.parts.get(ref.part);
    return part ? (geomOf(part).pins.find((q) => q.name === ref.pin)?.width ?? 1) : 1;
  };
  for (const wire of index.board.wires) {
    const path = index.paths.get(wire.id);
    if (!path || path.length < 2) continue;
    const w = Math.max(pinW(wire.from), pinW(wire.to));
    if (w <= 1) continue;
    widths.set(wire.id, w);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let best = -1;
    let lx = 0, ly = 0, lh = true, li = 0;
    for (let i = 0; i < path.length; i++) {
      const a = path[i]!;
      x0 = Math.min(x0, a.x);
      y0 = Math.min(y0, a.y);
      x1 = Math.max(x1, a.x);
      y1 = Math.max(y1, a.y);
      const b = path[i + 1];
      if (!b) continue;
      const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      // Prefer horizontal runs for labels (text reads along them).
      const score = len * (b.y === a.y ? 1.5 : 1);
      if (score > best) {
        best = score;
        lx = (a.x + b.x) / 2;
        ly = (a.y + b.y) / 2;
        lh = b.y === a.y;
        li = i;
      }
    }
    const a = path[0]!;
    const b = path[1]!;
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const t = len ? Math.min(0.85, len * 0.5) / len : 0;
    buses.push({
      id: wire.id,
      path,
      w,
      box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      mx: a.x + (b.x - a.x) * t,
      my: a.y + (b.y - a.y) * t,
      mh: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y),
      lx,
      ly,
      lh,
      ll: lh ? best / 1.5 : best,
      first: li === 0 ? b : undefined,
    });
  }
  wireWidthCache.set(index, (c = { widths, buses }));
  return c;
}

/** Darker (dark theme) or lighter (light theme) center line of a bus. */
const busCore = (p: Palette, color: string): string => mix(color, p.board, 0.62);

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

/**
 * Everything static that changes a part's drawing besides type, rotation,
 * flip and lock: widths and other props, and for chips the definition
 * (id, version, color). Live values (switch numbers, displays) are overlays.
 */
const looksCache = new WeakMap<Part, string>();
export function looksKey(part: Part): string {
  if (part.type === 'chip') {
    const def = getChipRegistry()[part.chip ?? ''];
    return `${part.chip ?? ''}@${def?.version ?? 0}${def?.deleted ? 'x' : ''}${def?.color ?? ''}${def?.name ?? ''}`;
  }
  let k = looksCache.get(part);
  if (k === undefined) {
    const pr = part.props;
    k = pr ? `${pr.width ?? ''},${pr.chunk ?? ''},${pr.selectBits ?? ''},${pr.addrWidth ?? ''},${part.type === 'const' ? (pr.value ?? '') : ''}` : '';
    looksCache.set(part, k);
  }
  return k;
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
  let atlasResetAt = -Infinity;
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

  /** Bus stroke width in cells at this zoom. */
  const busWidth = (F: Frame): number => Math.max(BUS_W, MIN_BUS_PX / F.s, F.wireW * 1.8);

  function drawWires(F: Frame, scene: Scene): void {
    const { index, selection, overlay } = scene;
    const ctx = F.ctx;
    const p = F.p;
    const wires = F.snap?.wires;
    const { widths } = wireWidths(index);
    // Buckets 0-3: 1-bit wires (none, 0, 1, X); 4-7: buses.
    const groups: (readonly Pt[])[][] = [[], [], [], [], [], [], [], []];
    for (const [id, path] of index.paths) groups[(wires ? bucketOf(wires[id]) : 0) + (widths.has(id) ? 4 : 0)]!.push(path);
    device(F);
    const w = F.wireW;
    const bw = busWidth(F);
    const widthOf = (id: string): number => (widths.has(id) ? bw : w);

    // Halos under wires: hover, selection (opaque pre-mixed so overlaps stay even).
    const hp = overlay.hoverId && !selection.has(overlay.hoverId) ? index.paths.get(overlay.hoverId) : undefined;
    if (hp) {
      ctx.fillStyle = mix(p.board, p.accent, 0.3);
      fillPath(F, hp, widthOf(overlay.hoverId!) + 6 / F.s);
    }
    if (selection.size) {
      ctx.fillStyle = mix(p.board, p.accent, 0.5);
      for (const id of selection) {
        const path = index.paths.get(id);
        if (path) fillPath(F, path, widthOf(id) + 8 / F.s);
      }
    }

    // Glow under every wire carrying 1 (once it is wide enough to see), then the cores.
    if ((groups[2]!.length || groups[6]!.length) && F.s >= LOD.pins) {
      ctx.fillStyle = mix(p.board, p.sig1, p.glowAlpha);
      for (const path of groups[2]!) fillPath(F, path, w * 3.2);
      for (const path of groups[6]!) fillPath(F, path, bw * 2.1);
    }
    const colors = [p.wire, p.sig0, p.sig1, p.sigX];
    for (let b = 0; b < 8; b++) {
      const list = groups[b]!;
      if (!list.length) continue;
      const bus = b >= 4;
      const color = colors[b & 3]!;
      const ww = bus ? bw : w;
      const wd = Math.max(1, Math.round(ww * F.k));
      const x = (b & 3) === 3;
      if (wd <= 4) {
        hairlines(F, list, wd, color, x);
        continue;
      }
      ctx.fillStyle = color;
      if (x) for (const path of list) dashPath(F, path, ww);
      else for (const path of list) fillPath(F, path, ww);
      // Buses: a darker core line down the middle (Turing Complete style), solid states only.
      if (bus && !x && wd >= 6) {
        ctx.fillStyle = busCore(p, color);
        for (const path of list) fillPath(F, path, ww * BUS_CORE);
      }
    }

    // Junction dots, once they are big enough to read.
    if (F.s < LOD.pins) return;
    const v = F.view;
    const dots: number[][] = [[], [], [], [], [], [], [], []];
    for (const j of junctionsOf(index)) {
      if (!inView(v, j.x, j.y)) continue;
      dots[(wires ? bucketOf(wires[j.wire]) : 0) + (widths.has(j.wire) ? 4 : 0)]!.push(j.x, j.y);
    }
    const r = Math.max(w * 1.75, 2.5 / F.s);
    const rb = Math.max(bw * 0.95, r);
    const dotColors = [p.wire, p.sig0, p.sig1, p.sigX];
    for (let b = 0; b < 8; b++) if (dots[b]!.length) stampDots(F, dots[b]!, b >= 4 ? rb : r, dotColors[b & 3]!, null);
  }

  /**
   * Bus annotations in screen space: a schematic width marker (a slash and
   * the bit count) near the start of every bus, and once zoomed in, the live
   * value in a pill at the middle of its longest run.
   */
  function drawBusText(F: Frame, scene: Scene): void {
    if (F.s < LOD.labels) return;
    const { buses } = wireWidths(scene.index);
    if (!buses.length) return;
    const ctx = F.ctx;
    const p = F.p;
    const v = F.view;
    const snap = F.snap;
    screen(F);
    const seen: BusInfo[] = [];
    const markers: BusInfo[] = [];
    const at = new Set<string>();
    for (const b of buses) {
      if (b.box.x > v.x + v.w || b.box.x + b.box.w < v.x || b.box.y > v.y + v.h || b.box.y + b.box.h < v.y) continue;
      seen.push(b);
      // Fan-out from one pin: one marker.
      const key = `${b.mx},${b.my}`;
      if (!at.has(key)) {
        at.add(key);
        markers.push(b);
      }
    }
    if (!seen.length) return;

    // Width markers.
    const slash = new Path2D();
    const half = Math.max(3.5, Math.min(7, 0.3 * F.s));
    for (const b of markers) {
      const x = sx(F, b.mx);
      const y = sy(F, b.my);
      slash.moveTo(x - half * 0.6, y + half);
      slash.lineTo(x + half * 0.6, y - half);
    }
    ctx.strokeStyle = p.label;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.stroke(slash);
    ctx.fillStyle = p.label;
    ctx.font = `600 ${Math.round(Math.max(9, Math.min(12, 0.42 * F.s)))}px ${MONO}`;
    for (const b of markers) {
      const x = sx(F, b.mx);
      const y = sy(F, b.my);
      if (b.mh) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(b.w), x + half * 0.6 + 1, y - 2);
      } else {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(b.w), x + half + 2, y - half * 0.4);
      }
    }

    // Live values.
    if (!snap || F.s < LOD.values) return;
    const px = Math.round(Math.max(10, Math.min(13, 0.48 * F.s)));
    ctx.font = `700 ${px}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pills: { x: number; y: number; w: number; text: string; state: number }[] = [];
    for (const b of seen) {
      const val = snap.buses[b.id];
      if (!val) continue;
      const text = formatValue(val.v, val.x, b.w, 'hex');
      const tw = text.length * px * 0.62 + 10;
      const need = (b.lh ? tw : px + 6) / 2 + 4;
      let x = sx(F, b.lx);
      let y = sy(F, b.ly);
      if (b.first) {
        // Sharing the first segment with the width marker: center the pill
        // between the marker and the segment's far end, or skip it.
        const mx = sx(F, b.mx);
        const my = sy(F, b.my);
        const ex = sx(F, b.first.x);
        const ey = sy(F, b.first.y);
        const room = Math.abs(ex - mx) + Math.abs(ey - my) - 14;
        if (room < 2 * need) continue;
        const t = (14 + room / 2) / (room + 14);
        x = mx + (ex - mx) * t;
        y = my + (ey - my) * t;
      } else if (b.ll * F.s < 2 * need + 8) continue;
      pills.push({ x, y, w: tw, text, state: val.x ? 3 : val.v ? 2 : 1 });
    }
    const colors = [p.wire, p.sig0, p.sig1, p.sigX];
    const ph = px + 6;
    for (let st = 1; st <= 3; st++) {
      const path = new Path2D();
      let any = false;
      for (const q of pills) {
        if (q.state !== st) continue;
        any = true;
        path.roundRect(Math.round(q.x - q.w / 2) + 0.5, Math.round(q.y - ph / 2) + 0.5, Math.round(q.w), ph, ph / 2);
      }
      if (!any) continue;
      ctx.fillStyle = p.board;
      ctx.fill(path);
      ctx.strokeStyle = colors[st]!;
      ctx.lineWidth = 1.5;
      if (st === 3) ctx.setLineDash([3, 2]);
      ctx.stroke(path);
      ctx.setLineDash([]);
      ctx.fillStyle = st === 1 ? p.label : colors[st]!;
      for (const q of pills) if (q.state === st) ctx.fillText(q.text, q.x, q.y + 0.5);
    }
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
    const bars = new Path2D();
    const lcds = new Path2D();
    const lcdX = new Path2D();
    const missing = new Path2D();
    const blocks = new Path2D();
    const blockInk = new Path2D();
    const chipFills = new Map<string, Path2D>();
    let anyLocked = false;
    let anyHalo = false;
    let anyStriped = false;
    let anyLcdX = false;

    const radius = 0.2;
    const inset = 0.08;

    /** Rounded rectangle from local corners, added to `path` in world cells. */
    const box = (path: Path2D, x0: number, y0: number, x1: number, y1: number, r: number): void => {
      const ax = P.X(x0, y0);
      const ay = P.Y(x0, y0);
      const bx = P.X(x1, y1);
      const by = P.Y(x1, y1);
      path.roundRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay), r);
    };

    for (const part of parts) {
      const body = bodyRectWith(P, part);
      const thin = part.type === 'splitter' || part.type === 'joiner';
      const x = body.x + inset;
      const y = body.y + inset;
      const w = body.w - 2 * inset;
      const h = body.h - 2 * inset;

      if (!thin) {
        shadow.roundRect(x, y + 0.12, w, h, radius);
        tiles.roundRect(x, y, w, h, radius);
      }
      if (part.locked) {
        anyLocked = true;
        if (thin) box(lockedEdge, BAR0 - 0.12, body.y + 0.2, BAR1 + 0.12, body.y + body.h - 0.2, 0.12);
        else lockedEdge.roundRect(x, y, w, h, radius);
        if (s >= LOD.captions && !thin) {
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
      const wide = (geomOf(part).pins[0]?.width ?? 1) > 1;
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
        case 'buffer':
        case 'tristate':
          P.M(0.42, 0.28).L(BUF_TIP, 1).L(0.42, 1.72).Z();
          break;
        case 'dff': {
          P.M(0.55, -0.22).L(2.3, -0.22).L(2.3, 2.22).L(0.55, 2.22).Z();
          P.t = inkLine;
          P.M(0.55, 1.68).L(0.95, 2).L(0.55, 2.32);
          break;
        }
        case 'switch': {
          if (wide) {
            // Number input: a value well; the digits are drawn live on top.
            box(insets, 0.24, 0.5, 1.62, 1.5, 0.14);
            break;
          }
          const on = snap ? switchesOn(snap).has(part.id) : !!part.on;
          P.t = on ? lit : insets;
          P.M(0.74, 0.64).L(1.26, 0.64).A(1.26, 1, 0.36, -HALF_PI, HALF_PI).L(0.74, 1.36).A(0.74, 1, 0.36, HALF_PI, 3 * HALF_PI).Z();
          P.t = knobs;
          P.O(on ? 1.26 : 0.74, 1, 0.27);
          break;
        }
        case 'const':
          box(insets, 0.3, 0.56, 1.62, 1.44, 0.12);
          break;
        case 'button': {
          const down = snap?.pins[pinKeys(part)[0]!] === 1;
          P.t = insets;
          P.O(1, 1, 0.6);
          if (down) {
            P.t = halo;
            P.O(1, 1, 0.9);
            anyHalo = true;
            P.t = lit;
            P.O(1, 1, 0.38);
          } else {
            P.t = knobs;
            P.O(1, 1, 0.44);
          }
          break;
        }
        case 'lamp': {
          const v = snap?.pins[pinKeys(part)[0]!];
          if (wide) {
            box(lcds, 0.4, 0.34, 1.86, 1.66, 0.12);
            if (v === 2) {
              anyLcdX = true;
              box(lcdX, 0.4, 0.34, 1.86, 1.66, 0.12);
            }
            break;
          }
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
        case 'splitter':
        case 'joiner': {
          const g = geomOf(part);
          const ys = g.pins.map((q) => q.y);
          box(bars, BAR0, Math.min(...ys) - 0.4, BAR1, Math.max(...ys) + 0.4, 0.08);
          break;
        }
        default: {
          if (!BLOCKS.has(part.type)) break;
          const L = blockLayout(part);
          const def = part.type === 'chip' ? getChipRegistry()[part.chip ?? ''] : undefined;
          P.t = blocks;
          if (part.type === 'chip') {
            if (!def || def.deleted) P.t = missing;
            else {
              const c = def.color ?? p.chip;
              let path = chipFills.get(c);
              if (!path) chipFills.set(c, (path = new Path2D()));
              P.t = path;
            }
          }
          if (L.shape === 'rect') box(P.t, L.x0, L.y0, L.x1, L.y1, part.type === 'chip' ? 0.22 : 0.08);
          else if (L.shape === 'mux') {
            const t = Math.min(0.7, (L.y1 - L.y0) * 0.2);
            P.M(L.x0, L.y0).L(L.x1, L.y0 + t).L(L.x1, L.y1 - t).L(L.x0, L.y1).Z();
          } else {
            // ALU: classic chevron with a notch between the two operands.
            const t = 0.4;
            const ny = 0.5;
            P.M(L.x0, L.y0).L(L.x1, L.y0 + t).L(L.x1, L.y1 - t).L(L.x0, L.y1).L(L.x0, ny + 0.32).L(L.x0 + 0.42, ny).L(L.x0, ny - 0.32).Z();
          }
          if (L.lcd) box(lcds, L.lcd.x0, L.lcd.y0, L.lcd.x1, L.lcd.y1, 0.1);
          if (CLOCKED.has(part.type)) {
            const clk = geomOf(part).pins.find((q) => q.name === 'clk');
            if (clk) {
              P.t = blockInk;
              P.M(L.x0, clk.y - 0.3).L(L.x0 + 0.38, clk.y).L(L.x0, clk.y + 0.3);
            }
          }
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
    ctx.fill(bars);
    ctx.strokeStyle = p.symbolStroke;
    ctx.lineWidth = Math.max(0.07, 1.25 / s);
    ctx.stroke(sym);
    ctx.lineWidth = Math.max(0.1, 1.5 / s);
    ctx.stroke(symLine);

    ctx.fillStyle = p.blockFill;
    ctx.fill(blocks);
    ctx.strokeStyle = p.blockStroke;
    ctx.lineWidth = Math.max(0.06, 1.25 / s);
    ctx.stroke(blocks);
    ctx.strokeStyle = p.blockText;
    ctx.stroke(blockInk);

    for (const [c, path] of chipFills) {
      ctx.fillStyle = c;
      ctx.fill(path);
      ctx.strokeStyle = mix(c, '#000000', 0.3);
      ctx.lineWidth = Math.max(0.06, 1.25 / s);
      ctx.stroke(path);
    }
    ctx.fillStyle = p.inset;
    ctx.fill(missing);
    ctx.strokeStyle = p.danger;
    ctx.setLineDash([0.25, 0.18]);
    ctx.lineWidth = Math.max(0.06, 1.25 / s);
    ctx.stroke(missing);
    ctx.setLineDash([]);

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
    ctx.fillStyle = p.lcd;
    ctx.fill(lcds);
    ctx.strokeStyle = p.lcdEdge;
    ctx.stroke(lcds);
    if (anyLcdX) {
      ctx.strokeStyle = p.sigX;
      ctx.lineWidth = Math.max(0.07, 1.5 / s);
      ctx.setLineDash([0.2, 0.14]);
      ctx.stroke(lcdX);
      ctx.setLineDash([]);
      ctx.lineWidth = F.hair;
    }
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

  /**
   * Text that is part of a symbol (gate captions, block titles, pin names,
   * splitter ranges, const values), upright in device pixels. Drawn into
   * sprites, so it costs nothing per frame.
   */
  function drawStaticText(F: Frame, parts: readonly Part[]): void {
    if (F.s < LOD.labels) return;
    const ctx = F.ctx;
    const p = F.p;
    device(F);
    let font = '';
    for (const part of parts) {
      const T = staticTexts(part);
      if (!T.length) continue;
      P.set(part);
      let chipInk = '';
      if (part.type === 'chip') chipInk = inkOn(getChipRegistry()[part.chip ?? '']?.color ?? p.chip);
      for (const t of T) {
        if (F.s < t.minS) continue;
        const f = `${t.bold ? 700 : 500} ${(t.size * F.k).toFixed(1)}px ${MONO}`;
        if (f !== font) ctx.font = font = f;
        ctx.fillStyle = t.color === 'sym' ? p.symbolText : t.color === 'chip' ? chipInk : t.color === 'block' ? p.blockText : p.label;
        const X = P.X(t.x, t.y) * F.k + F.tx;
        const Y = P.Y(t.x, t.y) * F.k + F.ty;
        if (t.dir) {
          // Align against the edge the pin is on, whatever the rotation.
          const dx = P.a * t.dir[0] + P.c * t.dir[1];
          const dy = P.b * t.dir[0] + P.d * t.dir[1];
          ctx.textAlign = dx > 0.5 ? 'left' : dx < -0.5 ? 'right' : 'center';
          ctx.textBaseline = dy > 0.5 ? 'top' : dy < -0.5 ? 'bottom' : 'middle';
        } else {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
        }
        ctx.fillText(t.text, X, Y + 0.5);
      }
    }
  }

  /* ---------------- parts: sprites ---------------- */

  function spriteFor(F: Frame, part: Part): Slot | null {
    const a = atlas!;
    const state = spriteState(part, F.snap);
    const key = `${part.type}|${part.rot}|${part.flip ? 1 : 0}|${part.locked ? 1 : 0}|${looksKey(part)}|${state}`;
    const hit = a.slots.get(key);
    if (hit) return hit;
    if (a.full) return null;
    const clone: Part = {
      id: SPRITE_ID,
      type: part.type,
      x: 0,
      y: 0,
      rot: part.rot,
      flip: part.flip,
      locked: part.locked,
      props: part.props,
      chip: part.chip,
    };
    const ext = spriteExtent(clone);
    const ox = ext.x;
    const oy = ext.y;
    const w = Math.ceil(ext.w * F.k) + 2;
    const h = Math.ceil(ext.h * F.k) + 2;
    // Huge sprites (big blocks, close up) would crowd out everything else: draw those as vectors.
    if (w > MAX_SPRITE_PX || h > MAX_SPRITE_PX) return null;
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
    drawStaticText(SF, [clone]);
    const slot = { x: at.x, y: at.y, w, h, ox, oy };
    a.slots.set(key, slot);
    return slot;
  }

  /** World rectangle (relative to the part origin) a part's sprite covers: body, pins and side labels. */
  function spriteExtent(part: Part): Rect {
    const g = geomOf(part);
    let x0 = g.body.x;
    let y0 = g.body.y;
    let x1 = g.body.x + g.body.w;
    let y1 = g.body.y + g.body.h;
    for (const q of g.pins) {
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y);
      y1 = Math.max(y1, q.y);
    }
    if (part.type === 'splitter' || part.type === 'joiner') {
      // Range labels overhang the pins.
      x0 -= 0.3;
      x1 += 0.3;
    }
    P.set(part);
    const ax = P.X(x0, y0);
    const ay = P.Y(x0, y0);
    const bx = P.X(x1, y1);
    const by = P.Y(x1, y1);
    const m = SPRITE_MARGIN;
    return { x: Math.min(ax, bx) - m, y: Math.min(ay, by) - m, w: Math.abs(bx - ax) + 2 * m, h: Math.abs(by - ay) + 2 * m };
  }

  function drawParts(F: Frame, parts: readonly Part[], index: SpatialIndex): void {
    const ctx = F.ctx;
    if (F.s < LOD.symbols) {
      // Far out: flat tiles only (chips in their own color).
      world(F);
      ctx.fillStyle = F.p.tileEdge;
      let special = false;
      for (const part of parts) {
        if (part.locked || part.type === 'chip') {
          special = true;
          continue;
        }
        const r = bodyRectWith(P, part);
        ctx.fillRect(r.x + 0.15, r.y + 0.15, r.w - 0.3, r.h - 0.3);
      }
      if (special) {
        const reg = getChipRegistry();
        for (const part of parts) {
          if (!part.locked && part.type !== 'chip') continue;
          ctx.fillStyle = part.locked ? F.p.locked : (reg[part.chip ?? '']?.color ?? F.p.chip);
          const r = bodyRectWith(P, part);
          ctx.fillRect(r.x + 0.15, r.y + 0.15, r.w - 0.3, r.h - 0.3);
        }
      }
      return;
    }
    if (F.k > SPRITE_MAX_K || !atlas) {
      drawPartBodies(F, parts);
      drawLeads(F, parts);
      drawPins(F, parts);
      drawStaticText(F, parts);
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
        (atlas.full && now - atlasResetAt > FULL_RESET_MS) ||
        ratio < 0.8 ||
        ratio > 1.25 ||
        (ratio !== 1 && now - lastKChange > ZOOM_SETTLE_MS)
      ) {
        atlas.reset(F.k, F.p.board);
        atlasResetAt = now;
      }
      const scale = F.k / atlas.k;
      settling = scale !== 1;
      const fallback = drawChunks(F, index, scale);
      drawPartBodies(F, fallback);
      drawLeads(F, fallback);
      drawPins(F, fallback);
      drawStaticText(F, fallback);
      // Keep frames coming so a full atlas gets rebuilt even on a still board.
      if (atlas.full) settling = true;
    }
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

  /** Lead lines from pins to symbols, as pixel-snapped rectangles colored by the value each pin sees; bus pins get bus-thick leads. */
  function drawLeads(F: Frame, parts: readonly Part[]): void {
    if (!parts.length) return;
    const ctx = F.ctx;
    const p = F.p;
    const pins = F.snap?.pins;
    // Buckets 0-3 for 1-bit pins, 4-7 for buses.
    const leads: number[][] = [[], [], [], [], [], [], [], []];
    for (const part of parts) {
      const g = geomOf(part);
      const keys = pinKeys(part);
      const L = leadsOf(part);
      P.set(part);
      for (let j = 0; j < L.length; j += 5) {
        const i = L[j]!;
        const b = (pins ? bucketOf(pins[keys[i]!]) : 0) + (g.pins[i]!.width > 1 ? 4 : 0);
        const x0 = L[j + 1]!;
        const y0 = L[j + 2]!;
        const x1 = L[j + 3]!;
        const y1 = L[j + 4]!;
        leads[b]!.push(P.X(x0, y0), P.Y(x0, y0), P.X(x1, y1), P.Y(x1, y1));
      }
    }
    device(F);
    const colors = [p.wire, p.sig0, p.sig1, p.sigX];
    const busW = busWidth(F);
    for (let b = 0; b < 8; b++) {
      const L = leads[b]!;
      if (!L.length) continue;
      const bus = b >= 4;
      const color = colors[b & 3]!;
      // Bus leads are short: solid and a little slimmer than the bus, no core line.
      ctx.fillStyle = color;
      const w = bus ? busW * 0.8 : F.wireW;
      for (let i = 0; i < L.length; i += 4) {
        segRect(F, Math.min(L[i]!, L[i + 2]!), Math.min(L[i + 1]!, L[i + 3]!), Math.max(L[i]!, L[i + 2]!), Math.max(L[i + 1]!, L[i + 3]!), w, false);
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
    const p = F.p;
    if (s >= LOD.values) drawValues(F, parts);

    // Labels sit above the tile, upright, in monospace.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${Math.round(Math.min(15, Math.max(10, 0.55 * s)))}px ${MONO}`;
    for (const part of parts) {
      if (!part.label) continue;
      const r = bodyRectWith(P, part);
      ctx.fillStyle = part.locked ? p.locked : p.label;
      ctx.fillText(part.label, sx(F, r.x + r.w / 2), sy(F, r.y) - 5);
    }
  }

  /** Value of a pin as {w, v, x}: from busPins for buses, from pins for 1-bit pins. */
  function pinValue(snap: Snapshot, key: string, width: number): BusValue | undefined {
    if (width > 1) return snap.busPins[key];
    const b = snap.pins[key];
    return b === undefined ? undefined : { w: 1, v: b === 1 ? 1 : 0, x: b === 2 ? 1 : 0 };
  }

  /**
   * Live values drawn over the sprites each frame (screen space): number
   * inputs, multi-bit displays, register and memory readouts. Digits are
   * colored by state and never by color alone: X shows as '?'.
   */
  function drawValues(F: Frame, parts: readonly Part[]): void {
    const ctx = F.ctx;
    const p = F.p;
    const snap = F.snap;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let font = '';
    const put = (text: string, x0: number, y0: number, x1: number, y1: number, color: string, ghost: string | null, maxCells: number): void => {
      // Fit the digits to the box (local corners mapped to screen).
      const ax = P.X(x0, y0);
      const ay = P.Y(x0, y0);
      const bx = P.X(x1, y1);
      const by = P.Y(x1, y1);
      const bw = Math.abs(bx - ax) * F.s;
      const bh = Math.abs(by - ay) * F.s;
      const px = Math.min(bh * 0.66, maxCells * F.s, (bw - 4) / (text.length * 0.62));
      if (px < 6) return;
      const f = `700 ${px.toFixed(1)}px ${MONO}`;
      if (f !== font) ctx.font = font = f;
      const cx = sx(F, (ax + bx) / 2);
      const cy = sy(F, (ay + by) / 2) + 0.5;
      if (ghost) {
        ctx.fillStyle = ghost;
        ctx.fillText(text.replace(/[0-9A-F?]/g, '8'), cx, cy);
      }
      ctx.fillStyle = color;
      ctx.fillText(text, cx, cy);
    };
    const digitColor = (v: BusValue | undefined, on: string, zero: string): string =>
      !v ? zero : v.x ? p.sigX : v.v ? on : zero;

    for (const part of parts) {
      const t = part.type;
      if (t !== 'switch' && t !== 'lamp' && t !== 'register' && t !== 'counter' && t !== 'ram' && t !== 'rom') continue;
      const g = geomOf(part);
      if ((t === 'switch' || t === 'lamp') && g.pins[0]!.width <= 1) continue;
      P.set(part);
      const keys = pinKeys(part);
      if (t === 'switch') {
        const w = g.pins[0]!.width;
        const v = (snap?.switchValues[part.id] ?? part.props?.value ?? 0) >>> 0;
        put(formatValue(v, 0, w, 'hex'), 0.24, 0.5, 1.62, 1.5, v ? p.label : mix(p.label, p.tile, 0.35), null, 0.5);
      } else if (t === 'lamp') {
        const w = g.pins[0]!.width;
        const v = snap ? pinValue(snap, keys[0]!, w) : undefined;
        const text = v ? formatValue(v.v, v.x, w, part.props?.format ?? 'hex') : '–';
        put(text, 0.4, 0.34, 1.86, 1.66, digitColor(v, p.lcdOn, p.lcdZero), v ? p.lcdGhost : null, 0.62);
      } else {
        const L = blockLayout(part);
        if (!L.lcd) continue;
        const qi = g.pins.findIndex((q) => q.name === 'q');
        const q = g.pins[qi];
        if (!q) continue;
        const v = snap ? pinValue(snap, keys[qi]!, q.width) : undefined;
        let text = v ? formatValue(v.v, v.x, q.width, 'hex') : '–';
        if (v && (t === 'ram' || t === 'rom')) {
          const ai = g.pins.findIndex((r) => r.name === 'addr');
          const av = pinValue(snap!, keys[ai]!, g.pins[ai]!.width);
          text = `${av ? formatValue(av.v, av.x, g.pins[ai]!.width, 'hex').slice(2) : '?'}: ${text}`;
        }
        put(text, L.lcd.x0, L.lcd.y0, L.lcd.x1, L.lcd.y1, digitColor(v, p.lcdOn, p.lcdZero), null, 0.5);
      }
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
      drawStaticText(GF, [ghost]);
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
      drawBusText(F, scene);
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
