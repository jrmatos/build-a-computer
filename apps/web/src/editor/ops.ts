import type { Board, Part, PartType, PinRef, Rotation, Wire } from '@build-a-computer/schema';
import { boardBounds, partPins, partRect, unionRect } from './geometry';

let counter = 0;
/** Ids only need to be unique within a board; random suffix keeps pastes across tabs apart. */
export function newId(prefix: 'p' | 'w'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function addPart(board: Board, type: PartType, x: number, y: number, extra: Partial<Part> = {}): [Board, Part] {
  const part: Part = { id: newId('p'), type, x, y, rot: 0, flip: false, ...extra };
  return [{ ...board, parts: [...board.parts, part] }, part];
}

const samePin = (a: PinRef, b: PinRef) => a.part === b.part && a.pin === b.pin;

/**
 * Add a wire between two pins. Outputs become `from` so values flow forward.
 * Returns the board unchanged for a self-wire or a duplicate.
 */
export function addWire(board: Board, a: PinRef, b: PinRef, points: [number, number][] = []): [Board, Wire | undefined] {
  if (samePin(a, b)) return [board, undefined];
  if (board.wires.some((w) => (samePin(w.from, a) && samePin(w.to, b)) || (samePin(w.from, b) && samePin(w.to, a)))) {
    return [board, undefined];
  }
  const isOut = (r: PinRef) => {
    const part = board.parts.find((p) => p.id === r.part);
    return !!part && partPins(part).some((p) => p.name === r.pin && p.output);
  };
  let from = a;
  let to = b;
  let pts = points;
  if (!isOut(a) && isOut(b)) {
    [from, to] = [b, a];
    pts = [...points].reverse();
  }
  const wire: Wire = { id: newId('w'), from, to, points: pts };
  return [{ ...board, wires: [...board.wires, wire] }, wire];
}

/** Delete parts and wires by id, plus every wire attached to a deleted part. Locked parts stay. */
export function deleteIds(board: Board, ids: Set<string>): Board {
  const goneParts = new Set(board.parts.filter((p) => ids.has(p.id) && !p.locked).map((p) => p.id));
  return {
    parts: board.parts.filter((p) => !goneParts.has(p.id)),
    wires: board.wires.filter((w) => !ids.has(w.id) && !goneParts.has(w.from.part) && !goneParts.has(w.to.part)),
  };
}

/**
 * Move parts by a whole number of cells. A wire's waypoints move when the wire
 * is selected or both its ends move, so dragged groups keep their shape.
 */
export function moveIds(board: Board, ids: Set<string>, dx: number, dy: number): Board {
  if (!dx && !dy) return board;
  return {
    parts: board.parts.map((p) => (ids.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
    wires: board.wires.map((w) =>
      ids.has(w.id) || (ids.has(w.from.part) && ids.has(w.to.part))
        ? { ...w, points: w.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) }
        : w,
    ),
  };
}

/** Rotate selected parts by 90 degrees about the selection's center, like Excalidraw rotates a group. */
export function rotateIds(board: Board, ids: Set<string>, dir: 1 | -1): Board {
  const sel = board.parts.filter((p) => ids.has(p.id));
  if (!sel.length) return board;
  const r = unionRect(sel.map(partRect))!;
  const cx = Math.round(r.x + r.w / 2);
  const cy = Math.round(r.y + r.h / 2);
  const turn = (x: number, y: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    return dir === 1 ? [cx - dy, cy + dx] : [cx + dy, cy - dx];
  };
  return {
    parts: board.parts.map((p) => {
      if (!ids.has(p.id)) return p;
      const rot = (((p.rot + (dir === 1 ? 90 : 270)) % 360) as Rotation);
      if (sel.length === 1) return { ...p, rot };
      // Keep the part's pivot where the group rotation sends it.
      const before = partRect(p);
      const [nx, ny] = turn(before.x + before.w / 2, before.y + before.h / 2);
      const rotated = { ...p, rot };
      const after = partRect(rotated);
      return { ...rotated, x: p.x + Math.round(nx - (after.x + after.w / 2)), y: p.y + Math.round(ny - (after.y + after.h / 2)) };
    }),
    wires: board.wires.map((w) =>
      ids.has(w.id) || (ids.has(w.from.part) && ids.has(w.to.part))
        ? { ...w, points: w.points.map(([x, y]) => turn(x, y)) }
        : w,
    ),
  };
}

export function flipIds(board: Board, ids: Set<string>): Board {
  return { ...board, parts: board.parts.map((p) => (ids.has(p.id) ? { ...p, flip: !p.flip } : p)) };
}

export function updatePart(board: Board, id: string, patch: Partial<Part>): Board {
  return { ...board, parts: board.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

export interface Clip {
  kind: 'build-a-computer/clipboard';
  parts: Part[];
  wires: Wire[];
}

/** Copy the selected parts and the wires between them. Locked level parts are copied unlocked. */
export function copyIds(board: Board, ids: Set<string>): Clip {
  const parts = board.parts.filter((p) => ids.has(p.id)).map(({ locked: _locked, ...p }) => p);
  const keep = new Set(parts.map((p) => p.id));
  const wires = board.wires.filter((w) => keep.has(w.from.part) && keep.has(w.to.part));
  return { kind: 'build-a-computer/clipboard', parts, wires };
}

/**
 * Paste a clip centered on (x, y) with fresh ids. Parts outside `allowed`
 * are dropped and reported (E-DATA-07).
 */
export function pasteClip(
  board: Board,
  clip: Clip,
  x: number,
  y: number,
  allowed?: ReadonlySet<PartType>,
): { board: Board; ids: string[]; dropped: PartType[] } {
  const dropped = new Set<PartType>();
  const parts = clip.parts.filter((p) => {
    if (allowed && !allowed.has(p.type)) {
      dropped.add(p.type);
      return false;
    }
    return true;
  });
  const src: Board = { parts, wires: clip.wires };
  const b = boardBounds(src);
  const dx = b ? Math.round(x - (b.x + b.w / 2)) : 0;
  const dy = b ? Math.round(y - (b.y + b.h / 2)) : 0;
  const idMap = new Map<string, string>();
  const newParts = parts.map((p) => {
    const id = newId('p');
    idMap.set(p.id, id);
    return { ...p, id, x: p.x + dx, y: p.y + dy };
  });
  const newWires = clip.wires
    .filter((w) => idMap.has(w.from.part) && idMap.has(w.to.part))
    .map((w) => ({
      ...w,
      id: newId('w'),
      from: { ...w.from, part: idMap.get(w.from.part)! },
      to: { ...w.to, part: idMap.get(w.to.part)! },
      points: w.points.map(([px, py]) => [px + dx, py + dy] as [number, number]),
    }));
  return {
    board: { parts: [...board.parts, ...newParts], wires: [...board.wires, ...newWires] },
    ids: [...newParts.map((p) => p.id), ...newWires.map((w) => w.id)],
    dropped: [...dropped],
  };
}

/** Duplicate in place with an offset, like Excalidraw's Ctrl+D. */
export function duplicateIds(board: Board, ids: Set<string>, offset = 2): { board: Board; ids: string[] } {
  const clip = copyIds(board, ids);
  const b = boardBounds({ parts: clip.parts, wires: clip.wires });
  if (!b) return { board, ids: [] };
  const r = pasteClip(board, clip, b.x + b.w / 2 + offset, b.y + b.h / 2 + offset);
  return { board: r.board, ids: r.ids };
}
