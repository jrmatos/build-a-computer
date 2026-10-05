import type { Level, PartType } from '@ground-up/schema';
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
    hints: ['Pins are the small circles on the edges of a part. Outputs are on the right, inputs on the left.', 'Click the switch to flip it and watch the lamp follow.'],
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
    hints: ['Start a new wire from switch A\'s output pin, even though it already has one.', 'Wires may cross. Only the pins they end on matter.'],
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
    hints: ["Drag from a switch's pin to a NAND input to make a wire.", 'Flip the switches to watch Y change.'],
    afterword: 'You just used the only gate you will ever need. Next, you build NOT out of it.',
    palette: [...P0_IO, 'nand'],
    starter: { parts: [...column(sw, ['A', 'B'], -10), lamp('Y', 10, 0)], wires: [] },
    tests: [truthTable(['A', 'B'], model('nand'))],
    // Open from the start, like the onboarding levels: a player who already knows wires can jump in.
    requires: [],
  }),
];
