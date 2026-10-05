import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Level, type Board, type SequenceStep, type TestSpec } from '@build-a-computer/schema';
import * as sim from '@build-a-computer/sim-logic';
import { compile, loadProgram, runTest } from '@build-a-computer/sim-logic';
import { Bus, Hart, MemoryDevice, RAM_BASE } from '@build-a-computer/rv32';
import { pendingReason } from '../../solutions/harness';
import { phase5Solution } from '../../solutions/phase5';
import { programsDataSource } from '../../solutions/phase5/gen-data';
import { Golden, assembleRv } from '../../solutions/phase5/golden';
import { rvCpuBoard } from '../../solutions/phase5/rv-cpu';
import { PHASE5_LEVELS } from './index';
import { PHASE4_LAST_ID } from './phase5';
import { ALL_PROGRAMS, DATAPATH_PROGRAMS, PIPELINE_PROGRAMS, RUN_PROGRAMS } from './programs';
import { RV_PROGRAM_DATA } from './programs.data';
import * as rv from './rv';

/** First failing case of `test` on `board`, or null when every case passes. */
function failure(level: Pick<Level, 'power'>, board: Board, test: TestSpec): string | null {
  const nl = compile(test.kind === 'program' ? loadProgram(board, test) : board);
  for (const r of runTest(nl, test, { powerOnState: level.power, seed: 7 })) {
    if (!r.pass) return `case ${r.index}: in ${JSON.stringify(r.inputs)} want ${JSON.stringify(r.expected)} got ${JSON.stringify(r.actual)} ${r.message ?? ''}`;
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

/** The 'program' checker packs bytes into 32-bit ROM words (wordBytes 4), little-endian. */
function wordBytesSupported(): boolean {
  const rom = { id: 'ROM', type: 'rom' as const, x: 0, y: 0, rot: 0 as const, flip: false, label: 'ROM', props: { addrWidth: 2, width: 32, data: '' } };
  const out = loadProgram({ parts: [rom], wires: [] }, { program: '01 02 03 04', rom: 'ROM', wordBytes: 4 });
  const data = String(out.parts[0]!.props?.data ?? '');
  return /^0*4030201\b/i.test(data.trim());
}

const RV_BLOCKS = ['regfile', 'immgen', 'rvalu', 'branchcmp', 'lsu'] as const;

/** Why Phase 5 solutions cannot be checked yet, or null. */
function pending(level: Level, board: Board): string | null {
  const parts = [...level.starter.parts, ...board.parts];
  for (const p of parts) if ((RV_BLOCKS as readonly string[]).includes(p.type) && !sim.BLOCKS[p.type]) return `no block model for '${p.type}'`;
  if (level.tests.some((t) => t.kind === 'program') && !wordBytesSupported()) return "program checker has no wordBytes: 4 packing";
  return pendingReason(level, board);
}

const ids = PHASE5_LEVELS.map((l) => l.id);

describe('Phase 5 levels', () => {
  it('are 9 valid draft levels in play order, the last one optional', () => {
    expect(PHASE5_LEVELS.map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(ids).size).toBe(9);
    for (const l of PHASE5_LEVELS) {
      expect(() => Level.parse(l), l.id).not.toThrow();
      expect(l.phase, l.id).toBe(5);
      expect(l.draft, l.id).toBe(true);
      expect(l.tests.length, l.id).toBeGreaterThan(0);
      expect(l.hints.length, l.id).toBeGreaterThanOrEqual(3);
      expect(l.hints.length, l.id).toBeLessThanOrEqual(5);
      expect(l.afterword.length, l.id).toBeGreaterThan(0);
      expect(l.optional, l.id).toBe(l.id === 'rv-pipeline');
    }
  });

  it(`form a chain starting after '${PHASE4_LAST_ID}'`, () => {
    expect(PHASE5_LEVELS[0]!.requires).toEqual([PHASE4_LAST_ID]);
    for (let i = 1; i < PHASE5_LEVELS.length; i++) expect(PHASE5_LEVELS[i]!.requires).toEqual([ids[i - 1]]);
  });

  it('palettes grow, and each block unlocks after the level that builds it', () => {
    const unlockedAfter: Record<string, string> = { regfile: 'rv-register-file', immgen: 'immediate-generator', branchcmp: 'branch-comparator', lsu: 'load-store-unit' };
    for (let i = 1; i < PHASE5_LEVELS.length; i++) for (const t of PHASE5_LEVELS[i - 1]!.palette) expect(PHASE5_LEVELS[i]!.palette, ids[i]).toContain(t);
    for (const [block, id] of Object.entries(unlockedAfter)) {
      const k = ids.indexOf(id);
      for (let i = 0; i <= k; i++) expect(PHASE5_LEVELS[i]!.palette, `${ids[i]} must not have ${block}`).not.toContain(block);
      for (let i = k + 1; i < ids.length; i++) expect(PHASE5_LEVELS[i]!.palette, `${ids[i]} needs ${block}`).toContain(block);
    }
    expect(PHASE5_LEVELS[ids.indexOf('alu-control')]!.palette).toContain('rvalu');
  });

  it('every program test is the assembled program with emulator-computed A0 and HALT', () => {
    const programs = new Map(ALL_PROGRAMS.map((p) => [p.name, p]));
    for (const l of PHASE5_LEVELS) {
      for (const t of l.tests) {
        if (t.kind !== 'program') continue;
        expect(t.wordBytes, l.id).toBe(4);
        const name = [...programs.keys()].find((n) => t.program.includes(RV_PROGRAM_DATA[n]!.hex))!;
        expect(name, l.id).toBeDefined();
        const g = new Golden(assembleRv(programs.get(name)!.source));
        g.run(t.maxCycles);
        expect(g.halted, `${l.id}/${name}`).toBe(true);
        expect(t.expect, `${l.id}/${name}`).toEqual({ A0: g.hart.reg(10), HALT: 1 });
      }
    }
    expect(PHASE5_LEVELS.find((l) => l.id === 'single-cycle-datapath')!.tests).toHaveLength(DATAPATH_PROGRAMS.length);
    expect(PHASE5_LEVELS.find((l) => l.id === 'running-programs')!.tests).toHaveLength(RUN_PROGRAMS.length);
    expect(PHASE5_LEVELS.find((l) => l.id === 'rv-pipeline')!.tests).toHaveLength(PIPELINE_PROGRAMS.length);
  });

  it('programs.data.ts is up to date with programs.ts (packages/asm + packages/rv32)', () => {
    const file = new URL('./programs.data.ts', import.meta.url);
    const fresh = programsDataSource();
    if (process.env.UPDATE_RV_PROGRAMS) writeFileSync(file, fresh);
    expect(readFileSync(file, 'utf8')).toBe(fresh);
  });
});

describe('Phase 5 semantics (rv.ts) match the golden emulator and the block models', () => {
  const rnd = rv.prng(99);
  const words = (n: number): number[] => [...rv.EDGE_WORDS, ...Array.from({ length: n }, () => rnd())];

  /** Execute one instruction on the rv32 hart with x1 = a, x2 = b; returns [rd value, next pc]. */
  function execOne(inst: number, a: number, b: number, pc = 0x100): [number, number] {
    const bus = new Bus();
    const code = new MemoryDevice('boot-rom', 0x1000, false);
    bus.register(0, 0x1000, code);
    const ram = new MemoryDevice('ram', 4096);
    bus.register(RAM_BASE, 4096, ram);
    new DataView(code.bytes.buffer).setUint32(pc, inst >>> 0, true);
    const h = new Hart({ bus, ram: ram.bytes, resetVector: pc });
    h.x[1] = a | 0;
    h.x[2] = b | 0;
    h.step();
    return [h.reg((inst >>> 7) & 31), h.pc];
  }

  it('immOf matches the immgen block and rv32 decode on every format', () => {
    const level = PHASE5_LEVELS.find((l) => l.id === 'immediate-generator')!;
    const t = level.tests[0]!;
    expect(t.kind).toBe('truth-table');
    if (t.kind !== 'truth-table') return;
    for (const r of t.rows) expect(r.expect.IMM, (r.inputs.INST! >>> 0).toString(16)).toBe(sim.immOf(r.inputs.INST!));
    for (const w of words(2000)) expect(rv.immOf(w)).toBe(sim.immOf(w));
  });

  it('aluResult matches rv32 for every OP and OP-IMM row of the ALU-control level', () => {
    const t = PHASE5_LEVELS.find((l) => l.id === 'alu-control')!.tests[0]!;
    if (t.kind !== 'truth-table') throw new Error('kind');
    for (const r of t.rows) {
      // Re-target rs1 = x1, rs2 = x2, rd = x3 so the hart sees A and B.
      const w = ((r.inputs.INST! & ~((31 << 15) | (31 << 20) | (31 << 7))) | (1 << 15) | (3 << 7) | ((r.inputs.INST! & 0x7f) === 0x33 ? 2 << 20 : r.inputs.INST! & (31 << 20))) >>> 0;
      expect(rv.aluResult(w, r.inputs.A!, r.inputs.B!), w.toString(16)).toBe(execOne(w, r.inputs.A!, r.inputs.B!)[0]);
      expect(rv.aluResult(w, r.inputs.A!, r.inputs.B!)).toBe(r.expect.Y);
    }
    for (const a of words(40)) for (const b of words(10)) for (const op of [0, 8, 1, 2, 3, 4, 5, 13, 6, 7]) expect(rv.rvAlu(a, b, op)).toBe(sim.rvAluOp(a, b, op));
  });

  it('branchTaken matches the branchcmp block and rv32 branches', () => {
    for (const a of words(30)) {
      for (const b of [...words(10), a]) {
        for (let f3 = 0; f3 < 8; f3++) expect(rv.branchTaken(a, b, f3)).toBe(sim.branchTaken(a, b, f3));
        for (const f3 of [0, 1, 4, 5, 6, 7]) {
          const [, next] = execOne(rv.encB(64, 2, 1, f3), a, b);
          expect(next === 0x140, `f3 ${f3}`).toBe(rv.branchTaken(a, b, f3));
        }
      }
    }
  });

  it('nextPc matches rv32 for jal, jalr and branches', () => {
    // Targets stay 4-byte aligned (a misaligned target traps on rv32, E-CPU-07); jalr clears bit 0.
    for (const w of [rv.encJ(-0x100, 1), rv.encJ(0x7fc, 0), rv.encI(-5, 1, 0, 5, rv.OPC.JALR), rv.encI(7, 1, 0, 0, rv.OPC.JALR), rv.encI(-4, 1, 0, 1, rv.OPC.JALR)]) {
      expect(rv.nextPc(0x100, w, 0x205, false), w.toString(16)).toBe(execOne(w, 0x205, 0)[1]);
    }
    expect(rv.nextPc(0x100, rv.EBREAK, 0, true)).toBe(0x100);
  });

  it('the load/store functions match the lsu block', () => {
    for (const rdata of words(20)) {
      for (const wdata of words(5)) {
        for (let off = 0; off < 4; off++) {
          for (let f3 = 0; f3 < 8; f3++) {
            const addr = 0x404 + off;
            expect(rv.lsuLoad(addr, rdata, f3)).toBe(sim.lsuLoad(addr, rdata, f3));
            expect(rv.lsuStore(addr, wdata, rdata, f3)).toBe(sim.lsuStore(addr, wdata, rdata, f3));
            expect(rv.lsuMisaligned(addr, f3, true)).toBe(sim.lsuMisaligned(addr, f3, true));
            expect(rv.lsuMisaligned(addr, f3, false)).toBe(sim.lsuMisaligned(addr, f3, false));
          }
        }
      }
    }
  });
});

describe('Phase 5 reference solutions', () => {
  for (const level of PHASE5_LEVELS) {
    const solution = phase5Solution(level)!;

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

    const reason = pending(level, solution);
    it.skipIf(reason !== null)(`E-RES-06: ${level.id}: the starter board fails every test${reason ? ` (pending: ${reason})` : ''}`, () => {
      for (const t of level.tests) expect(failure(level, level.starter, t), `${level.id} ${t.kind}`).not.toBeNull();
    });
    it.skipIf(reason !== null)(`${level.id}: the reference solution passes every test${reason ? ` (pending: ${reason})` : ''}`, () => {
      expect(firstFailure(level, solution)).toBeNull();
    }, 120_000);
  }
});

describe('RV32I CPU boards (built from blocks) against the rv32 emulator', () => {
  const probe = PHASE5_LEVELS.find((l) => l.id === 'running-programs')!;
  const single = rvCpuBoard();
  const pipe = rvCpuBoard({ pipeline: true });
  const reason = pending(probe, single);

  const counts = (board: Board): Record<string, number> => {
    const c: Record<string, number> = { total: board.parts.length };
    for (const p of board.parts) c[p.type] = (c[p.type] ?? 0) + 1;
    return c;
  };

  it('have modest part counts', () => {
    const s = counts(single);
    expect([s.regfile, s.immgen, s.rvalu, s.branchcmp, s.lsu, s.ram, s.rom]).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(s.register).toBe(2); // PC and the A0 shadow
    expect(s.total).toBeLessThan(120);
    const p = counts(pipe);
    expect(p.register).toBe(13); // PC, 11 stage registers, A0 shadow
    expect(p.total).toBeLessThan(400);
  });

  const programs = ALL_PROGRAMS;
  const debug = rvCpuBoard({ debug: true });
  for (const prog of programs) {
    it.skipIf(reason !== null)(`${prog.name}: the single-cycle CPU matches the emulator cycle by cycle (PC, x1..x31)${reason ? ` (pending: ${reason})` : ''}`, () => {
      const bytes = assembleRv(prog.source);
      const g = new Golden(bytes);
      const steps: SequenceStep[] = [];
      const snapshot = (): Record<string, number> => {
        const e: Record<string, number> = { PC: g.hart.pc };
        for (let k = 1; k < 32; k++) e[`X${k}`] = g.hart.reg(k);
        return e;
      };
      steps.push({ ticks: 0, expect: snapshot() });
      for (let n = 0; n < 1200 && !g.halted; n++) {
        g.run(1);
        steps.push({ ticks: 2, expect: snapshot() });
      }
      if (g.halted) steps.push({ ticks: 2, expect: snapshot() }); // frozen on ebreak
      const hex = RV_PROGRAM_DATA[prog.name]!.hex;
      const board = loadProgram(debug, { program: hex, wordBytes: 4, rom: 'ROM' });
      const seq: TestSpec = { kind: 'sequence', steps };
      expect(failure({ power: 'zero' }, board, seq), prog.name).toBeNull();
    }, 120_000);

    it.skipIf(reason !== null)(`${prog.name}: the pipelined CPU halts with the emulator's registers${reason ? ` (pending: ${reason})` : ''}`, () => {
      const d = RV_PROGRAM_DATA[prog.name]!;
      const g = new Golden(assembleRv(prog.source));
      g.run(1_000_000);
      const expect_: Record<string, number> = { HALT: 1, A0: g.hart.reg(10) };
      for (let k = 1; k < 32; k++) expect_[`X${k}`] = g.hart.reg(k);
      const test: TestSpec = { kind: 'program', program: d.hex, wordBytes: 4, rom: 'ROM', halt: 'HALT', maxCycles: 3 * d.steps + 16, expect: expect_ };
      expect(failure({ power: 'zero' }, rvCpuBoard({ pipeline: true, debug: true, halt: true }), test), prog.name).toBeNull();
    }, 120_000);
  }

  it.skipIf(reason !== null)(`a wrong answer or a too-small cycle budget fails${reason ? ` (pending: ${reason})` : ''}`, () => {
    const d = RV_PROGRAM_DATA['sum-loop']!;
    const ok: TestSpec = { kind: 'program', program: d.hex, wordBytes: 4, rom: 'ROM', halt: 'HALT', maxCycles: d.steps, expect: { A0: d.a0, HALT: 1 } };
    expect(failure({ power: 'zero' }, single, ok)).toBeNull();
    expect(failure({ power: 'zero' }, single, { ...ok, expect: { A0: d.a0 + 1, HALT: 1 } })).not.toBeNull();
    expect(failure({ power: 'zero' }, single, { ...ok, maxCycles: d.steps - 1 })).not.toBeNull();
  });
});
