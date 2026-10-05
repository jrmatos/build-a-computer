import type { Level, PartType } from '@ground-up/schema';
import { column, defineLevel, grow, lamp, rowsOf, sw, truthTable } from '../define';
import { model } from './models';
import { P1_ALL } from './phase1';

/**
 * Phase 2, Arithmetic: binary counting, half adder, full adder, 8-bit adder,
 * two's complement negation, subtractor, equality, less-than (signed and
 * unsigned in one level), logic unit, shifter, 8-bit ALU with flags, widening
 * to 32 bits. Unlocks: splitter, joiner, adder, ALU.
 * DRAFT text (owner approves curriculum text).
 */

/** Byte inputs and outputs, like Turing Complete's byte pins. */
const byteIn = (w: number) => (label: string, x: number, y: number) => sw(label, x, y, w);

/** Deterministic sample of byte pairs (edge cases first), for truth-table rows. */
function bytePairs(count: number): [number, number][] {
  const edges = [0, 1, 2, 0x7f, 0x80, 0x81, 0xfe, 0xff];
  const out: [number, number][] = [];
  for (const a of edges) for (const b of edges) out.push([a, b]);
  let s = 0x2545f491;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) & 0xff;
  };
  while (out.length < count) {
    const a = next();
    out.push([a, out.length % 5 === 0 ? a : next()]);
  }
  return out;
}

const P_BUS = grow(P1_ALL, 'splitter', 'joiner');
const P_ADDER = grow(P_BUS, 'adder', 'const');
const P_ALU = grow(P_ADDER, 'alu');
/** Everything Phase 2 unlocks: the starting palette of Phase 3. */
export const P2_ALL: PartType[] = P_ALU;

const base = { track: 'nand-to-os', phase: 2 } as const;
const ab8 = (outs: Level['starter']['parts']): Level['starter'] => ({ parts: [...column(byteIn(8), ['A', 'B'], -14), ...outs], wires: [] });

const aluEdges = (w: number): Record<string, number>[] => {
  const top = w >= 32 ? 0x80000000 : 1 << (w - 1);
  const max = w >= 32 ? 0xffffffff : (1 << w) - 1;
  const pairs = [
    [0, 0],
    [max, 1],
    [5, 5],
    [top, top],
    [3, 7],
    [200, 100],
    [1, w - 1],
  ];
  return pairs.flatMap(([A, B]) => [0, 1, 2, 3, 4, 5, 6, 7].map((OP) => ({ A: A!, B: B!, OP })));
};

export const PHASE2: Level[] = [
  defineLevel({
    ...base,
    id: 'binary-counting',
    order: 1,
    title: 'Binary counting',
    goal: 'Join the eight bits B0..B7 into one 8-bit number and show it on Y. B0 is worth 1, B1 is worth 2, and so on up to B7, worth 128.',
    tutorial:
      'With one wire you can count to 1. With eight wires you can count to 255. In binary each position is worth twice the one to its right: ' +
      '1, 2, 4, 8, 16, 32, 64, 128. The number 5 is 4 + 1, so B2 and B0 are on.\n\n' +
      'A bus is a bundle of wires that travels together. The joiner bundles single wires into a bus; the splitter does the opposite. ' +
      'Both are now in your parts list.\n\n' +
      'Once Y works, play with it: can you make 42? 200? What is the biggest number you can make?',
    hints: ['Place a joiner and set its width to 8.', 'Input i0 of the joiner is the lowest bit, worth 1. Wire B0 there.', 'Wire B7 to i7 and the joiner output to Y.'],
    afterword: 'Eight bits make a byte. From now on most inputs and outputs are bytes: one pin, eight wires.',
    palette: P_BUS,
    starter: {
      parts: [...column(sw, ['B7', 'B6', 'B5', 'B4', 'B3', 'B2', 'B1', 'B0'], -14), lamp('Y', 14, 0, 8, 'dec')],
      wires: [],
    },
    tests: [
      rowsOf(
        [0, 1, 2, 4, 8, 16, 32, 64, 128, 5, 42, 100, 170, 85, 200, 255].map((v) =>
          Object.fromEntries(Array.from({ length: 8 }, (_, k) => [`B${k}`, (v >> k) & 1])),
        ),
        model('bits8'),
      ),
    ],
    requires: ['decoder-2to4'],
  }),
  defineLevel({
    ...base,
    id: 'half-adder',
    order: 2,
    title: 'Half adder',
    goal: 'Add two bits: S is the sum bit and C is the carry. 1 + 1 = 10 in binary, so S = 0 and C = 1.',
    tutorial:
      'Adding in binary works like adding on paper, column by column. One column of two bits has four cases: 0+0 = 0, 0+1 = 1, 1+0 = 1, and 1+1 = 2, which is written 10: sum 0, carry 1.',
    hints: ['Look at the S column of the truth table. You have built that gate.', 'C is only on when both are on.'],
    afterword: 'A half adder is one XOR and one AND. It is "half" because it cannot take a carry in from the column to its right.',
    palette: P_BUS,
    starter: { parts: [...column(sw, ['A', 'B'], -10), ...column(lamp, ['S', 'C'], 10)], wires: [] },
    tests: [truthTable(['A', 'B'], model('halfadder'))],
    requires: ['binary-counting'],
  }),
  defineLevel({
    ...base,
    id: 'full-adder',
    order: 3,
    title: 'Full adder',
    goal: 'Add three bits A, B and Cin. S is the sum bit, Cout the carry out.',
    tutorial: 'A full adder handles one column of a long addition: the two digits plus the carry from the column to its right. Three bits add up to at most 3, which is 11 in binary.',
    hints: [
      'Two half adders in a row: add A and B, then add Cin to that sum.',
      'Only one of the two half adders can produce a carry. Combine the carries with OR.',
    ],
    afterword: 'Chain eight of these and you have an 8-bit adder. That is your next level.',
    palette: P_BUS,
    starter: { parts: [...column(sw, ['A', 'B', 'Cin'], -10), ...column(lamp, ['S', 'Cout'], 10)], wires: [] },
    tests: [truthTable(['A', 'B', 'Cin'], model('fulladder'))],
    requires: ['half-adder'],
  }),
  defineLevel({
    ...base,
    id: 'adder-8bit',
    order: 4,
    title: '8-bit adder',
    goal: 'S = A + B + Cin on 8 bits. Cout is on when the true sum does not fit in 8 bits.',
    tutorial:
      'Split A and B into bits, add each column with a full adder, and pass every carry to the column on its left. ' +
      'This is a ripple-carry adder: the carry ripples from bit 0 to bit 7.\n\n' +
      'Tip: build one full adder, select it, and copy it seven times. Or make it a chip.',
    hints: [
      'Use a splitter on A and on B (width 8, chunk 1), and a joiner for S.',
      'Bit 0 takes Cin as its carry in. Bit i takes the carry out of bit i - 1.',
      'The carry out of bit 7 is Cout.',
    ],
    afterword: '255 + 1 = 0 with a carry: the adder wraps around. The adder is now in your parts list as a block of any width.',
    palette: P_BUS,
    starter: { parts: [...column(byteIn(8), ['A', 'B'], -14), sw('Cin', -14, 6), lamp('S', 14, -2, 8), lamp('Cout', 14, 2)], wires: [] },
    tests: [
      rowsOf(
        [
          { A: 0, B: 0, Cin: 0 },
          { A: 255, B: 1, Cin: 0 },
          { A: 255, B: 0, Cin: 1 },
          { A: 255, B: 255, Cin: 1 },
          { A: 0x55, B: 0xaa, Cin: 0 },
          { A: 0x55, B: 0xaa, Cin: 1 },
          { A: 100, B: 27, Cin: 0 },
        ],
        model('adder8'),
      ),
      { kind: 'random', inputs: ['A', 'B', 'Cin'], outputs: ['S', 'Cout'], reference: 'adder8', count: 500, seed: 8 },
    ],
    requires: ['full-adder'],
  }),
  defineLevel({
    ...base,
    id: 'negation',
    order: 5,
    title: "Two's complement negation",
    goal: 'Y = -A in 8-bit two\'s complement: the number that, added to A, gives 0.',
    tutorial:
      'Computers store negative numbers by letting the top bit count as -128 instead of +128. So 11111111 is -128 + 127 = -1. ' +
      'This is two\'s complement, and its magic is that the same adder works for signed and unsigned numbers.\n\n' +
      'To negate: flip every bit, then add 1. Check it: 5 is 00000101, flipped 11111010, plus 1 is 11111011, which is -5.\n\n' +
      'Gates now work on whole buses: set a NOT gate\'s width to 8 and it flips all eight bits. A constant part gives you a fixed value.',
    hints: ['Set a NOT gate to width 8.', 'Feed the flipped value into an adder. Where can the + 1 come from?', 'The adder\'s carry in is a free + 1.'],
    afterword: 'Negating -128 gives -128 back: that number has no positive twin in 8 bits. Every fixed-width machine has this quirk.',
    palette: P_ADDER,
    starter: { parts: [sw('A', -14, 0, 8), lamp('Y', 14, 0, 8, 'signed')], wires: [] },
    tests: [{ kind: 'exhaustive', inputs: ['A'], outputs: ['Y'], reference: 'negate8' }],
    requires: ['adder-8bit'],
  }),
  defineLevel({
    ...base,
    id: 'subtractor',
    order: 6,
    title: 'Subtractor',
    goal: 'Y = A - B on 8 bits (wrapping around below 0).',
    tutorial: 'A - B is A + (-B). You know how to make -B, and you have an adder.',
    hints: ['-B is NOT B plus 1.', 'One adder is enough: NOT B into b, and 1 into the carry in.'],
    afterword: 'One adder, one NOT and one carry bit: that is how real ALUs subtract.',
    palette: P_ADDER,
    starter: ab8([lamp('Y', 14, 0, 8)]),
    tests: [{ kind: 'exhaustive', inputs: ['A', 'B'], outputs: ['Y'], reference: 'sub8' }],
    requires: ['negation'],
  }),
  defineLevel({
    ...base,
    id: 'equality',
    order: 7,
    title: 'Equality',
    goal: 'Y is on when A equals B.',
    tutorial: 'Two numbers are equal when every pair of bits is equal. You have a gate that compares two bits, and it works on buses too.',
    hints: ['XNOR (width 8) tells you, bit by bit, where A and B agree.', 'Split the result and AND all eight bits together.', 'Or: XOR, then check that no bit is on.'],
    afterword: 'Branch instructions like "jump if equal" use exactly this circuit.',
    palette: P_ADDER,
    starter: ab8([lamp('Y', 14, 0)]),
    tests: [{ kind: 'exhaustive', inputs: ['A', 'B'], outputs: ['Y'], reference: 'eq8' }],
    requires: ['subtractor'],
  }),
  defineLevel({
    ...base,
    id: 'less-than',
    order: 8,
    title: 'Signed and unsigned less-than',
    goal: 'LTU is on when A < B as unsigned numbers (0..255). LTS is on when A < B as signed numbers (-128..127).',
    tutorial:
      'Subtract and look at the carry. Computing A - B as A + NOT B + 1, the carry out is 1 exactly when no borrow was needed, that is when A >= B.\n\n' +
      'Signed numbers differ only when the signs differ: as unsigned, -1 (255) is bigger than 1, but as signed it is smaller.',
    hints: [
      'LTU = NOT (carry out of A + NOT B + 1).',
      'When A and B have the same top bit, LTS = LTU.',
      'When the top bits differ, the answer flips. LTS = LTU XOR A7 XOR B7.',
    ],
    afterword: 'The same bits, two meanings. Instruction sets carry both comparisons (RISC-V has SLT and SLTU) because only you know what the bits mean.',
    palette: P_ADDER,
    starter: ab8(column(lamp, ['LTU', 'LTS'], 14)),
    tests: [
      rowsOf(
        bytePairs(320).map(([A, B]) => ({ A, B })),
        (i) => ({ LTU: model('lt8u')(i).Y!, LTS: model('lt8s')(i).Y! }),
      ),
    ],
    requires: ['equality'],
  }),
  defineLevel({
    ...base,
    id: 'logic-unit',
    order: 9,
    title: 'Logic unit',
    goal: 'OP picks the operation: 0 = A AND B, 1 = A OR B, 2 = A XOR B, 3 = NOT A. Y is the result.',
    tutorial:
      'A CPU does not have one circuit per instruction that runs alone. It computes every candidate result at once, then a multiplexer picks the one the instruction asked for.\n\n' +
      'OP is a 2-bit number. Its low bit chooses within a pair, its high bit chooses between pairs.',
    hints: ['Compute all four results with 8-bit gates.', 'Split OP into two bits with a splitter.', 'Three 8-bit multiplexers in a tree: two pick by OP bit 0, one picks by OP bit 1.'],
    afterword: 'Compute everything, select one: you will build the whole ALU this way.',
    palette: P_ADDER,
    starter: { parts: [...column(byteIn(8), ['A', 'B'], -14), sw('OP', -14, 6, 2), lamp('Y', 14, 0, 8, 'hex')], wires: [] },
    tests: [
      rowsOf(
        [0, 1, 2, 3].flatMap((OP) => [
          { A: 0xf0, B: 0x3c, OP },
          { A: 0x00, B: 0xff, OP },
          { A: 0xff, B: 0xff, OP },
        ]),
        model('logic8'),
      ),
      { kind: 'random', inputs: ['A', 'B', 'OP'], outputs: ['Y'], reference: 'logic8', count: 500, seed: 9 },
    ],
    requires: ['less-than'],
  }),
  defineLevel({
    ...base,
    id: 'shifter',
    order: 10,
    title: 'Shifter',
    goal: 'Shift A by SH places (0..7): left when DIR is 0, right when DIR is 1. Bits that fall off are lost; new bits are 0.',
    tutorial:
      'Shifting left by one doubles a number; shifting right halves it. On a bus, a shift is only wiring: split, then join with every wire moved one place over and a 0 in the gap.\n\n' +
      'To shift by any amount from 0 to 7, shift in stages of 1, 2 and 4. Each bit of SH decides, through a multiplexer, whether its stage is used.',
    hints: [
      'Shift left by 1: joiner input i0 gets a constant 0, input i(k+1) gets bit k of A.',
      'Three stages (1, 2, 4), each an 8-bit multiplexer between "unchanged" and "shifted".',
      'Build a left shifter and a right shifter, and let DIR pick between them.',
    ],
    afterword: 'This is a barrel shifter. log2(8) = 3 stages handle every shift amount, instead of 8 separate circuits.',
    palette: P_ADDER,
    starter: { parts: [sw('A', -14, -4, 8), sw('SH', -14, 0, 3), sw('DIR', -14, 4), lamp('Y', 14, 0, 8, 'bin')], wires: [] },
    tests: [{ kind: 'exhaustive', inputs: ['A', 'SH', 'DIR'], outputs: ['Y'], reference: 'shift8' }],
    requires: ['logic-unit'],
  }),
  defineLevel({
    ...base,
    id: 'alu-8bit',
    order: 11,
    title: '8-bit ALU with flags',
    goal:
      'OP: 0 add, 1 sub, 2 and, 3 or, 4 xor, 5 not A, 6 shift A left by B, 7 shift A right by B (B\'s low 3 bits). Y is the result. ' +
      'Flags: Z when Y is 0, N when Y\'s top bit is on, C = carry out for add, carry out of A + NOT B + 1 for sub (1 when A >= B), 0 otherwise.',
    tutorial:
      'The arithmetic logic unit is the calculator at the heart of the CPU. You have built every piece: adder, subtractor, logic unit and shifter. ' +
      'Now compute all eight results and select one with OP.\n\n' +
      'The flags summarize the result for the instructions that come after: "jump if zero" reads Z, "jump if negative" reads N, and unsigned comparisons read C.',
    hints: [
      'Eight results, three select bits: a tree of seven 8-bit multiplexers.',
      'Z: OR all bits of Y together and invert. N is bit 7 of Y.',
      'C comes from the add carry when OP = 0 and from the subtract carry when OP = 1. For every other OP it is 0.',
    ],
    afterword: 'The ALU is now in your parts list as a block, with these exact op codes and flags. Your 8-bit CPU will use it in Phase 4.',
    palette: P_ADDER,
    starter: {
      parts: [...column(byteIn(8), ['A', 'B'], -14), sw('OP', -14, 6, 3), lamp('Y', 14, -6, 8), ...column(lamp, ['Z', 'N', 'C'], 14).map((p) => ({ ...p, y: p.y + 4 }))],
      wires: [],
    },
    tests: [
      rowsOf(aluEdges(8), model('alu8')),
      { kind: 'random', inputs: ['A', 'B', 'OP'], outputs: ['Y', 'Z', 'N', 'C'], reference: 'alu8', count: 1000, seed: 11 },
    ],
    requires: ['shifter'],
  }),
  defineLevel({
    ...base,
    id: 'alu-32bit',
    order: 12,
    title: 'Widening to 32 bits',
    goal: 'The same ALU, on 32-bit A, B and Y. Shifts use B\'s low 5 bits. Flags as before, with N from bit 31.',
    tutorial:
      'Nothing about the ALU depends on 8: every bit of AND, OR, XOR and NOT is independent, and the adder just has a longer carry chain. ' +
      'Real processors like the RISC-V core you will build in Phase 5 work on 32-bit words.\n\n' +
      'The ALU block you just unlocked takes a width setting. Building the wide version by hand, from four 8-bit slices chained through their carries, is the long way and a good exercise.',
    hints: ['Place an ALU block and look at its settings.', 'Width 32. The flags come for free.'],
    afterword: 'Phase 2 is done. You have a calculator, but it forgets everything the moment the inputs change. Next: memory and time.',
    palette: P_ALU,
    starter: {
      parts: [...column(byteIn(32), ['A', 'B'], -14), sw('OP', -14, 6, 3), lamp('Y', 14, -6, 32, 'hex'), ...column(lamp, ['Z', 'N', 'C'], 14).map((p) => ({ ...p, y: p.y + 4 }))],
      wires: [],
    },
    tests: [
      rowsOf(aluEdges(32), model('alu32')),
      { kind: 'random', inputs: ['A', 'B', 'OP'], outputs: ['Y', 'Z', 'N', 'C'], reference: 'alu32', count: 1000, seed: 32 },
    ],
    requires: ['alu-8bit'],
  }),
];
