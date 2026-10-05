import type { Board, Level, Part } from '@ground-up/schema';
import { pinsOf } from '@ground-up/sim-logic';
import { geomOf } from '../editor/parts';
import { partRect } from '../editor/geometry';

/**
 * "Show solution" (ADR-007): load a level's reference solution, laid out so a
 * player can read it. Reference boards are built in code on a plain grid; here
 * parts go into columns by logic depth between the level's inputs and outputs,
 * each column ordered to follow its drivers, and wires route themselves.
 */
export async function loadSolution(level: Level): Promise<Board | undefined> {
  // Its own chunk: solutions never ship in the first-level bundle.
  const { referenceSolution } = await import('@ground-up/content/solutions');
  const board = referenceSolution(level);
  return board ? layoutSolution(board) : undefined;
}

const GAP_X = 3;
const GAP_Y = 2;

export function layoutSolution(board: Board): Board {
  const byId = new Map(board.parts.map((p) => [p.id, p]));
  const outPins = new Map(board.parts.map((p) => [p.id, new Set(pinsOf(p).filter((q) => q.dir === 'out').map((q) => q.name))]));

  // Driver -> reader edges, whichever way each wire was drawn.
  const preds = new Map<string, Set<string>>();
  for (const w of board.wires) {
    const fromIsOut = outPins.get(w.from.part)?.has(w.from.pin);
    const [src, dst] = fromIsOut ? [w.from.part, w.to.part] : [w.to.part, w.from.part];
    if (src === dst) continue;
    if (!preds.has(dst)) preds.set(dst, new Set());
    preds.get(dst)!.add(src);
  }

  // Longest path from the inputs, ignoring edges that close a loop (latches).
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const part = byId.get(id);
    if (!part || part.locked) return 0;
    visiting.add(id);
    let d = 1;
    for (const p of preds.get(id) ?? []) if (!visiting.has(p)) d = Math.max(d, depthOf(p) + 1);
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  const free = board.parts.filter((p) => !p.locked);
  for (const p of free) depthOf(p.id);

  const locked = board.parts.filter((p) => p.locked);
  const lockedRects = locked.map((p) => ({ p, r: partRect(p) }));
  const isSource = (p: Part) => pinsOf(p).every((q) => q.dir === 'out');
  const sources = lockedRects.filter(({ p }) => isSource(p));
  const sinks = lockedRects.filter(({ p }) => !isSource(p));
  const left = sources.length ? Math.max(...sources.map(({ r }) => r.x + r.w)) : -10;
  const midY = lockedRects.length ? lockedRects.reduce((s, { r }) => s + r.y + r.h / 2, 0) / lockedRects.length : 0;

  // Columns of free parts by depth.
  const columns = new Map<number, Part[]>();
  for (const p of free) {
    const d = depth.get(p.id) ?? 1;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(p);
  }

  const placed = new Map<string, Part>(locked.map((p) => [p.id, p]));
  const centerY = (id: string): number | undefined => {
    const p = placed.get(id);
    if (!p) return undefined;
    const r = partRect(p);
    return r.y + r.h / 2;
  };

  let x = Math.ceil(left) + GAP_X + 1;
  for (const d of [...columns.keys()].sort((a, b) => a - b)) {
    const col = columns.get(d)!;
    // Order by the average height of each part's drivers (barycenter), so wires cross less.
    const want = (p: Part) => {
      const ys = [...(preds.get(p.id) ?? [])].map(centerY).filter((y): y is number => y !== undefined);
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : midY;
    };
    col.sort((a, b) => want(a) - want(b));
    const sizes = col.map((p) => geomOf({ ...p, rot: 0, flip: false }).body);
    const total = sizes.reduce((s, b) => s + b.h, 0) + GAP_Y * (col.length - 1);
    const colCenter = col.reduce((s, p) => s + want(p), 0) / col.length;
    let y = colCenter - total / 2;
    let widest = 0;
    col.forEach((p, i) => {
      const body = sizes[i]!;
      // Origin so the body's top-left lands at (x, y), on whole cells.
      const np: Part = { ...p, rot: 0, flip: false, x: Math.round(x - body.x), y: Math.round(y - body.y) };
      placed.set(p.id, np);
      y += body.h + GAP_Y;
      widest = Math.max(widest, body.w);
    });
    x += widest + GAP_X + 1;
  }

  // Outputs move right only if the solution needs more room than the starter left.
  const sinkLeft = sinks.length ? Math.min(...sinks.map(({ r }) => r.x)) : x;
  const shift = Math.max(0, Math.ceil(x + GAP_X - sinkLeft));
  if (shift) for (const { p } of sinks) placed.set(p.id, { ...p, x: p.x + shift });

  return {
    parts: board.parts.map((p) => placed.get(p.id) ?? p),
    // Waypoints from the builder's grid no longer make sense; wires route themselves.
    wires: board.wires.map((w) => ({ ...w, points: [] })),
  };
}
