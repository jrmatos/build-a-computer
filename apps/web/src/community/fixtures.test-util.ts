import type { Board, Level } from '@build-a-computer/schema';
import { Level as LevelSchema } from '@build-a-computer/schema';

/** A NOT gate from one NAND: switch A, lamp Y. */
export const notBoard = (): Board => ({
  parts: [
    { id: 'A', type: 'switch', x: 0, y: 0, rot: 0, flip: false, label: 'A' },
    { id: 'g', type: 'nand', x: 4, y: 0, rot: 0, flip: false },
    { id: 'Y', type: 'lamp', x: 8, y: 0, rot: 0, flip: false, label: 'Y' },
  ],
  wires: [
    { id: 'w1', from: { part: 'A', pin: 'out' }, to: { part: 'g', pin: 'a' }, points: [] },
    { id: 'w2', from: { part: 'A', pin: 'out' }, to: { part: 'g', pin: 'b' }, points: [] },
    { id: 'w3', from: { part: 'g', pin: 'out' }, to: { part: 'Y', pin: 'in' }, points: [] },
  ],
});

export const notLevel = (over: Partial<Level> = {}): Level =>
  LevelSchema.parse({
    id: 'not',
    version: 1,
    track: 'nand-to-os',
    phase: 0,
    order: 1,
    title: 'NOT',
    goal: 'Invert A.',
    palette: ['nand'],
    starter: {
      parts: [
        { id: 'A', type: 'switch', x: 0, y: 0, label: 'A', locked: true },
        { id: 'Y', type: 'lamp', x: 8, y: 0, label: 'Y', locked: true },
      ],
      wires: [],
    },
    tests: [
      {
        kind: 'truth-table',
        rows: [
          { inputs: { A: 0 }, expect: { Y: 1 } },
          { inputs: { A: 1 }, expect: { Y: 0 } },
        ],
      },
    ],
    ...over,
  });
