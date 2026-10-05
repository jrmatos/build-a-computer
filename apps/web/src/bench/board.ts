/** Synthetic boards and snapshots for the EDIT-01 renderer benchmark. */
import type { Board, Part, PartType, Wire } from '@ground-up/schema';
import type { Snapshot } from '@ground-up/worker';

const GATES: PartType[] = ['nand', 'and', 'or', 'nor', 'xor', 'xnor', 'not', 'dff'];

/** Deterministic PRNG so every run draws the same board. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PITCH_X = 5;
export const PITCH_Y = 4;

/**
 * A grid of `count` parts: a column of switches and clocks on the left, lamps
 * on the right, gates in between, each gate wired to its left neighbour and to
 * the part diagonally above, so there are roughly two wires per part.
 */
export function benchBoard(count: number, seed = 1): { board: Board; cols: number; rows: number } {
  const r = rng(seed);
  const cols = Math.max(4, Math.round(Math.sqrt(count * 1.25)));
  const rows = Math.ceil(count / cols);
  const parts: Part[] = [];
  const wires: Wire[] = [];
  const grid: (Part | undefined)[][] = [];
  const outPin = (p: Part): string => (p.type === 'dff' ? 'q' : 'out');
  const inPins = (p: Part): string[] =>
    p.type === 'dff' ? ['d', 'clk'] : p.type === 'not' || p.type === 'lamp' ? ['in'] : p.type === 'switch' || p.type === 'clock' ? [] : ['a', 'b'];

  for (let row = 0; row < rows; row++) {
    grid.push([]);
    for (let col = 0; col < cols; col++) {
      if (parts.length >= count) break;
      const type: PartType =
        col === 0 ? (row % 6 === 5 ? 'clock' : 'switch') : col === cols - 1 ? 'lamp' : GATES[Math.floor(r() * GATES.length)]!;
      const part: Part = {
        id: `p${row}_${col}`,
        type,
        x: col * PITCH_X,
        y: row * PITCH_Y,
        rot: 0,
        flip: false,
      };
      if (col === 0 || col === cols - 1) {
        part.locked = true;
        part.label = col === 0 ? `in${row}` : `out${row}`;
      } else if (r() < 0.06) part.label = `g${row}.${col}`;
      grid[row]!.push(part);
      parts.push(part);
    }
  }
  let wid = 0;
  for (let row = 0; row < grid.length; row++) {
    for (let col = 1; col < grid[row]!.length; col++) {
      const part = grid[row]![col]!;
      const ins = inPins(part);
      const left = grid[row]![col - 1];
      if (left && ins[0]) wires.push({ id: `w${wid++}`, from: { part: left.id, pin: outPin(left) }, to: { part: part.id, pin: ins[0] }, points: [] });
      const up = grid[row - 1]?.[col - 1];
      if (up && ins[1]) wires.push({ id: `w${wid++}`, from: { part: up.id, pin: outPin(up) }, to: { part: part.id, pin: ins[1] }, points: [] });
    }
  }
  return { board: { parts, wires }, cols, rows };
}

/** A plausible running snapshot: random net values (mostly 0/1, a few X), pins following their wires. */
export function benchSnapshot(board: Board, seed: number, withDiagnostics: boolean): Snapshot {
  const r = rng(seed);
  const wires: Record<string, number> = {};
  const pins: Record<string, number> = {};
  for (const w of board.wires) {
    const u = r();
    const v = u < 0.03 ? 2 : u < 0.5 ? 1 : 0;
    wires[w.id] = v;
    pins[`${w.from.part}:${w.from.pin}`] = v;
    pins[`${w.to.part}:${w.to.pin}`] = v;
  }
  const switchesOn = board.parts.filter((p) => p.type === 'switch' && r() < 0.5).map((p) => p.id);
  for (const id of switchesOn) pins[`${id}:out`] = 1;
  const contentionPins: string[] = [];
  const unstablePins: string[] = [];
  if (withDiagnostics) {
    const mid = Math.floor(board.wires.length / 2);
    for (const w of board.wires.slice(mid - 300, mid + 300)) {
      const u = r();
      if (u < 0.02) contentionPins.push(`${w.to.part}:${w.to.pin}`);
      else if (u < 0.04) unstablePins.push(`${w.to.part}:${w.to.pin}`);
    }
  }
  return {
    wires,
    buses: {},
    busPins: {},
    switchValues: {},
    pins,
    switchesOn,
    powered: true,
    running: true,
    ticks: seed,
    clock: seed & 1,
    stable: !withDiagnostics,
    unstablePins,
    contentionPins,
  };
}
