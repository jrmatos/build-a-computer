import type { Level, PartType } from '@build-a-computer/schema';
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
    tutorial:
      'A NOT gate flips its input: 0 becomes 1 and 1 becomes 0. You only have NAND, so look at its truth table again. What does it do when both inputs are the same?\n\n' +
      '| A | Y |\n|---|---|\n| 0 | 1 |\n| 1 | 0 |',
    hints: [
      'Y must be the opposite of A. Look at the NAND table, but only at the rows where both inputs are the same.',
      'NAND(0, 0) = 1 and NAND(1, 1) = 0. Give NAND the same value on both inputs and it flips it. That is NOT.',
      'You need 1 part: one NAND.',
      'Wire A → NAND input a. Start a second wire from A and end it on NAND input b. Wire the NAND output → Y.',
    ],
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
    tutorial:
      'AND outputs 1 only when both inputs are 1. Compare it with NAND, "not and": every row is the opposite. What do you get when you put a NOT after a NAND?\n\n' +
      '| A | B | Y |\n|---|---|---|\n| 0 | 0 | 0 |\n| 0 | 1 | 0 |\n| 1 | 0 | 0 |\n| 1 | 1 | 1 |',
    hints: [
      "AND is 1 only when A and B are both 1. Put its table next to NAND's: every Y is the opposite.",
      "NAND means NOT AND. So AND is NOT NAND: flip the NAND's answer and you are done.",
      'You need 2 parts: one NAND and one NOT. NOT is in your parts list now, from the last level.',
      'Wire A → NAND input a and B → NAND input b. Wire the NAND output → NOT input. Wire the NOT output → Y.',
    ],
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
    tutorial:
      'OR outputs 1 when at least one input is 1. NAND outputs 1 when at least one input is 0. Flip both inputs first and see what NAND does then.\n\n' +
      '| A | B | Y |\n|---|---|---|\n| 0 | 0 | 0 |\n| 0 | 1 | 1 |\n| 1 | 0 | 1 |\n| 1 | 1 | 1 |',
    hints: [
      'Y is 1 when A is 1, or B is 1, or both. Only the 0, 0 row gives 0.',
      'NAND is 1 when A is 0 OR B is 0. OR is the same idea but for 1s. So if you flip A and B first, NAND does exactly what OR should.',
      'You need 3 parts: two NOTs and one NAND.',
      "Wire A → NOT, B → NOT. Wire both NOT outputs into the NAND's two inputs. Wire the NAND output to Y.",
      'Check row 0, 0: both NOTs give 1, and NAND(1, 1) = 0. Every other row sends a 0 into the NAND, so Y = 1.',
    ],
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
      'NOR means "not or". It is the mirror image of NAND: where NAND is 0 only for 1 and 1, NOR is 1 only for 0 and 0. Like NAND, NOR alone could build every other gate.\n\n' +
      '| A | B | Y |\n|---|---|---|\n| 0 | 0 | 1 |\n| 0 | 1 | 0 |\n| 1 | 0 | 0 |\n| 1 | 1 | 0 |',
    hints: [
      'NOR is OR with every answer flipped. Only the 0, 0 row gives 1.',
      'You built OR one level ago, and it is in your parts list now. Flip its output.',
      'You need 2 parts: one OR and one NOT.',
      'Wire A → OR input a and B → OR input b. Wire the OR output → NOT input, and the NOT output → Y.',
    ],
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
    tutorial:
      'XOR is "A or B, but not both": it is 1 when the inputs differ. You already have every part you need.\n\n' +
      '| A | B | Y |\n|---|---|---|\n| 0 | 0 | 0 |\n| 0 | 1 | 1 |\n| 1 | 0 | 1 |\n| 1 | 1 | 0 |',
    hints: [
      'Y is 1 in the two middle rows, where A and B differ. The 1, 1 row must give 0.',
      'Split the sentence. "A or B" is an OR gate. "Not both" is a NAND gate. "But" means both must be true: AND.',
      'You need 3 parts: one OR, one NAND and one AND.',
      'Wire A and B into the OR. Wire A and B into the NAND too: one output can feed many inputs.',
      'Wire the OR output → AND input a, and the NAND output → AND input b. Wire the AND output → Y.',
    ],
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
    tutorial:
      'XNOR answers the question "are these two bits equal?". Later you will ask that question about whole numbers.\n\n' +
      '| A | B | Y |\n|---|---|---|\n| 0 | 0 | 1 |\n| 0 | 1 | 0 |\n| 1 | 0 | 0 |\n| 1 | 1 | 1 |',
    hints: [
      'Y is 1 when A and B are the same: rows 0, 0 and 1, 1. That is every row of XOR, flipped.',
      'XOR is in your parts list now. Flip its output.',
      'You need 2 parts: one XOR and one NOT.',
      'Wire A → XOR input a and B → XOR input b. Wire the XOR output → NOT, and the NOT output → Y.',
    ],
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
    hints: [
      'Only one of the 8 rows gives 1: the one where A, B and C are all 1.',
      'An AND gate has two inputs. "A and B and C" is "(A and B) and C": combine two, then add the third.',
      'You need 2 parts: two AND gates.',
      "Wire A and B into the first AND. Wire its output → the second AND's input a, and C → its input b. Second AND output → Y.",
    ],
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
      'A multiplexer is a switch controlled by a signal. The select input S chooses which data input reaches the output. This is how a computer picks between two values, for example "the result of add or the result of subtract".\n\n' +
      '| S | Y |\n|---|---|\n| 0 | A |\n| 1 | B |',
    hints: [
      'S is the selector. When S is 0, Y copies A and ignores B. When S is 1, Y copies B and ignores A.',
      'Split it into two cases. "Pass A when S is 0" is A AND NOT S. "Pass B when S is 1" is B AND S.',
      'Only one case can be on at a time, so OR them: Y = (A AND NOT S) OR (B AND S).',
      'You need 4 parts: one NOT, two ANDs and one OR.',
      'Wire S → NOT. First AND: A and the NOT output. Second AND: B and S. Both AND outputs → the OR, and the OR output → Y.',
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
    hints: [
      'X goes to exactly one lamp. S = 0 picks lamp A, S = 1 picks lamp B. The lamp not picked shows 0.',
      'AND works like a door: X AND 1 = X, and X AND 0 = 0. So AND X with "this lamp is picked".',
      'A is picked when S is 0, so A = X AND NOT S. B is picked when S is 1, so B = X AND S.',
      'You need 3 parts: one NOT and two ANDs.',
      'Wire S → NOT. First AND: X and the NOT output, into lamp A. Second AND: X and S, into lamp B.',
    ],
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
    hints: [
      'Read S1 S0 as a number from 0 to 3. Only the lamp with that number lights: 10 is 2, so only Y2.',
      'Each lamp checks one pattern. Y2 wants S1 = 1 and S0 = 0, so Y2 = S1 AND NOT S0.',
      'You need 6 parts: two NOTs (for NOT S1 and NOT S0) and four ANDs, one per lamp.',
      'Y0 = NOT S1 AND NOT S0. Y1 = NOT S1 AND S0. Y2 = S1 AND NOT S0. Y3 = S1 AND S0.',
      "Wire S1 → one NOT and S0 → the other. Wire each AND's inputs as listed, and its output to its lamp.",
    ],
    afterword:
      'The decoder is now in your parts list as a block, with its select width as a setting. Phase 1 is done: every gate you will need is in your hands.',
    palette: P_DECODER,
    starter: { parts: [...column(sw, ['S1', 'S0'], -10), ...column(lamp, ['Y0', 'Y1', 'Y2', 'Y3'], 10)], wires: [] },
    tests: [truthTable(['S1', 'S0'], model('decoder2'))],
    requires: ['demux'],
  }),
];
