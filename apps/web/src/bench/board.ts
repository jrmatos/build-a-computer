/** Synthetic boards and snapshots for the EDIT-01 renderer benchmark. */
import type { Board, ChipDef, ChipMap, Part, PartType, Wire } from '@ground-up/schema';
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

/* ------------------------------------------------------------------ */
/* Mixed board: blocks, chips, buses, splitters                        */
/* ------------------------------------------------------------------ */

const sw = (id: string, ports: { id: string; w: number; out: boolean }[], name: string, color?: string): ChipDef => ({
  id,
  name,
  version: 1,
  color,
  board: {
    parts: ports.map((q, i) => ({
      id: q.id,
      type: q.out ? 'lamp' : 'switch',
      x: q.out ? 10 : 0,
      y: i * 3,
      rot: 0,
      flip: false,
      label: q.id,
      props: { width: q.w },
    })),
    wires: [],
  },
  ports: { inputs: ports.filter((q) => !q.out).map((q) => q.id), outputs: ports.filter((q) => q.out).map((q) => q.id) },
});

/** Custom chips used by the mixed and showcase boards. */
export const BENCH_CHIPS: ChipMap = {
  add4: sw('add4', [
    { id: 'a', w: 4, out: false },
    { id: 'b', w: 4, out: false },
    { id: 'cin', w: 1, out: false },
    { id: 'sum', w: 4, out: true },
    { id: 'cout', w: 1, out: true },
  ], 'ADD4', '#4c6ef5'),
  flags: sw('flags', [
    { id: 'z', w: 1, out: false },
    { id: 'n', w: 1, out: false },
    { id: 'c', w: 1, out: false },
    { id: 'lt', w: 1, out: true },
    { id: 'ge', w: 1, out: true },
  ], 'CMP', '#f08c00'),
  pc: sw('pc', [
    { id: 'jmp', w: 8, out: false },
    { id: 'clk', w: 1, out: false },
    { id: 'addr', w: 8, out: true },
  ], 'PC', '#2f9e44'),
};

type P = Omit<Part, 'rot' | 'flip'> & Partial<Pick<Part, 'rot' | 'flip'>>;
const part = (q: P): Part => ({ rot: 0, flip: false, ...q });

/**
 * One CPU-ish cluster of about 18 parts: number inputs into an ALU and a
 * register, a splitter feeding a custom chip, a counter, RAM, mux and a few
 * gates and displays, wired with buses.
 */
function cluster(ox: number, oy: number, n: number, out: { parts: Part[]; wires: Wire[] }, wid: { n: number }): void {
  const id = (s: string): string => `c${n}_${s}`;
  const add = (q: P): void => {
    out.parts.push(part({ ...q, id: id(q.id), x: ox + q.x, y: oy + q.y }));
  };
  const wire = (a: string, ap: string, b: string, bp: string): void => {
    out.wires.push({ id: `w${wid.n++}`, from: { part: id(a), pin: ap }, to: { part: id(b), pin: bp }, points: [] });
  };
  add({ id: 'swa', type: 'switch', x: 0, y: 0, props: { width: 8 }, label: n % 4 === 0 ? `a${n}` : undefined, locked: n % 4 === 0 });
  add({ id: 'swb', type: 'switch', x: 0, y: 4, props: { width: 8 } });
  add({ id: 'op', type: 'const', x: 0, y: 8, props: { width: 3, value: n % 8 } });
  add({ id: 'alu', type: 'alu', x: 6, y: 1 });
  add({ id: 'reg', type: 'register', x: 19, y: 1 });
  add({ id: 'clk', type: 'clock', x: 13, y: 10 });
  add({ id: 'ld', type: 'button', x: 13, y: 6 });
  add({ id: 'q', type: 'lamp', x: 31, y: 0, props: { width: 8, format: n % 3 === 0 ? 'dec' : 'hex' } });
  add({ id: 'spl', type: 'splitter', x: 31, y: 5, props: { width: 8, chunk: 4 } });
  add({ id: 'chip', type: 'chip', chip: 'add4', x: 35, y: 5 });
  add({ id: 'sum', type: 'lamp', x: 46, y: 4, props: { width: 4 } });
  add({ id: 'nz', type: 'nand', x: 19, y: 8 });
  add({ id: 'z', type: 'lamp', x: 25, y: 8 });
  add({ id: 'ctr', type: 'counter', x: 6, y: 13 });
  add({ id: 'mux', type: 'mux', x: 19, y: 13, props: { width: 8 } });
  add({ id: 'ram', type: 'ram', x: 31, y: 13 });
  add({ id: 'ro', type: 'lamp', x: 43, y: 14, props: { width: 8 } });
  add({ id: 'tri', type: 'tristate', x: 46, y: 9, props: { width: 4 } });
  wire('swa', 'out', 'alu', 'a');
  wire('swb', 'out', 'alu', 'b');
  wire('op', 'out', 'alu', 'op');
  wire('alu', 'out', 'reg', 'd');
  wire('ld', 'out', 'reg', 'load');
  wire('clk', 'out', 'reg', 'clk');
  wire('reg', 'q', 'q', 'in');
  wire('reg', 'q', 'spl', 'in');
  wire('spl', 'o0', 'chip', 'a');
  wire('spl', 'o1', 'chip', 'b');
  wire('chip', 'sum', 'sum', 'in');
  wire('alu', 'zero', 'nz', 'a');
  wire('alu', 'carry', 'nz', 'b');
  wire('nz', 'out', 'z', 'in');
  wire('ctr', 'q', 'mux', 'a');
  wire('reg', 'q', 'mux', 'b');
  wire('mux', 'out', 'ram', 'd');
  wire('ram', 'q', 'ro', 'in');
  wire('chip', 'sum', 'tri', 'in');
}

/** About `count` parts in CPU-ish clusters (see `cluster`). */
export function mixedBoard(count: number): { board: Board; cols: number; rows: number; w: number; h: number } {
  const per = 18;
  const n = Math.max(1, Math.round(count / per));
  const cols = Math.max(1, Math.round(Math.sqrt(n * 0.6)));
  const rows = Math.ceil(n / cols);
  const out = { parts: [] as Part[], wires: [] as Wire[] };
  const wid = { n: 0 };
  for (let i = 0; i < n; i++) cluster((i % cols) * 54, Math.floor(i / cols) * 22, i, out, wid);
  return { board: out, cols, rows, w: cols * 54, h: rows * 22 };
}

/** Random values for every pin, with full bus values, switch values and a few X bits. */
export function mixedSnapshot(board: Board, seed: number, widthOf: (ref: { part: string; pin: string }) => number): Snapshot {
  const r = rng(seed);
  const s: Snapshot = {
    wires: {},
    buses: {},
    busPins: {},
    switchValues: {},
    pins: {},
    switchesOn: [],
    powered: true,
    running: true,
    ticks: seed,
    clock: seed & 1,
    stable: true,
    unstablePins: [],
    contentionPins: [],
  };
  const set = (key: string, w: number, v: number, x: number): void => {
    s.pins[key] = x ? 2 : v ? 1 : 0;
    if (w > 1) s.busPins[key] = { w, v, x };
  };
  for (const wire of board.wires) {
    const w = widthOf(wire.from);
    const mask = w >= 32 ? 0xffffffff : 2 ** w - 1;
    const u = r();
    const v = u < 0.12 ? 0 : Math.floor(r() * (mask + 1)) >>> 0;
    const x = r() < 0.04 ? (1 << Math.floor(r() * w)) >>> 0 : 0;
    s.wires[wire.id] = x ? 2 : v ? 1 : 0;
    if (w > 1) s.buses[wire.id] = { w, v, x };
    set(`${wire.from.part}:${wire.from.pin}`, w, v, x);
    set(`${wire.to.part}:${wire.to.pin}`, w, v, x);
  }
  for (const p of board.parts) {
    if (p.type === 'switch' && (p.props?.width ?? 1) > 1) {
      const v = s.busPins[`${p.id}:out`]?.v ?? 0;
      s.switchValues[p.id] = v;
    }
  }
  return s;
}
