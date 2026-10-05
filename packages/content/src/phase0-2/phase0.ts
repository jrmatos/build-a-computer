import type { Level, PartType } from '@build-a-computer/schema';
import { column, defineLevel, lamp, sw, truthTable } from '../define';
import { model } from './models';

/**
 * Phase 0, Onboarding: wires and lamps; switches; meet NAND.
 * Unlocks: lamp, switch, NAND. DRAFT text (owner approves curriculum text).
 */

export const P0_LAMP: PartType[] = ['lamp'];
export const P0_IO: PartType[] = ['switch', 'lamp'];

export const PHASE0: Level[] = [
  defineLevel({
    id: 'wires-and-lamps',
    track: 'nand-to-os',
    phase: 0,
    order: 1,
    title: 'Wires and lamps',
    goal: 'Connect switch A to lamp Y with a wire, so the lamp shows what the switch says.',
    tutorial:
      'Everything in a computer is a wire that is either on (1) or off (0). A switch puts a value on a wire; a lamp shows the value it receives.\n\n' +
      'Drag from the small circle on the right of the switch (its output pin) to the circle on the left of the lamp (its input pin). That is a wire. ' +
      'A lamp with nothing connected shows X: unknown. Unknown is never the right answer.',
    hints: [
      'The whole goal is one wire. When A is 1, Y must be 1. When A is 0, Y must be 0.',
      'Pins are the small circles on the edges of a part. Outputs are on the right, inputs on the left.',
      'Press on the circle on the right of switch A, drag to the circle on the left of lamp Y, and let go.',
      'Click the switch to flip it and watch the lamp follow.',
    ],
    afterword: 'A wire just copies a value from one place to another. It will carry every bit of every program you run on this computer.',
    palette: [],
    starter: { parts: [sw('A', -8, 0), lamp('Y', 8, 0)], wires: [] },
    tests: [truthTable(['A'], model('wire'))],
  }),
  defineLevel({
    id: 'switches',
    track: 'nand-to-os',
    phase: 0,
    order: 2,
    title: 'Switches',
    goal: 'Lamp X shows switch B. Lamps Y and Z both show switch A.',
    tutorial:
      'One output can feed as many inputs as you like: drag a second wire from the same pin. ' +
      'But an input takes exactly one wire. Two outputs fighting over one wire is a short circuit, and the editor will flag it.\n\n' +
      'The test flips the switches through every combination and checks every lamp each time.',
    hints: [
      'Three lamps, two switches. X copies B. Y and Z both copy A, so A needs two wires.',
      'One output pin can start as many wires as you like. Each input pin takes exactly one wire.',
      'You need 3 wires and no extra parts.',
      "Wire B → X and A → Y. Then start a second wire from A's output pin and end it on Z.",
      'Wires may cross. Only the pins they end on matter.',
    ],
    afterword: 'Fan-out (one output, many inputs) is free in this game. You now have switches and lamps in your parts list for testing your own ideas.',
    palette: P0_LAMP,
    starter: { parts: [...column(sw, ['A', 'B'], -10), ...column(lamp, ['X', 'Y', 'Z'], 10)], wires: [] },
    tests: [truthTable(['A', 'B'], (i) => ({ X: i.B!, Y: i.A!, Z: i.A! }))],
    requires: ['wires-and-lamps'],
  }),
  defineLevel({
    id: 'meet-nand',
    track: 'nand-to-os',
    phase: 0,
    order: 3,
    title: 'Meet NAND',
    goal: 'Connect A and B to a NAND gate and its output to Y. Y is off only when both A and B are on.',
    tutorial:
      'NAND means "not and". Its output is 1 unless both inputs are 1. Every other part in this game will be built from it.\n\n' +
      '| A | B | Y |\n|---|---|---|\n| 0 | 0 | 1 |\n| 0 | 1 | 1 |\n| 1 | 0 | 1 |\n| 1 | 1 | 0 |',
    hints: [
      'Look at the table: Y is 0 only in the last row, when A and B are both 1. That is exactly what NAND does.',
      'You need 1 part: one NAND gate from the parts list.',
      "Wire A → the NAND's input a and B → its input b. Either order works.",
      "Wire the NAND's output (on its right) → Y. Flip the switches to check all four rows.",
    ],
    afterword: 'You just used the only gate you will ever need. Next, you build NOT out of it.',
    palette: [...P0_IO, 'nand'],
    starter: { parts: [...column(sw, ['A', 'B'], -10), lamp('Y', 10, 0)], wires: [] },
    tests: [truthTable(['A', 'B'], model('nand'))],
    // Open from the start, like the onboarding levels: a player who already knows wires can jump in.
    requires: [],
  }),
];
