import type { Level, PartType } from '@ground-up/schema';
import { column, defineLevel, grow, lamp, sw, truthTable } from '../define';
import { model } from './models';
import { P0_IO } from './phase0';

/**
 * Phase 1, Gates: NOT, AND, OR, NOR, XOR, XNOR, 3-input AND, 2:1 multiplexer,
 * demultiplexer, 2-to-4 decoder. Each verified gate joins the palette of the
 * levels after it. DRAFT text (owner approves curriculum text).
 */

const AB = (): Level['starter'] => ({ parts: [...column(sw, ['A', 'B'], -10), lamp('Y', 10, 0)], wires: [] });

const P_NOT = grow(P0_IO, 'nand');
const P_AND = grow(P_NOT, 'not');
const P_OR = grow(P_AND, 'and');
const P_NOR = grow(P_OR, 'or');
const P_XOR = grow(P_NOR, 'nor');
const P_XNOR = grow(P_XOR, 'xor');
const P_AND3 = grow(P_XNOR, 'xnor');
const P_MUX = P_AND3;
const P_DEMUX = grow(P_MUX, 'mux');
const P_DECODER = P_DEMUX;
/** Everything Phase 1 unlocks: the starting palette of Phase 2. */
export const P1_ALL: PartType[] = grow(P_DECODER, 'decoder');

const base = { track: 'nand-to-os', phase: 1 } as const;

export const PHASE1: Level[] = [
  defineLevel({
    ...base,
    id: 'not-gate',
    order: 1,
    title: 'NOT',
    goal: 'Build NOT: Y is the opposite of A. You only have NAND.',
    tutorial: 'A NOT gate flips its input. Look at the NAND truth table: what happens when both inputs are the same?',
    hints: ['A wire can go from one output to many inputs.', 'Feed A into both NAND inputs.'],
    afterword: 'NOT is now in your parts list.',
    palette: P_NOT,
    starter: { parts: [sw('A', -10, 0), lamp('Y', 10, 0)], wires: [] },
    tests: [truthTable(['A'], model('not'))],
    requires: ['meet-nand'],
  }),
  defineLevel({
    ...base,
    id: 'and-gate',
    order: 2,
    title: 'AND',
    goal: 'Build AND: Y is on only when A and B are both on.',
    tutorial: 'NAND is "not and". What do you get when you put a NOT after it?',
    hints: ['Two parts are enough.'],
    afterword: 'AND is now in your parts list.',
    palette: P_AND,
    starter: AB(),
    tests: [truthTable(['A', 'B'], model('and'))],
    requires: ['not-gate'],
  }),
  defineLevel({
    ...base,
    id: 'or-gate',
    order: 3,
    title: 'OR',
    goal: 'Build OR: Y is on when A or B (or both) are on.',
    tutorial: 'NAND outputs 1 when at least one input is 0. Flip both inputs first and see what NAND does then.',
    hints: ['Invert A and B before they reach the NAND.', "This is De Morgan's law: A OR B = NOT(NOT A AND NOT B)."],
    afterword: 'OR is now in your parts list.',
    palette: P_OR,
    starter: AB(),
    tests: [truthTable(['A', 'B'], model('or'))],
    requires: ['and-gate'],
  }),
  defineLevel({
    ...base,
    id: 'nor-gate',
    order: 4,
    title: 'NOR',
    goal: 'Build NOR: Y is on only when both A and B are off.',
    tutorial:
      'NOR means "not or". It is the mirror image of NAND: where NAND is 0 only for 1 and 1, NOR is 1 only for 0 and 0. ' +
      'Like NAND, NOR alone could build every other gate.',
    hints: ['You built OR one level ago.', 'Put a NOT after an OR.'],
    afterword: 'NOR is now in your parts list. The Apollo Guidance Computer was built almost entirely from NOR gates.',
    palette: P_NOR,
    starter: AB(),
    tests: [truthTable(['A', 'B'], model('nor'))],
    requires: ['or-gate'],
  }),
  defineLevel({
    ...base,
    id: 'xor-gate',
    order: 5,
    title: 'XOR',
    goal: 'Build XOR: Y is on when exactly one of A and B is on.',
    tutorial: 'XOR is "A or B, but not both". You already have every part you need.',
    hints: ['"A or B" and "not both" are two gates you already have.', 'Combine an OR and a NAND with an AND.', 'It can be done with four NANDs, if you want a challenge.'],
    afterword: 'XOR is the heart of binary addition. You will meet it again in the adder.',
    palette: P_XOR,
    starter: AB(),
    tests: [truthTable(['A', 'B'], model('xor'))],
    requires: ['nor-gate'],
  }),
  defineLevel({
    ...base,
    id: 'xnor-gate',
    order: 6,
    title: 'XNOR',
    goal: 'Build XNOR: Y is on when A and B are the same.',
    tutorial: 'XNOR answers the question "are these two bits equal?". Later you will ask that question about whole numbers.',
    hints: ['It is the opposite of XOR.', 'One XOR and one NOT.'],
    afterword: 'XNOR is now in your parts list. Keep it in mind for the equality level.',
    palette: P_XNOR,
    starter: AB(),
    tests: [truthTable(['A', 'B'], model('xnor'))],
    requires: ['xor-gate'],
  }),
  defineLevel({
    ...base,
    id: 'and3-gate',
    order: 7,
    title: '3-input AND',
    goal: 'Y is on only when A, B and C are all on.',
    tutorial:
      'Gates have two inputs, but questions often have more. "All of these" is an AND of an AND. ' +
      'The truth table now has 8 rows: every extra input doubles it.',
    hints: ['AND two of the inputs first.', 'Then AND that result with the third input.'],
    afterword: 'Chaining gates like this is how wide ANDs and ORs are made. Eight inputs take seven 2-input gates, in a tree three gates deep.',
    palette: P_AND3,
    starter: { parts: [...column(sw, ['A', 'B', 'C'], -10), lamp('Y', 10, 0)], wires: [] },
    tests: [truthTable(['A', 'B', 'C'], model('and3'))],
    requires: ['xnor-gate'],
  }),
  defineLevel({
    ...base,
    id: 'mux',
    order: 8,
    title: '2:1 multiplexer',
    goal: 'When S is off, Y shows A. When S is on, Y shows B.',
    tutorial:
      'A multiplexer is a switch controlled by a signal. The select input S chooses which data input reaches the output. ' +
      'This is how a computer picks between two values, for example "the result of add or the result of subtract".',
    hints: [
      'Think of two cases: "A and not S" and "B and S".',
      'Exactly one of those two cases can be true at a time. Combine them with OR.',
      'Y = (A AND NOT S) OR (B AND S).',
    ],
    afterword: 'The multiplexer is now in your parts list as a block. Its pins are a, b, sel and out; sel = 0 picks a.',
    palette: P_MUX,
    starter: { parts: [...column(sw, ['A', 'B', 'S'], -10), lamp('Y', 10, 0)], wires: [] },
    tests: [truthTable(['S', 'A', 'B'], model('mux1'))],
    requires: ['and3-gate'],
  }),
  defineLevel({
    ...base,
    id: 'demux',
    order: 9,
    title: 'Demultiplexer',
    goal: 'Send X to output A when S is off, and to output B when S is on. The other output stays off.',
    tutorial: 'A demultiplexer is the multiplexer run backwards: one input, a choice of destinations. It is how a value is routed to one register out of many.',
    hints: ['Each output is X gated by a condition on S.', 'A = X AND NOT S. What is B?'],
    afterword: 'You will meet this idea again when a CPU decides which register receives a result.',
    palette: P_DEMUX,
    starter: { parts: [...column(sw, ['X', 'S'], -10), ...column(lamp, ['A', 'B'], 10)], wires: [] },
    tests: [truthTable(['S', 'X'], model('demux1'))],
    requires: ['mux'],
  }),
  defineLevel({
    ...base,
    id: 'decoder-2to4',
    order: 10,
    title: '2-to-4 decoder',
    goal: 'S1 and S0 form a 2-bit number (S1 is the high bit). Turn on exactly one lamp: Y0 for 00, Y1 for 01, Y2 for 10, Y3 for 11.',
    tutorial:
      'A decoder turns a number into "one of N" lines. A CPU uses one to turn the bits of an instruction into "this is an add", "this is a load", and so on.\n\n' +
      'Each output is an AND of S1 or NOT S1 with S0 or NOT S0.',
    hints: ['Y0 is on when S1 is off and S0 is off.', 'Make NOT S1 and NOT S0 once, then use four ANDs.', 'Y2 = S1 AND NOT S0.'],
    afterword:
      'The decoder is now in your parts list as a block, with its select width as a setting. Phase 1 is done: every gate you will need is in your hands.',
    palette: P_DECODER,
    starter: { parts: [...column(sw, ['S1', 'S0'], -10), ...column(lamp, ['Y0', 'Y1', 'Y2', 'Y3'], 10)], wires: [] },
    tests: [truthTable(['S1', 'S0'], model('decoder2'))],
    requires: ['demux'],
  }),
];
