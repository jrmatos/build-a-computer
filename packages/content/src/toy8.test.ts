import { describe, expect, it } from 'vitest';
import {
  Toy8,
  Toy8AsmError,
  TOY8_OPS,
  assemble,
  assembleHex,
  assembleLine,
  disassemble,
  disassembleAll,
  fromHex,
  toHex,
  toy8Alu,
} from './toy8';
import { MULTIPLY_SOURCE, multiplySource } from './phase3-4/programs';

/** Run a program to HALT (or the budget) and return the machine. */
function runAsm(src: string, maxCycles = 10_000): Toy8 {
  const m = new Toy8(assemble(src).bytes);
  m.run(maxCycles);
  return m;
}

describe('Toy-8 assembler', () => {
  it('encodes every instruction shape', () => {
    expect(assembleLine('HALT')).toEqual([0x00, 0x00]);
    expect(assembleLine('LDI R2, 0x2A')).toEqual([0x18, 0x2a]);
    expect(assembleLine('MOV R1, R3')).toEqual([0x27, 0x00]);
    expect(assembleLine('LD R0, [R1]')).toEqual([0x31, 0x00]);
    expect(assembleLine('ST R3, [R2]')).toEqual([0x4e, 0x00]);
    expect(assembleLine('OUT R1')).toEqual([0x54, 0x00]);
    expect(assembleLine('JMP 0x10')).toEqual([0x60, 0x10]);
    expect(assembleLine('JZ 4')).toEqual([0x70, 0x04]);
    expect(assembleLine('JNZ 4')).toEqual([0x71, 0x04]);
    expect(assembleLine('JC 4')).toEqual([0x72, 0x04]);
    expect(assembleLine('JN 4')).toEqual([0x73, 0x04]);
    expect(assembleLine('ADD R0, R1')).toEqual([0x81, 0x00]);
    expect(assembleLine('sub r2, r3')).toEqual([0x9b, 0x00]);
    expect(assembleLine('AND R0, R0')).toEqual([0xa0, 0x00]);
    expect(assembleLine('OR R0, R1')).toEqual([0xb1, 0x00]);
    expect(assembleLine('XOR R0, R1')).toEqual([0xc1, 0x00]);
    expect(assembleLine('NOT R3')).toEqual([0xdc, 0x00]);
    expect(assembleLine('SHL R0, R1')).toEqual([0xe1, 0x00]);
    expect(assembleLine('SHR R0, R1')).toEqual([0xf1, 0x00]);
    expect(assembleLine('LDI R0, -1')).toEqual([0x10, 0xff]);
    expect(assembleLine("LDI R0, 'A'")).toEqual([0x10, 0x41]);
    expect(assembleLine('LDI R0, 0b101')).toEqual([0x10, 0x05]);
    expect(assembleLine('.byte 1, 2, 0xFF')).toEqual([1, 2, 255]);
    expect(assembleLine('  ; only a comment')).toEqual([]);
  });

  it('has 16 opcodes (upper nibbles)', () => {
    expect(new Set(TOY8_OPS.map((o) => o.byte >> 4)).size).toBe(16);
  });

  it('resolves labels in two passes', () => {
    const p = assemble('start: JMP end\n  NOP_LABEL: OUT R0\nend: HALT');
    expect(p.labels).toEqual({ start: 0, NOP_LABEL: 2, end: 4 });
    expect(p.bytes).toEqual([0x60, 0x04, 0x50, 0x00, 0x00, 0x00]);
    expect(p.addrToLine).toEqual({ 0: 1, 2: 2, 4: 3 });
  });

  it('reports errors with line numbers', () => {
    expect(() => assemble('HALT\nFOO R1')).toThrow(/line 2: unknown instruction 'FOO'/);
    expect(() => assemble('JMP nowhere')).toThrow(/line 1: unknown label 'nowhere'/);
    expect(() => assemble('LDI R4, 1')).toThrow(Toy8AsmError);
    expect(() => assemble('LDI R0, 256')).toThrow(/does not fit/);
    expect(() => assemble('ADD R0')).toThrow(/ADD takes/);
    expect(() => assemble('a: HALT\na: HALT')).toThrow(/defined twice/);
    expect(() => assembleLine('JMP loop')).toThrow(/unknown label/);
  });

  it('round-trips hex', () => {
    expect(toHex([0, 0x1a, 255])).toBe('00 1A FF');
    expect(fromHex('00 1A ff')).toEqual([0, 0x1a, 255]);
    expect(fromHex('  ')).toEqual([]);
  });

  it('disassembles for the mnemonic preview', () => {
    expect(disassemble([0x18, 0x2a])).toEqual({ mnemonic: 'LDI', size: 2, text: 'LDI R2, 0x2A' });
    expect(disassemble([0x71, 0x08]).text).toBe('JNZ 0x08');
    expect(disassemble([0x4e]).text).toBe('ST R3, [R2]');
    expect(disassemble([0x10]).text).toBe('LDI R0, ?');
    expect(disassemble([]).mnemonic).toBe('?');
    // Every instruction byte disassembles and re-assembles to itself (unused fields 0).
    for (let b = 0; b < 256; b++) {
      const text = disassemble([b, 0x33]).text;
      const back = assembleLine(text)[0]!;
      const op = b >> 4;
      const unusedRs = op === 0x5 || op === 0xd || op === 0x0 || op === 0x1 || op === 0x6;
      const unusedRd = op === 0x0 || op === 0x6 || op === 0x7;
      let want = b;
      if (unusedRs) want &= ~0x03;
      if (unusedRd) want &= ~0x0c;
      expect(back, text).toBe(want);
    }
    expect(disassembleAll([0x10, 1, 0x50, 0, 0]).map((l) => l.text)).toEqual(['LDI R0, 0x01', 'OUT R0', 'HALT']);
  });
});

describe('Toy-8 reference model (TOY-01: a test per instruction)', () => {
  it('HALT stops after 2 cycles and freezes the machine', () => {
    const m = new Toy8(assemble('HALT').bytes);
    expect(m.run(100)).toBe(2);
    expect(m.halted).toBe(true);
    expect(m.pc).toBe(2);
    m.cycle();
    m.step();
    expect(m.cycles).toBe(2);
  });

  it('LDI loads an immediate', () => {
    const m = runAsm('LDI R0, 1\nLDI R1, 0x80\nLDI R2, 255\nLDI R3, 7\nHALT');
    expect(m.registers).toEqual([1, 0x80, 255, 7]);
    expect(m.cycles).toBe(10);
  });

  it('MOV copies a register', () => {
    expect(runAsm('LDI R1, 9\nMOV R3, R1\nHALT').registers).toEqual([0, 9, 0, 9]);
  });

  it('ST and LD use the register as the address', () => {
    const m = runAsm('LDI R1, 200\nLDI R0, 77\nST R0, [R1]\nLDI R0, 0\nLD R2, [R1]\nHALT');
    expect(m.mem[200]).toBe(77);
    expect(m.registers).toEqual([0, 200, 77, 0]);
  });

  it('OUT drives the output register', () => {
    const m = runAsm('LDI R2, 42\nOUT R2\nLDI R2, 1\nHALT');
    expect(m.out).toBe(42);
  });

  it('JMP jumps to imm', () => {
    const m = runAsm('JMP skip\nLDI R0, 1\nskip: LDI R1, 2\nHALT');
    expect(m.registers).toEqual([0, 2, 0, 0]);
  });

  it('JZ / JNZ follow Z', () => {
    const src = (j: string) => `LDI R0, 5\nLDI R1, 5\nSUB R0, R1\n${j} t\nLDI R3, 1\nt: HALT`;
    expect(runAsm(src('JZ')).r[3]).toBe(0);
    expect(runAsm(src('JNZ')).r[3]).toBe(1);
  });

  it('JC follows C (no borrow / carry out)', () => {
    expect(runAsm('LDI R0, 5\nLDI R1, 3\nSUB R0, R1\nJC t\nLDI R3, 1\nt: HALT').r[3]).toBe(0);
    expect(runAsm('LDI R0, 3\nLDI R1, 5\nSUB R0, R1\nJC t\nLDI R3, 1\nt: HALT').r[3]).toBe(1);
    expect(runAsm('LDI R0, 200\nLDI R1, 100\nADD R0, R1\nJC t\nLDI R3, 1\nt: HALT').r[3]).toBe(0);
  });

  it('JN follows N', () => {
    expect(runAsm('LDI R0, 3\nLDI R1, 5\nSUB R0, R1\nJN t\nLDI R3, 1\nt: HALT').r[3]).toBe(0);
    expect(runAsm('LDI R0, 5\nLDI R1, 3\nSUB R0, R1\nJN t\nLDI R3, 1\nt: HALT').r[3]).toBe(1);
  });

  it('flags only change on ALU instructions', () => {
    const m = runAsm('LDI R0, 0\nOR R0, R0\nLDI R0, 1\nMOV R1, R0\nHALT');
    expect(m.z).toBe(1);
  });

  const alu: [string, number, number, number, { z: number; n: number; c: number }][] = [
    ['ADD', 200, 100, 44, { z: 0, n: 0, c: 1 }],
    ['ADD', 1, 2, 3, { z: 0, n: 0, c: 0 }],
    ['SUB', 5, 5, 0, { z: 1, n: 0, c: 1 }],
    ['SUB', 3, 5, 254, { z: 0, n: 1, c: 0 }],
    ['AND', 0xf0, 0x3c, 0x30, { z: 0, n: 0, c: 0 }],
    ['OR', 0xf0, 0x0c, 0xfc, { z: 0, n: 1, c: 0 }],
    ['XOR', 0xff, 0xff, 0, { z: 1, n: 0, c: 0 }],
    ['SHL', 0x81, 1, 0x02, { z: 0, n: 0, c: 0 }],
    ['SHL', 1, 7, 0x80, { z: 0, n: 1, c: 0 }],
    ['SHR', 0x80, 3, 0x10, { z: 0, n: 0, c: 0 }],
    ['SHR', 0x80, 9, 0x40, { z: 0, n: 0, c: 0 }],
  ];
  for (const [op, a, b, y, f] of alu) {
    it(`${op} ${a}, ${b} = ${y}`, () => {
      const m = runAsm(`LDI R0, ${a}\nLDI R1, ${b}\n${op} R0, R1\nHALT`);
      expect(m.r[0]).toBe(y);
      expect({ z: m.z, n: m.n, c: m.c }).toEqual(f);
    });
  }

  it('NOT inverts rd', () => {
    const m = runAsm('LDI R2, 0x0F\nNOT R2\nHALT');
    expect(m.r[2]).toBe(0xf0);
    expect(m.n).toBe(1);
  });

  it('toy8Alu matches the ALU_OPS order', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((op) => toy8Alu(op, 12, 2).y)).toEqual([14, 10, 0, 14, 14, 243, 48, 3]);
  });

  it('timing: 2 cycles per instruction, fetch then execute', () => {
    const m = new Toy8(assemble('LDI R0, 9\nJMP 0').bytes);
    m.cycle();
    expect([m.phase, m.pc, m.ir, m.r[0]]).toEqual([1, 1, 0x10, 0]);
    m.cycle();
    expect([m.phase, m.pc, m.r[0]]).toEqual([0, 2, 9]);
    m.step();
    expect(m.pc).toBe(0);
    expect(m.cycles).toBe(4);
  });

  it('PC wraps from 0xFF to 0x00', () => {
    // 128 two-byte instructions fill the ROM: 127 × (LDI R0, 1), then ADD at 0xFE.
    const bytes = [...Array.from({ length: 127 }, () => [0x10, 1]).flat(), 0x81, 0];
    const m = new Toy8(bytes);
    m.run(256);
    expect(m.pc).toBe(0);
  });

  it('E-SIM-08: reset clears volatile state and keeps the ROM', () => {
    const m = runAsm('LDI R0, 3\nST R0, [R0]\nOUT R0\nHALT');
    m.reset();
    expect(m.snapshot()).toEqual({ pc: 0, r: [0, 0, 0, 0], z: 0, n: 0, c: 0, out: 0, halted: false, cycles: 0 });
    expect(m.mem[3]).toBe(0);
    expect(m.rom[0]).toBe(0x10);
  });

  it('multiplies by repeated addition', () => {
    expect(runAsm(MULTIPLY_SOURCE).out).toBe(42);
    expect(runAsm(multiplySource(13, 11)).out).toBe(143);
    expect(runAsm(multiplySource(0, 9)).out).toBe(0);
    expect(runAsm(multiplySource(9, 0)).out).toBe(0);
    expect(runAsm(multiplySource(16, 16)).out).toBe(0); // 256 wraps
    expect(assembleHex(MULTIPLY_SOURCE).startsWith('10 00 14 06')).toBe(true);
  });
});
