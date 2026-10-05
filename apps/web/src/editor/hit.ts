import type { Board, Part, PinRef } from '@build-a-computer/schema';
import { distToSegment, partPins, partRect, rectContains, rectsIntersect, wirePath, type Pt, type Rect } from './geometry';

const CELL = 8;

export type Hit =
  | { kind: 'pin'; ref: PinRef; x: number; y: number; output: boolean }
  | { kind: 'part'; id: string }
  | { kind: 'wire'; id: string };

/**
 * Spatial index over parts and wire segments: a uniform hash grid in world
 * cells. Rebuilt when the board object changes (boards are immutable).
 */
export class SpatialIndex {
  private readonly buckets = new Map<string, { parts: Part[]; wires: string[] }>();
  readonly parts: Map<string, Part>;
  readonly paths = new Map<string, Pt[]>();

  constructor(readonly board: Board) {
    this.parts = new Map(board.parts.map((p) => [p.id, p]));
    for (const p of board.parts) this.insert(partRect(p), (b) => b.parts.push(p));
    for (const w of board.wires) {
      const path = wirePath(board, w, this.parts);
      if (!path) continue;
      this.paths.set(w.id, path);
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i]!;
        const b = path[i + 1]!;
        this.insert({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }, (bk) => {
          if (bk.wires[bk.wires.length - 1] !== w.id) bk.wires.push(w.id);
        });
      }
    }
  }

  private insert(r: Rect, add: (b: { parts: Part[]; wires: string[] }) => void): void {
    for (let cx = Math.floor((r.x - 1) / CELL); cx <= Math.floor((r.x + r.w + 1) / CELL); cx++) {
      for (let cy = Math.floor((r.y - 1) / CELL); cy <= Math.floor((r.y + r.h + 1) / CELL); cy++) {
        const key = `${cx},${cy}`;
        let b = this.buckets.get(key);
        if (!b) this.buckets.set(key, (b = { parts: [], wires: [] }));
        add(b);
      }
    }
  }

  private near(p: Pt): { parts: Part[]; wires: string[] } {
    return this.buckets.get(`${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`) ?? { parts: [], wires: [] };
  }

  /**
   * What is under the point? Pins win over parts, parts over wires. Among
   * overlapping parts the topmost (last drawn) wins. `tol` is in grid cells.
   */
  hit(p: Pt, tol: number): Hit | undefined {
    const { parts, wires } = this.near(p);
    let best: { d: number; pin: Hit } | undefined;
    for (const part of parts) {
      for (const pin of partPins(part)) {
        const d = Math.hypot(pin.wx - p.x, pin.wy - p.y);
        if (d <= Math.max(0.45, tol) && (!best || d < best.d)) {
          best = { d, pin: { kind: 'pin', ref: { part: part.id, pin: pin.name }, x: pin.wx, y: pin.wy, output: pin.output } };
        }
      }
    }
    if (best) return best.pin;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (rectContains(partRect(parts[i]!), p)) return { kind: 'part', id: parts[i]!.id };
    }
    for (const id of [...new Set(wires)].reverse()) {
      const path = this.paths.get(id)!;
      for (let i = 0; i < path.length - 1; i++) {
        if (distToSegment(p, path[i]!, path[i + 1]!) <= Math.max(0.3, tol)) return { kind: 'wire', id };
      }
    }
    return undefined;
  }

  /** Ids of parts and wires fully inside the rectangle (Excalidraw box-select rule). */
  inside(r: Rect): string[] {
    const ids: string[] = [];
    for (const p of this.board.parts) {
      const pr = partRect(p);
      if (pr.x >= r.x && pr.y >= r.y && pr.x + pr.w <= r.x + r.w && pr.y + pr.h <= r.y + r.h) ids.push(p.id);
    }
    for (const [id, path] of this.paths) if (path.every((pt) => rectContains(r, pt))) ids.push(id);
    return ids;
  }

  /** Parts whose body touches the rectangle; used for viewport culling. */
  partsIn(r: Rect): Part[] {
    return this.board.parts.filter((p) => rectsIntersect(partRect(p), r));
  }
}
