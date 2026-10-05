import type { Level, Part, PartType, SequenceStep, TestSpec, TruthRow } from '@build-a-computer/schema';
import { defineLevel, grow, lamp, sw } from '../define';
import { AFTER_PHASE3, check, cycle } from '../phase3-4/common';
import { clockPart } from '../phase3-4/phase3';
import { DATAPATH_PROGRAMS, PIPELINE_PROGRAMS, RUN_PROGRAMS, type RvProgram } from './programs';
import { RV_PROGRAM_DATA } from './programs.data';
import {
  EBREAK,
  EDGE_WORDS,
  OPC,
  aluControl,
  aluResult,
  branchTaken,
  encB,
  encI,
  encJ,
  encR,
  encS,
  encU,
  immOf,
  lsuLoad,
  lsuMisaligned,
  lsuStore,
  lsuWriteEnable,
  nextPc,
  prng,
} from './rv';

/**
 * Phase 5, RISC-V CPU (RV32I): register file, immediate generator, ALU
 * control, branch comparator, load/store unit, next-PC logic, the
 * single-cycle datapath, running real programs, and an optional 5-stage
 * pipeline. The datapath and its conventions are in docs/rv32-datapath.md.
 * DRAFT text (owner approves). CNT-07.
 *
 * Each block level unlocks its block (regfile, immgen, branchcmp, lsu) for
 * the levels after it; the RISC-V ALU (rvalu) is given in ALU control, since
 * the player built a 32-bit ALU in Phase 2.
 */

const base = { track: 'nand-to-os', phase: 5 } as const;

/** Last Phase 4 level; Phase 5 starts after it. */
export const PHASE4_LAST_ID = 'first-program';

/** Palettes grow level by level. */
const P_REGFILE = AFTER_PHASE3;
const P_IMMGEN = grow(P_REGFILE, 'regfile');
const P_ALUCTL = grow(P_IMMGEN, 'immgen', 'rvalu');
const P_LSU = grow(P_ALUCTL, 'branchcmp');
/** Everything unlocked by the end of Phase 5's block levels: the palette of the CPU levels. */
export const P5_ALL: PartType[] = grow(P_LSU, 'lsu');

type Values = Record<string, number>;
const u = (x: number): number => x >>> 0;

const hexIn = (label: string, x: number, y: number, width: number): Part => sw(label, x, y, width);
const hexOut = (label: string, x: number, y: number, width = 32): Part => lamp(label, x, y, width, 'hex');

/** The program ROM of the CPU levels: 256 words of 32 bits, filled by the `program` tests. */
export const rvRomPart = (x = -20, y = 8): Part => ({
  id: 'ROM',
  type: 'rom',
  x,
  y,
  rot: 0,
  flip: false,
  label: 'ROM',
  locked: true,
  props: { addrWidth: 8, width: 32, data: '' },
});

/** Starter of the CPU levels: clock, program ROM, A0 (x10) and HALT. */
const cpuStarter = (): Level['starter'] => ({
  parts: [clockPart(-20, -8), rvRomPart(), lamp('A0', 20, -2, 32, 'signed'), lamp('HALT', 20, 2)],
  wires: [],
});

/**
 * A `program` test (wordBytes 4) for one RV32I program: run to ebreak, then
 * A0 = x10 and HALT = 1, as computed by packages/rv32 (programs.data.ts).
 * `slack` multiplies the instruction count for the cycle budget.
 */
export function rvProgramTest(p: RvProgram, slack = 1): TestSpec {
  const d = RV_PROGRAM_DATA[p.name];
  if (!d) throw new Error(`no data for program '${p.name}': regenerate programs.data.ts`);
  return {
    kind: 'program',
    program: `# ${p.title}\n${d.hex}`,
    wordBytes: 4,
    rom: 'ROM',
    halt: 'HALT',
    maxCycles: Math.ceil(d.steps * slack) + 16,
    expect: { A0: d.a0, HALT: 1 },
  };
}

// ------------------------------------------------------------ register file

/** Sequence steps for the register-file level, checked against a model. Unwritten registers are not checked (random power on). */
export function regfileSteps(): SequenceStep[] {
  const regs = new Array<number>(32).fill(0);
  const known = new Set<number>([0]);
  const steps: SequenceStep[] = [];
  const read = (rs1: number, rs2: number): Values => ({
    ...(known.has(rs1) ? { R1: regs[rs1]! } : {}),
    ...(known.has(rs2) ? { R2: regs[rs2]! } : {}),
  });
  const write = (rd: number, wd: number, we: number, rs1 = rd, rs2 = 0): void => {
    if (we && rd !== 0) {
      regs[rd] = u(wd);
      known.add(rd);
    }
    steps.push(cycle({ RS1: rs1, RS2: rs2, RD: rd, WD: u(wd), WE: we }, read(rs1, rs2)));
  };
  steps.push(check({ RS1: 0, RS2: 0, RD: 0, WD: 0, WE: 0 }, { R1: 0, R2: 0 }));
  write(1, 0x11111111, 1);
  write(2, 0xdeadbeef, 1, 2, 1);
  write(0, 0xffffffff, 1, 0, 2); // x0 stays 0
  write(31, 0x80000000, 1, 31, 0);
  write(1, 0x12345678, 1, 1, 31);
  write(2, 0x55555555, 0, 2, 1); // WE off: nothing changes
  // Reads are asynchronous: before the edge, R1 still shows the old value.
  steps.push(check({ RS1: 1, RS2: 2, RD: 1, WD: 0xcafef00d, WE: 1 }, read(1, 2)));
  regs[1] = 0xcafef00d;
  steps.push(cycle(undefined, read(1, 2)));
  const rnd = prng(5);
  for (let r = 1; r < 32; r++) write(r, rnd(), 1, r, r - 1);
  for (let r = 0; r < 32; r++) steps.push(check({ RS1: r, RS2: 31 - r, WE: 0 }, read(r, 31 - r)));
  write(0, 0x1234, 1, 0, 0);
  return steps;
}

// ------------------------------------------------------- instruction mixes

const pick = <T>(rnd: () => number, xs: readonly T[]): T => xs[rnd() % xs.length]!;
const reg = (rnd: () => number): number => rnd() & 31;
/** A random signed 12-bit immediate, biased to the edges. */
const imm12 = (rnd: () => number): number => pick(rnd, [0, 1, -1, 2047, -2048, 0x7ff, -0x800, (rnd() & 0xfff) << 20 >> 20, (rnd() & 0xfff) << 20 >> 20]);

/** Random instruction of a given kind, with random fields. */
function randomInstr(rnd: () => number, kind: string): number {
  const f7 = (k: string): number => (k === 'sub' || k === 'sra' ? 0x20 : 0);
  const rOps: Record<string, number> = { add: 0, sub: 0, sll: 1, slt: 2, sltu: 3, xor: 4, srl: 5, sra: 5, or: 6, and: 7 };
  const iOps: Record<string, number> = { addi: 0, slti: 2, sltiu: 3, xori: 4, ori: 6, andi: 7 };
  if (kind in rOps) return encR(f7(kind), reg(rnd), reg(rnd), rOps[kind]!, reg(rnd));
  if (kind in iOps) return encI(imm12(rnd), reg(rnd), iOps[kind]!, reg(rnd), OPC.OP_IMM);
  switch (kind) {
    case 'slli':
      return encI(rnd() & 31, reg(rnd), 1, reg(rnd), OPC.OP_IMM);
    case 'srli':
      return encI(rnd() & 31, reg(rnd), 5, reg(rnd), OPC.OP_IMM);
    case 'srai':
      return encI(0x400 | (rnd() & 31), reg(rnd), 5, reg(rnd), OPC.OP_IMM);
    case 'load':
      return encI(imm12(rnd), reg(rnd), pick(rnd, [0, 1, 2, 4, 5]), reg(rnd), OPC.LOAD);
    case 'store':
      return encS(imm12(rnd), reg(rnd), reg(rnd), pick(rnd, [0, 1, 2]));
    case 'branch':
      return encB(imm12(rnd) << 1, reg(rnd), reg(rnd), pick(rnd, [0, 1, 4, 5, 6, 7]));
    case 'lui':
      return encU(rnd(), reg(rnd), OPC.LUI);
    case 'auipc':
      return encU(rnd(), reg(rnd), OPC.AUIPC);
    case 'jal':
      return encJ(((rnd() & 0xfffff) << 12) >> 11, reg(rnd));
    case 'jalr':
      return encI(imm12(rnd), reg(rnd), 0, reg(rnd), OPC.JALR);
    case 'ebreak':
      return EBREAK;
    default:
      throw new Error(`unknown kind ${kind}`);
  }
}

const R_KINDS = ['add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and'];
const I_KINDS = ['addi', 'slti', 'sltiu', 'xori', 'ori', 'andi', 'slli', 'srli', 'srai'];

// ---------------------------------------------------- immediate generator

/** Rows for the immediate-generator level: every format, plus R-type (no immediate: 0). */
export function immgenRows(): TruthRow[] {
  const rnd = prng(11);
  const kinds = ['load', 'addi', 'slti', 'xori', 'andi', 'srai', 'jalr', 'store', 'branch', 'lui', 'auipc', 'jal', 'add', 'sub', 'ebreak'];
  const words: number[] = [
    encI(-1, 0, 0, 0, OPC.OP_IMM),
    encI(-2048, 0, 0, 0, OPC.OP_IMM),
    encI(2047, 31, 0, 31, OPC.LOAD),
    encS(-1, 0, 0, 2),
    encS(-2048, 31, 31, 0),
    encS(2047, 5, 6, 1),
    encB(-4096, 1, 2, 0),
    encB(4094, 1, 2, 1),
    encB(-2, 0, 0, 7),
    encU(0xfffff000, 1, OPC.LUI),
    encU(0x80000000, 1, OPC.AUIPC),
    encJ(-(1 << 20), 1),
    encJ((1 << 20) - 2, 0),
    encJ(2048, 1),
    encR(0x7f, 31, 31, 7, 31),
  ];
  for (let k = 0; k < 20; k++) for (const kind of kinds) words.push(randomInstr(rnd, kind));
  return words.map((w) => ({ inputs: { INST: w }, expect: { IMM: immOf(w) } }));
}

// ------------------------------------------------------------ ALU control

const operands = (rnd: () => number): [number, number] => {
  const r = rnd() % 4;
  if (r === 0) return [pick(rnd, EDGE_WORDS), pick(rnd, EDGE_WORDS)];
  if (r === 1) return [rnd(), rnd() & 63];
  return [rnd(), rnd()];
};

/** Rows for the ALU-control level: OP and OP-IMM instructions with random operands. */
export function aluControlRows(): TruthRow[] {
  const rnd = prng(23);
  const rows: TruthRow[] = [];
  for (let k = 0; k < 16; k++) {
    for (const kind of [...R_KINDS, ...I_KINDS]) {
      const w = randomInstr(rnd, kind);
      const [a, b] = operands(rnd);
      rows.push({ inputs: { INST: w, A: a, B: b }, expect: { ALUOP: aluControl(w), Y: aluResult(w, a, b) } });
    }
  }
  return rows;
}

// ------------------------------------------------------ branch comparator

/** Rows for the branch-comparator level: every funct3 (2 and 3 never take). */
export function branchRows(): TruthRow[] {
  const rnd = prng(31);
  const rows: TruthRow[] = [];
  const pairs: [number, number][] = [];
  for (const a of EDGE_WORDS) for (const b of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) pairs.push([a, b]);
  for (let k = 0; k < 20; k++) {
    const a = rnd();
    pairs.push([a, a], [a, rnd()], [a, u(a + 1)], [a & 0x7fffffff, u(rnd() | 0x80000000)]);
  }
  pairs.forEach(([a, b], i) => {
    for (const f3 of [0, 1, 4, 5, 6, 7]) rows.push({ inputs: { A: a, B: b, FUNCT3: f3 }, expect: { TAKE: branchTaken(a, b, f3) ? 1 : 0 } });
    if (i % 8 === 0) for (const f3 of [2, 3]) rows.push({ inputs: { A: a, B: b, FUNCT3: f3 }, expect: { TAKE: 0 } });
  });
  return rows;
}

// -------------------------------------------------------- load/store unit

/**
 * Rows for the load/store-unit level. Only the outputs that matter are
 * checked: RESULT for aligned loads, MWDATA for aligned stores, MWE,
 * MISALIGNED and MADDR always.
 */
export function lsuRows(): TruthRow[] {
  const rnd = prng(47);
  const rows: TruthRow[] = [];
  const addrOf = (off: number): number => u(0x400 + ((rnd() & 0x3ff) << 2) + off) & 0xfff | (rnd() & 1 ? 0x10000 : 0);
  for (let k = 0; k < 6; k++) {
    for (const f3 of [0, 1, 2, 4, 5]) {
      for (let off = 0; off < 4; off++) {
        const addr = addrOf(off);
        const rdata = k === 0 ? pick(rnd, [0x80808080, 0x7f7f7f7f, 0xffff8000, 0x00008000]) : rnd();
        const mis = lsuMisaligned(addr, f3, true);
        rows.push({
          inputs: { ADDR: addr, WDATA: rnd(), FUNCT3: f3, LOAD: 1, STORE: 0, RDATA: rdata },
          expect: { MADDR: (addr >>> 2) & 0x3ff, MWE: 0, MISALIGNED: mis ? 1 : 0, ...(mis ? {} : { RESULT: lsuLoad(addr, rdata, f3) }) },
        });
      }
    }
    for (const f3 of [0, 1, 2]) {
      for (let off = 0; off < 4; off++) {
        const addr = addrOf(off);
        const rdata = rnd();
        const wdata = rnd();
        const mis = lsuMisaligned(addr, f3, false);
        rows.push({
          inputs: { ADDR: addr, WDATA: wdata, FUNCT3: f3, LOAD: 0, STORE: 1, RDATA: rdata },
          expect: {
            MADDR: (addr >>> 2) & 0x3ff,
            MWE: lsuWriteEnable(addr, f3) ? 1 : 0,
            MISALIGNED: mis ? 1 : 0,
            ...(mis ? {} : { MWDATA: lsuStore(addr, wdata, rdata, f3) }),
          },
        });
      }
    }
    // Neither a load nor a store: nothing is written, nothing is flagged.
    rows.push({ inputs: { ADDR: addrOf(1), WDATA: rnd(), FUNCT3: 2, LOAD: 0, STORE: 0, RDATA: rnd() }, expect: { MWE: 0, MISALIGNED: 0 } });
  }
  return rows;
}

// ---------------------------------------------------------------- next PC

/** Rows for the next-PC level: jumps, branches (taken or not), ebreak, and everything else. */
export function nextPcRows(): TruthRow[] {
  const rnd = prng(59);
  const kinds = ['jal', 'jalr', 'branch', 'branch', 'ebreak', 'add', 'addi', 'load', 'store', 'lui', 'auipc'];
  const rows: TruthRow[] = [];
  for (let k = 0; k < 24; k++) {
    for (const kind of kinds) {
      const w = randomInstr(rnd, kind);
      const pc = k < 2 ? pick(rnd, [0, 0xfffffffc, 0x7ffffffc]) : u(rnd() & ~3);
      const rs1 = rnd();
      const take = rnd() & 1;
      rows.push({
        inputs: { PC: pc, INST: w, RS1: rs1, TAKE: take },
        expect: { NEXT: nextPc(pc, w, rs1, take === 1), LINK: u(pc + 4), HALT: w === EBREAK ? 1 : 0 },
      });
    }
  }
  return rows;
}

const table = (rows: TruthRow[]): TestSpec => ({ kind: 'truth-table', rows });

// ------------------------------------------------------------------ levels

export const PHASE5: Level[] = [
  defineLevel({
    ...base,
    id: 'rv-register-file',
    order: 1,
    title: 'Register file: x0 to x31',
    goal:
      'Build the RISC-V register file: 32 registers of 32 bits. R1 shows register RS1 and R2 shows register RS2, all the time. ' +
      'At a rising edge with WE on, register RD takes WD. Register x0 always reads 0, and writing it does nothing.',
    tutorial:
      'Welcome to RISC-V, the real instruction set your computer will run from here on. It has 32 registers, x0 to x31, each 32 bits wide. ' +
      'An instruction names up to three of them: two to read (rs1, rs2) and one to write (rd), each with a 5-bit number.\n\n' +
      '| Register | Use |\n| --- | --- |\n| x0 | always 0 (writes are ignored) |\n| x1 (ra) | return address |\n| x2 (sp) | stack pointer |\n| x10 (a0) | first argument and result |\n\n' +
      'A hard-wired zero is handy: `add x5, x6, x0` copies a register, and a write to x0 throws a result away. ' +
      'This is the Phase 3 register file again, just wider and with more registers.',
    hints: [
      'Same plan as the Phase 3 register file: one register per x-register, a decoder to pick which one loads, and a multiplexer tree per read port.',
      'x0 needs no register at all: feed a 32-bit constant 0 into the read trees where x0 would go.',
      'Write side: a decoder with Select bits 5 on RD. Register k (k = 1..31) loads on WE AND decoder o*k*. Every register takes d ← WD and clk ← CLK.',
      'Read side: split RS1 into 5 bits. A tree of 32-bit muxes picks among the 32 values: 16 muxes select with bit 0, then 8 with bit 1, 4, 2 and 1. Do the same for RS2.',
      'Exact wiring: 31 registers (width 32), 31 ANDs, 1 decoder, a 32-bit constant 0, two splitters and 62 muxes (width 32). Tree outputs → R1 and R2. Tip: build a 4-register chip first and reuse it.',
    ],
    afterword: 'From now on the register file is a block in your palette (regfile): same pins, already tested.',
    palette: P_REGFILE,
    starter: {
      parts: [
        clockPart(),
        hexIn('RS1', -20, -8, 5),
        hexIn('RS2', -20, -4, 5),
        hexIn('RD', -20, 0, 5),
        hexIn('WD', -20, 4, 32),
        sw('WE', -20, 8),
        hexOut('R1', 20, -2),
        hexOut('R2', 20, 2),
      ],
      wires: [],
    },
    power: 'random',
    tests: [{ kind: 'sequence', steps: regfileSteps() }],
    requires: [PHASE4_LAST_ID],
  }),
  defineLevel({
    ...base,
    id: 'immediate-generator',
    order: 2,
    title: 'Immediate generator',
    goal:
      'IMM shows the sign-extended immediate of the instruction INST, in the layout its opcode (bits 6..0) calls for: I, S, B, U or J. ' +
      'Instructions without an immediate (R-type, opcode 0x33) give 0.',
    tutorial:
      'Every RV32I instruction is 32 bits. The constant inside it, the immediate, is scattered over different bits depending on the format, ' +
      'so that rs1, rs2 and rd always sit in the same place. Bit 31 is always the sign.\n\n' +
      '| Format | Opcodes | Immediate |\n| --- | --- | --- |\n| I | 0x03 loads, 0x13 ALU-imm, 0x67 jalr, 0x73 system | inst[31:20] |\n' +
      '| S | 0x23 stores | inst[31:25] inst[11:7] |\n| B | 0x63 branches | inst[31] inst[7] inst[30:25] inst[11:8] 0 |\n' +
      '| U | 0x37 lui, 0x17 auipc | inst[31:12], then 12 zeros |\n| J | 0x6f jal | inst[31] inst[19:12] inst[20] inst[30:21] 0 |\n\n' +
      'Sign extension copies bit 31 into every bit above the immediate. The full table is in docs/rv32-datapath.md.',
    hints: [
      'Build all five immediates side by side, then use the opcode to choose one.',
      'Split INST into 32 single bits. For each format, a joiner (width 32, chunk 1) puts bits back together: i0 is the lowest bit of the result. Every unused high input gets bit 31 (the sign).',
      'Example, I-type: joiner i0..i11 ← inst bits 20..31, i12..i31 ← bit 31. S-type: i0..i4 ← bits 7..11, i5..i11 ← bits 25..31, the rest ← bit 31. B and J put a constant 0 in i0.',
      'All opcodes end in 11, so bits 6..2 tell the format. Join them into 5 bits and feed a decoder with Select bits 5: o0 load, o4 ALU-imm, o5 auipc, o8 store, o13 lui, o24 branch, o25 jalr, o27 jal, o28 system.',
      'Exact wiring: start from a 32-bit constant 0; then a mux chain, each 32-bit mux choosing the next format: sel = (o0 OR o4 OR o25 OR o28) → I, o8 → S, o24 → B, (o5 OR o13) → U, o27 → J. The last mux → IMM.',
    ],
    afterword: 'The immgen block is now in your palette. Notice how cheap the decoding was: RISC-V was designed so the hardware stays simple.',
    palette: P_IMMGEN,
    starter: { parts: [hexIn('INST', -20, 0, 32), hexOut('IMM', 20, 0)], wires: [] },
    tests: [table(immgenRows())],
    requires: ['rv-register-file'],
  }),
  defineLevel({
    ...base,
    id: 'alu-control',
    order: 3,
    title: 'ALU control',
    goal:
      'For an ALU instruction INST (opcode 0x33, register-register, or 0x13, register-immediate), set ALUOP for the rvalu block and show the result on Y. ' +
      'A is the value of rs1 and B the value of rs2; register-immediate instructions use the immediate instead of B.',
    tutorial:
      'Your palette now has rvalu, a 32-bit RISC-V ALU, like the one you built in Phase 2 with RISC-V\'s ten operations. ' +
      'Its 4-bit op is {funct7 bit 5, funct3}: the instruction already contains it, almost.\n\n' +
      '| op | operation | op | operation |\n| --- | --- | --- | --- |\n| 0 | add | 8 | sub |\n| 1 | sll | 5 | srl |\n| 2 | slt | 13 | sra |\n| 3 | sltu | 4 | xor |\n| 6 | or | 7 | and |\n\n' +
      'The catch: in a register-immediate instruction bit 30 is part of the immediate. `addi x1, x1, -1` has bit 30 set, but it must add, not subtract. ' +
      'Only the immediate shifts (funct3 = 5: srli, srai) use bit 30 as an operation bit.',
    hints: [
      'Two jobs: choose the ALU\'s B input (B or the immediate) and build the 4-bit op.',
      'The low three bits of op are funct3, inst bits 12..14. Bit 3 is inst bit 30, but only when it means "sub/sra".',
      'Bit 3 = bit30 AND (register-register OR funct3 = 5). Register-register is opcode 0x33: bit 5 of the instruction is 1 for 0x33 and 0 for 0x13.',
      'B input: a 32-bit mux, a = immgen imm, b = B, sel = inst bit 5. The immgen block handles every format for you.',
      'Exact wiring: split INST; funct3 = 5 is AND(bit 12, NOT bit 13, bit 14). op joiner (width 4): i0..i2 ← bits 12..14, i3 ← AND(bit 30, OR(bit 5, funct3 = 5)). op → rvalu op and ALUOP; rvalu a ← A, b ← mux; out → Y.',
    ],
    afterword: 'This little circuit is the whole "ALU control" of a textbook RISC-V. The next block decides whether to branch.',
    palette: P_ALUCTL,
    starter: {
      parts: [hexIn('INST', -20, -4, 32), hexIn('A', -20, 0, 32), hexIn('B', -20, 4, 32), lamp('ALUOP', 20, -2, 4, 'dec'), hexOut('Y', 20, 2)],
      wires: [],
    },
    tests: [table(aluControlRows())],
    requires: ['immediate-generator'],
  }),
  defineLevel({
    ...base,
    id: 'branch-comparator',
    order: 4,
    title: 'Branch comparator',
    goal:
      'TAKE is 1 when the branch with this FUNCT3 holds for A and B: 0 beq (A = B), 1 bne, 4 blt (signed A < B), 5 bge (signed A ≥ B), 6 bltu (unsigned A < B), 7 bgeu. ' +
      'FUNCT3 2 and 3 are not branches: TAKE is 0.',
    tutorial:
      'RISC-V has no flags. A branch compares two registers directly and jumps when the comparison holds, so the comparison has to happen in the same cycle.\n\n' +
      '| funct3 | branch | condition |\n| --- | --- | --- |\n| 0 / 1 | beq / bne | A = B / A ≠ B |\n| 4 / 5 | blt / bge | A < B / A ≥ B, signed |\n| 6 / 7 | bltu / bgeu | A < B / A ≥ B, unsigned |\n\n' +
      'Bit 0 of funct3 always means "the opposite". The same 32 bits can be a big unsigned number or a negative signed one, which is why there are two kinds of "less than".',
    hints: [
      'Three comparisons are enough: equal, signed less-than and unsigned less-than. The others are their opposites.',
      'The rvalu block already compares: op 2 (slt) gives 1 when A < B signed, op 3 (sltu) unsigned. For equality, op 8 (sub) sets zero when A = B.',
      'Bits of FUNCT3: bit 0 inverts, bits 2..1 choose: 00 equal, 01 never, 10 signed, 11 unsigned.',
      'Use three rvalus (sub, slt, sltu) and take bit 0 of the slt/sltu outputs with a splitter. Then an 8-input mux tree of 1-bit muxes picks the answer.',
      'Exact wiring: tree inputs in order: eq, NOT eq, 0, 0, lt, NOT lt, ltu, NOT ltu. Select with FUNCT3 bit 0, then bit 1, then bit 2 (7 muxes). Tree out → TAKE.',
    ],
    afterword: 'branchcmp is now a block. With it, the CPU will decide every branch in a single cycle.',
    palette: P_ALUCTL,
    starter: { parts: [hexIn('A', -20, -4, 32), hexIn('B', -20, 0, 32), hexIn('FUNCT3', -20, 4, 3), lamp('TAKE', 20, 0)], wires: [] },
    tests: [table(branchRows())],
    requires: ['alu-control'],
  }),
  defineLevel({
    ...base,
    id: 'load-store-unit',
    order: 5,
    title: 'Load/store unit',
    goal:
      'Connect the CPU to a RAM of 32-bit words. MADDR = ADDR bits 11..2. A load (LOAD on) takes the byte, half or word at ADDR out of RDATA, sign- or zero-extended by FUNCT3. ' +
      'A store (STORE on) merges WDATA into RDATA to make MWDATA and sets MWE. MISALIGNED flags a half or word that is not on its boundary.',
    tutorial:
      'RISC-V addresses bytes, but your RAM holds 32-bit words. The load/store unit sits in between. Address bits 1..0 pick the byte inside the word; the rest pick the word.\n\n' +
      '| funct3 | load | store |\n| --- | --- | --- |\n| 0 | lb: byte, sign-extended | sb: byte |\n| 1 | lh: half, sign-extended | sh: half |\n| 2 | lw: word | sw: word |\n' +
      '| 4 | lbu: byte, zero-extended | |\n| 5 | lhu: half, zero-extended | |\n\n' +
      'A store of one byte must not destroy the other three, so it reads the word (RDATA), replaces one byte and writes the whole word back: read-modify-write. ' +
      'Little-endian: byte 0 is the low 8 bits of the word.',
    hints: [
      'Two halves: the load side picks and extends a piece of RDATA; the store side builds a new word from RDATA and WDATA. MADDR is just ADDR bits 2..11.',
      'Load: split RDATA into bytes (chunk 8) and halves (chunk 16). A mux tree on ADDR bits 0, 1 picks the byte; ADDR bit 1 picks the half.',
      'Extension: rebuild 32 bits with a joiner (chunk 8) of [byte, ext, ext, ext], where ext is 0xFF when the byte\'s top bit is 1 and FUNCT3 bit 2 is 0, else 0x00. Halves the same way with chunk 16.',
      'Store: make WDATA\'s byte repeated 4 times, its half twice, or the word (mux on FUNCT3 bits 1..0). Then each byte lane of MWDATA is either that or the RDATA byte, chosen by a per-lane write mask.',
      'Mask: sb writes lane ADDR[1:0] (a 2-bit decoder), sh writes lanes 0,1 or 2,3 (ADDR bit 1), sw writes all. MISALIGNED = (half AND bit 0) OR (word AND (bit 0 OR bit 1)), only for loads and stores. MWE = STORE AND NOT MISALIGNED.',
    ],
    afterword: 'The lsu block is now in your palette. Wire its maddr, mwdata, mwe and rdata to a RAM with Address bits 10 and width 32.',
    palette: P_LSU,
    starter: {
      parts: [
        hexIn('ADDR', -20, -10, 32),
        hexIn('WDATA', -20, -6, 32),
        hexIn('FUNCT3', -20, -2, 3),
        sw('LOAD', -20, 2),
        sw('STORE', -20, 6),
        hexIn('RDATA', -20, 10, 32),
        lamp('MADDR', 20, -8, 10, 'hex'),
        hexOut('MWDATA', 20, -4),
        lamp('MWE', 20, 0),
        hexOut('RESULT', 20, 4),
        lamp('MISALIGNED', 20, 8),
      ],
      wires: [],
    },
    tests: [table(lsuRows())],
    requires: ['branch-comparator'],
  }),
  defineLevel({
    ...base,
    id: 'next-pc',
    order: 6,
    title: 'Next PC',
    goal:
      'NEXT is the address of the next instruction after INST at address PC: jal → PC + imm; jalr → (RS1 + imm) with bit 0 cleared; a branch → PC + imm if TAKE, else PC + 4; ebreak → PC (HALT on); anything else → PC + 4. ' +
      'LINK is PC + 4, the return address jal and jalr save.',
    tutorial:
      'Every cycle the CPU picks its next PC. Usually that is the next word, PC + 4. Jumps and taken branches go somewhere else, relative to the PC or (jalr) to a register.\n\n' +
      '| Instruction | Next PC | Writes rd |\n| --- | --- | --- |\n| jal | PC + imm | PC + 4 |\n| jalr | (rs1 + imm) & ~1 | PC + 4 |\n| beq ... bgeu | taken ? PC + imm : PC + 4 | no |\n| ebreak | PC (halt) | no |\n| others | PC + 4 | |\n\n' +
      'Our CPU has no operating system yet, so `ebreak` means "stop here": the PC stays on it and the HALT lamp turns on.',
    hints: [
      'Compute every candidate, then choose: PC + 4, PC + imm, RS1 + imm with bit 0 cleared, and PC itself.',
      'Use the immgen block for imm (it knows the jal, jalr and branch layouts) and adders (width 32, cin 0) for the sums. AND with the constant 0xFFFFFFFE clears bit 0.',
      'Decode bits 6..2 of INST with a 5-bit decoder: o24 branch, o25 jalr, o27 jal, o28 system. ebreak is system with bit 20 set.',
      'Jump to PC + imm when jal OR (branch AND TAKE). TAKE alone means nothing: for other instructions it is ignored.',
      'Exact wiring: mux1 (a = PC + 4, b = PC + imm, sel = jal OR (branch AND TAKE)); mux2 (a = mux1, b = jalr target, sel = o25); mux3 (a = mux2, b = PC, sel = HALT) → NEXT. PC + 4 → LINK, HALT = o28 AND bit 20.',
    ],
    afterword: 'You have every block of a RISC-V CPU. Next: put them together.',
    palette: P5_ALL,
    starter: {
      parts: [hexIn('PC', -20, -6, 32), hexIn('INST', -20, -2, 32), hexIn('RS1', -20, 2, 32), sw('TAKE', -20, 6), hexOut('NEXT', 20, -4), hexOut('LINK', 20, 0), lamp('HALT', 20, 4)],
      wires: [],
    },
    tests: [table(nextPcRows())],
    requires: ['load-store-unit'],
  }),
  defineLevel({
    ...base,
    id: 'single-cycle-datapath',
    order: 7,
    title: 'Single-cycle RV32I',
    goal:
      'Build a RISC-V CPU that runs one RV32I instruction per clock cycle from the program ROM (word = PC / 4), with a 4 KiB data RAM. A0 shows register x10; HALT lights at ebreak and the CPU freezes there. ' +
      'The tests run one program per instruction group.',
    tutorial:
      'Everything happens in one cycle: the PC addresses the ROM, the instruction is decoded, registers are read, the ALU computes, memory is read or written, ' +
      'and at the rising edge the result lands in rd and the PC moves on.\n\n' +
      '| Opcode | rd ← | Next PC |\n| --- | --- | --- |\n| 0x33 / 0x13 ALU | ALU(rs1, rs2 or imm) | PC + 4 |\n| 0x03 load | memory | PC + 4 |\n| 0x23 store | (none) | PC + 4 |\n' +
      '| 0x37 lui | imm | PC + 4 |\n| 0x17 auipc | PC + imm | PC + 4 |\n| 0x6f / 0x67 jal / jalr | PC + 4 | target |\n| 0x63 branch | (none) | taken ? PC + imm : PC + 4 |\n\n' +
      'The regfile block has only two read ports, so to show a0 add a 32-bit register next to it that copies every write to x10. The block diagram is in docs/rv32-datapath.md.',
    hints: [
      'Start with fetch: a 32-bit PC register (load = 1), ROM addr ← PC bits 9..2 (a splitter with chunk 2 and a joiner help), and the ROM q is the instruction.',
      'Decode as in the earlier levels: rs1, rs2, rd, funct3 from fixed bits; a 5-bit decoder on bits 6..2 for the instruction kind. Wire regfile, immgen, your ALU control, branchcmp and lsu (with a RAM: Address bits 10, width 32).',
      'ALU inputs: a = rs1 value, or PC for auipc, or 0 for lui (two muxes). b = rs2 value for opcode 0x33, else imm. The ALU result is also the load/store address.',
      'Write-back: wd = load ? lsu result : (jal OR jalr) ? PC + 4 : ALU out. regfile we = ALU OR ALU-imm OR load OR lui OR auipc OR jal OR jalr (never stores, branches or ebreak).',
      'Next PC is your next-PC level, fed by branchcmp take and the regfile r1. Debug lamp: a register (width 32) with d ← wd, load ← we AND (rd = 10) from a decoder on rd; q → A0. HALT ← system AND inst bit 20.',
    ],
    afterword: 'Your CPU runs real RISC-V machine code, the same instructions a phone or a server runs. Next, give it longer programs.',
    palette: P5_ALL,
    starter: cpuStarter(),
    tests: DATAPATH_PROGRAMS.map((p) => rvProgramTest(p)),
    requires: ['next-pc'],
  }),
  defineLevel({
    ...base,
    id: 'running-programs',
    order: 8,
    title: 'Running test programs',
    goal: 'Run six real programs on your CPU to their ebreak: a sum loop, Fibonacci, a byte-by-byte memory copy, recursion with a stack, multiply by shift and add, and a bubble sort. A0 must match the reference emulator.',
    tutorial:
      'These are ordinary programs written in RISC-V assembly, assembled to machine code and loaded into your ROM. ' +
      'The same code runs on the reference emulator; your CPU must leave the same value in a0.\n\n' +
      '```\n        li   a0, 0\n        li   t0, 1\n        li   t1, 100\nloop:   add  a0, a0, t0     # a0 += t0\n        addi t0, t0, 1\n        bge  t1, t0, loop   # while t0 <= 100\n        ebreak               # a0 = 5050\n```\n\n' +
      'Data lives at addresses 0x400 to 0xFFF and the stack starts at 0x1000, just above it.',
    hints: [
      'No new hardware: a correct single-cycle CPU passes as it is. If one program fails, it uses an instruction the earlier tests did not stress.',
      'Step one cycle at a time and compare with the program listing: after each cycle exactly one instruction has finished.',
      'memcpy-bytes needs lb to sign-extend bytes ≥ 0x80 and sb to leave the other three bytes of the word alone.',
      'recursive-fib needs call (auipc + jalr) and ret (jalr x0, 0(ra)), plus sw/lw relative to sp with negative offsets.',
    ],
    afterword: 'A CPU you designed runs recursion, sorting and memory copies. Next you will write programs for it yourself, in assembly.',
    palette: P5_ALL,
    starter: cpuStarter(),
    tests: RUN_PROGRAMS.map((p) => rvProgramTest(p)),
    requires: ['single-cycle-datapath'],
  }),
  defineLevel({
    ...base,
    id: 'rv-pipeline',
    order: 9,
    title: 'Five-stage pipeline',
    optional: true,
    goal:
      'Optional challenge: split your CPU into five stages (fetch, decode, execute, memory, write-back) with pipeline registers between them, so five instructions are in flight at once. ' +
      'Results must not change: forward values between stages, stall one cycle after a load whose result is needed at once, and flush wrong-path instructions on a taken branch or jump.',
    tutorial:
      'In a single-cycle CPU the clock must wait for the slowest instruction to go all the way through. A pipeline cuts the path into five short stages, like a car factory line, so the clock can tick about five times faster.\n\n' +
      '| Hazard | Fix |\n| --- | --- |\n| Next instruction needs a result not yet written | forward it from the EX/MEM or MEM/WB register |\n| Instruction needs a value a load is still fetching | stall one cycle (insert a bubble) |\n| Branch or jump taken in EX | flush the two instructions fetched after it |\n\n' +
      'HALT should light when ebreak reaches write-back, so every instruction before it has finished. The simulator does not model gate delays, so the tests only check that results stay correct within a cycle budget.',
    hints: [
      'Carry each instruction word (and its PC) down the pipeline in registers, and decode it again in each stage. A bubble is just the instruction 0x00000013 (addi x0, x0, 0).',
      'Register file: write in WB at the rising edge, read in ID. If WB writes the register ID reads in the same cycle, bypass: use the WB value instead.',
      'Forwarding into EX: if the instruction in MEM writes rs1 (rd ≠ 0), use its result; else if WB writes rs1, use the WB value. Same for rs2.',
      'Load-use stall: when EX holds a load whose rd is ID\'s rs1 or rs2, hold PC and IF/ID, and put a bubble into ID/EX. Taken branch or jump in EX: load the target into PC and bubble IF/ID and ID/EX.',
      'ebreak: while ID holds it, stop fetching (hold PC and IF/ID) but let it flow on. HALT ← the MEM/WB instruction is ebreak. A0: a register copying writes to x10 in WB.',
    ],
    afterword: 'This is how real processors are built: your design is a classic five-stage RISC pipeline, the one textbooks call "the" RISC-V pipeline.',
    palette: P5_ALL,
    starter: cpuStarter(),
    tests: PIPELINE_PROGRAMS.map((p) => rvProgramTest(p, 3)),
    requires: ['running-programs'],
  }),
];
