import type { Board } from '@build-a-computer/schema';
import { BoardBuilder, type Pin } from '../../src/phase3-4/builder';

/**
 * The Phase 5 RV32I CPUs (docs/rv32-datapath.md) as boards of blocks:
 * regfile, immgen, rvalu, branchcmp, lsu, a 32-bit word RAM, the program ROM,
 * registers, adders, muxes, decoders, splitters/joiners and gates.
 * Test-only reference solutions.
 */

/** Opcode lines: decoder outputs on inst[6:2]. */
export const OPCODE_LINE = { load: 0, opImm: 4, auipc: 5, store: 8, op: 12, lui: 13, branch: 24, jalr: 25, jal: 27, system: 28 } as const;

/** `addi x0, x0, 0`: the pipeline bubble. */
export const NOP = 0x00000013;

export interface Fields {
  bits: Pin[];
  rd: Pin;
  rs1: Pin;
  rs2: Pin;
  f3: Pin;
  isLoad: Pin;
  isOpImm: Pin;
  isAuipc: Pin;
  isStore: Pin;
  isOp: Pin;
  isLui: Pin;
  isBranch: Pin;
  isJalr: Pin;
  isJal: Pin;
  isSystem: Pin;
  /** ebreak (system with inst[20] set): the halt instruction. */
  isHalt: Pin;
}

/** Split an instruction into its fields and one-hot opcode lines. */
export function decodeInst(b: BoardBuilder, inst: Pin): Fields {
  const bits = b.split(inst, 32);
  const lines = b.decoder(b.join(bits.slice(2, 7)), 5);
  const L = (k: number): Pin => lines[k]!;
  const isSystem = L(OPCODE_LINE.system);
  return {
    bits,
    rd: b.join(bits.slice(7, 12)),
    f3: b.join(bits.slice(12, 15)),
    rs1: b.join(bits.slice(15, 20)),
    rs2: b.join(bits.slice(20, 25)),
    isLoad: L(OPCODE_LINE.load),
    isOpImm: L(OPCODE_LINE.opImm),
    isAuipc: L(OPCODE_LINE.auipc),
    isStore: L(OPCODE_LINE.store),
    isOp: L(OPCODE_LINE.op),
    isLui: L(OPCODE_LINE.lui),
    isBranch: L(OPCODE_LINE.branch),
    isJalr: L(OPCODE_LINE.jalr),
    isJal: L(OPCODE_LINE.jal),
    isSystem,
    isHalt: b.and(isSystem, bits[20]!),
  };
}

/** ALU control: {inst[30] when it means sub/sra, funct3} for OP and OP-IMM; 0 (add) otherwise. */
export function aluControl(b: BoardBuilder, f: Fields): Pin {
  const [b12, b13, b14] = [f.bits[12]!, f.bits[13]!, f.bits[14]!];
  const f3is5 = b.andAll(b12, b.not(b13), b14);
  const bit3 = b.and(f.bits[30]!, b.or(f.isOp, b.and(f.isOpImm, f3is5)));
  const op = b.join([b12, b13, b14, bit3]);
  return b.mux(b.konst(0, 4), op, b.or(f.isOp, f.isOpImm), 4);
}

/** Place a 32-bit adder (cin 0); returns its sum. */
export function add32(b: BoardBuilder, a: Pin, x: Pin): Pin {
  const id = b.part('adder', { props: { width: 32 } });
  b.wire(a, `${id}.a`).wire(x, `${id}.b`).wire(b.konst(0, 1), `${id}.cin`);
  return `${id}.sum`;
}

/** A block with the given input wiring; returns its id. */
function block(b: BoardBuilder, type: 'regfile' | 'immgen' | 'rvalu' | 'branchcmp' | 'lsu' | 'ram', ins: Record<string, Pin>, props?: Record<string, number>): string {
  const id = b.part(type, props ? { props } : {});
  for (const [pin, src] of Object.entries(ins)) b.wire(src, `${id}.${pin}`);
  return id;
}

/** Equality of two 5-bit register numbers. */
export function eq5(b: BoardBuilder, x: Pin, y: Pin): Pin {
  return b.not(b.orAll(...b.split(b.g2('xor', x, y, 5), 5)));
}

/** rd ≠ 0. */
export const nonZero5 = (b: BoardBuilder, x: Pin): Pin => b.orAll(...b.split(x, 5));

/** ROM word address: PC bits 9..2. */
function romAddr(b: BoardBuilder, pc: Pin): Pin {
  return b.join(b.split(pc, 32, 2).slice(1, 5), 2);
}

/** Registers written by an instruction kind (never stores, branches or system). */
const writesRd = (b: BoardBuilder, f: Fields): Pin => b.orAll(f.isOp, f.isOpImm, f.isLoad, f.isLui, f.isAuipc, f.isJal, f.isJalr);

export interface CpuIo {
  clk: Pin;
  /** Id of the program ROM (addrWidth 8, width 32). */
  rom: string;
  /** A0 lamp input. */
  a0?: Pin;
  /** HALT lamp input. */
  halt?: Pin;
}

export interface Cpu {
  pc: string;
  /** Write-back: register number, data and enable (for debug shadows). */
  rd: Pin;
  wd: Pin;
  we: Pin;
  ram: string;
}

/** A shadow register that copies every write to register `k` (the regfile has only two read ports). */
export function shadow(b: BoardBuilder, clk: Pin, rdLines: Pin[], wd: Pin, we: Pin, k: number): Pin {
  return `${b.register(32, clk, wd, b.and(we, rdLines[k]!))}.q`;
}

/** The single-cycle RV32I CPU around a clock and a program ROM. */
export function rvSingleCycle(b: BoardBuilder, io: CpuIo): Cpu {
  const { clk, rom } = io;
  const pc = b.register(32, clk, undefined, b.konst(1, 1));
  const pcq = `${pc}.q`;
  b.wire(romAddr(b, pcq), `${rom}.addr`);
  const f = decodeInst(b, `${rom}.q`);

  const rf = block(b, 'regfile', { rs1: f.rs1, rs2: f.rs2, rd: f.rd, clk });
  const r1 = `${rf}.r1`;
  const r2 = `${rf}.r2`;
  const imm = `${block(b, 'immgen', { inst: `${rom}.q` })}.imm`;

  const aIn = b.mux(b.mux(r1, pcq, f.isAuipc, 32), b.konst(0, 32), f.isLui, 32);
  const bIn = b.mux(imm, r2, f.isOp, 32);
  const alu = block(b, 'rvalu', { a: aIn, b: bIn, op: aluControl(b, f) });
  const aluOut = `${alu}.out`;
  const take = `${block(b, 'branchcmp', { a: r1, b: r2, funct3: f.f3 })}.take`;

  const lsu = block(b, 'lsu', { addr: aluOut, wdata: r2, funct3: f.f3, load: f.isLoad, store: f.isStore }, { addrWidth: 10 });
  const ram = block(b, 'ram', { addr: `${lsu}.maddr`, d: `${lsu}.mwdata`, we: `${lsu}.mwe`, clk }, { addrWidth: 10, width: 32 });
  b.wire(`${ram}.q`, `${lsu}.rdata`);

  const pc4 = add32(b, pcq, b.konst(4, 32));
  const pcImm = add32(b, pcq, imm);
  const jalrTarget = b.and(aluOut, b.konst(0xfffffffe, 32), 32);

  const wd = b.mux(b.mux(aluOut, pc4, b.or(f.isJal, f.isJalr), 32), `${lsu}.result`, f.isLoad, 32);
  const we = writesRd(b, f);
  b.wire(wd, `${rf}.wd`).wire(we, `${rf}.we`);

  const jump = b.or(f.isJal, b.and(f.isBranch, take));
  const next = b.mux(b.mux(b.mux(pc4, pcImm, jump, 32), jalrTarget, f.isJalr, 32), pcq, f.isHalt, 32);
  b.wire(next, `${pc}.d`);

  if (io.a0) b.wire(shadow(b, clk, b.decoder(f.rd, 5), wd, we, 10), io.a0);
  if (io.halt) b.wire(f.isHalt, io.halt);
  return { pc, rd: f.rd, wd, we, ram };
}

/**
 * The five-stage pipelined RV32I CPU: IF, ID, EX, MEM, WB. Each stage
 * register carries the instruction word and re-decodes it. Forwarding from
 * MEM and WB into EX, a WB → ID bypass around the register file, a one-cycle
 * load-use stall, branches and jumps resolved in EX (flushing two), and
 * ebreak stops fetch in ID; HALT = ebreak in WB.
 */
export function rvPipeline(b: BoardBuilder, io: CpuIo): Cpu {
  const { clk, rom } = io;
  const nop = b.konst(NOP, 32);
  const one = b.konst(1, 1);
  const reg32 = (): string => b.register(32, clk);

  // Stage registers (wired below; d inputs need values from later stages).
  const pc = reg32();
  const dInst = reg32();
  const dPc = reg32();
  const eInst = reg32();
  const ePc = reg32();
  const eR1 = reg32();
  const eR2 = reg32();
  const mInst = reg32();
  const mRes = reg32();
  const mR2 = reg32();
  const wInst = reg32();
  const wVal = reg32();

  // ------------------------------------------------------------- WB
  const W = decodeInst(b, `${wInst}.q`);
  const wWe = b.and(writesRd(b, W), nonZero5(b, W.rd));
  const wd = `${wVal}.q`;

  // ------------------------------------------------------------- MEM
  const M = decodeInst(b, `${mInst}.q`);
  const mWe = b.and(writesRd(b, M), nonZero5(b, M.rd));
  const lsu = block(b, 'lsu', { addr: `${mRes}.q`, wdata: `${mR2}.q`, funct3: M.f3, load: M.isLoad, store: M.isStore }, { addrWidth: 10 });
  const ram = block(b, 'ram', { addr: `${lsu}.maddr`, d: `${lsu}.mwdata`, we: `${lsu}.mwe`, clk }, { addrWidth: 10, width: 32 });
  b.wire(`${ram}.q`, `${lsu}.rdata`);
  b.wire(`${mInst}.q`, `${wInst}.d`).wire(one, `${wInst}.load`);
  b.wire(b.mux(`${mRes}.q`, `${lsu}.result`, M.isLoad, 32), `${wVal}.d`).wire(one, `${wVal}.load`);

  // ------------------------------------------------------------- EX
  const E = decodeInst(b, `${eInst}.q`);
  const fwd = (reg: Pin, val: Pin): Pin =>
    b.mux(b.mux(val, wd, b.and(wWe, eq5(b, W.rd, reg)), 32), `${mRes}.q`, b.and(mWe, eq5(b, M.rd, reg)), 32);
  const r1 = fwd(E.rs1, `${eR1}.q`);
  const r2 = fwd(E.rs2, `${eR2}.q`);
  const epc = `${ePc}.q`;
  const imm = `${block(b, 'immgen', { inst: `${eInst}.q` })}.imm`;
  const aIn = b.mux(b.mux(r1, epc, E.isAuipc, 32), b.konst(0, 32), E.isLui, 32);
  const bIn = b.mux(imm, r2, E.isOp, 32);
  const aluOut = `${block(b, 'rvalu', { a: aIn, b: bIn, op: aluControl(b, E) })}.out`;
  const take = `${block(b, 'branchcmp', { a: r1, b: r2, funct3: E.f3 })}.take`;
  const pc4 = add32(b, epc, b.konst(4, 32));
  const target = b.mux(add32(b, epc, imm), b.and(aluOut, b.konst(0xfffffffe, 32), 32), E.isJalr, 32);
  const redirect = b.orAll(E.isJal, E.isJalr, b.and(E.isBranch, take));
  b.wire(`${eInst}.q`, `${mInst}.d`).wire(one, `${mInst}.load`);
  b.wire(b.mux(aluOut, pc4, b.or(E.isJal, E.isJalr), 32), `${mRes}.d`).wire(one, `${mRes}.load`);
  b.wire(r2, `${mR2}.d`).wire(one, `${mR2}.load`);

  // ------------------------------------------------------------- ID
  const D = decodeInst(b, `${dInst}.q`);
  const rf = block(b, 'regfile', { rs1: D.rs1, rs2: D.rs2, rd: W.rd, wd, we: wWe, clk });
  const bypass = (reg: Pin, val: Pin): Pin => b.mux(val, wd, b.and(wWe, eq5(b, W.rd, reg)), 32);
  b.wire(bypass(D.rs1, `${rf}.r1`), `${eR1}.d`).wire(one, `${eR1}.load`);
  b.wire(bypass(D.rs2, `${rf}.r2`), `${eR2}.d`).wire(one, `${eR2}.load`);
  b.wire(`${dPc}.q`, `${ePc}.d`).wire(one, `${ePc}.load`);
  const eWritesNz = b.and(E.isLoad, nonZero5(b, E.rd));
  const loadUse = b.and(eWritesNz, b.or(eq5(b, E.rd, D.rs1), eq5(b, E.rd, D.rs2)));
  b.wire(b.mux(`${dInst}.q`, nop, b.or(loadUse, redirect), 32), `${eInst}.d`).wire(one, `${eInst}.load`);

  // ------------------------------------------------------------- IF
  const hold = b.or(loadUse, D.isHalt);
  const advance = b.or(redirect, b.not(hold));
  const pcq = `${pc}.q`;
  b.wire(romAddr(b, pcq), `${rom}.addr`);
  b.wire(b.mux(add32(b, pcq, b.konst(4, 32)), target, redirect, 32), `${pc}.d`).wire(advance, `${pc}.load`);
  b.wire(b.mux(`${rom}.q`, nop, redirect, 32), `${dInst}.d`).wire(advance, `${dInst}.load`);
  b.wire(pcq, `${dPc}.d`).wire(advance, `${dPc}.load`);

  if (io.a0) b.wire(shadow(b, clk, b.decoder(W.rd, 5), wd, wWe, 10), io.a0);
  if (io.halt) b.wire(W.isHalt, io.halt);
  return { pc, rd: W.rd, wd, we: wWe, ram };
}

/**
 * A stand-alone RV32I board: clock, ROM (labelled ROM), A0 and HALT lamps.
 * With `debug`, extra lamps X1..X31 (shadow copies of every register write)
 * and, for the single-cycle CPU, PC, expose the architectural state for
 * comparison with the emulator. A debug board has no HALT lamp unless `halt`
 * is set, so a program test runs exactly maxCycles.
 */
export function rvCpuBoard(o: { pipeline?: boolean; debug?: boolean; halt?: boolean } = {}): Board {
  const b = new BoardBuilder();
  const clk = b.clock();
  const rom = b.part('rom', { id: 'ROM', label: 'ROM', locked: true, props: { addrWidth: 8, width: 32, data: '' } });
  const a0 = b.output('A0', 32, 20, 0);
  const halt = (o.halt ?? !o.debug) ? b.output('HALT', 1, 20, 4) : undefined;
  const cpu = (o.pipeline ? rvPipeline : rvSingleCycle)(b, { clk, rom, a0, ...(halt ? { halt } : {}) });
  if (o.debug) {
    const lines = b.decoder(cpu.rd, 5);
    for (let k = 1; k < 32; k++) b.wire(shadow(b, clk, lines, cpu.wd, cpu.we, k), b.output(`X${k}`, 32, 24, 4 * k));
    if (!o.pipeline) b.wire(`${cpu.pc}.q`, b.output('PC', 32, 20, 8));
  }
  return b.build();
}
