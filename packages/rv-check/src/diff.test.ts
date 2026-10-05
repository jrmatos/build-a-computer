import { describe, expect, it } from 'vitest';
import { Level, TestSpec } from '@build-a-computer/schema';
import { type RiscvTest, judgeRiscv, runRiscvTest, type RiscvCaseResult } from './check';
import { buildProgram } from './build';
import { applyInput, checkProblem, clipCheck, lineHits, riscvChecks, riscvDebugSetup, type RvCheck, type RvReadout } from './diff';
import { createMachine, runMachine } from './machine';

const level = (tests: Record<string, unknown>[] = [], code: Record<string, unknown> = {}): Level =>
  Level.parse({
    id: 't',
    version: 1,
    track: 'sandbox',
    phase: 6,
    order: 0,
    title: 'T',
    goal: 'g',
    palette: [],
    starter: { parts: [], wires: [] },
    mode: 'code',
    code: { language: 'rv32-asm', devices: ['uart'], ...code },
    tests: tests.map((t) => ({ kind: 'riscv', ...t })),
  });

const spec = (t: Record<string, unknown>): RiscvTest => TestSpec.parse({ kind: 'riscv', ...t }) as RiscvTest;

const readout = (o: Partial<RvReadout> & { regs?: Record<string, number> }): RvReadout => ({
  reg: (n) => o.regs?.[n] ?? 0,
  readBytes: o.readBytes ?? (() => new Uint8Array(4)),
  uart: o.uart ?? '',
  exitCode: o.exitCode ?? null,
  framebufferSha256: () => '0'.repeat(64),
});

describe('riscvChecks', () => {
  it('lists registers, exit, memory and uart with actual values', () => {
    const checks = riscvChecks(
      { regs: { a0: 55, a1: -1 }, exitCode: 0, memory: [{ addr: 0x80001000, hex: '01 02 03 04' }], uart: 'hello' },
      readout({ regs: { a0: 45, a1: 0xffffffff }, readBytes: () => new Uint8Array([1, 2, 9, 4]), uart: 'help', exitCode: 0 }),
    );
    expect(checks).toEqual([
      { kind: 'reg', name: 'a0', expected: 55, actual: 45, ok: false },
      { kind: 'reg', name: 'a1', expected: 0xffffffff, actual: 0xffffffff, ok: true },
      { kind: 'exit', expected: 0, actual: 0, ok: true },
      { kind: 'memory', addr: 0x80001000, expected: '01 02 03 04', actual: '01 02 09 04', firstBad: 2, ok: false },
      { kind: 'uart', expected: 'hello', actual: 'help', firstDiff: 3, ok: false },
    ]);
    expect(checkProblem(checks[0]!, { isC: false })).toBe('a0 should be 55 but is 45.');
    expect(checkProblem(checks[1]!, { isC: false })).toBeNull();
    expect(checkProblem(checks[3]!, { isC: false })).toBe('Memory at 0x80001000 should be 01 02 03 04 but is 01 02 09 04.');
    expect(checkProblem(checks[4]!, { isC: false })).toBe('UART output is wrong: expected "hello", got "help".');
  });

  it('reports memory that is not memory and a missing exit', () => {
    const [exit, mem] = riscvChecks({ memory: [{ addr: 0x10, hex: 'ff' }], exitCode: 3 }, readout({ readBytes: () => null }));
    expect(mem).toMatchObject({ actual: null, firstBad: 0, ok: false });
    expect(checkProblem(exit!, { isC: true, stopped: 'ebreak' })).toBe('The program should exit with code 3 (return it from main), but it stopped at ebreak.');
  });

  it('clips long UART text around the first difference', () => {
    const want = 'a'.repeat(1000) + 'X' + 'b'.repeat(1000);
    const got = 'a'.repeat(1000) + 'Y';
    const c = clipCheck({ kind: 'uart', expected: want, actual: got, firstDiff: 1000, ok: false }) as Extract<RvCheck, { kind: 'uart' }>;
    expect(c.offset).toBe(900);
    expect(c.expected[c.firstDiff - c.offset!]).toBe('X');
    expect(c.actual[c.firstDiff - c.offset!]).toBe('Y');
    expect(c.expected.length).toBeLessThanOrEqual(400);
  });
});

const BUGGY_SUM = `
  li a0, 0
  li t0, 1
  li t1, 10
loop:
  add a0, a0, t0
  addi t0, t0, 1
  bne t0, t1, loop
  ebreak
`;

describe('runRiscvTest checks', () => {
  it('attaches every check to the case result', () => {
    const r = [...runRiscvTest(BUGGY_SUM, spec({ expect: { regs: { a0: 55, t0: 10 } } }), level())][0] as RiscvCaseResult;
    expect(r.message).toBe('a0 should be 55 but is 45.');
    expect(r.checks).toEqual([
      { kind: 'reg', name: 'a0', expected: 55, actual: 45, ok: false },
      { kind: 'reg', name: 't0', expected: 10, actual: 10, ok: true },
    ]);
  });
});

describe('riscvDebugSetup + judgeRiscv', () => {
  const lvl = level([
    { expect: { regs: { a0: 1 } } },
    { name: 'echo', setup: { regs: { a1: 7 } }, input: 'hi', expect: { regs: { a0: 7 }, uart: 'hi' } },
  ]);

  it('returns the setup and input of any test', () => {
    expect(riscvDebugSetup(lvl, 0)).toMatchObject({ index: 0, name: 'Test 1', setup: {}, maxSteps: 5_000_000 });
    expect(riscvDebugSetup(lvl, 1)).toMatchObject({ index: 1, name: 'echo', setup: { regs: { a1: 7 } }, input: 'hi' });
    expect(riscvDebugSetup(lvl, 5)).toBeUndefined();
  });

  it('judges a machine the debugger ran the same way the checker does', () => {
    // Echo two UART bytes and copy a1 to a0.
    const src = `
      li t0, 0x10000000
      li t2, 2
    1: lbu t1, 5(t0)
      andi t1, t1, 1
      beqz t1, 1b
      lbu t1, 0(t0)
      sb t1, 0(t0)
      addi t2, t2, -1
      bnez t2, 1b
      mv a0, a1
      ebreak`;
    const d = riscvDebugSetup(lvl, 1)!;
    const program = buildProgram(src, lvl);
    expect(program.ok).toBe(true);
    const m = createMachine(program, lvl, d.setup);
    applyInput(m, d.input);
    const r = runMachine(m, 10_000);
    const verdict = judgeRiscv(program, m, d.test, { ...(r.stop ? { stop: r.stop } : {}) });
    const checker = [...runRiscvTest(src, d.test, lvl)][0]!;
    expect(verdict.pass).toBe(checker.pass);
    expect(verdict.message).toBe(checker.message);
    expect(verdict.checks).toEqual((checker as RiscvCaseResult).checks);
  });

  it('says when the program has not stopped yet', () => {
    const program = buildProgram(BUGGY_SUM, lvl);
    const m = createMachine(program, lvl);
    runMachine(m, 3);
    expect(judgeRiscv(program, m, spec({ expect: { regs: { a0: 1 } } }), {}).message).toMatch(/has not stopped yet \(at line \d+\)/);
  });
});

describe('lineHits', () => {
  it('counts how often each line of the player file ran', () => {
    const lvl = level();
    const program = buildProgram(BUGGY_SUM, lvl);
    const hits = lineHits(program, lvl, {}, undefined, 1000)!;
    const at = (line: number) => hits.find((h) => h.line === line)?.count;
    expect(at(2)).toBe(1); // li a0, 0
    expect(at(6)).toBe(9); // add a0, a0, t0: the loop ran 9 times
    expect(at(9)).toBe(1); // ebreak
  });
  it('stops after the given steps', () => {
    const lvl = level();
    const hits = lineHits(buildProgram('loop: j loop', lvl), lvl, {}, undefined, 50)!;
    expect(hits).toEqual([{ line: 1, count: 50 }]);
  });
});
