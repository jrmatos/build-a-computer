import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { disassemble, disassembleWord, toSource } from './disasm';
import { formatDiagnostic } from './diagnostics';
import { type Instr, OPS, decode, encode, instr } from './encoding';
import { build } from './linker';

const SEED = 0x6a5d;
const reg = fc.integer({ min: 0, max: 31 });
const even = (min: number, max: number): fc.Arbitrary<number> =>
  fc.integer({ min: min / 2, max: max / 2 }).map((n) => n * 2);

/** A random valid instruction with only the fields its format uses. */
const arbInstr: fc.Arbitrary<Instr> = fc.constantFrom(...OPS).chain((op): fc.Arbitrary<Instr> => {
  const imm12 = fc.integer({ min: -2048, max: 2047 });
  switch (op.format) {
    case 'R':
      return fc.tuple(reg, reg, reg).map(([rd, rs1, rs2]) => instr(op, { rd, rs1, rs2 }));
    case 'I':
    case 'LOAD':
    case 'JALR':
      return fc.tuple(reg, reg, imm12).map(([rd, rs1, imm]) => instr(op, { rd, rs1, imm }));
    case 'SHIFT':
      return fc
        .tuple(reg, reg, fc.integer({ min: 0, max: 31 }))
        .map(([rd, rs1, imm]) => instr(op, { rd, rs1, imm }));
    case 'STORE':
      return fc.tuple(reg, reg, imm12).map(([rs2, rs1, imm]) => instr(op, { rs1, rs2, imm }));
    case 'BRANCH':
      return fc
        .tuple(reg, reg, even(-4096, 4094))
        .map(([rs1, rs2, imm]) => instr(op, { rs1, rs2, imm }));
    case 'U':
      return fc
        .tuple(reg, fc.integer({ min: 0, max: 0xfffff }))
        .map(([rd, imm]) => instr(op, { rd, imm }));
    case 'JAL':
      return fc.tuple(reg, even(-1048576, 1048574)).map(([rd, imm]) => instr(op, { rd, imm }));
    case 'CSR':
      return fc
        .tuple(reg, reg, fc.integer({ min: 0, max: 4095 }))
        .map(([rd, rs1, csr]) => instr(op, { rd, rs1, csr }));
    case 'CSRI':
      return fc
        .tuple(reg, fc.integer({ min: 0, max: 31 }), fc.integer({ min: 0, max: 4095 }))
        .map(([rd, imm, csr]) => instr(op, { rd, imm, csr }));
    case 'FENCE':
      return fc
        .tuple(fc.integer({ min: 0, max: 15 }), fc.integer({ min: 0, max: 15 }))
        .map(([pred, succ]) => instr(op, { pred, succ }));
    case 'FIXED':
      return fc.constant(instr(op));
    case 'SFENCE':
      return fc.tuple(reg, reg).map(([rs1, rs2]) => instr(op, { rs1, rs2 }));
    case 'LR':
      return fc
        .tuple(reg, reg, fc.boolean(), fc.boolean())
        .map(([rd, rs1, aq, rl]) => instr(op, { rd, rs1, aq, rl }));
    case 'AMO':
      return fc
        .tuple(reg, reg, reg, fc.boolean(), fc.boolean())
        .map(([rd, rs1, rs2, aq, rl]) => instr(op, { rd, rs1, rs2, aq, rl }));
  }
});

const base = fc.integer({ min: 0, max: 0x3ffc0000 }).map((n) => n * 4);

function reassemble(words: readonly number[], at: number, pseudo: boolean): number[] {
  const bytes = new Uint8Array(new Uint32Array(words).buffer);
  const source = toSource(disassemble(bytes, at, { pseudo }));
  const r = build(source, { base: at });
  if (!r.ok) throw new Error(`${r.diagnostics.map(formatDiagnostic).join('\n')}\n${source}`);
  return Array.from(new Uint32Array(r.image.buffer, r.image.byteOffset, r.image.length / 4));
}

describe('encode/decode', () => {
  it('decode(encode(i)) returns i for every valid instruction', () => {
    fc.assert(
      fc.property(arbInstr, (i) => {
        expect(decode(encode(i))).toEqual(i);
      }),
      { seed: SEED, numRuns: 5000 },
    );
  });

  it('encode(decode(w)) returns w for every word that decodes', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (w) => {
        const d = decode(w);
        if (d) expect(encode(d)).toBe(w);
      }),
      { seed: SEED, numRuns: 20000 },
    );
  });

  it('boundary words decode and re-encode: 0, 1, -1, 0x7fffffff, 0x80000000', () => {
    for (const w of [0, 1, 0xffffffff, 0x7fffffff, 0x80000000]) {
      const d = decode(w);
      if (d) expect(encode(d)).toBe(w);
      else expect(disassembleWord(w).text).toBe(`.word 0x${w.toString(16)}`);
    }
  });
});

describe('disassemble then assemble reproduces the words', () => {
  it('for random valid instructions, with and without pseudo-instructions', () => {
    fc.assert(
      fc.property(fc.array(arbInstr, { minLength: 1, maxLength: 64 }), base, (instrs, at) => {
        const words = instrs.map(encode);
        expect(reassemble(words, at, true)).toEqual(words);
        expect(reassemble(words, at, false)).toEqual(words);
      }),
      { seed: SEED, numRuns: 150 },
    );
  });

  it('for arbitrary 32-bit words (invalid ones become .word)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 0xffffffff }), { minLength: 1, maxLength: 64 }),
        base,
        (words, at) => {
          expect(reassemble(words, at, true)).toEqual(words);
        },
      ),
      { seed: SEED, numRuns: 100 },
    );
  });
});
