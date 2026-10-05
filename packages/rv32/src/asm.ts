/**
 * Tiny programmatic assembler for tests, levels and boot ROM stubs.
 * `asm('addi', rd, rs1, imm)` returns one instruction word.
 */

import { encode } from './decode';
import { OP_SPECS } from './ops';

/**
 * Encode one instruction by mnemonic. Operand order follows assembly syntax:
 * R `rd, rs1, rs2`; I/shift/load/jalr `rd, rs1, imm`; store `rs2, rs1, imm`;
 * branch `rs1, rs2, offset`; lui/auipc/jal `rd, imm`; csr `rd, csr, rs1`;
 * csr*i `rd, csr, uimm`; sfence.vma `rs1, rs2`; amo `rd, rs2, rs1[, aqrl]`;
 * lr.w `rd, rs1[, aqrl]`; fence `[pred_succ]`; ecall/ebreak/mret/sret/wfi none.
 */
export function asm(name: string, ...a: number[]): number {
  const spec = OP_SPECS.find((s) => s?.name === name);
  if (!spec) throw new Error(`unknown mnemonic ${name}`);
  const op = spec.op;
  const n = (i: number): number => a[i] ?? 0;
  switch (spec.fmt) {
    case 'R':
      return encode({ op, rd: n(0), rs1: n(1), rs2: n(2), imm: 0 });
    case 'I':
    case 'SH':
      return encode({ op, rd: n(0), rs1: n(1), rs2: 0, imm: n(2) });
    case 'S':
      return encode({ op, rd: 0, rs1: n(1), rs2: n(0), imm: n(2) });
    case 'B':
      return encode({ op, rd: 0, rs1: n(0), rs2: n(1), imm: n(2) });
    case 'U':
    case 'J':
      return encode({ op, rd: n(0), rs1: 0, rs2: 0, imm: n(1) });
    case 'CSR':
    case 'CSRI':
      return encode({ op, rd: n(0), rs1: n(2), rs2: 0, imm: n(1) });
    case 'SFENCE':
      return encode({ op, rd: 0, rs1: n(0), rs2: n(1), imm: 0 });
    case 'AMO':
      if (name === 'lr.w') return encode({ op, rd: n(0), rs1: n(1), rs2: 0, imm: n(2) });
      return encode({ op, rd: n(0), rs1: n(2), rs2: n(1), imm: n(3) });
    case 'FENCE':
      return encode({
        op,
        rd: 0,
        rs1: 0,
        rs2: 0,
        imm: a.length ? n(0) : name === 'fence' ? 0x0ff : 0,
      });
    case 'SYS':
      return encode({ op, rd: 0, rs1: 0, rs2: 0, imm: 0 });
  }
}

/** `li rd, value` as LUI+ADDI (always two words, simple to count). */
export function li(rd: number, value: number): number[] {
  const v = value | 0;
  const lo = (v << 20) >> 20;
  const hi = (v - lo) | 0;
  return [asm('lui', rd, hi), asm('addi', rd, rd, lo)];
}

/** Pack instruction words into little-endian bytes. */
export function toBytes(words: readonly number[]): Uint8Array {
  const out = new Uint8Array(words.length * 4);
  const view = new DataView(out.buffer);
  words.forEach((w, i) => view.setUint32(i * 4, w >>> 0, true));
  return out;
}
