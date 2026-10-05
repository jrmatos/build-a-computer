import { ALU_OPS } from '../parts-spec';
import { allX, mask, sig, type Signal } from '../values';
import type { BlockModel } from './types';
import { bit, bitSig, input, numProp } from './bits';

/**
 * Combinational blocks: mux, decoder, adder, ALU. Stateless (state = null).
 *
 * X rules: bitwise results are precise per bit (0 AND X = 0, 1 OR X = 1, a
 * mux with X select is known where a and b agree, a decoder output is 0 when
 * its index disagrees with a known select bit). Arithmetic is conservative:
 * any X bit in an operand makes the whole sum and the carry X. An X ALU `op`
 * makes every output X.
 */

const stateless = { init: () => null } as const;

/** Pins: a, b, sel → out. sel = 0 selects a. */
export const muxModel: BlockModel<null> = {
  ...stateless,
  outputs(inputs, _s, part) {
    const w = numProp(part, 'width');
    const a = input(inputs, 0, w);
    const b = input(inputs, 1, w);
    const sel = bit(inputs, 2);
    if (sel === 0) return [a];
    if (sel === 1) return [b];
    const x = (a.x | b.x | (a.v ^ b.v)) >>> 0;
    return [sig(w, a.v, x)];
  },
};

/** Pins: in (selectBits) → o0..o(2^n - 1), one-hot. */
export const decoderModel: BlockModel<null> = {
  ...stateless,
  outputs(inputs, _s, part) {
    const n = numProp(part, 'selectBits');
    const s = input(inputs, 0, n);
    const known = ~s.x & mask(n);
    const out: Signal[] = [];
    for (let i = 0; i < 1 << n; i++) {
      if (((i ^ s.v) & known) !== 0) out.push(sig(1, 0));
      else out.push(s.x === 0 ? sig(1, 1) : allX(1));
    }
    return out;
  },
};

/** a + b + cin over `w` bits as [sum, carry]; inputs must be known. Safe for w = 32 (max 2^33 - 1). */
function addW(a: number, b: number, cin: number, w: number): [number, 0 | 1] {
  const s = a + b + cin;
  const m = mask(w);
  return [(s & m) >>> 0, s > m ? 1 : 0];
}

/** Pins: a, b, cin → sum, cout. */
export const adderModel: BlockModel<null> = {
  ...stateless,
  outputs(inputs, _s, part) {
    const w = numProp(part, 'width');
    const a = input(inputs, 0, w);
    const b = input(inputs, 1, w);
    const cin = bit(inputs, 2);
    if (a.x !== 0 || b.x !== 0 || cin === 2) return [allX(w), allX(1)];
    const [sum, cout] = addW(a.v, b.v, cin, w);
    return [sig(w, sum), sig(1, cout)];
  },
};

/** Number of low bits of b that choose the shift amount: ceil(log2(w)). */
export const shiftBits = (w: number): number => (w <= 1 ? 0 : 32 - Math.clz32(w - 1));

/** Shift amount from b: its low shiftBits(w) bits, mod w. Null when any of those bits is X. */
function shiftAmount(b: Signal, w: number): number | null {
  const sm = mask(shiftBits(w));
  if ((b.x & sm) !== 0) return null;
  return (b.v & sm) % w;
}

/**
 * Pure ALU on (possibly X) operands. Exported for the behavioral swap and
 * tests. op index follows ALU_OPS: add, sub, and, or, xor, not, shl, shr.
 * Flags: zero = result is 0, neg = result's top bit, carry = carry out of add,
 * NOT borrow for sub (1 when a >= b unsigned), 0 for the other ops.
 * shl/shr shift a by (b's low ceil(log2 w) bits) mod w; shr is logical.
 */
export function aluEval(a: Signal, b: Signal, op: Signal, w: number): { out: Signal; zero: Signal; neg: Signal; carry: Signal } {
  const m = mask(w);
  if ((op.x & 7) !== 0) return { out: allX(w), zero: allX(1), neg: allX(1), carry: allX(1) };
  const name = ALU_OPS[op.v & 7]!;
  let v = 0;
  let x = 0;
  let carry: 0 | 1 | 2 = 0;
  switch (name) {
    case 'add':
    case 'sub': {
      if (a.x !== 0 || b.x !== 0) {
        x = m;
        carry = 2;
      } else if (name === 'add') {
        [v, carry] = addW(a.v, b.v, 0, w);
      } else {
        [v, carry] = addW(a.v, (~b.v & m) >>> 0, 1, w);
      }
      break;
    }
    case 'and': {
      const known0 = (~a.v & ~a.x) | (~b.v & ~b.x);
      x = (a.x | b.x) & ~known0;
      v = a.v & b.v;
      break;
    }
    case 'or': {
      v = a.v | b.v;
      x = (a.x | b.x) & ~v;
      break;
    }
    case 'xor':
      x = a.x | b.x;
      v = a.v ^ b.v;
      break;
    case 'not':
      x = a.x;
      v = ~a.v & ~a.x;
      break;
    case 'shl':
    case 'shr': {
      const s = shiftAmount(b, w);
      if (s === null) x = m;
      else if (name === 'shl') {
        v = a.v << s;
        x = a.x << s;
      } else {
        v = a.v >>> s;
        x = a.x >>> s;
      }
      break;
    }
  }
  const out = sig(w, v, x);
  const top = 1 << (w - 1);
  const zero: 0 | 1 | 2 = out.v !== 0 ? 0 : out.x !== 0 ? 2 : 1;
  const neg: 0 | 1 | 2 = (out.x & top) !== 0 ? 2 : (out.v & top) !== 0 ? 1 : 0;
  return { out, zero: bitSig(zero), neg: bitSig(neg), carry: bitSig(carry) };
}

/** Pins: a, b, op (3 bits) → out, zero, neg, carry. */
export const aluModel: BlockModel<null> = {
  ...stateless,
  outputs(inputs, _s, part) {
    const w = numProp(part, 'width');
    const r = aluEval(input(inputs, 0, w), input(inputs, 1, w), input(inputs, 2, 3), w);
    return [r.out, r.zero, r.neg, r.carry];
  },
};
