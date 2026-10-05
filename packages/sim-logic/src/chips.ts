import type { Board, ChipDef, ChipMap, Part } from '@build-a-computer/schema';
import { portName } from './parts-spec';

/**
 * Custom chip bookkeeping (CHIP-03): dependency graph, self-inclusion checks
 * for the editor and loader (E-SIM-05), usages and tombstones (E-DATA-08),
 * save closure, port validation and "Make chip" (CHIP-01).
 */

/** Ids of the chips placed directly on a board. */
export function chipsOnBoard(board: Board): Set<string> {
  const out = new Set<string>();
  for (const p of board.parts) if (p.type === 'chip' && p.chip !== undefined) out.add(p.chip);
  return out;
}

/** Chip id -> ids of the chips its board places directly. */
export function chipDependencies(chips: ChipMap): Map<string, Set<string>> {
  const g = new Map<string, Set<string>>();
  for (const [id, def] of Object.entries(chips)) g.set(id, chipsOnBoard(def.board));
  return g;
}

/** Every chip reachable from `start` (excluding `start` unless a cycle leads back). */
function reachable(g: Map<string, Set<string>>, start: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const todo = [...start];
  while (todo.length) {
    const c = todo.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    for (const d of g.get(c) ?? []) if (!seen.has(d)) todo.push(d);
  }
  return seen;
}

/**
 * First self-inclusion found among the chips, as a path of ids that starts
 * and ends with the same chip, or null. The loader rejects saves that have
 * one (E-SIM-05).
 */
export function findChipCycle(chips: ChipMap): string[] | null {
  const g = chipDependencies(chips);
  const state = new Map<string, 1 | 2>(); // 1 = on the stack, 2 = done
  for (const root of g.keys()) {
    if (state.has(root)) continue;
    const stack: { id: string; deps: string[]; i: number }[] = [{ id: root, deps: [...g.get(root)!], i: 0 }];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      if (top.i >= top.deps.length) {
        state.set(top.id, 2);
        stack.pop();
        continue;
      }
      const d = top.deps[top.i++]!;
      const s = state.get(d);
      if (s === 1) {
        const from = stack.findIndex((f) => f.id === d);
        return [...stack.slice(from).map((f) => f.id), d];
      }
      if (s === undefined && g.has(d)) {
        state.set(d, 1);
        stack.push({ id: d, deps: [...g.get(d)!], i: 0 });
      }
    }
  }
  return null;
}

/**
 * Would placing `insertedChipId` inside `targetChipId`'s board make a chip
 * contain itself? The editor calls this before the drop (E-SIM-05).
 */
export function wouldCreateCycle(chips: ChipMap, targetChipId: string, insertedChipId: string): boolean {
  if (targetChipId === insertedChipId) return true;
  return reachable(chipDependencies(chips), [insertedChipId]).has(targetChipId);
}

export interface ChipUsage {
  kind: 'board' | 'chip';
  /** Board name, or the using chip's name. */
  name: string;
  /** For kind 'chip': the using chip's id. */
  chipId?: string;
  /** Instance ids on that board that use the chip (directly, or through `via`). */
  parts: string[];
  /** False when the chip is used through other chips; `via` lists the ones placed on the board. */
  direct: boolean;
  via?: string[];
}

/**
 * Every board and chip that uses `chipId`, directly or through other chips,
 * so deleting a chip in use can list its usages first (E-DATA-08).
 * Tombstoned chips are listed too: they still load.
 */
export function usagesOf(chipId: string, boards: { name: string; board: Board }[], chips: ChipMap): ChipUsage[] {
  const g = chipDependencies(chips);
  // Chips that contain chipId transitively.
  const users = new Set<string>();
  const memo = new Map<string, boolean>();
  const uses = (c: string, seen: Set<string>): boolean => {
    if (c === chipId) return true;
    const m = memo.get(c);
    if (m !== undefined) return m;
    if (seen.has(c)) return false;
    seen.add(c);
    let r = false;
    for (const d of g.get(c) ?? []) if (uses(d, seen)) r = true;
    memo.set(c, r);
    return r;
  };
  for (const c of g.keys()) if (c !== chipId && uses(c, new Set())) users.add(c);

  const describe = (kind: 'board' | 'chip', name: string, board: Board, chipIdOf?: string): ChipUsage | null => {
    const direct: string[] = [];
    const indirect: string[] = [];
    const via = new Set<string>();
    for (const p of board.parts) {
      if (p.type !== 'chip' || p.chip === undefined) continue;
      if (p.chip === chipId) direct.push(p.id);
      else if (users.has(p.chip)) {
        indirect.push(p.id);
        via.add(p.chip);
      }
    }
    if (!direct.length && !indirect.length) return null;
    const u: ChipUsage = { kind, name, parts: direct.length ? direct : indirect, direct: direct.length > 0 };
    if (chipIdOf !== undefined) u.chipId = chipIdOf;
    if (!direct.length) u.via = [...via];
    return u;
  };

  const out: ChipUsage[] = [];
  for (const b of boards) {
    const u = describe('board', b.name, b.board);
    if (u) out.push(u);
  }
  for (const [id, def] of Object.entries(chips)) {
    if (id === chipId) continue;
    const u = describe('chip', def.name, def.board, id);
    if (u) out.push(u);
  }
  return out;
}

/**
 * The minimal ChipMap a save must embed for `board`: every chip it uses,
 * transitively. Tombstoned chips are kept; missing ids are skipped.
 */
export function closure(board: Board, chips: ChipMap): ChipMap {
  const out: ChipMap = {};
  const todo = [...chipsOnBoard(board)];
  while (todo.length) {
    const id = todo.pop()!;
    if (Object.hasOwn(out, id)) continue;
    const def = chips[id];
    if (!def) continue;
    out[id] = def;
    for (const d of chipsOnBoard(def.board)) if (!Object.hasOwn(out, d)) todo.push(d);
  }
  return out;
}

/** Mark a chip deleted but keep its definition, so old saves still load (E-DATA-08). */
export function tombstone(chips: ChipMap, id: string): ChipMap {
  const def = chips[id];
  if (!def || def.deleted) return chips;
  return { ...chips, [id]: { ...def, deleted: true } };
}

export interface PortProblem {
  code: 'missing-port' | 'wrong-type' | 'duplicate-port' | 'duplicate-name' | 'too-many';
  port?: string;
  message: string;
}

export const MAX_PORTS = 64;

/**
 * Ports must name switches (inputs) and lamps (outputs) on the chip's own
 * board, each at most once, with unique pin names, at most 64 per side.
 */
export function validatePorts(def: ChipDef): PortProblem[] {
  const problems: PortProblem[] = [];
  const byId = new Map(def.board.parts.map((p) => [p.id, p]));
  const seenIds = new Set<string>();
  const names = new Map<string, string>();
  const side = (ids: string[], want: 'switch' | 'lamp', label: 'inputs' | 'outputs') => {
    if (ids.length > MAX_PORTS) {
      problems.push({ code: 'too-many', message: `A chip can have at most ${MAX_PORTS} ${label}; this one has ${ids.length}.` });
    }
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) {
        problems.push({ code: 'missing-port', port: id, message: `Port ${id} is not on the chip's board.` });
        continue;
      }
      if (p.type !== want) {
        problems.push({ code: 'wrong-type', port: id, message: `Port ${id} must be a ${want}, not a ${p.type}.` });
        continue;
      }
      if (seenIds.has(id)) {
        problems.push({ code: 'duplicate-port', port: id, message: `Port ${id} is listed twice.` });
        continue;
      }
      seenIds.add(id);
      const name = portName(def, id);
      const other = names.get(name);
      if (other !== undefined) {
        problems.push({ code: 'duplicate-name', port: id, message: `Ports ${other} and ${id} are both named "${name}".` });
        continue;
      }
      names.set(name, id);
    }
  };
  side(def.ports.inputs, 'switch', 'inputs');
  side(def.ports.outputs, 'lamp', 'outputs');
  return problems;
}

const byPosition = (a: Part, b: Part): number => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Lowercase slug for chip ids: letters, digits and dashes. */
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'chip';

/**
 * A fresh, readable chip id not in `taken`: `chip-<name>` then `-2`, `-3`, ...
 * Deterministic (no randomness in sim packages); pass every id in use.
 */
export function newChipId(name: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  const base = `chip-${slug(name)}`;
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export interface MakeChipOptions {
  name: string;
  /** Switch ids, in pin order. Default: every switch, top to bottom then left to right. */
  inputs?: string[];
  /** Lamp ids, in pin order. Default: every lamp, top to bottom then left to right. */
  outputs?: string[];
  color?: string;
  /** Use this id instead of generating one. */
  id?: string;
  /** Ids already in use (e.g. the save's chips), so the new id is unique. */
  taken?: Iterable<string>;
}

/**
 * "Make chip" (CHIP-01): the board becomes a ChipDef. Part ids are kept as
 * they are, so ports and wires stay stable across edits; the board is copied.
 * Throws when the requested ports are invalid.
 */
export function makeChipFromBoard(board: Board, opts: MakeChipOptions): ChipDef {
  const copy = JSON.parse(JSON.stringify(board)) as Board;
  const inputs = opts.inputs ?? copy.parts.filter((p) => p.type === 'switch').sort(byPosition).map((p) => p.id);
  const outputs = opts.outputs ?? copy.parts.filter((p) => p.type === 'lamp').sort(byPosition).map((p) => p.id);
  const def: ChipDef = {
    id: opts.id ?? newChipId(opts.name, opts.taken),
    name: opts.name,
    version: 1,
    board: copy,
    ports: { inputs, outputs },
  };
  if (opts.color !== undefined) def.color = opts.color;
  const problems = validatePorts(def);
  if (problems.length) throw new Error(problems.map((p) => p.message).join(' '));
  return def;
}
