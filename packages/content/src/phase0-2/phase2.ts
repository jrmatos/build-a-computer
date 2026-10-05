import type { Level, PartType } from '@build-a-computer/schema';
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
    hints: [
      'Y is one 8-bit number. B0 adds 1 when on, B1 adds 2, B2 adds 4, and so on up to B7, which adds 128.',
      'A joiner takes single wires on its left (i0 to i7) and bundles them into one bus on its right.',
      'You need 1 part: one joiner. A new joiner is already 8 bits wide, 1 bit per chunk.',
      'Input i0 is the lowest bit, worth 1. Wire B0 → i0, B1 → i1, and so on up to B7 → i7.',
      "Wire the joiner's output → Y. Turn on B2 and B0: Y should show 5.",
    ],
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
    hints: [
      'Fill in the table: S is 0, 1, 1, 0 and C is 0, 0, 0, 1. Both columns are gates you have built.',
      'S is 1 when exactly one input is 1: that is XOR. C is 1 only when both are 1: that is AND.',
      'You need 2 parts: one XOR and one AND.',
      'Wire A and B into the XOR, and its output → S. Wire A and B into the AND as well, and its output → C.',
    ],
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
      'Count how many of A, B and Cin are 1. S is 1 when the count is odd (1 or 3). Cout is 1 when it is 2 or 3.',
      'Do it in two steps, like two half adders. First add A and B. Then add Cin to that partial sum.',
      'Only one of the two steps can make a carry, so Cout is the OR of the two carries.',
      'You need 5 parts: two XORs, two ANDs and one OR.',
      'P = A XOR B. S = P XOR Cin. Cout = (A AND B) OR (P AND Cin). Build and wire each gate in that order.',
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
      'Add like on paper: column by column, from the right. Each column is one full adder, like the last level.',
      'Column 0 adds bit 0 of A, bit 0 of B and Cin. Its carry out goes into column 1, and so on up to column 7.',
      'You need 2 splitters (for A and B), 8 full adders of 5 gates each, and 1 joiner (for S).',
      'Splitter output o0 is bit 0, the lowest. Full adder k takes o*k* from both splitters, plus the carry from adder k - 1.',
      'Adder 0 takes Cin as its carry. Each sum bit k goes to joiner input i*k*, joiner output → S. The carry out of adder 7 → Cout.',
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
    hints: [
      '-A is the number you add to A to get 0. The recipe: flip every bit of A, then add 1.',
      'One NOT set to width 8 flips all eight bits at once. An adder block does the + 1.',
      'You need 4 parts: a NOT (width 8), an adder (width 8), an 8-bit constant 0 and a 1-bit constant 1.',
      'Wire A → NOT. Wire the NOT output → adder a, constant 0 → adder b, constant 1 → adder cin.',
      "Wire the adder's sum → Y and leave cout unconnected. Check it: A = 5 should show -5.",
    ],
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
    tutorial:
      'A - B is A + (-B). In the last level you made -A by flipping the bits and adding 1. Do the same to B, and let one adder add it to A.',
    hints: [
      'A - B is A + (-B). And from the last level, -B is NOT B plus 1.',
      'One adder can do it all: A on input a, NOT B on input b, and the + 1 on the carry in.',
      'You need 3 parts: a NOT (width 8), an adder (width 8) and a constant 1.',
      'Wire A → adder a. Wire B → NOT, and the NOT output → adder b. Wire constant 1 → adder cin, and adder sum → Y.',
    ],
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
    hints: [
      'A equals B when bit 0 matches bit 0, bit 1 matches bit 1, and so on for all eight. One mismatch makes Y = 0.',
      'XNOR is 1 when two bits match. Set an XNOR to width 8 and it compares all eight pairs at once.',
      'Then you need "all eight are 1": an 8-input AND, built from 2-input ANDs like the 3-input AND level.',
      'You need 9 parts: one XNOR (width 8), one splitter and seven ANDs.',
      'Wire A, B → XNOR → splitter. AND o0 with o1, o2 with o3, o4 with o5, o6 with o7. AND those four in pairs, then the last two → Y.',
    ],
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
      'Start with LTU. Build A - B like the subtractor. Its cout is 1 when A >= B, so LTU = NOT cout.',
      'For LTS, bit 7 is the sign bit. When A and B have the same sign, signed and unsigned agree: LTS = LTU.',
      'When the signs differ, the answer flips. A7 XOR B7 is 1 exactly then, so LTS = LTU XOR A7 XOR B7.',
      'You need 8 parts: a NOT (width 8), an adder, a constant 1, a 1-bit NOT, two splitters and two XORs.',
      'Adder: a = A, b = NOT B, cin = 1. Then cout → NOT → LTU. Split A and B, XOR their o7 pins, XOR that with LTU → LTS.',
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
    hints: [
      'Do not build one circuit that changes. Build all four answers at once, then let OP choose one.',
      'Four gates with width 8 give the answers: A AND B, A OR B, A XOR B and NOT A.',
      'Choosing 1 of 4 takes three 8-bit multiplexers in a tree. Split OP (width 2) into o0, the low bit, and o1.',
      'You need 8 parts: four gates, one splitter and three multiplexers. Everything is width 8 except the splitter.',
      'Mux 1: a = AND, b = OR, sel = o0. Mux 2: a = XOR, b = NOT, sel = o0. Mux 3: a = mux 1, b = mux 2, sel = o1, out → Y.',
    ],
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
      'A shift is only rewiring. Shift left by 1: bit 0 becomes 0, bit 1 gets old bit 0, bit 2 gets old bit 1, and so on.',
      'Any amount from 0 to 7 is a sum of 1, 2 and 4. SH bit 0 means "shift by 1", bit 1 "by 2", bit 2 "by 4".',
      'One stage shifts by k: split the value, then join it back with every bit moved k places and constant 0 in the gaps.',
      'An 8-bit mux after each stage picks a = unchanged or b = shifted. Chain stages 1, 2, 4 with sel = SH bits o0, o1, o2.',
      'Build one chain for left and one for right. A last mux picks: a = left, b = right, sel = DIR. That is 21 parts in all.',
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
      'Same plan as the logic unit, just bigger: build all eight results side by side, then let OP pick one.',
      'Results: 0 is an adder (A, B, cin 0). 1 is the subtractor. 2 to 4 are AND, OR, XOR. 5 is NOT A.',
      "6 and 7 are your left and right shifters from the last level. Their SH is B's low 3 bits: o0 to o2 of a splitter on B.",
      'Pick 1 of 8 with seven 8-bit muxes. Split OP (width 3): o0 drives the first four muxes, o1 the next two, o2 the last.',
      'Flags: split Y. N is o7. Z is NOT of an 8-input OR. C: a mux picks add cout or sub cout by OP o0, ANDed with NOR(o1, o2).',
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
    hints: [
      'Same job as the last level, on 32-bit buses. The ALU block you just unlocked already does it.',
      'You need 1 part: an ALU block. Select it and set Width (bits) to 32 in Settings.',
      'Wire A → a, B → b and OP → op. Wire out → Y.',
      'The flag pins are zero → Z, neg → N and carry → C.',
    ],
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
