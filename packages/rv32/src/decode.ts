/**
 * RV-01: decoder and encoder for RV32I, M, A, Zicsr, Zifencei and the
 * privileged instructions (MRET, SRET, WFI, SFENCE.VMA).
 *
 * `decode` never throws: words that are not a valid instruction decode to
 * `OP_ILLEGAL` and keep their raw bits for the trap value and the debugger.
 */

import { signExtend } from '@build-a-computer/det';
import * as O from './ops';
import { OP_SPECS, type OpSpec } from './ops';

/** A decoded instruction. Unused fields are 0. */
export interface Instr {
  /** Operation number from `ops.ts`. */
  op: number;
  rd: number;
  rs1: number;
  rs2: number;
  /**
   * Immediate as a signed 32-bit integer for I/S/B/U/J formats; the shift
   * amount for SH; the CSR number for CSR/CSRI (the 5-bit uimm is in rs1);
   * bits 31:20 verbatim for FENCE; `aq << 1 | rl` for AMO.
   */
  imm: number;
  /** The instruction word as an unsigned 32-bit number. */
  raw: number;
}

const ILLEGAL = (raw: number): Instr => ({ op: O.OP_ILLEGAL, rd: 0, rs1: 0, rs2: 0, imm: 0, raw });

const immI = (w: number): number => w >> 20;
const immS = (w: number): number => ((w >> 25) << 5) | ((w >>> 7) & 0x1f);
const immB = (w: number): number =>
  signExtend(
    (((w >>> 31) & 1) << 12) |
      (((w >>> 7) & 1) << 11) |
      (((w >>> 25) & 0x3f) << 5) |
      (((w >>> 8) & 0xf) << 1),
    13,
  ) | 0;
const immU = (w: number): number => w & 0xfffff000;
const immJ = (w: number): number =>
  signExtend(
    (((w >>> 31) & 1) << 20) |
      (((w >>> 12) & 0xff) << 12) |
      (((w >>> 20) & 1) << 11) |
      (((w >>> 21) & 0x3ff) << 1),
    21,
  ) | 0;

// Lookup tables built from OP_SPECS: key = opcode | funct3 << 7 | funct7 << 10.
const byOpcode = new Map<number, OpSpec>();
const byF3 = new Map<number, OpSpec>();
const byF7 = new Map<number, OpSpec>();
const bySys = new Map<number, OpSpec>();
for (const spec of OP_SPECS) {
  if (!spec) continue;
  switch (spec.fmt) {
    case 'U':
    case 'J':
      byOpcode.set(spec.opcode, spec);
      break;
    case 'I':
    case 'S':
    case 'B':
    case 'CSR':
    case 'CSRI':
    case 'FENCE':
      byF3.set(spec.opcode | (spec.funct3 << 7), spec);
      break;
    case 'R':
    case 'SH':
    case 'AMO':
      byF7.set(spec.opcode | (spec.funct3 << 7) | (spec.funct7 << 10), spec);
      break;
    case 'SYS':
      bySys.set(spec.funct7 >>> 0, spec);
      break;
    case 'SFENCE':
      break;
  }
}

/** Decode one 32-bit instruction word. */
export function decode(word: number): Instr {
  const w = word | 0;
  const raw = word >>> 0;
  const opcode = w & 0x7f;
  const rd = (w >>> 7) & 31;
  const f3 = (w >>> 12) & 7;
  const rs1 = (w >>> 15) & 31;
  const rs2 = (w >>> 20) & 31;
  const f7 = (w >>> 25) & 0x7f;

  if ((opcode & 3) !== 3) return ILLEGAL(raw);

  const u = byOpcode.get(opcode);
  if (u) return { op: u.op, rd, rs1: 0, rs2: 0, imm: u.fmt === 'U' ? immU(w) : immJ(w), raw };

  if (opcode === 0x73) {
    if (f3 === 0) {
      const sys = bySys.get(raw);
      if (sys) return { op: sys.op, rd: 0, rs1: 0, rs2: 0, imm: 0, raw };
      if (f7 === 0x09 && rd === 0) return { op: O.SFENCE_VMA, rd: 0, rs1, rs2, imm: 0, raw };
      return ILLEGAL(raw);
    }
    const spec = byF3.get(opcode | (f3 << 7));
    if (!spec) return ILLEGAL(raw);
    return { op: spec.op, rd, rs1, rs2: 0, imm: (w >>> 20) & 0xfff, raw };
  }

  if (opcode === 0x33 || (opcode === 0x13 && (f3 === 1 || f3 === 5))) {
    const spec = byF7.get(opcode | (f3 << 7) | (f7 << 10));
    if (!spec) return ILLEGAL(raw);
    if (spec.fmt === 'SH') return { op: spec.op, rd, rs1, rs2: 0, imm: rs2, raw };
    return { op: spec.op, rd, rs1, rs2, imm: 0, raw };
  }

  if (opcode === 0x2f) {
    const spec = byF7.get(opcode | (f3 << 7) | ((f7 >>> 2) << 10));
    if (!spec) return ILLEGAL(raw);
    if (spec.op === O.LR_W && rs2 !== 0) return ILLEGAL(raw);
    return { op: spec.op, rd, rs1, rs2: spec.op === O.LR_W ? 0 : rs2, imm: f7 & 3, raw };
  }

  const spec = byF3.get(opcode | (f3 << 7));
  if (!spec) return ILLEGAL(raw);
  switch (spec.fmt) {
    case 'I':
      return { op: spec.op, rd, rs1, rs2: 0, imm: immI(w), raw };
    case 'S':
      return { op: spec.op, rd: 0, rs1, rs2, imm: immS(w), raw };
    case 'B':
      return { op: spec.op, rd: 0, rs1, rs2, imm: immB(w), raw };
    case 'FENCE':
      return { op: spec.op, rd, rs1, rs2: 0, imm: (w >>> 20) & 0xfff, raw };
    default:
      return ILLEGAL(raw);
  }
}

/** Encode an instruction back to its 32-bit word (unsigned). Inverse of `decode`. */
export function encode(i: Omit<Instr, 'raw'>): number {
  const spec = OP_SPECS[i.op];
  if (!spec) throw new Error(`cannot encode op ${i.op}`);
  const rd = (i.rd & 31) << 7;
  const rs1 = (i.rs1 & 31) << 15;
  const rs2 = (i.rs2 & 31) << 20;
  const f3 = spec.funct3 << 12;
  const imm = i.imm | 0;
  let w: number;
  switch (spec.fmt) {
    case 'R':
      w = (spec.funct7 << 25) | rs2 | rs1 | f3 | rd | spec.opcode;
      break;
    case 'SH':
      w = (spec.funct7 << 25) | ((imm & 31) << 20) | rs1 | f3 | rd | spec.opcode;
      break;
    case 'I':
    case 'FENCE':
      w = ((imm & 0xfff) << 20) | rs1 | f3 | rd | spec.opcode;
      break;
    case 'CSR':
    case 'CSRI':
      w = ((imm & 0xfff) << 20) | rs1 | f3 | rd | spec.opcode;
      break;
    case 'S':
      w = (((imm >> 5) & 0x7f) << 25) | rs2 | rs1 | f3 | ((imm & 0x1f) << 7) | spec.opcode;
      break;
    case 'B':
      w =
        (((imm >>> 12) & 1) << 31) |
        (((imm >>> 5) & 0x3f) << 25) |
        rs2 |
        rs1 |
        f3 |
        (((imm >>> 1) & 0xf) << 8) |
        (((imm >>> 11) & 1) << 7) |
        spec.opcode;
      break;
    case 'U':
      w = (imm & 0xfffff000) | rd | spec.opcode;
      break;
    case 'J':
      w =
        (((imm >>> 20) & 1) << 31) |
        (((imm >>> 1) & 0x3ff) << 21) |
        (((imm >>> 11) & 1) << 20) |
        (((imm >>> 12) & 0xff) << 12) |
        rd |
        spec.opcode;
      break;
    case 'SYS':
      w = spec.funct7;
      break;
    case 'SFENCE':
      w = (spec.funct7 << 25) | rs2 | rs1 | spec.opcode;
      break;
    case 'AMO':
      w = (spec.funct7 << 27) | ((imm & 3) << 25) | rs2 | rs1 | f3 | rd | spec.opcode;
      break;
  }
  return w >>> 0;
}

/** Look up an op by mnemonic (e.g. "addi"). */
export function opByName(name: string): OpSpec | undefined {
  return OP_SPECS.find((s) => s?.name === name);
}

const hex = (n: number): string => '0x' + (n >>> 0).toString(16);

/** ABI register names, x0..x31. */
export const REG_NAMES: readonly string[] = [
  'zero',
  'ra',
  'sp',
  'gp',
  'tp',
  't0',
  't1',
  't2',
  's0',
  's1',
  'a0',
  'a1',
  'a2',
  'a3',
  'a4',
  'a5',
  'a6',
  'a7',
  's2',
  's3',
  's4',
  's5',
  's6',
  's7',
  's8',
  's9',
  's10',
  's11',
  't3',
  't4',
  't5',
  't6',
];

/**
 * Human-readable disassembly. `pc` resolves branch and jump targets.
 * Illegal words show as `.word 0x...` (E-CPU-08: the debugger shows the word).
 */
export function disassemble(word: number, pc = 0): string {
  const i = decode(word);
  const spec = OP_SPECS[i.op];
  if (!spec) return `.word ${hex(word)}`;
  const r = (n: number): string => REG_NAMES[n] ?? `x${n}`;
  const n = spec.name;
  switch (spec.fmt) {
    case 'R':
      return `${n} ${r(i.rd)}, ${r(i.rs1)}, ${r(i.rs2)}`;
    case 'SH':
      return `${n} ${r(i.rd)}, ${r(i.rs1)}, ${i.imm}`;
    case 'I':
      if (spec.opcode === 0x03 || spec.opcode === 0x67)
        return `${n} ${r(i.rd)}, ${i.imm}(${r(i.rs1)})`;
      return `${n} ${r(i.rd)}, ${r(i.rs1)}, ${i.imm}`;
    case 'S':
      return `${n} ${r(i.rs2)}, ${i.imm}(${r(i.rs1)})`;
    case 'B':
      return `${n} ${r(i.rs1)}, ${r(i.rs2)}, ${hex(pc + i.imm)}`;
    case 'U':
      return `${n} ${r(i.rd)}, ${hex(i.imm >>> 12)}`;
    case 'J':
      return `${n} ${r(i.rd)}, ${hex(pc + i.imm)}`;
    case 'CSR':
      return `${n} ${r(i.rd)}, ${hex(i.imm)}, ${r(i.rs1)}`;
    case 'CSRI':
      return `${n} ${r(i.rd)}, ${hex(i.imm)}, ${i.rs1}`;
    case 'SFENCE':
      return `${n} ${r(i.rs1)}, ${r(i.rs2)}`;
    case 'AMO': {
      const suffix = (i.imm & 2 ? '.aq' : '') + (i.imm & 1 ? '.rl' : '');
      if (i.op === O.LR_W) return `${n}${suffix} ${r(i.rd)}, (${r(i.rs1)})`;
      return `${n}${suffix} ${r(i.rd)}, ${r(i.rs2)}, (${r(i.rs1)})`;
    }
    case 'FENCE':
    case 'SYS':
      return n;
  }
}
