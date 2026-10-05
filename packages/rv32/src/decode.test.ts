import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { asm } from './asm';
import { decode, disassemble, encode, opByName } from './decode';
import { REFERENCE_ENCODINGS } from './decode.fixtures';
import { OP_ILLEGAL, OP_SPECS } from './ops';

const SEED = 0x5eed_0001;

describe('RV-01 decoder: one table row per opcode (GNU as reference words)', () => {
  it('covers every implemented op exactly once', () => {
    const names = REFERENCE_ENCODINGS.map((r) => r[0]).sort();
    const ops = OP_SPECS.filter(Boolean)
      .map((s) => s.name)
      .sort();
    expect(names).toEqual(ops);
  });

  for (const [name, source, word, fields] of REFERENCE_ENCODINGS) {
    it(`${source} = 0x${word.toString(16).padStart(8, '0')}`, () => {
      const d = decode(word);
      expect(OP_SPECS[d.op]?.name).toBe(name);
      expect(d.raw).toBe(word >>> 0);
      expect({ rd: d.rd, rs1: d.rs1, rs2: d.rs2, imm: d.imm }).toEqual({
        rd: fields.rd ?? 0,
        rs1: fields.rs1 ?? 0,
        rs2: fields.rs2 ?? 0,
        imm: fields.imm ?? 0,
      });
      expect(encode(d)).toBe(word >>> 0);
    });
  }
});

describe('RV-01 immediate sign extension', () => {
  it('I-type -1 and -2048', () => {
    expect(decode(asm('addi', 1, 0, -1)).imm).toBe(-1);
    expect(decode(asm('addi', 1, 0, -2048)).imm).toBe(-2048);
    expect(decode(asm('addi', 1, 0, 2047)).imm).toBe(2047);
  });
  it('S-type, B-type and J-type extremes', () => {
    expect(decode(asm('sw', 1, 2, -2048)).imm).toBe(-2048);
    expect(decode(asm('beq', 1, 2, -4096)).imm).toBe(-4096);
    expect(decode(asm('beq', 1, 2, 4094)).imm).toBe(4094);
    expect(decode(asm('jal', 1, -(1 << 20))).imm).toBe(-(1 << 20));
    expect(decode(asm('jal', 1, (1 << 20) - 2)).imm).toBe((1 << 20) - 2);
  });
  it('U-type keeps the upper 20 bits', () => {
    expect(decode(asm('lui', 1, 0x80000000 | 0)).imm).toBe(0x80000000 | 0);
  });
});

describe('RV-01 illegal words decode to OP_ILLEGAL', () => {
  const illegal: [string, number][] = [
    ['E-CPU-08 all-zero word', 0x00000000],
    ['all ones', 0xffffffff],
    ['compressed (low bits != 11)', 0x00000001],
    ['slli with shamt[5] set (RV64 only)', 0x02009093],
    ['srai with bad funct7', 0x60005093],
    ['add with funct7 0x40 on funct3 1', 0x40001033],
    ['load funct3 3 (ld)', 0x00003003],
    ['store funct3 3 (sd)', 0x00003023],
    ['branch funct3 2', 0x00002063],
    ['jalr funct3 1', 0x00001067],
    ['csr funct3 4', 0x00004073],
    ['lr.w with rs2 != 0', 0x1010a0af],
    ['amo with bad funct5', 0x3000a0af],
    ['amo width d (funct3 3)', 0x0000b0af],
    ['system funct3 0 unknown', 0x00200073],
    ['sfence.vma with rd != 0', 0x120000f3],
    ['custom-0 opcode', 0x0000000b],
    ['float load (no F)', 0x00002007],
  ];
  for (const [label, w] of illegal) {
    it(label, () => {
      const d = decode(w);
      expect(d.op).toBe(OP_ILLEGAL);
      expect(d.raw).toBe(w >>> 0);
      expect(disassemble(w)).toBe(`.word 0x${(w >>> 0).toString(16)}`);
    });
  }
});

describe('RV-01 encode/decode round-trip fuzz', () => {
  it('every decodable word re-encodes to itself', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (w) => {
        const d = decode(w);
        if (d.op === OP_ILLEGAL) return true;
        return encode(d) === w;
      }),
      { seed: SEED, numRuns: 200_000 },
    );
  });

  it('words built from valid fields decode back to the same fields', () => {
    const specs = OP_SPECS.filter(Boolean);
    const instr = fc
      .record({
        spec: fc.constantFrom(...specs),
        rd: fc.integer({ min: 0, max: 31 }),
        rs1: fc.integer({ min: 0, max: 31 }),
        rs2: fc.integer({ min: 0, max: 31 }),
        imm: fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
      })
      .map(({ spec, rd, rs1, rs2, imm }) => {
        // Normalize fields to what the format can hold.
        switch (spec.fmt) {
          case 'R':
            return { op: spec.op, rd, rs1, rs2, imm: 0 };
          case 'SH':
            return { op: spec.op, rd, rs1, rs2: 0, imm: imm & 31 };
          case 'I':
            return { op: spec.op, rd, rs1, rs2: 0, imm: (imm << 20) >> 20 };
          case 'S':
            return { op: spec.op, rd: 0, rs1, rs2, imm: (imm << 20) >> 20 };
          case 'B':
            return { op: spec.op, rd: 0, rs1, rs2, imm: ((imm << 19) >> 19) & ~1 };
          case 'U':
            return { op: spec.op, rd, rs1: 0, rs2: 0, imm: imm & 0xfffff000 };
          case 'J':
            return { op: spec.op, rd, rs1: 0, rs2: 0, imm: ((imm << 11) >> 11) & ~1 };
          case 'CSR':
          case 'CSRI':
          case 'FENCE':
            return { op: spec.op, rd, rs1, rs2: 0, imm: imm & 0xfff };
          case 'SFENCE':
            return { op: spec.op, rd: 0, rs1, rs2, imm: 0 };
          case 'AMO':
            return { op: spec.op, rd, rs1, rs2: spec.name === 'lr.w' ? 0 : rs2, imm: imm & 3 };
          case 'SYS':
            return { op: spec.op, rd: 0, rs1: 0, rs2: 0, imm: 0 };
        }
      });
    fc.assert(
      fc.property(instr, (i) => {
        const w = encode(i);
        const d = decode(w);
        expect({ op: d.op, rd: d.rd, rs1: d.rs1, rs2: d.rs2, imm: d.imm }).toEqual(i);
      }),
      { seed: SEED, numRuns: 50_000 },
    );
  });
});

describe('disassemble', () => {
  it('formats common instructions', () => {
    expect(disassemble(asm('addi', 10, 0, -1))).toBe('addi a0, zero, -1');
    expect(disassemble(asm('lw', 5, 2, 8))).toBe('lw t0, 8(sp)');
    expect(disassemble(asm('sw', 5, 2, 8))).toBe('sw t0, 8(sp)');
    expect(disassemble(asm('beq', 1, 2, 8), 0x100)).toBe('beq ra, sp, 0x108');
    expect(disassemble(asm('csrrw', 0, 0x305, 5))).toBe('csrrw zero, 0x305, t0');
    expect(disassemble(asm('amoadd.w', 10, 11, 12, 3))).toBe('amoadd.w.aq.rl a0, a1, (a2)');
    expect(disassemble(asm('ecall'))).toBe('ecall');
  });
  it('opByName finds specs', () => {
    expect(opByName('mulhsu')?.fmt).toBe('R');
    expect(opByName('nope')).toBeUndefined();
  });
});
