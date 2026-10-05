import type { PartType } from '@ground-up/schema';
import { LIBRARY } from '@ground-up/sim-logic';

/** Geometry in grid cells, relative to the part origin. Pins sit on grid points. */
export interface PinGeom {
  name: string;
  x: number;
  y: number;
  /** Outward direction, before rotation. */
  dir: [number, number];
  output: boolean;
}

export interface PartGeom {
  body: { x: number; y: number; w: number; h: number };
  pins: PinGeom[];
  /** Rotation pivot: a grid point, so pins stay on the grid after rotating. */
  pivot: [number, number];
}

const gate2: PartGeom = {
  body: { x: 0, y: -0.5, w: 3, h: 3 },
  pins: [
    { name: 'a', x: 0, y: 0, dir: [-1, 0], output: false },
    { name: 'b', x: 0, y: 2, dir: [-1, 0], output: false },
    { name: 'out', x: 3, y: 1, dir: [1, 0], output: true },
  ],
  pivot: [1, 1],
};

const tileOut = (): PartGeom => ({
  body: { x: 0, y: 0, w: 2, h: 2 },
  pins: [{ name: 'out', x: 2, y: 1, dir: [1, 0], output: true }],
  pivot: [1, 1],
});

export const GEOMETRY: Record<PartType, PartGeom> = {
  switch: tileOut(),
  clock: tileOut(),
  lamp: {
    body: { x: 0, y: 0, w: 2, h: 2 },
    pins: [{ name: 'in', x: 0, y: 1, dir: [-1, 0], output: false }],
    pivot: [1, 1],
  },
  not: {
    body: { x: 0, y: 0, w: 2, h: 2 },
    pins: [
      { name: 'in', x: 0, y: 1, dir: [-1, 0], output: false },
      { name: 'out', x: 2, y: 1, dir: [1, 0], output: true },
    ],
    pivot: [1, 1],
  },
  nand: gate2,
  and: gate2,
  or: gate2,
  nor: gate2,
  xor: gate2,
  xnor: gate2,
  dff: {
    body: { x: 0, y: -0.5, w: 3, h: 3 },
    pins: [
      { name: 'd', x: 0, y: 0, dir: [-1, 0], output: false },
      { name: 'clk', x: 0, y: 2, dir: [-1, 0], output: false },
      { name: 'q', x: 3, y: 1, dir: [1, 0], output: true },
    ],
    pivot: [1, 1],
  },
};

// Keep the editor and the engine agreeing on pin names.
for (const [type, g] of Object.entries(GEOMETRY)) {
  const lib = LIBRARY[type as PartType];
  const names = g.pins.map((p) => p.name).sort().join();
  const want = [...lib.inputs, ...lib.outputs].sort().join();
  if (names !== want) throw new Error(`Pin mismatch for ${type}: ${names} vs ${want}`);
}

/** Toolbar and library order, with the i18n key for each part's name. */
export const PART_ORDER: PartType[] = ['switch', 'lamp', 'nand', 'not', 'and', 'or', 'nor', 'xor', 'xnor', 'clock', 'dff'];

export const PART_GROUPS: { key: string; parts: PartType[] }[] = [
  { key: 'library.io', parts: ['switch', 'lamp', 'clock'] },
  { key: 'library.gates', parts: ['nand', 'not', 'and', 'or', 'nor', 'xor', 'xnor'] },
  { key: 'library.memory', parts: ['dff'] },
];
