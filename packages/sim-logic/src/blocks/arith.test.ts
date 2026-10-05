import type { Part, PartProps, PartType } from '@ground-up/schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ALU_OPS } from '../parts-spec';
import { allX, sig, type Signal } from '../values';
import { aluEval, shiftBits } from './arith';
import { BLOCKS } from './index';

const part = (type: PartType, props: PartProps = {}): Part => ({ id: 'p1', type, x: 0, y: 0, rot: 0, flip: false, props });
const zeroRng = { nextU32: () => 0 };
const s1 = (b: 0 | 1 | 'x'): Signal => (b === 'x' ? allX(1) : sig(1, b));
const run = (type: PartType, props: PartProps, ins: Signal[]): Signal[] => {
  const p = part(type, props);
  const m = BLOCKS[type]!;
  return m.outputs(ins, m.init(p, 'zero', zeroRng), p);
};
const FC = { seed: 20261004, numRuns: 2000 };
const WIDTHS = [1, 2, 7, 8, 16, 31, 32];
const EDGE32 = [0, 1, 0xffffffff, 0x7fffffff, 0x80000000];

describe('mux', () => {
  it('sel 0 → a, sel 1 → b', () => {
    expect(run('mux', { width: 8 }, [sig(8, 1), sig(8, 2), s1(0)])[0]).toEqual(sig(8, 1));
    expect(run('mux', { width: 8 }, [sig(8, 1), sig(8, 2), s1(1)])[0]).toEqual(sig(8, 2));
    expect(run('mux', { width: 32 }, [sig(32, 0xffffffff), sig(32, 0), s1(0)])[0]).toEqual(sig(32, 0xffffffff));
    expect(run('mux', { width: 1 }, [sig(1, 0), sig(1, 1), s1(1)])[0]).toEqual(sig(1, 1));
  });

  it('X sel is known only where a and b agree', () => {
    expect(run('mux', { width: 4 }, [sig(4, 0b1100), sig(4, 0b1010), s1('x')])[0]).toEqual(sig(4, 0b1000, 0b0110));
    // X in the unselected input does not leak.
    expect(run('mux', { width: 4 }, [sig(4, 5), allX(4), s1(0)])[0]).toEqual(sig(4, 5));
  });
});

describe('decoder', () => {
  it('is one-hot for every select value (1..5 select bits)', () => {
    for (let n = 1; n <= 5; n++) {
      for (let s = 0; s < 1 << n; s++) {
        const outs = run('decoder', { selectBits: n }, [sig(n, s)]);
        expect(outs.length).toBe(1 << n);
        outs.forEach((o, i) => expect(o).toEqual(sig(1, i === s ? 1 : 0)));
      }
    }
  });

  it('X select bits: outputs disagreeing with known bits are 0, the rest X', () => {
    // in = 1? (bit0 = 1 known, bit1 X) → o1, o3 X; o0, o2 = 0.
    const outs = run('decoder', { selectBits: 2 }, [sig(2, 1, 2)]);
    expect(outs).toEqual([sig(1, 0), allX(1), sig(1, 0), allX(1)]);
  });
});

describe('adder', () => {
  it('adds with carry in and out, wrapping (widths 1, 8, 32)', () => {
    expect(run('adder', { width: 8 }, [sig(8, 200), sig(8, 100), s1(1)])).toEqual([sig(8, 45), sig(1, 1)]);
    expect(run('adder', { width: 1 }, [sig(1, 1), sig(1, 1), s1(1)])).toEqual([sig(1, 1), sig(1, 1)]);
    expect(run('adder', { width: 32 }, [sig(32, 0xffffffff), sig(32, 0xffffffff), s1(1)])).toEqual([sig(32, 0xffffffff), sig(1, 1)]);
    expect(run('adder', { width: 32 }, [sig(32, 0x7fffffff), sig(32, 1), s1(0)])).toEqual([sig(32, 0x80000000), sig(1, 0)]);
  });

  it('any X input bit makes sum and cout all-X', () => {
    const allXOut = [allX(8), allX(1)];
    expect(run('adder', { width: 8 }, [sig(8, 0, 0x80), sig(8, 0), s1(0)])).toEqual(allXOut);
    expect(run('adder', { width: 8 }, [sig(8, 0), sig(8, 0), s1('x')])).toEqual(allXOut);
    expect(run('adder', { width: 8 }, [sig(8, 0), sig(8, 1)])).toEqual(allXOut); // missing cin
  });

  it('matches BigInt math (property, widths 1..32)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...WIDTHS), fc.nat({ max: 0xffffffff }), fc.nat({ max: 0xffffffff }), fc.boolean(), (w, a0, b0, c) => {
        const M = (1n << BigInt(w)) - 1n;
        const a = BigInt(a0) & M;
        const b = BigInt(b0) & M;
        const t = a + b + (c ? 1n : 0n);
        const [sum, cout] = run('adder', { width: w }, [sig(w, Number(a)), sig(w, Number(b)), s1(c ? 1 : 0)]);
        expect(sum).toEqual(sig(w, Number(t & M)));
        expect(cout).toEqual(sig(1, t > M ? 1 : 0));
      }),
      FC,
    );
  });
});

/** BigInt model of the ALU, written independently from aluEval. */
function bigAlu(a: bigint, b: bigint, op: number, w: number) {
  const M = (1n << BigInt(w)) - 1n;
  const sh = w === 1 ? 0n : (b & ((1n << BigInt(shiftBits(w))) - 1n)) % BigInt(w);
  let y = 0n;
  let c = 0n;
  switch (ALU_OPS[op]) {
    case 'add':
      y = (a + b) & M;
      c = a + b > M ? 1n : 0n;
      break;
    case 'sub':
      y = (a - b) & M;
      c = a >= b ? 1n : 0n;
      break;
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
      y = ~a & M;
      break;
    case 'shl':
      y = (a << sh) & M;
      break;
    case 'shr':
      y = a >> sh;
      break;
  }
  return { y: Number(y), z: y === 0n ? 1 : 0, n: Number((y >> BigInt(w - 1)) & 1n), c: Number(c) };
}

describe('alu', () => {
  const alu = (w: number, a: number, b: number, op: number | Signal) =>
    run('alu', { width: w }, [sig(w, a), sig(w, b), typeof op === 'number' ? sig(3, op) : op]);

  it('ALU_OPS order and flags on known values', () => {
    expect(alu(8, 200, 100, 0)).toEqual([sig(8, 44), sig(1, 0), sig(1, 0), sig(1, 1)]);
    expect(alu(8, 5, 5, 1)).toEqual([sig(8, 0), sig(1, 1), sig(1, 0), sig(1, 1)]); // a >= b → carry 1
    expect(alu(8, 4, 5, 1)).toEqual([sig(8, 255), sig(1, 0), sig(1, 1), sig(1, 0)]); // borrow → carry 0
    expect(alu(8, 0b1100, 0b1010, 2)[0]).toEqual(sig(8, 0b1000));
    expect(alu(8, 0b1100, 0b1010, 3)[0]).toEqual(sig(8, 0b1110));
    expect(alu(8, 0b1100, 0b1010, 4)[0]).toEqual(sig(8, 0b0110));
    expect(alu(8, 0x0f, 0, 5)).toEqual([sig(8, 0xf0), sig(1, 0), sig(1, 1), sig(1, 0)]);
    expect(alu(8, 0x81, 1, 6)[0]).toEqual(sig(8, 0x02));
    expect(alu(8, 0x81, 9, 6)[0]).toEqual(sig(8, 0x02)); // shift amount = low 3 bits of b
    expect(alu(8, 0x80, 7, 7)[0]).toEqual(sig(8, 0x01)); // logical
    expect(alu(32, 0x80000000, 31, 7)[0]).toEqual(sig(32, 1));
    expect(alu(32, 1, 31, 6)).toEqual([sig(32, 0x80000000), sig(1, 0), sig(1, 1), sig(1, 0)]);
    expect(alu(1, 1, 1, 0)).toEqual([sig(1, 0), sig(1, 1), sig(1, 0), sig(1, 1)]);
  });

  it('32-bit edge values', () => {
    for (const a of EDGE32)
      for (const b of EDGE32)
        for (let op = 0; op < 8; op++) {
          const r = alu(32, a, b, op);
          const e = bigAlu(BigInt(a), BigInt(b), op, 32);
          expect(r, `${a} ${ALU_OPS[op]} ${b}`).toEqual([sig(32, e.y), sig(1, e.z), sig(1, e.n), sig(1, e.c)]);
        }
  });

  it('matches BigInt math (property, every op, widths 1..32)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...WIDTHS),
        fc.nat({ max: 0xffffffff }),
        fc.nat({ max: 0xffffffff }),
        fc.nat({ max: 7 }),
        (w, a0, b0, op) => {
          const M = (1n << BigInt(w)) - 1n;
          const a = BigInt(a0) & M;
          const b = BigInt(b0) & M;
          const e = bigAlu(a, b, op, w);
          expect(alu(w, Number(a), Number(b), op)).toEqual([sig(w, e.y), sig(1, e.z), sig(1, e.n), sig(1, e.c)]);
        },
      ),
      FC,
    );
  });

  it('X op makes every output X', () => {
    expect(alu(8, 1, 2, sig(3, 0, 4))).toEqual([allX(8), allX(1), allX(1), allX(1)]);
  });

  it('X operands: precise for bitwise ops, conservative for arithmetic', () => {
    const a = sig(8, 0b1100_0000, 0b0000_1111); // 1100XXXX
    const b = sig(8, 0b1010_0000, 0);
    const r = (op: number, bb: Signal = b) => aluEval(a, bb, sig(3, op), 8);
    expect(r(0).out).toEqual(allX(8));
    expect(r(0).carry).toEqual(allX(1));
    expect(r(1).out).toEqual(allX(8));
    expect(r(2).out).toEqual(sig(8, 0b1000_0000)); // AND with 0 kills the X
    expect(r(2).zero).toEqual(sig(1, 0));
    expect(r(3).out).toEqual(sig(8, 0b1110_0000, 0b0000_1111));
    expect(r(4).out).toEqual(sig(8, 0b0110_0000, 0b0000_1111));
    expect(r(5).out).toEqual(sig(8, 0b0011_0000, 0b0000_1111));
    expect(r(5).neg).toEqual(sig(1, 0));
    expect(r(6, sig(8, 4)).out).toEqual(sig(8, 0, 0xf0));
    expect(r(6, sig(8, 4)).neg).toEqual(allX(1));
    expect(r(7, sig(8, 4)).out).toEqual(sig(8, 0b0000_1100));
    expect(r(6, sig(8, 0, 1)).out).toEqual(allX(8)); // X shift amount
    expect(r(6, sig(8, 1, 0x80)).out).toEqual(sig(8, 0b1000_0000, 0b0001_1110)); // X in ignored high bits of b
    // zero flag: known 0 bits plus X → X; logic ops carry stays 0.
    const z = aluEval(sig(8, 0, 1), sig(8, 0), sig(3, 3), 8);
    expect(z.zero).toEqual(allX(1));
    expect(z.carry).toEqual(sig(1, 0));
  });

  it('property: X results are sound (every concrete completion agrees with known bits)', () => {
    fc.assert(
      fc.property(fc.nat({ max: 255 }), fc.nat({ max: 255 }), fc.nat({ max: 255 }), fc.nat({ max: 7 }), fc.nat({ max: 255 }), (av, ax, bv, op, fill) => {
        const a = sig(8, av, ax);
        const b = sig(8, bv, 0);
        const r = aluEval(a, b, sig(3, op), 8);
        const concrete = (a.v | (fill & ax)) >>> 0;
        const e = bigAlu(BigInt(concrete), BigInt(bv), op, 8);
        const known = ~r.out.x & 0xff;
        expect(r.out.v & known).toBe(e.y & known);
        if (r.zero.x === 0) expect(r.zero.v).toBe(e.z);
        if (r.neg.x === 0) expect(r.neg.v).toBe(e.n);
        if (r.carry.x === 0) expect(r.carry.v).toBe(e.c);
      }),
      FC,
    );
  });
});
