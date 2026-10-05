import type { ChipMap, Part, PartType } from '@build-a-computer/schema';
import { pinsOf, type PinSpec } from '@build-a-computer/sim-logic';

/** Geometry in grid cells, relative to the part origin. Pins sit on grid points. */
export interface PinGeom {
  name: string;
  x: number;
  y: number;
  /** Outward direction, before rotation. */
  dir: [number, number];
  output: boolean;
  width: number;
}

export interface PartGeom {
  body: { x: number; y: number; w: number; h: number };
  pins: PinGeom[];
  /** Rotation pivot: a grid point, so pins stay on the grid after rotating. */
  pivot: [number, number];
}

/**
 * Custom chips known to the editor, so chip instances get their pins.
 * Kept current from the store (editor/chips code calls setChipRegistry).
 */
let chipRegistry: ChipMap = {};
export const setChipRegistry = (chips: ChipMap): void => {
  chipRegistry = chips;
  cache = new WeakMap();
};
export const getChipRegistry = (): ChipMap => chipRegistry;

const pin = (p: PinSpec, x: number, y: number, dir: [number, number]): PinGeom => ({
  name: p.name,
  x,
  y,
  dir,
  output: p.dir === 'out',
  width: p.width,
});

/** Hand-made layouts that match the original 1-bit parts (saves depend on them). */
function classic(part: Part, pins: PinSpec[]): PartGeom | undefined {
  const by = (n: string) => pins.find((p) => p.name === n)!;
  switch (part.type) {
    case 'switch':
    case 'clock':
    case 'button':
    case 'const':
      return { body: { x: 0, y: 0, w: 2, h: 2 }, pins: [pin(by('out'), 2, 1, [1, 0])], pivot: [1, 1] };
    case 'lamp':
      return { body: { x: 0, y: 0, w: 2, h: 2 }, pins: [pin(by('in'), 0, 1, [-1, 0])], pivot: [1, 1] };
    case 'not':
    case 'buffer':
      return {
        body: { x: 0, y: 0, w: 2, h: 2 },
        pins: [pin(by('in'), 0, 1, [-1, 0]), pin(by('out'), 2, 1, [1, 0])],
        pivot: [1, 1],
      };
    case 'nand':
    case 'and':
    case 'or':
    case 'nor':
    case 'xor':
    case 'xnor':
      return {
        body: { x: 0, y: -0.5, w: 3, h: 3 },
        pins: [pin(by('a'), 0, 0, [-1, 0]), pin(by('b'), 0, 2, [-1, 0]), pin(by('out'), 3, 1, [1, 0])],
        pivot: [1, 1],
      };
    case 'tristate':
      return {
        body: { x: 0, y: 0, w: 2, h: 2 },
        pins: [pin(by('in'), 0, 1, [-1, 0]), pin(by('en'), 1, 2, [0, 1]), pin(by('out'), 2, 1, [1, 0])],
        pivot: [1, 1],
      };
    case 'dff':
      return {
        body: { x: 0, y: -0.5, w: 3, h: 3 },
        pins: [pin(by('d'), 0, 0, [-1, 0]), pin(by('clk'), 0, 2, [-1, 0]), pin(by('q'), 3, 1, [1, 0])],
        pivot: [1, 1],
      };
    case 'splitter':
    case 'joiner': {
      // Thin bar: the bus on one side, one pin per chunk on the other.
      const many = pins.filter((p) => (part.type === 'splitter' ? p.dir === 'out' : p.dir === 'in'));
      const bus = pins.find((p) => p.name === (part.type === 'splitter' ? 'in' : 'out'))!;
      const h = Math.max(1, many.length - 1);
      const mid = Math.floor(h / 2);
      const busX = part.type === 'splitter' ? 0 : 1;
      const manyX = part.type === 'splitter' ? 1 : 0;
      return {
        body: { x: 0.25, y: -0.5, w: 0.5, h: h + 1 },
        pins: [
          pin(bus, busX, mid, [busX === 0 ? -1 : 1, 0]),
          ...many.map((p, i) => pin(p, manyX, i, [manyX === 0 ? -1 : 1, 0])),
        ],
        pivot: [0, mid],
      };
    }
    default:
      return undefined;
  }
}

/**
 * Generic block: inputs down the left edge, outputs down the right, one cell
 * apart, vertically centered against each other. Used by blocks and chips.
 */
function block(part: Part, pins: PinSpec[]): PartGeom {
  const ins = pins.filter((p) => p.dir === 'in');
  const outs = pins.filter((p) => p.dir === 'out');
  const rows = Math.max(ins.length, outs.length, 1);
  const longest = Math.max(0, ...pins.map((p) => p.name.length));
  const title = part.type === 'chip' ? (chipRegistry[part.chip ?? '']?.name ?? '?') : part.type;
  const w = Math.max(3, Math.min(10, Math.ceil((longest * 2 + title.length * 0.9) / 2.6) + 2));
  const offIn = Math.floor((rows - ins.length) / 2);
  const offOut = Math.floor((rows - outs.length) / 2);
  return {
    body: { x: 0, y: -1, w, h: rows + 1 },
    pins: [
      ...ins.map((p, i) => pin(p, 0, offIn + i, [-1, 0])),
      ...outs.map((p, i) => pin(p, w, offOut + i, [1, 0])),
    ],
    pivot: [Math.floor(w / 2), Math.floor((rows - 1) / 2)],
  };
}

let cache = new WeakMap<Part, PartGeom>();

/** Geometry for a part, derived from its pins (and chip definition). Cached per immutable part object. */
export function geomOf(part: Part): PartGeom {
  let g = cache.get(part);
  if (!g) {
    const pins = pinsOf(part, chipRegistry);
    g = classic(part, pins) ?? block(part, pins);
    cache.set(part, g);
  }
  return g;
}

/** Geometry for a part type with default props (toolbar ghosts, library tiles). */
export function geomOfType(type: PartType): PartGeom {
  return geomOf(sample(type));
}

const samples = new Map<PartType, Part>();
function sample(type: PartType): Part {
  let p = samples.get(type);
  if (!p) samples.set(type, (p = { id: `sample-${type}`, type, x: 0, y: 0, rot: 0, flip: false }));
  return p;
}

/** Toolbar and library order. */
export const PART_ORDER: PartType[] = [
  'switch',
  'lamp',
  'nand',
  'not',
  'and',
  'or',
  'nor',
  'xor',
  'xnor',
  'clock',
  'button',
  'const',
  'buffer',
  'tristate',
  'splitter',
  'joiner',
  'dff',
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
];

export const PART_GROUPS: { key: string; parts: PartType[] }[] = [
  { key: 'library.io', parts: ['switch', 'lamp', 'clock', 'button', 'const'] },
  { key: 'library.gates', parts: ['nand', 'not', 'and', 'or', 'nor', 'xor', 'xnor'] },
  { key: 'library.wiring', parts: ['buffer', 'tristate', 'splitter', 'joiner'] },
  { key: 'library.memory', parts: ['dff', 'register', 'counter', 'ram', 'rom'] },
  { key: 'library.arith', parts: ['mux', 'decoder', 'adder', 'alu'] },
  { key: 'library.riscv', parts: ['regfile', 'immgen', 'rvalu', 'branchcmp', 'lsu'] },
];
