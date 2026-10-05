import { describe, expect, it } from 'vitest';
import { Level, type Board, type TestSpec } from '@build-a-computer/schema';
import { compile, loadProgram, runTest } from '@build-a-computer/sim-logic';
import { pendingReason } from '../../solutions/harness';
import { phase3_4Solution } from '../../solutions/phase3-4';
import { toy8CpuBoard } from '../../solutions/phase3-4/toy8-cpu';
import { Toy8, assemble, toHex } from '../toy8';
import { PHASE3_4_LEVELS } from './index';
import { PHASE2_LAST_ID } from './common';
import {
  COUNTDOWN_PARK_SOURCE,
  FIBONACCI_LOOP_SOURCE,
  HALT_STOPS_SOURCE,
  MEMORY_SUM_SOURCE,
  maxParkSource,
  multiplySource,
  signParkSource,
} from './programs';

/** First failing case of `test` on `board`, or null when every case passes. */
function failure(level: Pick<Level, 'power'>, board: Board, test: TestSpec): string | null {
  const nl = compile(test.kind === 'program' ? loadProgram(board, test) : board);
  for (const r of runTest(nl, test, { powerOnState: level.power, seed: 7 })) {
    if (!r.pass) {
      return `case ${r.index}: want ${JSON.stringify(r.expected)} got ${JSON.stringify(r.actual)} ${r.message ?? ''}`;
    }
  }
  return null;
}

const firstFailure = (level: Level, board: Board): string | null => {
  for (const [k, t] of level.tests.entries()) {
    const f = failure(level, board, t);
    if (f) return `test ${k} (${t.kind}) ${f}`;
  }
  return null;
};

const ids = PHASE3_4_LEVELS.map((l) => l.id);

describe('Phase 3-4 levels', () => {
  it('are 10 + 10 valid draft levels in play order', () => {
    expect(PHASE3_4_LEVELS.filter((l) => l.phase === 3).map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(PHASE3_4_LEVELS.filter((l) => l.phase === 4).map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(ids).size).toBe(20);
    for (const l of PHASE3_4_LEVELS) {
      expect(() => Level.parse(l), l.id).not.toThrow();
      expect(l.draft, l.id).toBe(true);
      expect(l.tests.length, l.id).toBeGreaterThan(0);
      expect(l.hints.length, l.id).toBeGreaterThan(0);
      expect(l.afterword.length, l.id).toBeGreaterThan(0);
    }
  });

  it(`form a chain starting after '${PHASE2_LAST_ID}'`, () => {
    expect(PHASE3_4_LEVELS[0]!.requires).toEqual([PHASE2_LAST_ID]);
    for (let i = 1; i < PHASE3_4_LEVELS.length; i++) expect(PHASE3_4_LEVELS[i]!.requires).toEqual([ids[i - 1]]);
  });

  it('every CPU program test is the assembled program with model-computed expectations', () => {
    for (const l of PHASE3_4_LEVELS) {
      for (const t of l.tests) {
        if (t.kind !== 'program') continue;
        const m = new Toy8(t.program);
        m.run(t.maxCycles);
        expect(t.expect.OUT, l.id).toBe(m.out);
        if (t.expect.HALT !== undefined) expect(m.halted, l.id).toBe(true);
        // A HALT lamp makes the checker require halting (TOY-03 semantics).
        const hasHalt = l.starter.parts.some((p) => p.label === 'HALT');
        expect(hasHalt ? m.halted : true, l.id).toBe(true);
      }
    }
  });
});

describe('Phase 3-4 reference solutions', () => {
  for (const level of PHASE3_4_LEVELS) {
    const solution = phase3_4Solution(level)!;

    it(`${level.id}: has a solution that keeps the starter and uses only palette parts`, () => {
      expect(solution, level.id).toBeDefined();
      for (const p of level.starter.parts) expect(solution.parts.find((q) => q.id === p.id), `${level.id}/${p.id}`).toEqual(p);
      const starterIds = new Set(level.starter.parts.map((p) => p.id));
      for (const p of solution.parts) if (!starterIds.has(p.id)) expect(level.palette, `${level.id} uses ${p.type}`).toContain(p.type);
      const partIds = new Set(solution.parts.map((p) => p.id));
      for (const w of solution.wires) {
        expect(partIds.has(w.from.part), w.id).toBe(true);
        expect(partIds.has(w.to.part), w.id).toBe(true);
      }
    });

    const reason = pendingReason(level, solution);
    it.skipIf(reason !== null)(`E-RES-06: ${level.id}: the starter board fails every test${reason ? ` (pending: ${reason})` : ''}`, () => {
      for (const t of level.tests) expect(failure(level, level.starter, t), `${level.id} ${t.kind}`).not.toBeNull();
    });
    it.skipIf(reason !== null)(`${level.id}: the reference solution passes every test${reason ? ` (pending: ${reason})` : ''}`, () => {
      expect(firstFailure(level, solution)).toBeNull();
    }, 60_000);
  }

  const latch = PHASE3_4_LEVELS.find((l) => l.id === 'sr-latch')!;
  it.skipIf(pendingReason(latch, phase3_4Solution(latch)!) !== null)('E-SIM-07: the SR latch level passes from random power-on state (several seeds)', () => {
    const board = phase3_4Solution(latch)!;
    for (const seed of [1, 2, 3, 4, 5]) {
      const nl = compile(board);
      expect([...runTest(nl, latch.tests[0]!, { powerOnState: 'random', seed })].every((r) => r.pass), `seed ${seed}`).toBe(true);
    }
  });

  const rom = PHASE3_4_LEVELS.find((l) => l.id === 'rom-lookup')!;
  it.skipIf(pendingReason(rom, phase3_4Solution(rom)!) !== null)('E-SIM-08: the ROM level keeps its words across a power cycle', () => {
    const seq = rom.tests.find((t) => t.kind === 'sequence')!;
    expect(seq.kind === 'sequence' && seq.steps.some((s) => s.power === 'cycle')).toBe(true);
    expect(failure(rom, phase3_4Solution(rom)!, seq)).toBeNull();
  });
});

describe('Toy-8 CPU board (built from blocks) against the reference model', () => {
  const debugBoard = toy8CpuBoard({ debug: true });
  const probe = PHASE3_4_LEVELS.find((l) => l.id === 'first-program')!;
  const reason = pendingReason(probe, debugBoard);

  it('has a modest part count', () => {
    const counts: Record<string, number> = {};
    for (const p of toy8CpuBoard().parts) counts[p.type] = (counts[p.type] ?? 0) + 1;
    expect(counts.rom).toBe(1);
    expect(counts.ram).toBe(1);
    expect(counts.alu).toBe(1);
    expect(counts.counter).toBe(1);
    expect(counts.register).toBe(10); // IR, R0-R3, Z, N, C, OUT, halted
    expect(toy8CpuBoard().parts.length).toBeLessThan(100);
  });

  const programs: [string, string][] = [
    ['multiply 6 x 7', multiplySource(6, 7)],
    ['multiply 0 x 3', multiplySource(0, 3)],
    ['memory sum', MEMORY_SUM_SOURCE],
    ['fibonacci loop', FIBONACCI_LOOP_SOURCE],
    ['countdown', COUNTDOWN_PARK_SOURCE],
    ['max via JC', maxParkSource(4, 9)],
    ['sign via JN', signParkSource(3, 5)],
    ['halt stops', HALT_STOPS_SOURCE],
  ];
  for (const [name, src] of programs) {
    it.skipIf(reason !== null)(`${name}: matches the model cycle by cycle${reason ? ` (pending: ${reason})` : ''}`, () => {
      const bytes = assemble(src).bytes;
      const full = new Toy8(bytes);
      full.run(90);
      const last = Math.min(90, full.cycles + 3);
      for (let n = 0; n <= last; n++) {
        const m = new Toy8(bytes);
        m.run(n);
        const test: TestSpec = {
          kind: 'program',
          program: toHex(bytes),
          rom: 'ROM',
          halt: 'NO_HALT_LAMP', // run exactly n cycles
          maxCycles: Math.max(1, n),
          expect: {
            PC: m.pc,
            R0: m.r[0]!,
            R1: m.r[1]!,
            R2: m.r[2]!,
            R3: m.r[3]!,
            Z: m.z,
            N: m.n,
            C: m.c,
            OUT: m.out,
            HALTED: m.halted ? 1 : 0,
          },
        };
        if (n === 0) continue; // maxCycles >= 1: cycle 0 is the power-on state, checked implicitly by cycle 1
        expect(failure({ power: 'zero' }, debugBoard, test), `${name} after ${n} cycles`).toBeNull();
      }
    }, 120_000);
  }

  it.skipIf(reason !== null)(`runs multiply by repeated addition to HALT${reason ? ` (pending: ${reason})` : ''}`, () => {
    for (const [a, b] of [
      [6, 7],
      [13, 11],
      [0, 5],
      [255, 1],
    ] as const) {
      const bytes = assemble(multiplySource(a, b)).bytes;
      const test: TestSpec = { kind: 'program', program: toHex(bytes), rom: 'ROM', halt: 'HALT', maxCycles: 5000, expect: { OUT: (a * b) & 0xff, HALT: 1 } };
      expect(failure({ power: 'zero' }, toy8CpuBoard(), test), `${a} x ${b}`).toBeNull();
    }
    // Not vacuous: a wrong product and a too-small cycle budget both fail.
    const bytes = assemble(multiplySource(6, 7)).bytes;
    const wrong: TestSpec = { kind: 'program', program: toHex(bytes), rom: 'ROM', halt: 'HALT', maxCycles: 5000, expect: { OUT: 43, HALT: 1 } };
    expect(failure({ power: 'zero' }, toy8CpuBoard(), wrong)).not.toBeNull();
    const short: TestSpec = { ...wrong, maxCycles: new Toy8(bytes).run(5000) - 1, expect: { OUT: 42, HALT: 1 } };
    expect(failure({ power: 'zero' }, toy8CpuBoard(), short)).not.toBeNull();
  });
});
