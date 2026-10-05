import type { Board } from '@build-a-computer/schema';
import { BoardBuilder, type Pin } from '../../src/phase3-4/builder';

/**
 * The Toy-8 CPU (docs/toy8.md) as a board of blocks: counter, registers,
 * ROM, RAM, ALU, muxes, decoders and gates. Test-only reference solution;
 * it proves the platform can build a working computer.
 */

export interface DatapathIn {
  /** 8-bit instruction byte. */
  ir: Pin;
  /** 8-bit operand byte. */
  imm: Pin;
  /** 1 during the execute cycle: every write happens at its closing edge. */
  exec: Pin;
  clk: Pin;
  /** Include the ALU and flag registers. */
  alu: boolean;
  /** Include the data RAM (LD/ST). */
  mem: boolean;
}

export interface Datapath {
  bits: Pin[];
  /** R[rd] and R[rs]. */
  regA: Pin;
  regB: Pin;
  /** Register part ids R0..R3. */
  regs: string[];
  /** System instruction lines (each already ANDed with NOT A): HALT, LDI, MOV, LD, ST, OUT, JMP, JCC. */
  sys: Pin[];
  isAlu: Pin;
  /** Flag register outputs (when `alu`). */
  z?: Pin;
  n?: Pin;
  c?: Pin;
}

/** Decoder, register file, write-back, ALU + flags and RAM: the execute half of Toy-8. */
export function toy8Datapath(b: BoardBuilder, o: DatapathIn): Datapath {
  const bits = b.split(o.ir, 8);
  const rd = b.join([bits[2]!, bits[3]!]);
  const op = b.join([bits[4]!, bits[5]!, bits[6]!]);
  const isAlu = bits[7]!;
  const nA = b.not(isAlu);
  const sys = b.decoder(op, 3).map((line) => b.and(line, nA));
  const [, isLdi, isMov, isLd, isSt] = sys as [Pin, Pin, Pin, Pin, Pin];

  const regs = [0, 1, 2, 3].map(() => b.register(8, o.clk));
  const qs = regs.map((r) => `${r}.q`) as [Pin, Pin, Pin, Pin];
  const regA = b.mux4(qs, bits[2]!, bits[3]!, 8);
  const regB = b.mux4(qs, bits[0]!, bits[1]!, 8);

  // Write-back: bit 4 ? mem : R[rs] → bit 5 ? that : imm → A ? ALU : that.
  let fromSys: Pin = regB;
  if (o.mem) {
    const ram = b.part('ram', { props: { addrWidth: 8, width: 8 } });
    b.wire(regB, `${ram}.addr`).wire(regA, `${ram}.d`).wire(o.clk, `${ram}.clk`);
    b.wire(b.and(o.exec, isSt), `${ram}.we`);
    fromSys = b.mux(regB, `${ram}.q`, bits[4]!, 8);
  }
  let wb = b.mux(o.imm, fromSys, bits[5]!, 8);
  const writers: Pin[] = [isLdi, isMov];
  if (o.mem) writers.push(isLd);
  const out: Datapath = { bits, regA, regB, regs, sys, isAlu };
  if (o.alu) {
    const alu = b.part('alu', { props: { width: 8 } });
    b.wire(regA, `${alu}.a`).wire(regB, `${alu}.b`).wire(op, `${alu}.op`);
    wb = b.mux(wb, `${alu}.out`, isAlu, 8);
    writers.push(isAlu);
    const loadFlags = b.and(o.exec, isAlu);
    const flag = (pin: string): Pin => `${b.register(1, o.clk, `${alu}.${pin}`, loadFlags)}.q`;
    out.z = flag('zero');
    out.n = flag('neg');
    out.c = flag('carry');
  }
  const we = b.and(o.exec, b.orAll(...writers));
  const sel = b.decoder(rd, 2);
  regs.forEach((r, i) => {
    b.wire(wb, `${r}.d`);
    b.wire(b.and(sel[i]!, we), `${r}.load`);
  });
  return out;
}

export interface CpuIo {
  clk: Pin;
  /** Id of the ROM part (addrWidth 8, width 8). */
  rom: string;
  /** OUT lamp input. */
  out: Pin;
  /** HALT lamp input, if the board has one. */
  halt?: Pin;
}

export interface Cpu extends Datapath {
  pc: string;
  ir: string;
  halted: string;
  outReg: string;
}

/** The whole Toy-8 CPU around an existing clock, ROM and output lamps. */
export function toy8Cpu(b: BoardBuilder, io: CpuIo): Cpu {
  const { clk, rom } = io;
  const halted = b.register(1, clk, b.konst(1, 1));
  const run = b.not(`${halted}.q`);
  const phase = b.part('dff');
  b.wire(clk, `${phase}.clk`);
  const nPhase = b.not(`${phase}.q`);
  b.wire(nPhase, `${phase}.d`);
  const fetch = b.and(run, nPhase);
  const exec = b.and(run, `${phase}.q`);

  const pc = b.part('counter', { props: { width: 8 } });
  b.wire(clk, `${pc}.clk`).wire(`${pc}.q`, `${rom}.addr`).wire(`${rom}.q`, `${pc}.d`).wire(run, `${pc}.en`);
  const ir = b.register(8, clk, `${rom}.q`, fetch);

  const dp = toy8Datapath(b, { ir: `${ir}.q`, imm: `${rom}.q`, exec, clk, alu: true, mem: true });
  const [isHalt, , , , , isOut, isJmp, isJcc] = dp.sys as Pin[];

  const outReg = b.register(8, clk, dp.regA, b.and(exec, isOut!));
  b.wire(`${outReg}.q`, io.out);
  b.wire(b.and(exec, isHalt!), `${halted}.load`);
  if (io.halt) b.wire(`${halted}.q`, io.halt);

  const cond = b.mux4([dp.z!, b.not(dp.z!), dp.c!, dp.n!], dp.bits[0]!, dp.bits[1]!);
  const jump = b.or(isJmp!, b.and(isJcc!, cond));
  b.wire(b.and(exec, jump), `${pc}.load`);
  return { ...dp, pc, ir, halted, outReg };
}

/**
 * A stand-alone Toy-8 board: clock, ROM (labelled ROM), OUT lamp. With
 * `debug`, extra lamps PC, R0..R3, Z, N, C and HALTED expose the state for
 * cycle-by-cycle comparison with the reference model (no HALT lamp, so a
 * program test runs exactly maxCycles). Without `debug` it has the HALT lamp.
 */
export function toy8CpuBoard(o: { debug?: boolean; program?: string } = {}): Board {
  const b = new BoardBuilder();
  const clk = b.clock();
  const rom = b.part('rom', { id: 'ROM', label: 'ROM', locked: true, props: { addrWidth: 8, width: 8, data: o.program ?? '' } });
  const out = b.output('OUT', 8, 20, 0);
  const halt = o.debug ? undefined : b.output('HALT', 1, 20, 4);
  const cpu = toy8Cpu(b, { clk, rom, out, ...(halt ? { halt } : {}) });
  if (o.debug) {
    b.wire(`${cpu.pc}.q`, b.output('PC', 8, 20, 8));
    cpu.regs.forEach((r, i) => b.wire(`${r}.q`, b.output(`R${i}`, 8, 20, 12 + 4 * i)));
    b.wire(cpu.z!, b.output('Z', 1, 24, 0));
    b.wire(cpu.n!, b.output('N', 1, 24, 4));
    b.wire(cpu.c!, b.output('C', 1, 24, 8));
    b.wire(`${cpu.halted}.q`, b.output('HALTED', 1, 24, 12));
  }
  return b.build();
}
