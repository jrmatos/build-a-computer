import type { Board, Level } from '@ground-up/schema';
import { BoardBuilder, type Pin } from '../../src/phase3-4/builder';
import { toy8Cpu, toy8Datapath } from './toy8-cpu';

/**
 * Reference solutions for every Phase 3–4 level, built in code from the
 * level's starter (locked parts kept as they are) plus palette parts only.
 * Test-only: never imported by the game.
 */

/** A cross-coupled NAND latch with active-low set/reset; returns Q. */
function nandLatch(b: BoardBuilder, nSet: Pin, nReset: Pin): Pin {
  const q = b.part('nand');
  const qb = b.part('nand');
  b.wire(nSet, `${q}.a`).wire(`${qb}.out`, `${q}.b`);
  b.wire(nReset, `${qb}.a`).wire(`${q}.out`, `${qb}.b`);
  return `${q}.out`;
}

/** Gated D latch from NANDs: transparent while `en` is 1. */
function dLatch(b: BoardBuilder, d: Pin, en: Pin): Pin {
  return nandLatch(b, b.nand(d, en), b.nand(b.not(d), en));
}

function adderPlusOne(b: BoardBuilder, q: Pin): Pin {
  const add = b.part('adder', { props: { width: 8 } });
  b.wire(q, `${add}.a`).wire(b.konst(0, 8), `${add}.b`).wire(b.konst(1, 1), `${add}.cin`);
  return `${add}.sum`;
}

type Solver = (b: BoardBuilder) => void;

const SOLVERS: Record<string, Solver> = {
  // ------------------------------------------------------------ Phase 3
  'the-clock': (b) => {
    const clk = `${b.part('clock')}.out`;
    b.wire(clk, 'TICK.in').wire(b.not(clk), 'TOCK.in');
  },
  'sr-latch': (b) => {
    b.wire(nandLatch(b, b.not('S.out'), b.not('R.out')), 'Q.in');
  },
  'd-latch': (b) => {
    b.wire(dLatch(b, 'D.out', 'E.out'), 'Q.in');
  },
  'd-flip-flop': (b) => {
    const master = dLatch(b, 'D.out', b.not('CLK.out'));
    b.wire(dLatch(b, master, 'CLK.out'), 'Q.in');
  },
  'register-enable': (b) => {
    const ff = b.part('dff');
    b.wire('CLK.out', `${ff}.clk`).wire(b.mux(`${ff}.q`, 'D.out', 'LOAD.out'), `${ff}.d`).wire(`${ff}.q`, 'Q.in');
  },
  'register-8bit': (b) => {
    const joiner = b.part('joiner', { props: { width: 8, chunk: 1 } });
    const q = `${joiner}.out`;
    const next = b.split(b.mux(q, 'D.out', 'LOAD.out', 8), 8);
    next.forEach((d, i) => {
      const ff = b.part('dff');
      b.wire('CLK.out', `${ff}.clk`).wire(d, `${ff}.d`).wire(`${ff}.q`, `${joiner}.i${i}`);
    });
    b.wire(q, 'Q.in');
  },
  'counter-8bit': (b) => {
    const r = b.register(8, 'CLK.out', undefined, b.konst(1, 1));
    const q = `${r}.q`;
    const counted = b.mux(q, adderPlusOne(b, q), 'EN.out', 8);
    b.wire(b.mux(counted, 'D.out', 'LOAD.out', 8), `${r}.d`).wire(q, 'Q.in');
  },
  'register-file': (b) => {
    const sel = b.decoder('W.out', 2);
    const qs = sel.map((line) => `${b.register(8, 'CLK.out', 'D.out', b.and(line, 'WE.out'))}.q`) as [Pin, Pin, Pin, Pin];
    const [a0, a1] = b.split('RA.out', 2);
    const [b0, b1] = b.split('RB.out', 2);
    b.wire(b.mux4(qs, a0!, a1!, 8), 'A.in').wire(b.mux4(qs, b0!, b1!, 8), 'B.in');
  },
  'ram-16x8': (b) => {
    const sel = b.decoder('ADDR.out', 4);
    const qs = sel.map((line) => `${b.register(8, 'CLK.out', 'D.out', b.and(line, 'WE.out'))}.q`);
    b.wire(b.muxTree(qs, b.split('ADDR.out', 4), 8), 'Q.in');
  },
  'rom-lookup': (b) => {
    const words = [0x4e, 0x41, 0x4e, 0x44].map((v) => b.konst(v, 8)) as [Pin, Pin, Pin, Pin];
    const [s0, s1] = b.split('ADDR.out', 2);
    b.wire(b.mux4(words, s0!, s1!, 8), 'Q.in');
  },

  // ------------------------------------------------------------ Phase 4
  'program-counter': (b) => {
    const pc = b.part('counter', { props: { width: 8 } });
    b.wire('CLK.out', `${pc}.clk`)
      .wire(b.mux('TARGET.out', b.konst(0, 8), 'RESET.out', 8), `${pc}.d`)
      .wire(b.or('JUMP.out', 'RESET.out'), `${pc}.load`)
      .wire(b.konst(1, 1), `${pc}.en`)
      .wire(`${pc}.q`, 'PC.in');
  },
  fetch: (b) => {
    const phase = b.part('dff');
    const nPhase = b.not(`${phase}.q`);
    b.wire('CLK.out', `${phase}.clk`).wire(nPhase, `${phase}.d`).wire(`${phase}.q`, 'PHASE.in');
    const pc = b.part('counter', { props: { width: 8 } });
    b.wire('CLK.out', `${pc}.clk`).wire(b.konst(0, 8), `${pc}.d`).wire(b.konst(0, 1), `${pc}.load`).wire(b.konst(1, 1), `${pc}.en`);
    b.wire(`${pc}.q`, 'ROM.addr').wire(`${pc}.q`, 'PC.in');
    const ir = b.register(8, 'CLK.out', 'ROM.q', nPhase);
    b.wire(`${ir}.q`, 'IR.in');
  },
  'instruction-decoder': (b) => {
    const bits = b.split('IR.out', 8);
    b.wire(b.join([bits[0]!, bits[1]!]), 'RS.in');
    b.wire(b.join([bits[2]!, bits[3]!]), 'RD.in');
    const op = b.join([bits[4]!, bits[5]!, bits[6]!]);
    b.wire(op, 'OP.in').wire(bits[7]!, 'ALU.in');
    const nA = b.not(bits[7]!);
    const names = ['HALT', 'LDI', 'MOV', 'LD', 'ST', 'OUT', 'JMP', 'JCC'];
    b.decoder(op, 3).forEach((line, i) => b.wire(b.and(line, nA), `${names[i]}.in`));
  },
  'register-file-wiring': (b) => {
    const dp = toy8Datapath(b, { ir: 'IR.out', imm: 'IMM.out', exec: 'WE.out', clk: 'CLK.out', alu: false, mem: false });
    b.wire(dp.regA, 'A.in').wire(dp.regB, 'B.in');
  },
  'alu-execute': (b) => {
    const dp = toy8Datapath(b, { ir: 'IR.out', imm: 'IMM.out', exec: 'WE.out', clk: 'CLK.out', alu: true, mem: false });
    b.wire(dp.regA, 'A.in').wire(dp.regB, 'B.in').wire(dp.z!, 'Z.in').wire(dp.n!, 'N.in').wire(dp.c!, 'C.in');
  },
  'load-store': (b) => {
    const dp = toy8Datapath(b, { ir: 'IR.out', imm: 'IMM.out', exec: 'WE.out', clk: 'CLK.out', alu: true, mem: true });
    b.wire(dp.regA, 'A.in').wire(dp.regB, 'B.in').wire(dp.z!, 'Z.in').wire(dp.n!, 'N.in').wire(dp.c!, 'C.in');
  },
  jump: (b) => void toy8Cpu(b, { clk: 'CLK.out', rom: 'ROM', out: 'OUT.in' }),
  'conditional-branch': (b) => void toy8Cpu(b, { clk: 'CLK.out', rom: 'ROM', out: 'OUT.in' }),
  halt: (b) => void toy8Cpu(b, { clk: 'CLK.out', rom: 'ROM', out: 'OUT.in', halt: 'HALT.in' }),
  'first-program': (b) => void toy8Cpu(b, { clk: 'CLK.out', rom: 'ROM', out: 'OUT.in', halt: 'HALT.in' }),
};

/** Level ids with a reference solution. */
export const PHASE3_4_SOLUTION_IDS = Object.keys(SOLVERS);

/** The reference solution board for a Phase 3–4 level, or undefined. */
export function phase3_4Solution(level: Level): Board | undefined {
  const solve = SOLVERS[level.id];
  if (!solve) return undefined;
  const b = new BoardBuilder(level.starter);
  solve(b);
  return b.build();
}
