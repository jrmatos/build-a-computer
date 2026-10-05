import type { Board, Level } from '@build-a-computer/schema';
import { BoardBuilder, type Pin } from '../../src/phase3-4/builder';
import { add32, rvPipeline, rvSingleCycle } from './rv-cpu';

/**
 * Reference solutions for every Phase 5 level, built in code from the
 * level's starter (locked parts kept as they are) plus palette parts only.
 * The block levels build each block from earlier parts; the CPU levels use
 * the blocks. Loaded by the game only on "Show solution" (ADR-007).
 */

type Solver = (b: BoardBuilder) => void;

const range = (lo: number, hi: number): number[] => Array.from({ length: hi - lo }, (_, i) => lo + i);

/** Bits 2..6 of an instruction through a 5-bit decoder: one line per opcode. */
const opcodeLines = (b: BoardBuilder, bits: Pin[]): Pin[] => b.decoder(b.join(bits.slice(2, 7)), 5);

/** An immediate built from instruction bits: `pick(i)` gives the pin for result bit i. */
const assemble = (b: BoardBuilder, pick: (i: number) => Pin): Pin => b.join(range(0, 32).map(pick));

const SOLVERS: Record<string, Solver> = {
  'rv-register-file': (b) => {
    const lines = b.decoder('RD.out', 5);
    const qs = [b.konst(0, 32), ...range(1, 32).map((k) => `${b.register(32, 'CLK.out', 'WD.out', b.and(lines[k]!, 'WE.out'))}.q`)];
    b.wire(b.muxTree(qs, b.split('RS1.out', 5), 32), 'R1.in');
    b.wire(b.muxTree(qs, b.split('RS2.out', 5), 32), 'R2.in');
  },

  'immediate-generator': (b) => {
    const bits = b.split('INST.out', 32);
    const s = bits[31]!;
    const zero = b.konst(0, 1);
    const at = (k: number): Pin => bits[k]!;
    const immI = assemble(b, (i) => (i < 12 ? at(20 + i) : s));
    const immS = assemble(b, (i) => (i < 5 ? at(7 + i) : i < 12 ? at(20 + i) : s));
    const immB = assemble(b, (i) => (i === 0 ? zero : i < 5 ? at(7 + i) : i < 11 ? at(20 + i) : i === 11 ? at(7) : s));
    const immU = assemble(b, (i) => (i < 12 ? zero : at(i)));
    const immJ = assemble(b, (i) => (i === 0 ? zero : i < 11 ? at(20 + i) : i === 11 ? at(20) : i < 20 ? at(i) : s));
    const L = opcodeLines(b, bits);
    let imm = b.konst(0, 32);
    imm = b.mux(imm, immI, b.orAll(L[0]!, L[4]!, L[25]!, L[28]!), 32);
    imm = b.mux(imm, immS, L[8]!, 32);
    imm = b.mux(imm, immB, L[24]!, 32);
    imm = b.mux(imm, immU, b.or(L[5]!, L[13]!), 32);
    imm = b.mux(imm, immJ, L[27]!, 32);
    b.wire(imm, 'IMM.in');
  },

  'alu-control': (b) => {
    const bits = b.split('INST.out', 32);
    const [b12, b13, b14] = [bits[12]!, bits[13]!, bits[14]!];
    const f3is5 = b.andAll(b12, b.not(b13), b14);
    const op = b.join([b12, b13, b14, b.and(bits[30]!, b.or(bits[5]!, f3is5))]);
    const imm = b.part('immgen');
    b.wire('INST.out', `${imm}.inst`);
    const alu = b.part('rvalu');
    b.wire('A.out', `${alu}.a`).wire(b.mux(`${imm}.imm`, 'B.out', bits[5]!, 32), `${alu}.b`).wire(op, `${alu}.op`);
    b.wire(op, 'ALUOP.in').wire(`${alu}.out`, 'Y.in');
  },

  'branch-comparator': (b) => {
    const cmp = (op: number, out: 'out' | 'zero'): Pin => {
      const alu = b.part('rvalu');
      b.wire('A.out', `${alu}.a`).wire('B.out', `${alu}.b`).wire(b.konst(op, 4), `${alu}.op`);
      return out === 'zero' ? `${alu}.zero` : b.split(`${alu}.out`, 32)[0]!;
    };
    const eq = cmp(8, 'zero');
    const lt = cmp(2, 'out');
    const ltu = cmp(3, 'out');
    const zero = b.konst(0, 1);
    const f = b.split('FUNCT3.out', 3);
    b.wire(b.muxTree([eq, b.not(eq), zero, zero, lt, b.not(lt), ltu, b.not(ltu)], f), 'TAKE.in');
  },

  'load-store-unit': (b) => {
    const a = b.split('ADDR.out', 32);
    const [a0, a1] = [a[0]!, a[1]!];
    b.wire(b.join(a.slice(2, 12)), 'MADDR.in');
    const [f0, f1, f2] = b.split('FUNCT3.out', 3) as [Pin, Pin, Pin];
    const nf2 = b.not(f2);
    const zero1 = b.konst(0, 1);

    // Load: pick a byte or half and extend it.
    const rb = b.split('RDATA.out', 32, 8);
    const rh = b.split('RDATA.out', 32, 16);
    const byte = b.mux4(rb as [Pin, Pin, Pin, Pin], a0, a1, 8);
    const half = b.mux(rh[0]!, rh[1]!, a1, 16);
    const e8 = b.mux(b.konst(0, 8), b.konst(0xff, 8), b.and(b.split(byte, 8)[7]!, nf2), 8);
    const e16 = b.mux(b.konst(0, 16), b.konst(0xffff, 16), b.and(b.split(half, 16)[15]!, nf2), 16);
    const loadVal = b.mux4([b.join([byte, e8, e8, e8], 8), b.join([half, e16], 16), 'RDATA.out', b.konst(0, 32)], f0, f1, 32);
    const misSize = b.mux4([zero1, a0, b.or(a0, a1), zero1], f0, f1);
    const validL = b.not(b.and(f2, f1));
    b.wire(b.mux(b.konst(0, 32), loadVal, b.and(validL, b.not(misSize)), 32), 'RESULT.in');

    // Store: replicate the data, then replace the selected byte lanes of RDATA.
    const validS = b.and(nf2, b.not(b.and(f1, f0)));
    const storeOk = b.and(validS, b.not(misSize));
    b.wire(b.and('STORE.out', storeOk), 'MWE.in');
    const wb = b.split('WDATA.out', 32, 8);
    const wh = b.split('WDATA.out', 32, 16);
    const rep = b.mux4([b.join([wb[0]!, wb[0]!, wb[0]!, wb[0]!], 8), b.join([wh[0]!, wh[0]!], 16), 'WDATA.out', 'WDATA.out'], f0, f1, 32);
    const repLanes = b.split(rep, 32, 8);
    const lane = b.decoder(b.join([a0, a1]), 2);
    const na1 = b.not(a1);
    const one = b.konst(1, 1);
    const lanes = range(0, 4).map((i) => {
      const mask = b.mux4([lane[i]!, i < 2 ? na1 : a1, one, zero1], f0, f1);
      return b.mux(rb[i]!, repLanes[i]!, b.and(mask, storeOk), 8);
    });
    b.wire(b.join(lanes, 8), 'MWDATA.in');

    const nLoad = b.not('LOAD.out');
    const mis = b.or(b.andAll('LOAD.out', validL, misSize), b.andAll(nLoad, 'STORE.out', validS, misSize));
    b.wire(mis, 'MISALIGNED.in');
  },

  'next-pc': (b) => {
    const bits = b.split('INST.out', 32);
    const L = opcodeLines(b, bits);
    const imm = b.part('immgen');
    b.wire('INST.out', `${imm}.inst`);
    const pc4 = add32(b, 'PC.out', b.konst(4, 32));
    const pcImm = add32(b, 'PC.out', `${imm}.imm`);
    const jalrTarget = b.and(add32(b, 'RS1.out', `${imm}.imm`), b.konst(0xfffffffe, 32), 32);
    const halt = b.and(L[28]!, bits[20]!);
    const jump = b.or(L[27]!, b.and(L[24]!, 'TAKE.out'));
    const next = b.mux(b.mux(b.mux(pc4, pcImm, jump, 32), jalrTarget, L[25]!, 32), 'PC.out', halt, 32);
    b.wire(next, 'NEXT.in').wire(pc4, 'LINK.in').wire(halt, 'HALT.in');
  },

  'single-cycle-datapath': (b) => void rvSingleCycle(b, { clk: 'CLK.out', rom: 'ROM', a0: 'A0.in', halt: 'HALT.in' }),
  'running-programs': (b) => void rvSingleCycle(b, { clk: 'CLK.out', rom: 'ROM', a0: 'A0.in', halt: 'HALT.in' }),
  'rv-pipeline': (b) => void rvPipeline(b, { clk: 'CLK.out', rom: 'ROM', a0: 'A0.in', halt: 'HALT.in' }),
};

/** Level ids with a reference solution. */
export const PHASE5_SOLUTION_IDS = Object.keys(SOLVERS);

/** The reference solution board for a Phase 5 level, or undefined. */
export function phase5Solution(level: Level): Board | undefined {
  const solve = SOLVERS[level.id];
  if (!solve) return undefined;
  const b = new BoardBuilder(level.starter);
  solve(b);
  return b.build();
}
