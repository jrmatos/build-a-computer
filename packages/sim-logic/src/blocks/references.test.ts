import type { Part, PartType } from '@build-a-computer/schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sig, type Signal } from '../values';
import { BLOCKS } from './index';
import { REFERENCES, REFERENCE_SIGNATURES } from './references';

const part = (type: PartType, props: Part['props'] = {}): Part => ({ id: 'p1', type, x: 0, y: 0, rot: 0, flip: false, props });
const zeroRng = { nextU32: () => 0 };
const run = (type: PartType, props: Part['props'], ins: Signal[]): number[] => {
  const p = part(type, props);
  const m = BLOCKS[type]!;
  return m.outputs(ins, m.init(p, 'zero', zeroRng), p).map((s) => {
    expect(s.x).toBe(0);
    return s.v;
  });
};
const FC = { seed: 4242, numRuns: 2000 };

/** Every input combination of a signature (only for small total widths). */
function* allInputs(name: keyof typeof REFERENCE_SIGNATURES): Generator<Record<string, number>> {
  const ports = REFERENCE_SIGNATURES[name].inputs;
  const total = ports.reduce((n, p) => n + p.width, 0);
  for (let k = 0; k < 2 ** total; k++) {
    const r: Record<string, number> = {};
    let shift = 0;
    for (const p of ports) {
      r[p.name] = Math.floor(k / 2 ** shift) % 2 ** p.width;
      shift += p.width;
    }
    yield r;
  }
}

describe('REFERENCE_SIGNATURES', () => {
  it('lists every reference, and each returns exactly its declared outputs within width', () => {
    expect(Object.keys(REFERENCES).sort()).toEqual(Object.keys(REFERENCE_SIGNATURES).sort());
    for (const [name, sigr] of Object.entries(REFERENCE_SIGNATURES)) {
      const zero = Object.fromEntries(sigr.inputs.map((p) => [p.name, 0]));
      const max = Object.fromEntries(sigr.inputs.map((p) => [p.name, 2 ** p.width - 1]));
      for (const ins of [zero, max]) {
        const out = REFERENCES[name]!(ins);
        expect(Object.keys(out).sort(), name).toEqual(sigr.outputs.map((p) => p.name).sort());
        for (const p of sigr.outputs) {
          expect(Number.isInteger(out[p.name]), `${name}.${p.name}`).toBe(true);
          expect(out[p.name]!, `${name}.${p.name}`).toBeGreaterThanOrEqual(0);
          expect(out[p.name]!, `${name}.${p.name}`).toBeLessThan(2 ** p.width);
        }
      }
    }
  });

  it('exhaustive references stay within the 16-bit exhaustive limit or are meant for random tests', () => {
    const random = new Set(['adder8', 'sub8', 'eq8', 'lt8u', 'lt8s', 'logic8', 'alu8', 'adder32', 'alu32']);
    for (const [name, s] of Object.entries(REFERENCE_SIGNATURES)) {
      const bits = s.inputs.reduce((n, p) => n + p.width, 0);
      if (!random.has(name)) expect(bits, name).toBeLessThanOrEqual(16);
    }
  });
});

describe('REFERENCES truth tables', () => {
  const table = (name: string) =>
    [...allInputs(name as keyof typeof REFERENCE_SIGNATURES)].map((i) => {
      const o = REFERENCES[name]!(i);
      return o.Y;
    });

  it('1-bit gates', () => {
    expect(table('not')).toEqual([1, 0]);
    // order: A is the low bit → (A,B) = 00, 10, 01, 11
    expect(table('and')).toEqual([0, 0, 0, 1]);
    expect(table('or')).toEqual([0, 1, 1, 1]);
    expect(table('nor')).toEqual([1, 0, 0, 0]);
    expect(table('xor')).toEqual([0, 1, 1, 0]);
    expect(table('xnor')).toEqual([1, 0, 0, 1]);
    expect(table('nand')).toEqual([1, 1, 1, 0]);
    expect(table('and3')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('mux1, demux1, decoder2 (S0/S1 and 2-bit S)', () => {
    for (const i of allInputs('mux1')) expect(REFERENCES.mux1!(i).Y).toBe(i.S ? i.B : i.A);
    expect(REFERENCES.demux1!({ X: 1, S: 0 })).toEqual({ A: 1, B: 0 });
    expect(REFERENCES.demux1!({ X: 1, S: 1 })).toEqual({ A: 0, B: 1 });
    expect(REFERENCES.demux1!({ X: 0, S: 1 })).toEqual({ A: 0, B: 0 });
    expect(REFERENCES.decoder2!({ S0: 1, S1: 1 })).toEqual({ Y0: 0, Y1: 0, Y2: 0, Y3: 1 });
    expect(REFERENCES.decoder2!({ S0: 0, S1: 1 })).toEqual({ Y0: 0, Y1: 0, Y2: 1, Y3: 0 });
    expect(REFERENCES.decoder2!({ S: 1 })).toEqual({ Y0: 0, Y1: 1, Y2: 0, Y3: 0 });
  });

  it('half and full adders', () => {
    for (const i of allInputs('halfadder')) {
      const o = REFERENCES.halfadder!(i);
      expect(o.S! + 2 * o.C!).toBe(i.A! + i.B!);
    }
    for (const i of allInputs('fulladder')) {
      const o = REFERENCES.fulladder!(i);
      expect(o.S! + 2 * o.Cout!).toBe(i.A! + i.B! + i.Cin!);
    }
  });

  it('8-bit arithmetic and comparisons', () => {
    expect(REFERENCES.negate8!({ A: 1 })).toEqual({ Y: 255 });
    expect(REFERENCES.negate8!({ A: 0 })).toEqual({ Y: 0 });
    expect(REFERENCES.negate8!({ A: 128 })).toEqual({ Y: 128 });
    expect(REFERENCES.sub8!({ A: 3, B: 5 })).toEqual({ Y: 254 });
    expect(REFERENCES.eq8!({ A: 7, B: 7 })).toEqual({ Y: 1 });
    expect(REFERENCES.lt8u!({ A: 1, B: 255 })).toEqual({ Y: 1 });
    expect(REFERENCES.lt8s!({ A: 1, B: 255 })).toEqual({ Y: 0 }); // 1 < -1 is false
    expect(REFERENCES.lt8s!({ A: 128, B: 127 })).toEqual({ Y: 1 }); // -128 < 127
    expect(REFERENCES.lt8s!({ A: 5, B: 5 })).toEqual({ Y: 0 });
    expect(REFERENCES.logic8!({ A: 0xf0, B: 0x3c, OP: 3 })).toEqual({ Y: 0x0f });
    expect(REFERENCES.shift8!({ A: 0x81, SH: 1, DIR: 0 })).toEqual({ Y: 0x02 });
    expect(REFERENCES.shift8!({ A: 0x81, SH: 7, DIR: 1 })).toEqual({ Y: 0x01 });
    expect(REFERENCES.adder8!({ A: 255, B: 1, Cin: 1 })).toEqual({ S: 1, Cout: 1 });
  });

  it('masks inputs to width and treats missing inputs as 0', () => {
    expect(REFERENCES.adder8!({ A: 0x1ff, B: 1 })).toEqual({ S: 0, Cout: 1 });
    expect(REFERENCES.and!({ A: 3, B: 1 })).toEqual({ Y: 1 });
  });

  it('32-bit edge values', () => {
    expect(REFERENCES.adder32!({ A: 0xffffffff, B: 1, Cin: 0 })).toEqual({ S: 0, Cout: 1 });
    expect(REFERENCES.adder32!({ A: 0x7fffffff, B: 1, Cin: 0 })).toEqual({ S: 0x80000000, Cout: 0 });
    expect(REFERENCES.alu32!({ A: 0, B: 1, OP: 1 })).toEqual({ Y: 0xffffffff, Z: 0, N: 1, C: 0 });
    expect(REFERENCES.alu32!({ A: 1, B: 31, OP: 6 })).toEqual({ Y: 0x80000000, Z: 0, N: 1, C: 0 });
    expect(REFERENCES.alu32!({ A: 0x80000000, B: 0, OP: 5 })).toEqual({ Y: 0x7fffffff, Z: 0, N: 0, C: 0 });
  });
});

describe('REFERENCES agree with the block models', () => {
  const nat = (w: number) => fc.nat({ max: 2 ** w - 1 });

  it('adder8 / adder32 vs the adder block', () => {
    for (const w of [8, 32]) {
      fc.assert(
        fc.property(nat(w), nat(w), fc.nat({ max: 1 }), (A, B, Cin) => {
          const [S, Cout] = run('adder', { width: w }, [sig(w, A), sig(w, B), sig(1, Cin)]);
          expect(REFERENCES[`adder${w}`]!({ A, B, Cin })).toEqual({ S, Cout });
        }),
        FC,
      );
    }
  });

  it('alu8 exhaustive-ish and alu32 random vs the alu block', () => {
    for (const w of [8, 32]) {
      fc.assert(
        fc.property(nat(w), nat(w), fc.nat({ max: 7 }), (A, B, OP) => {
          const [Y, Z, N, C] = run('alu', { width: w }, [sig(w, A), sig(w, B), sig(3, OP)]);
          expect(REFERENCES[`alu${w}`]!({ A, B, OP })).toEqual({ Y, Z, N, C });
        }),
        FC,
      );
    }
  });

  it('logic8 and shift8 vs the alu block', () => {
    const ops = [2, 3, 4, 5];
    fc.assert(
      fc.property(nat(8), nat(8), fc.nat({ max: 3 }), (A, B, OP) => {
        const [Y] = run('alu', { width: 8 }, [sig(8, A), sig(8, B), sig(3, ops[OP]!)]);
        expect(REFERENCES.logic8!({ A, B, OP })).toEqual({ Y });
      }),
      FC,
    );
    for (const i of allInputs('shift8')) {
      const [Y] = run('alu', { width: 8 }, [sig(8, i.A!), sig(8, i.SH!), sig(3, i.DIR ? 7 : 6)]);
      expect(REFERENCES.shift8!(i)).toEqual({ Y });
    }
  });

  it('sub8, negate8, eq8, lt8u vs the alu block (sub flags)', () => {
    for (let A = 0; A < 256; A++)
      for (let B = 0; B < 256; B += 3) {
        const [Y, Z, , C] = run('alu', { width: 8 }, [sig(8, A), sig(8, B), sig(3, 1)]);
        expect(REFERENCES.sub8!({ A, B })).toEqual({ Y });
        expect(REFERENCES.eq8!({ A, B }).Y).toBe(Z);
        expect(REFERENCES.lt8u!({ A, B }).Y).toBe(1 - C!);
      }
    for (let A = 0; A < 256; A++) {
      const [Y] = run('alu', { width: 8 }, [sig(8, 0), sig(8, A), sig(3, 1)]);
      expect(REFERENCES.negate8!({ A })).toEqual({ Y });
    }
  });

  it('mux1 and decoder2 vs the mux and decoder blocks', () => {
    for (const i of allInputs('mux1')) {
      const [Y] = run('mux', { width: 1 }, [sig(1, i.A!), sig(1, i.B!), sig(1, i.S!)]);
      expect(REFERENCES.mux1!(i)).toEqual({ Y });
    }
    for (const i of allInputs('decoder2')) {
      const [Y0, Y1, Y2, Y3] = run('decoder', { selectBits: 2 }, [sig(2, i.S0! + 2 * i.S1!)]);
      expect(REFERENCES.decoder2!(i)).toEqual({ Y0, Y1, Y2, Y3 });
    }
  });
});
