import { Level, type Part, type PartType, type TruthRow } from '@ground-up/schema';

/**
 * Levels for the first playable. DRAFT: tutorial text, hints and resources
 * still need owner approval (human review gate). Resources stay empty until an
 * agent fetches and verifies each URL (resource policy).
 * CNT-01 will move these to YAML + MDX compiled at build time.
 */

const sw = (id: string, x: number, y: number): Part => ({ id, type: 'switch', x, y, rot: 0, flip: false, label: id, locked: true });
const lamp = (id: string, x: number, y: number): Part => ({ id, type: 'lamp', x, y, rot: 0, flip: false, label: id, locked: true });

const twoInputs = [sw('A', -10, -4), sw('B', -10, 4)];
const table2 = (f: (a: number, b: number) => number): TruthRow[] =>
  [0, 1].flatMap((a) =>
    [0, 1].map((b) => ({ inputs: { A: a as 0 | 1, B: b as 0 | 1 }, expect: { Y: f(a, b) as 0 | 1 } })),
  );

const ALL: PartType[] = ['switch', 'lamp', 'clock', 'nand', 'not', 'and', 'or', 'nor', 'xor', 'xnor', 'dff'];

const raw = [
  {
    id: 'sandbox',
    version: 1,
    track: 'sandbox',
    phase: 0,
    order: 0,
    title: 'Sandbox',
    goal: 'Free building. Every part is unlocked and nothing is checked.',
    palette: ALL,
    starter: { parts: [], wires: [] },
  },
  {
    id: 'meet-nand',
    version: 1,
    track: 'nand-to-os',
    phase: 0,
    order: 1,
    title: 'Meet NAND',
    goal: 'Connect A and B to a NAND gate and its output to Y. Y is off only when both A and B are on.',
    tutorial:
      'NAND means "not and". Its output is 1 unless both inputs are 1. Every other part in this game will be built from it.',
    hints: ['Drag from a switch\'s pin to a NAND input to make a wire.', 'Flip the switches to watch Y change.'],
    afterword: 'You just used the only gate you will ever need. Next, you build NOT out of it.',
    palette: ['nand'],
    starter: { parts: [...twoInputs, lamp('Y', 10, 0)], wires: [] },
    tests: [{ kind: 'truth-table', rows: table2((a, b) => 1 - (a & b)) }],
  },
  {
    id: 'not-gate',
    version: 1,
    track: 'nand-to-os',
    phase: 1,
    order: 2,
    title: 'NOT',
    goal: 'Build NOT: Y is the opposite of A. You only have NAND.',
    tutorial: 'A NOT gate flips its input. Look at the NAND truth table: what happens when both inputs are the same?',
    hints: ['A wire can go from one output to many inputs.', 'Feed A into both NAND inputs.'],
    afterword: 'NOT is now in your parts list.',
    palette: ['nand'],
    starter: { parts: [sw('A', -10, 0), lamp('Y', 10, 0)], wires: [] },
    tests: [{ kind: 'truth-table', rows: [{ inputs: { A: 0 }, expect: { Y: 1 } }, { inputs: { A: 1 }, expect: { Y: 0 } }] }],
    requires: ['meet-nand'],
  },
  {
    id: 'and-gate',
    version: 1,
    track: 'nand-to-os',
    phase: 1,
    order: 3,
    title: 'AND',
    goal: 'Build AND: Y is on only when A and B are both on.',
    tutorial: 'NAND is "not and". What do you get when you put a NOT after it?',
    hints: ['Two parts are enough.'],
    afterword: 'AND is now in your parts list.',
    palette: ['nand', 'not'],
    starter: { parts: [...twoInputs, lamp('Y', 10, 0)], wires: [] },
    tests: [{ kind: 'truth-table', rows: table2((a, b) => a & b) }],
    requires: ['not-gate'],
  },
  {
    id: 'or-gate',
    version: 1,
    track: 'nand-to-os',
    phase: 1,
    order: 4,
    title: 'OR',
    goal: 'Build OR: Y is on when A or B (or both) are on.',
    tutorial: 'NAND outputs 1 when at least one input is 0. Flip both inputs first and see what NAND does then.',
    hints: ['Invert A and B before they reach the NAND.', 'This is De Morgan\'s law: A OR B = NOT(NOT A AND NOT B).'],
    afterword: 'OR is now in your parts list.',
    palette: ['nand', 'not', 'and'],
    starter: { parts: [...twoInputs, lamp('Y', 10, 0)], wires: [] },
    tests: [{ kind: 'truth-table', rows: table2((a, b) => a | b) }],
    requires: ['and-gate'],
  },
  {
    id: 'xor-gate',
    version: 1,
    track: 'nand-to-os',
    phase: 1,
    order: 5,
    title: 'XOR',
    goal: 'Build XOR: Y is on when exactly one of A and B is on.',
    tutorial: 'XOR is "A or B, but not both". You already have every part you need.',
    hints: ['Combine an OR and a NAND with an AND.', 'It can be done with four NANDs, if you want a challenge.'],
    afterword: 'XOR is the heart of binary addition. You will meet it again in the adder.',
    palette: ['nand', 'not', 'and', 'or'],
    starter: { parts: [...twoInputs, lamp('Y', 10, 0)], wires: [] },
    tests: [{ kind: 'truth-table', rows: table2((a, b) => a ^ b) }],
    requires: ['or-gate'],
  },
];

/** Every level, validated at load. A schema error here fails the build. */
export const LEVELS: Level[] = raw.map((l) => Level.parse({ draft: true, ...l }));

export const levelById = (id: string): Level | undefined => LEVELS.find((l) => l.id === id);
export * from './toy8';
