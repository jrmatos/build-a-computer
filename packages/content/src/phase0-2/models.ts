/**
 * Plain-TypeScript models of the Phase 0-2 circuits, keyed by the same names as
 * sim-logic's REFERENCES. They generate the truth tables and edge-case rows of
 * these levels, and the content tests compare them with REFERENCES so a label
 * or semantics mismatch between content and the checker shows up early.
 *
 * Labels: inputs A, B, C, Cin, S, S0, S1, OP, SH, DIR, X; outputs Y, S, C, Cout, Z, N,
 * Y0..Y3, A, B (see each model). Values are unsigned integers.
 */
export type Model = (i: Record<string, number>) => Record<string, number>;

const m = (w: number): number => (w >= 32 ? 0xffffffff : (1 << w) - 1);
const n = (i: Record<string, number>, k: string): number => i[k] ?? 0;

/** ALU op order, the same as sim-logic ALU_OPS. */
export const ALU_OPS = ['add', 'sub', 'and', 'or', 'xor', 'not', 'shl', 'shr'] as const;

/** ALU on `w` bits: A, B, OP (3 bits) -> Y, Z (zero), N (top bit), C (carry; NOT borrow for sub; 0 otherwise). Shifts use B's low log2(w) bits. */
export function alu(w: number): Model {
  const mask = m(w);
  const shBits = 32 - Math.clz32(w - 1);
  return (i) => {
    const a = n(i, 'A') >>> 0;
    const b = n(i, 'B') >>> 0;
    const op = ALU_OPS[n(i, 'OP') & 7]!;
    const sh = (b & m(shBits)) % w;
    let y = 0;
    let c = 0;
    switch (op) {
      case 'add': {
        const s = a + b;
        y = s & mask;
        c = s > mask ? 1 : 0;
        break;
      }
      case 'sub': {
        const s = a + ((~b & mask) >>> 0) + 1;
        y = s & mask;
        c = s > mask ? 1 : 0;
        break;
      }
      case 'and':
        y = a & b;
        break;
      case 'or':
        y = a | b;
        break;
      case 'xor':
        y = a ^ b;
        break;
      case 'not':
        y = ~a & mask;
        break;
      case 'shl':
        y = (a << sh) & mask;
        break;
      case 'shr':
        y = a >>> sh;
        break;
    }
    y >>>= 0;
    return { Y: y, Z: y === 0 ? 1 : 0, N: (y >>> (w - 1)) & 1, C: c };
  };
}

const sx8 = (v: number): number => ((v & 0xff) ^ 0x80) - 0x80;

export const MODELS: Record<string, Model> = {
  wire: (i) => ({ Y: n(i, 'A') }),
  nand: (i) => ({ Y: 1 - (n(i, 'A') & n(i, 'B')) }),
  not: (i) => ({ Y: 1 - n(i, 'A') }),
  and: (i) => ({ Y: n(i, 'A') & n(i, 'B') }),
  or: (i) => ({ Y: n(i, 'A') | n(i, 'B') }),
  nor: (i) => ({ Y: 1 - (n(i, 'A') | n(i, 'B')) }),
  xor: (i) => ({ Y: n(i, 'A') ^ n(i, 'B') }),
  xnor: (i) => ({ Y: 1 - (n(i, 'A') ^ n(i, 'B')) }),
  and3: (i) => ({ Y: n(i, 'A') & n(i, 'B') & n(i, 'C') }),
  /** S = 0 selects A. */
  mux1: (i) => ({ Y: n(i, 'S') ? n(i, 'B') : n(i, 'A') }),
  /** X goes to A when S = 0, to B when S = 1; the other output is 0. */
  demux1: (i) => ({ A: n(i, 'S') ? 0 : n(i, 'X'), B: n(i, 'S') ? n(i, 'X') : 0 }),
  /** S1 is the high select bit, S0 the low one: Yk is on when 2 S1 + S0 = k. */
  decoder2: (i) => {
    const k = n(i, 'S1') * 2 + n(i, 'S0');
    return { Y0: k === 0 ? 1 : 0, Y1: k === 1 ? 1 : 0, Y2: k === 2 ? 1 : 0, Y3: k === 3 ? 1 : 0 };
  },
  /** B0..B7 (bit i has weight 2^i) -> Y. */
  bits8: (i) => {
    let y = 0;
    for (let k = 0; k < 8; k++) y |= n(i, `B${k}`) << k;
    return { Y: y };
  },
  halfadder: (i) => ({ S: n(i, 'A') ^ n(i, 'B'), C: n(i, 'A') & n(i, 'B') }),
  fulladder: (i) => {
    const t = n(i, 'A') + n(i, 'B') + n(i, 'Cin');
    return { S: t & 1, Cout: t >> 1 };
  },
  adder8: (i) => {
    const t = n(i, 'A') + n(i, 'B') + n(i, 'Cin');
    return { S: t & 0xff, Cout: t >> 8 };
  },
  negate8: (i) => ({ Y: -n(i, 'A') & 0xff }),
  sub8: (i) => ({ Y: (n(i, 'A') - n(i, 'B')) & 0xff }),
  eq8: (i) => ({ Y: n(i, 'A') === n(i, 'B') ? 1 : 0 }),
  lt8u: (i) => ({ Y: n(i, 'A') < n(i, 'B') ? 1 : 0 }),
  lt8s: (i) => ({ Y: sx8(n(i, 'A')) < sx8(n(i, 'B')) ? 1 : 0 }),
  /** OP: 0 AND, 1 OR, 2 XOR, 3 NOT A (the ALU's logic ops, in ALU order). */
  logic8: (i) => {
    const a = n(i, 'A');
    const b = n(i, 'B');
    const y = [a & b, a | b, a ^ b, ~a & 0xff][n(i, 'OP') & 3]!;
    return { Y: y };
  },
  /** DIR 0 = left, 1 = right (logical); SH = 0..7. */
  shift8: (i) => {
    const a = n(i, 'A');
    const s = n(i, 'SH') & 7;
    return { Y: n(i, 'DIR') ? a >>> s : (a << s) & 0xff };
  },
  alu8: alu(8),
  alu32: alu(32),
  adder32: (i) => {
    const t = (n(i, 'A') >>> 0) + (n(i, 'B') >>> 0) + n(i, 'Cin');
    return { S: t % 2 ** 32, Cout: t > 0xffffffff ? 1 : 0 };
  },
};

/** The model for a name; throws for an unknown one (a typo in a level). */
export function model(name: string): Model {
  const f = MODELS[name];
  if (!f) throw new Error(`No model named ${name}`);
  return f;
}
