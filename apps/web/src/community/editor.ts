/**
 * Community level editor, pure part (COM-02). A sandbox board becomes a level:
 * its labelled switches and lamps become the locked starter, the rest of the
 * board is the reference solution, and the truth table comes from running
 * the reference (or is edited by hand). Publishing (export) is allowed only
 * after the check: the reference passes and the empty starter fails.
 */
import {
  Level,
  LevelPack,
  PACK_KIND,
  PART_TYPES,
  slugify,
  type Board,
  type ChipMap,
  type PartType,
  type TruthRow,
} from '@build-a-computer/schema';
import { closure } from '@build-a-computer/sim-logic';

export interface Port {
  id: string;
  label: string;
  width: number;
}

const INPUT_TYPES = new Set<PartType>(['switch', 'button']);

/** Labelled inputs (switches, buttons) and outputs (lamps) on a board, top to bottom. */
export function portsOf(board: Board): { inputs: Port[]; outputs: Port[]; unlabeled: number; duplicates: string[] } {
  const inputs: Port[] = [];
  const outputs: Port[] = [];
  const seen = new Map<string, number>();
  let unlabeled = 0;
  const sorted = [...board.parts].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const p of sorted) {
    const isIn = INPUT_TYPES.has(p.type);
    if (!isIn && p.type !== 'lamp') continue;
    const label = p.label?.trim();
    if (!label) {
      unlabeled++;
      continue;
    }
    seen.set(label, (seen.get(label) ?? 0) + 1);
    (isIn ? inputs : outputs).push({ id: p.id, label, width: p.props?.width ?? 1 });
  }
  const duplicates = [...seen].filter(([, n]) => n > 1).map(([l]) => l);
  return { inputs, outputs, unlabeled, duplicates };
}

/** Part types the reference places besides the chosen I/O parts: the default palette. */
export function defaultPalette(board: Board, ioIds: readonly string[] = []): PartType[] {
  const io = new Set(ioIds);
  const used = new Set<PartType>();
  for (const p of board.parts) if (!io.has(p.id) && p.type !== 'chip') used.add(p.type);
  if (!used.size) used.add('nand');
  return PART_TYPES.filter((t) => used.has(t));
}

/** Palette choices offered as checkboxes (custom chips are always allowed separately). */
export const PALETTE_CHOICES: PartType[] = PART_TYPES.filter((t) => t !== 'chip');

/** Most rows the generated truth table holds. */
export const MAX_ROWS = 256;

/**
 * Input vectors for the generated table: every combination when the inputs
 * have at most 8 bits in total, else all zeros, all ones and a fixed-seed
 * sample (deterministic, so re-generating gives the same table).
 */
export function inputVectors(inputs: readonly Port[], sample = 64): Record<string, number>[] {
  const bits = inputs.reduce((n, p) => n + p.width, 0);
  const rows: Record<string, number>[] = [];
  const mask = (w: number) => (w >= 32 ? 0xffffffff : (1 << w) - 1) >>> 0;
  if (bits <= 8) {
    for (let v = 0; v < 1 << bits; v++) {
      const row: Record<string, number> = {};
      let shift = bits;
      for (const p of inputs) {
        shift -= p.width;
        row[p.label] = (v >>> shift) & mask(p.width);
      }
      rows.push(row);
    }
    return rows;
  }
  rows.push(Object.fromEntries(inputs.map((p) => [p.label, 0])));
  rows.push(Object.fromEntries(inputs.map((p) => [p.label, mask(p.width)])));
  let s = 0x2545f491;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  };
  const keys = new Set(rows.map((r) => JSON.stringify(r)));
  for (let tries = 0; rows.length < Math.min(sample, MAX_ROWS) && tries < sample * 8; tries++) {
    const row = Object.fromEntries(inputs.map((p) => [p.label, (next() & mask(p.width)) >>> 0]));
    const k = JSON.stringify(row);
    if (keys.has(k)) continue;
    keys.add(k);
    rows.push(row);
  }
  return rows;
}

/** The chosen I/O parts, locked, without wires: what a player starts with. */
export function starterFrom(board: Board, ids: readonly string[]): Board {
  const keep = new Set(ids);
  return { parts: board.parts.filter((p) => keep.has(p.id)).map((p) => ({ ...p, locked: true })), wires: [] };
}

/** The reference solution: the whole board with the chosen I/O parts locked (so its ids match the starter). */
export function referenceBoard(board: Board, ids: readonly string[]): Board {
  const keep = new Set(ids);
  return { ...board, parts: board.parts.map((p) => (keep.has(p.id) ? { ...p, locked: true } : p)) };
}

export interface LevelDraft {
  title: string;
  goal: string;
  hints: string[];
  afterword: string;
  palette: PartType[];
  /** Part ids of the chosen inputs and outputs. */
  inputs: string[];
  outputs: string[];
  rows: TruthRow[];
  packName: string;
  author: string;
  description: string;
}

/** What must be fixed before the check can run. Pure. */
export function draftProblems(d: LevelDraft, board: Board): string[] {
  const p: string[] = [];
  if (!d.title.trim()) p.push('title');
  if (!d.goal.trim()) p.push('goal');
  if (!d.inputs.length) p.push('inputs');
  if (!d.outputs.length) p.push('outputs');
  if (!d.palette.length) p.push('palette');
  if (!d.rows.length) p.push('rows');
  if (!d.packName.trim()) p.push('packName');
  const { duplicates } = portsOf(board);
  const chosen = new Set([...d.inputs, ...d.outputs]);
  if (board.parts.some((pt) => chosen.has(pt.id) && pt.label && duplicates.includes(pt.label.trim()))) p.push('duplicates');
  return p;
}

const labelsOf = (board: Board, ids: readonly string[]) => ids.map((id) => board.parts.find((p) => p.id === id)?.label?.trim() ?? id);

/** Build the level from a draft (throws on schema errors). */
export function buildLevel(d: LevelDraft, board: Board): Level {
  const outs = new Set(labelsOf(board, d.outputs));
  const ins = new Set(labelsOf(board, d.inputs));
  const rows = d.rows.map((r) => ({
    inputs: Object.fromEntries(Object.entries(r.inputs).filter(([k]) => ins.has(k))),
    expect: Object.fromEntries(Object.entries(r.expect).filter(([k]) => outs.has(k))),
  }));
  return Level.parse({
    id: slugify(d.title, 40),
    version: 1,
    track: 'nand-to-os',
    phase: 0,
    order: 1,
    title: d.title.trim(),
    goal: d.goal.trim(),
    hints: d.hints.map((h) => h.trim()).filter(Boolean),
    afterword: d.afterword.trim(),
    palette: d.palette,
    starter: starterFrom(board, [...d.inputs, ...d.outputs]),
    tests: [{ kind: 'truth-table', rows }],
  });
}

/** A one-level pack holding the level and its reference solution. */
export function buildPack(d: LevelDraft, level: Level, board: Board, chips: ChipMap): LevelPack {
  const solution = referenceBoard(board, [...d.inputs, ...d.outputs]);
  return LevelPack.parse({
    kind: PACK_KIND,
    version: 1,
    slug: slugify(d.packName),
    name: d.packName.trim(),
    ...(d.author.trim() ? { author: d.author.trim() } : {}),
    ...(d.description.trim() ? { description: d.description.trim() } : {}),
    levels: [level],
    solutions: { [level.id]: { board: solution } },
    chips: closure(solution, chips),
  });
}
