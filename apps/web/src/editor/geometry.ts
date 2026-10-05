import type { Board, Part, PinRef, Wire } from '@ground-up/schema';
import { GEOMETRY, type PinGeom } from './parts';

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Map a point local to the part into world grid cells: flip, rotate about the pivot, translate. */
export function toWorld(part: Part, lx: number, ly: number): Pt {
  const [px, py] = GEOMETRY[part.type].pivot;
  let dx = (part.flip ? 2 * px - lx : lx) - px;
  let dy = ly - py;
  for (let r = 0; r < part.rot; r += 90) [dx, dy] = [-dy, dx];
  return { x: part.x + px + dx, y: part.y + py + dy };
}

/** Rotate and flip a direction vector the same way as toWorld. */
export function dirToWorld(part: Part, d: [number, number]): [number, number] {
  let dx = part.flip ? -d[0] : d[0];
  let dy = d[1];
  for (let r = 0; r < part.rot; r += 90) [dx, dy] = [-dy, dx];
  return [dx, dy];
}

export interface WorldPin extends PinGeom {
  part: Part;
  wx: number;
  wy: number;
  wdir: [number, number];
}

export function partPins(part: Part): WorldPin[] {
  return GEOMETRY[part.type].pins.map((pin) => {
    const w = toWorld(part, pin.x, pin.y);
    return { ...pin, part, wx: w.x, wy: w.y, wdir: dirToWorld(part, pin.dir) };
  });
}

export function pinPos(board: Board, ref: PinRef, parts?: Map<string, Part>): WorldPin | undefined {
  const part = parts ? parts.get(ref.part) : board.parts.find((p) => p.id === ref.part);
  if (!part) return undefined;
  return partPins(part).find((p) => p.name === ref.pin);
}

/** World-space bounding box of a part body. */
export function partRect(part: Part): Rect {
  const b = GEOMETRY[part.type].body;
  const a = toWorld(part, b.x, b.y);
  const c = toWorld(part, b.x + b.w, b.y + b.h);
  return { x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y) };
}

/**
 * Orthogonal route through the wire's waypoints. A direct pin-to-pin wire
 * between two horizontal pins goes out, across at the midpoint, and in;
 * otherwise each leg turns once.
 */
export function routeWire(
  a: Pt,
  aDir: [number, number] | undefined,
  b: Pt,
  bDir: [number, number] | undefined,
  waypoints: readonly (readonly [number, number])[],
): Pt[] {
  const pts: Pt[] = [a, ...waypoints.map(([x, y]) => ({ x, y })), b];
  const out: Pt[] = [a];
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    if (p.x !== q.x && p.y !== q.y) {
      const first = i === 0;
      const last = i === pts.length - 2;
      const aHoriz = !aDir || aDir[0] !== 0;
      const bHoriz = !bDir || bDir[0] !== 0;
      if (first && last && aHoriz && bHoriz) {
        const mx = Math.round((p.x + q.x) / 2);
        out.push({ x: mx, y: p.y }, { x: mx, y: q.y });
      } else if (first && !last) {
        out.push(aHoriz ? { x: q.x, y: p.y } : { x: p.x, y: q.y });
      } else if (last) {
        out.push(bHoriz ? { x: p.x, y: q.y } : { x: q.x, y: p.y });
      } else {
        out.push({ x: q.x, y: p.y });
      }
    }
    out.push(q);
  }
  return dedupe(out);
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    // Drop a middle point that lies on a straight line.
    const prev = out[out.length - 2];
    if (prev && last && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

export function wirePath(board: Board, wire: Wire, parts: Map<string, Part>): Pt[] | undefined {
  const a = pinPos(board, wire.from, parts);
  const b = pinPos(board, wire.to, parts);
  if (!a || !b) return undefined;
  return routeWire({ x: a.wx, y: a.wy }, a.wdir, { x: b.wx, y: b.wy }, b.wdir, wire.points);
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function rectContains(r: Rect, p: Pt): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function unionRect(rects: Rect[]): Rect | undefined {
  if (!rects.length) return undefined;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function normRect(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Bounds of everything given: parts and wire paths. */
export function boardBounds(board: Board, ids?: Set<string>): Rect | undefined {
  const parts = new Map(board.parts.map((p) => [p.id, p]));
  const rects: Rect[] = [];
  for (const p of board.parts) if (!ids || ids.has(p.id)) rects.push(partRect(p));
  for (const w of board.wires) {
    if (ids && !ids.has(w.id)) continue;
    const path = wirePath(board, w, parts);
    if (path) rects.push(unionRect(path.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!);
  }
  return unionRect(rects);
}
