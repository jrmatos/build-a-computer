import type { Board, ChipDef, ChipMap, Part, PartProps, PartType, PinRef, Wire } from '@ground-up/schema';
import { pinsOf, portName, type PinSpec } from './parts-spec';

/** A non-fatal problem found while flattening; the board still loads. */
export interface FlattenProblem {
  code:
    | 'missing-chip' // part.chip names no ChipDef: the part is dropped
    | 'deleted-chip' // the ChipDef is a tombstone: still simulated (E-DATA-08)
    | 'bad-port' // a port id names no switch (input) / lamp (output) on the chip's board
    | 'duplicate-port-name' // two ports share a pin name: only the first is reachable
    | 'unknown-pin' // an outer wire targets a pin the chip does not have
    | 'model-mismatch'; // the behavioral model's pins do not match the ports: gates run instead
  /** Flat id of the chip instance (or part) concerned. */
  part: string;
  message: string;
}

export interface FlattenResult {
  board: Board;
  /** Flat part id -> path of instance ids from the root, for diagnostics and probes. */
  origin: Map<string, string[]>;
  /** Missing/deleted chips and port problems. Additive: never thrown. */
  problems: FlattenProblem[];
}

export class ChipCycleError extends Error {
  constructor(readonly path: string[]) {
    super(`A chip cannot contain itself: ${path.join(' → ')}`);
    this.name = 'ChipCycleError';
  }
}

/**
 * Props for a behavioral model so its pins match the given port widths, by
 * type. Returns the part's props; the caller still checks the pins match.
 */
export function inferModelProps(type: PartType, inW: readonly number[], outW: readonly number[]): PartProps {
  const first = inW[0] ?? outW[0] ?? 1;
  switch (type) {
    case 'decoder':
      return { selectBits: first };
    case 'ram':
      return { addrWidth: first, width: inW[1] ?? 1 };
    case 'rom':
      return { addrWidth: first, width: outW[0] ?? 1 };
    case 'splitter':
      return { width: first, chunk: outW[0] ?? 1 };
    case 'joiner':
      return { width: outW[0] ?? 1, chunk: first };
    default:
      return { width: first };
  }
}

const samePins = (a: readonly PinSpec[], b: readonly PinSpec[]): boolean =>
  a.length === b.length && a.every((p, i) => p.width === b[i]!.width);

/**
 * The model part a chip runs as (behavioral swap), or a reason it cannot.
 * Model pins are matched to ports by order: inputs to model inputs, outputs
 * to model outputs; counts and widths must agree.
 */
export function modelPartFor(
  def: ChipDef,
  type: PartType,
  chips: ChipMap,
  base: Pick<Part, 'id' | 'x' | 'y'> & Partial<Part> = { id: 'model', x: 0, y: 0 },
): { part: Part; rename: Map<string, string> } | { error: string } {
  if (type === 'chip') return { error: 'A chip cannot use another chip as its model.' };
  const chipPart: Part = { id: base.id, type: 'chip', x: 0, y: 0, rot: 0, flip: false, chip: def.id };
  const ports = pinsOf(chipPart, { ...chips, [def.id]: def });
  const pIn = ports.filter((p) => p.dir === 'in');
  const pOut = ports.filter((p) => p.dir === 'out');
  const part: Part = {
    rot: 0,
    flip: false,
    ...base,
    type,
    chip: undefined,
    props: inferModelProps(
      type,
      pIn.map((p) => p.width),
      pOut.map((p) => p.width),
    ),
  };
  delete part.chip;
  const mPins = pinsOf(part);
  const mIn = mPins.filter((p) => p.dir === 'in');
  const mOut = mPins.filter((p) => p.dir === 'out');
  if (!samePins(pIn, mIn) || !samePins(pOut, mOut)) {
    const fmt = (l: PinSpec[]) => l.map((p) => `${p.name}:${p.width}`).join(', ') || 'none';
    return {
      error: `Model ${type} pins (in: ${fmt(mIn)}; out: ${fmt(mOut)}) do not match the chip's ports (in: ${fmt(pIn)}; out: ${fmt(pOut)}).`,
    };
  }
  const rename = new Map<string, string>();
  pIn.forEach((p, i) => rename.set(p.name, mIn[i]!.name));
  pOut.forEach((p, i) => rename.set(p.name, mOut[i]!.name));
  return { part, rename };
}

/** Endpoint key; \u0000 cannot appear in ids typed by players. */
const key = (part: string, pin: string): string => `${part}\u0000${pin}`;

interface Ctx {
  chips: ChipMap;
  parts: Part[];
  wires: Wire[];
  origin: Map<string, string[]>;
  problems: FlattenProblem[];
  /** Flat ids of parts that disappear: inlined chip instances and their port parts. */
  virtual: Set<string>;
  /** Zero-delay joins between a chip pin and its inner port part's pin. */
  joins: [string, string][];
  /** Chip ids on the current inlining path, for E-SIM-05. */
  stack: string[];
  onStack: Set<string>;
}

/**
 * Inline custom chips into one flat board (SIM-02).
 *
 * - Flat ids are `${instanceId}/${innerId}` (nested: `a/b/c`); wires likewise.
 *   Ids are built top-down with the parent prefix, so each id is built once.
 * - A chip's ports (inner switch = input, inner lamp = output) vanish: every
 *   wire endpoint on a chip pin or a port part is re-pointed to a real pin of
 *   the same connected group, so the outer and inner nets become one net with
 *   zero delay. An unconnected chip input leaves the inner net undriven (reads
 *   X, E-SIM-03); a lamp port wired straight to a switch port passes through.
 * - Chips with `model` and no `simulateGates` become one part of that type,
 *   pins renamed by port order (see modelPartFor).
 * - Missing or tombstoned defs and bad ports go to `problems`, never thrown.
 * - Self-inclusion throws ChipCycleError with the chip id path (E-SIM-05).
 */
export function flattenBoard(board: Board, chips: ChipMap = {}): FlattenResult {
  const ctx: Ctx = {
    chips,
    parts: [],
    wires: [],
    origin: new Map(),
    problems: [],
    virtual: new Set(),
    joins: [],
    stack: [],
    onStack: new Set(),
  };
  emitBoard(ctx, board, '', []);
  if (ctx.virtual.size === 0) {
    return { board: { parts: ctx.parts, wires: ctx.wires }, origin: ctx.origin, problems: ctx.problems };
  }
  return { board: { parts: ctx.parts, wires: rewire(ctx) }, origin: ctx.origin, problems: ctx.problems };
}

function emitBoard(ctx: Ctx, board: Board, prefix: string, path: string[]): void {
  /** Inner part id -> pin rename (model chips) or null (dropped part). */
  const renames = new Map<string, Map<string, string> | null>();
  const pinsByChip = new Map<string, Set<string>>();

  for (const p of board.parts) {
    const flat = prefix + p.id;
    if (p.type !== 'chip') {
      ctx.parts.push(prefix ? { ...p, id: flat } : p);
      ctx.origin.set(flat, path);
      continue;
    }
    const def = p.chip !== undefined ? ctx.chips[p.chip] : undefined;
    if (!def) {
      ctx.problems.push({
        code: 'missing-chip',
        part: flat,
        message: `Chip ${p.chip ?? '(none)'} used by ${flat} is missing; the part was removed.`,
      });
      renames.set(p.id, null);
      continue;
    }
    if (def.deleted) {
      ctx.problems.push({
        code: 'deleted-chip',
        part: flat,
        message: `Chip "${def.name}" used by ${flat} was deleted; it still runs from its saved definition.`,
      });
    }
    if (def.model && !def.simulateGates) {
      const m = modelPartFor(def, def.model, ctx.chips, { ...p, id: flat, label: p.label ?? def.name });
      if ('part' in m) {
        ctx.parts.push(m.part);
        ctx.origin.set(flat, path);
        renames.set(p.id, m.rename);
        continue;
      }
      ctx.problems.push({ code: 'model-mismatch', part: flat, message: `${m.error} Running the chip's gates instead.` });
    }
    pinsByChip.set(p.id, inlineChip(ctx, def, flat, path));
  }

  for (const w of board.wires) {
    const from = mapEnd(ctx, w.from, prefix, renames, pinsByChip);
    const to = mapEnd(ctx, w.to, prefix, renames, pinsByChip);
    if (!from || !to) continue;
    if (!prefix && from === w.from && to === w.to) ctx.wires.push(w);
    else ctx.wires.push({ ...w, id: prefix + w.id, from, to });
  }
}

function mapEnd(
  ctx: Ctx,
  ref: PinRef,
  prefix: string,
  renames: Map<string, Map<string, string> | null>,
  pinsByChip: Map<string, Set<string>>,
): PinRef | null {
  const r = renames.get(ref.part);
  if (r === null) return null;
  const flat = prefix + ref.part;
  if (r) {
    const pin = r.get(ref.pin);
    if (pin === undefined) {
      ctx.problems.push({ code: 'unknown-pin', part: flat, message: `${flat} has no pin "${ref.pin}".` });
      return null;
    }
    return { part: flat, pin };
  }
  const pins = pinsByChip.get(ref.part);
  if (pins && !pins.has(ref.pin)) {
    ctx.problems.push({ code: 'unknown-pin', part: flat, message: `${flat} has no pin "${ref.pin}".` });
    return null;
  }
  return prefix ? { part: flat, pin: ref.pin } : ref;
}

/** Inline one chip instance; returns the instance's pin names. */
function inlineChip(ctx: Ctx, def: ChipDef, flat: string, path: string[]): Set<string> {
  if (ctx.onStack.has(def.id)) {
    const start = ctx.stack.indexOf(def.id);
    throw new ChipCycleError([...ctx.stack.slice(start), def.id]);
  }
  ctx.stack.push(def.id);
  ctx.onStack.add(def.id);
  ctx.virtual.add(flat);

  const inner = `${flat}/`;
  const byId = new Map(def.board.parts.map((p) => [p.id, p]));
  const pins = new Set<string>();
  const portIds = new Set<string>();
  const port = (id: string, want: 'switch' | 'lamp', pin: 'out' | 'in') => {
    const p = byId.get(id);
    if (!p || p.type !== want) {
      ctx.problems.push({
        code: 'bad-port',
        part: flat,
        message: `Chip "${def.name}": port ${id} is not a ${want} on its board.`,
      });
      return;
    }
    const name = portName(def, id);
    if (pins.has(name)) {
      ctx.problems.push({
        code: 'duplicate-port-name',
        part: flat,
        message: `Chip "${def.name}": two ports are named "${name}".`,
      });
      return;
    }
    pins.add(name);
    portIds.add(id);
    ctx.virtual.add(inner + id);
    ctx.joins.push([key(flat, name), key(inner + id, pin)]);
  };
  for (const id of def.ports.inputs) port(id, 'switch', 'out');
  for (const id of def.ports.outputs) port(id, 'lamp', 'in');

  const innerBoard: Board =
    portIds.size === 0 ? def.board : { parts: def.board.parts.filter((p) => !portIds.has(p.id)), wires: def.board.wires };
  // Port parts are skipped as parts, but wires to them are kept (re-pointed later).
  const innerPath = [...path, flat.slice(flat.lastIndexOf('/') + 1)];
  emitBoard(ctx, innerBoard, inner, innerPath);

  ctx.stack.pop();
  ctx.onStack.delete(def.id);
  return pins;
}

/**
 * Re-point every wire endpoint on a vanished part (chip pin or port) to a real
 * pin connected to it, so the compiler's net union sees one net. Wires whose
 * whole group has no real pin are dropped. Union-find over endpoints: linear.
 */
function rewire(ctx: Ctx): Wire[] {
  const index = new Map<string, number>();
  const refs: PinRef[] = [];
  const parent: number[] = [];
  const id = (part: string, pin: string, ref?: PinRef): number => {
    const k = key(part, pin);
    let i = index.get(k);
    if (i === undefined) {
      i = parent.length;
      index.set(k, i);
      parent.push(i);
      refs.push(ref ?? { part, pin });
    }
    return i;
  };
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const ends = ctx.wires.map((w) => {
    const a = id(w.from.part, w.from.pin, w.from);
    const b = id(w.to.part, w.to.pin, w.to);
    union(a, b);
    return a;
  });
  for (const [ka, kb] of ctx.joins) {
    const [pa, na] = ka.split('\u0000') as [string, string];
    const [pb, nb] = kb.split('\u0000') as [string, string];
    union(id(pa, na), id(pb, nb));
  }
  // A real representative per group.
  const rep = new Map<number, number>();
  for (let i = 0; i < refs.length; i++) {
    if (ctx.virtual.has(refs[i]!.part)) continue;
    const r = find(i);
    if (!rep.has(r)) rep.set(r, i);
  }
  const out: Wire[] = [];
  ctx.wires.forEach((w, wi) => {
    const a = ends[wi]!;
    const va = ctx.virtual.has(w.from.part);
    const vb = ctx.virtual.has(w.to.part);
    if (!va && !vb) {
      out.push(w);
      return;
    }
    const r = rep.get(find(a));
    if (r === undefined) return;
    out.push({ ...w, from: va ? refs[r]! : w.from, to: vb ? refs[r]! : w.to });
  });
  return out;
}
