/**
 * Reference functions for 'exhaustive' and 'random' level tests.
 *
 * Conventions (for content authors building levels):
 * - Keys of REFERENCES are reference names (usually the level's label, e.g.
 *   'adder8'). A level's test names one with `reference: '<name>'`.
 * - Inputs and outputs are keyed by the level's input/output LABELS, exactly
 *   as listed in REFERENCE_SIGNATURES (case-sensitive: 'A', 'B', 'Cin', ...).
 *   Label the board's switches and lamps with these names.
 * - Values are unsigned integers of the port's width (two's complement
 *   patterns for signed values: -1 in 8 bits is 255). Inputs are masked to
 *   their width; a missing input reads as 0.
 * - Single-bit gates use A, B (and C) → Y. 'not' takes only A.
 * - Multi-bit buses are one labelled port of the given width (an 8-bit A is
 *   one 8-bit switch), except where a signature lists bits separately.
 * - decoder2: select bits are S0 (low) and S1 (high), outputs Y0..Y3 with
 *   Yi = 1 when S1S0 = i. A level that uses one 2-bit switch may label it
 *   'S' instead: when an input 'S' is present it wins over S0/S1.
 * - demux1: X routed to A when S = 0, to B when S = 1; the other output is 0.
 * - mux1: Y = S ? B : A.
 * - Arithmetic wraps to the output width. Carry out is Cout / C.
 * - logic8 OP: 0 and, 1 or, 2 xor, 3 not A (B ignored).
 * - shift8: DIR 0 = shift left, 1 = logical shift right, by SH (0..7).
 * - alu8 / alu32 OP follows ALU_OPS (0 add, 1 sub, 2 and, 3 or, 4 xor, 5 not,
 *   6 shl, 7 shr). Flags: Z = Y is 0, N = top bit of Y, C = carry out of add,
 *   NOT borrow for sub (1 when A >= B unsigned), 0 otherwise. Shifts use B's
 *   low 3 (8-bit) or 5 (32-bit) bits; shr is logical. Same as the `alu` block.
 */

export interface ReferencePort {
  name: string;
  width: number;
}

export interface ReferenceSignature {
  inputs: ReferencePort[];
  outputs: ReferencePort[];
  /** One line for authors: what the reference computes. */
  description: string;
}

export type ReferenceFn = (inputs: Record<string, number>) => Record<string, number>;

const p = (name: string, width = 1): ReferencePort => ({ name, width });
const m = (w: number): number => (w >= 32 ? 0xffffffff : 2 ** w - 1);
const b = (x: boolean): number => (x ? 1 : 0);

const ab = [p('A'), p('B')];
const Y = [p('Y')];
const ALU_DOC = 'OP per ALU_OPS (add, sub, and, or, xor, not, shl, shr); Z zero, N top bit, C carry / NOT borrow';

/** Inputs and outputs (with widths) of every reference, keyed by name. */
export const REFERENCE_SIGNATURES = {
  not: { inputs: [p('A')], outputs: Y, description: 'Y = NOT A' },
  and: { inputs: ab, outputs: Y, description: 'Y = A AND B' },
  or: { inputs: ab, outputs: Y, description: 'Y = A OR B' },
  nor: { inputs: ab, outputs: Y, description: 'Y = NOT (A OR B)' },
  xor: { inputs: ab, outputs: Y, description: 'Y = A XOR B' },
  xnor: { inputs: ab, outputs: Y, description: 'Y = NOT (A XOR B)' },
  nand: { inputs: ab, outputs: Y, description: 'Y = NOT (A AND B)' },
  and3: { inputs: [p('A'), p('B'), p('C')], outputs: Y, description: 'Y = A AND B AND C' },
  mux1: { inputs: [p('A'), p('B'), p('S')], outputs: Y, description: 'Y = S ? B : A' },
  demux1: { inputs: [p('X'), p('S')], outputs: [p('A'), p('B')], description: 'A = X when S = 0, B = X when S = 1' },
  decoder2: {
    inputs: [p('S0'), p('S1')],
    outputs: [p('Y0'), p('Y1'), p('Y2'), p('Y3')],
    description: 'Yi = 1 when S1S0 = i (a 2-bit input labelled S may replace S0/S1)',
  },
  halfadder: { inputs: ab, outputs: [p('S'), p('C')], description: 'S = A XOR B, C = A AND B' },
  fulladder: { inputs: [p('A'), p('B'), p('Cin')], outputs: [p('S'), p('Cout')], description: 'A + B + Cin = 2 Cout + S' },
  adder8: {
    inputs: [p('A', 8), p('B', 8), p('Cin')],
    outputs: [p('S', 8), p('Cout')],
    description: '8-bit A + B + Cin; S wraps, Cout is the carry out',
  },
  negate8: { inputs: [p('A', 8)], outputs: [p('Y', 8)], description: "Y = -A (two's complement, wraps: -128 stays 128)" },
  sub8: { inputs: [p('A', 8), p('B', 8)], outputs: [p('Y', 8)], description: 'Y = A - B, wrapping to 8 bits' },
  eq8: { inputs: [p('A', 8), p('B', 8)], outputs: Y, description: 'Y = 1 when A = B' },
  lt8u: { inputs: [p('A', 8), p('B', 8)], outputs: Y, description: 'Y = 1 when A < B as unsigned' },
  lt8s: { inputs: [p('A', 8), p('B', 8)], outputs: Y, description: "Y = 1 when A < B as signed two's complement" },
  logic8: {
    inputs: [p('A', 8), p('B', 8), p('OP', 2)],
    outputs: [p('Y', 8)],
    description: 'OP 0: A AND B, 1: A OR B, 2: A XOR B, 3: NOT A',
  },
  shift8: {
    inputs: [p('A', 8), p('SH', 3), p('DIR')],
    outputs: [p('Y', 8)],
    description: 'DIR 0: Y = A << SH, DIR 1: Y = A >> SH (logical)',
  },
  alu8: { inputs: [p('A', 8), p('B', 8), p('OP', 3)], outputs: [p('Y', 8), p('Z'), p('N'), p('C')], description: ALU_DOC },
  adder32: {
    inputs: [p('A', 32), p('B', 32), p('Cin')],
    outputs: [p('S', 32), p('Cout')],
    description: '32-bit A + B + Cin; S wraps, Cout is the carry out',
  },
  alu32: { inputs: [p('A', 32), p('B', 32), p('OP', 3)], outputs: [p('Y', 32), p('Z'), p('N'), p('C')], description: ALU_DOC },
} satisfies Record<string, ReferenceSignature>;

export type ReferenceName = keyof typeof REFERENCE_SIGNATURES;

type In = Record<string, number>;

function add(a: number, bb: number, cin: number, w: number): { s: number; c: number } {
  const t = a + bb + cin; // < 2^33 for w <= 32: exact in a double.
  return { s: t % 2 ** w, c: b(t >= 2 ** w) };
}

function alu(a: number, bv: number, op: number, w: number): Record<string, number> {
  const mw = m(w);
  const sh = bv % w; // w is 8 or 32: the low 3 or 5 bits of B.
  let y: number;
  let c = 0;
  switch (op) {
    case 0:
      ({ s: y, c } = add(a, bv, 0, w));
      break;
    case 1:
      y = (a - bv + 2 ** w) % 2 ** w;
      c = b(a >= bv);
      break;
    case 2:
      y = (a & bv) >>> 0;
      break;
    case 3:
      y = (a | bv) >>> 0;
      break;
    case 4:
      y = (a ^ bv) >>> 0;
      break;
    case 5:
      y = mw - a;
      break;
    case 6:
      y = ((a << sh) & mw) >>> 0;
      break;
    default:
      y = a >>> sh;
  }
  return { Y: y, Z: b(y === 0), N: b(y >= 2 ** (w - 1)), C: c };
}

const sx8 = (v: number): number => (v >= 128 ? v - 256 : v);

const IMPL: Record<ReferenceName, (i: In) => In> = {
  not: (i) => ({ Y: 1 - i.A! }),
  and: (i) => ({ Y: i.A! & i.B! }),
  or: (i) => ({ Y: i.A! | i.B! }),
  nor: (i) => ({ Y: 1 - (i.A! | i.B!) }),
  xor: (i) => ({ Y: i.A! ^ i.B! }),
  xnor: (i) => ({ Y: 1 - (i.A! ^ i.B!) }),
  nand: (i) => ({ Y: 1 - (i.A! & i.B!) }),
  and3: (i) => ({ Y: i.A! & i.B! & i.C! }),
  mux1: (i) => ({ Y: i.S ? i.B! : i.A! }),
  demux1: (i) => ({ A: i.S ? 0 : i.X!, B: i.S ? i.X! : 0 }),
  decoder2: (i) => {
    const s = i.S !== undefined ? i.S : i.S0! + 2 * i.S1!;
    return { Y0: b(s === 0), Y1: b(s === 1), Y2: b(s === 2), Y3: b(s === 3) };
  },
  halfadder: (i) => ({ S: i.A! ^ i.B!, C: i.A! & i.B! }),
  fulladder: (i) => {
    const t = i.A! + i.B! + i.Cin!;
    return { S: t % 2, Cout: b(t >= 2) };
  },
  adder8: (i) => {
    const r = add(i.A!, i.B!, i.Cin!, 8);
    return { S: r.s, Cout: r.c };
  },
  negate8: (i) => ({ Y: (256 - i.A!) % 256 }),
  sub8: (i) => ({ Y: (i.A! - i.B! + 256) % 256 }),
  eq8: (i) => ({ Y: b(i.A === i.B) }),
  lt8u: (i) => ({ Y: b(i.A! < i.B!) }),
  lt8s: (i) => ({ Y: b(sx8(i.A!) < sx8(i.B!)) }),
  logic8: (i) => ({ Y: [i.A! & i.B!, i.A! | i.B!, i.A! ^ i.B!, 255 - i.A!][i.OP!]! }),
  shift8: (i) => ({ Y: i.DIR ? i.A! >>> i.SH! : (i.A! << i.SH!) & 255 }),
  alu8: (i) => alu(i.A!, i.B!, i.OP!, 8),
  adder32: (i) => {
    const r = add(i.A!, i.B!, i.Cin!, 32);
    return { S: r.s, Cout: r.c };
  },
  alu32: (i) => alu(i.A!, i.B!, i.OP!, 32),
};

/** Mask each declared input to its width (missing → 0); pass undeclared ones (e.g. decoder2's S) through masked to 32 bits. */
function wrap(name: ReferenceName): ReferenceFn {
  const sig: ReferenceSignature = REFERENCE_SIGNATURES[name];
  const impl = IMPL[name];
  return (raw) => {
    const inputs: In = {};
    for (const [k, v] of Object.entries(raw)) inputs[k] = v >>> 0;
    for (const port of sig.inputs) inputs[port.name] = ((raw[port.name] ?? 0) >>> 0) % (m(port.width) + 1);
    if (name === 'decoder2' && raw.S !== undefined) inputs.S = (raw.S >>> 0) % 4;
    return impl(inputs);
  };
}

/**
 * Reference functions by name. Inputs and outputs are keyed by level labels;
 * values are unsigned integers. See the conventions at the top of this file
 * and REFERENCE_SIGNATURES for every name's ports and widths.
 */
export const REFERENCES: Record<string, ReferenceFn> = Object.fromEntries(
  (Object.keys(REFERENCE_SIGNATURES) as ReferenceName[]).map((n) => [n, wrap(n)]),
);
