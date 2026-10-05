/**
 * "Debug this test": rvLoad with a test index loads THAT test's setup, input
 * and disk, snapshots carry its expectations live, and the verdict when the
 * program ends matches the checker's.
 */
import { describe, expect, it } from 'vitest';
import { buildProgram } from '@build-a-computer/rv-check';
import { Level, TestSpec } from '@build-a-computer/schema';
import type { CaseResult } from '@build-a-computer/sim-logic';
import { SimHost } from './host';
import type { RiscvCaseResult, RvSnapshot } from './protocol';

const level = (code: Record<string, unknown>, tests: unknown[]): Level =>
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
    code: { language: 'rv32-asm', ...code },
    tests: tests.map((t) => TestSpec.parse(t)),
  });

function makeHost() {
  let clock = 0;
  const queue: (() => void)[] = [];
  const host = new SimHost(
    () => (clock += 1),
    (fn) => {
      queue.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
  );
  const snaps: RvSnapshot[] = [];
  host.rvSubscribe((s) => snaps.push(s));
  const pump = (): void => {
    for (let n = 0; queue.length && n < 10_000; n++) queue.shift()!();
  };
  return { host, pump, last: (): RvSnapshot => snaps.at(-1)! };
}

// Sums 1..a1-1 into a0 (a bug: the loop stops one early), echoes the UART input, exits with 0.
const SRC = `.globl _start
_start:
  li a0, 0
  li t0, 1
loop:
  add a0, a0, t0
  addi t0, t0, 1
  bne t0, a1, loop
  li t3, 0x10000000
echo:
  lbu t1, 5(t3)
  andi t1, t1, 1
  beqz t1, done
  lbu t1, 0(t3)
  sb t1, 0(t3)
  j echo
done:
  mv s1, a0
  li a0, 0
  mv a0, s1
  li a7, 93
  ecall
`;

const LVL = level({ devices: ['uart'] }, [
  { kind: 'riscv', setup: { regs: { a1: 3 } }, expect: { regs: { a0: 3 } } },
  { kind: 'riscv', name: 'sum to 10', setup: { regs: { a1: 10 } }, input: 'ok', expect: { regs: { a0: 55 }, uart: 'ok!', exitCode: 55 } },
]);

describe('RvHost: Debug this test', () => {
  it('loads the chosen test setup and input, not the first test', async () => {
    const { host, last } = makeHost();
    const res = await host.rvLoad(SRC, LVL, { test: 1 });
    expect(res.ok).toBe(true);
    expect(res.test).toEqual({ index: 1, name: 'sum to 10' });
    const s = last();
    expect(s.state.regs[11]).toBe(10);
    expect(s.test).toMatchObject({ index: 1, name: 'sum to 10', input: 'ok', setup: { regs: { a1: 10 } } });
    expect(s.test!.checks.map((c) => c.kind)).toEqual(['reg', 'exit', 'uart']);
    expect(s.test!.verdict).toBeUndefined();
  });

  it('updates checks while stepping and judges the end like the checker', async () => {
    const { host, pump, last } = makeHost();
    await host.rvLoad(SRC, LVL, { test: 1 });
    host.rvStep(5);
    const a0 = last().test!.checks[0]!;
    expect(a0).toMatchObject({ kind: 'reg', name: 'a0', expected: 55, ok: false });
    expect(a0.kind === 'reg' && a0.actual).toBe(1);
    host.rvRun();
    pump();
    const t = last().test!;
    expect(last().state.reason).toBe('exit');
    expect(t.checks[0]).toMatchObject({ actual: 45, ok: false });
    expect(t.checks[1]).toMatchObject({ kind: 'exit', actual: 45, ok: false });
    expect(t.checks[2]).toMatchObject({ kind: 'uart', actual: 'ok', firstDiff: 2, ok: false });
    expect(t.verdict?.pass).toBe(false);
    expect(t.verdict?.message).toMatch(/^a0 should be 55 but is 45\./);
    // The loop body (line 6) ran 9 times.
    expect(t.lineHits?.find((h) => h.line === 6)?.count).toBe(9);
    // Same verdict as the test run.
    const cases: CaseResult[] = [];
    await host.runTests(LVL, (c) => void cases.push(c), undefined, undefined, SRC);
    const checked = cases[1] as RiscvCaseResult;
    expect(t.verdict?.message).toBe(checked.message);
    expect(t.verdict?.checks).toEqual(checked.checks);
  });

  it('reset keeps the test (setup and input again)', async () => {
    const { host, pump, last } = makeHost();
    await host.rvLoad(SRC, LVL, { test: 1 });
    host.rvRun();
    pump();
    host.rvReset();
    expect(last().state.regs[11]).toBe(10);
    expect(last().test?.verdict).toBeUndefined();
    host.rvRun();
    pump();
    expect(last().uart).toBe('ok');
  });

  it('without a test it keeps the first test setup and sends no test view', async () => {
    const { host, last } = makeHost();
    await host.rvLoad(SRC, LVL);
    expect(last().state.regs[11]).toBe(3);
    expect(last().test).toBeUndefined();
  });

  it('pauses with a verdict at the test step limit', async () => {
    const lvl = level({}, [{ kind: 'riscv', maxSteps: 50, expect: { regs: { a0: 1 } } }]);
    const { host, pump, last } = makeHost();
    await host.rvLoad('loop: j loop', lvl, { test: 0 });
    host.rvRun();
    pump();
    expect(last().state.reason).toBe('budget');
    expect(last().state.instret).toBe(50);
    expect(last().test?.verdict?.message).toMatch(/never stopped: it ran 50 steps/);
  });

  it('judges ebreak as the end of the test', async () => {
    const lvl = level({}, [{ kind: 'riscv', expect: { regs: { a0: 2 } } }]);
    const { host, pump, last } = makeHost();
    await host.rvLoad('li a0, 2\nebreak\nli a0, 3\nebreak', lvl, { test: 0 });
    host.rvRun();
    pump();
    expect(last().state.reason).toBe('ebreak');
    expect(last().test?.verdict?.pass).toBe(true);
    host.rvRun();
    pump();
    expect(last().test?.verdict?.message).toBe('a0 should be 2 but is 3.');
  });

  it('loads the test disk', async () => {
    const lvl = level({ devices: ['disk'] }, [
      { kind: 'riscv', expect: {} },
      { kind: 'riscv', setup: { disk: [{ sector: 0, hex: 'aa bb' }] }, expect: {} },
    ]);
    const { host } = makeHost();
    expect((await host.rvLoad('ebreak', lvl, { test: 1 })).ok).toBe(true);
  });
});

const ccIsStub = buildProgram('int main(void) { return 0; }\n', level({ language: 'c' }, [])).diagnostics.some((d) => /not implemented/i.test(d.message));

describe.skipIf(ccIsStub)('RvHost: Debug this test on C', () => {
  it('stops at main', async () => {
    const lvl = level({ language: 'c' }, [{ kind: 'riscv', expect: { exitCode: 3 } }]);
    const src = 'int g;\n\nint main(void) {\n  g = 3;\n  return g;\n}\n';
    const { host, pump, last } = makeHost();
    const res = await host.rvLoad(src, lvl, { test: 0, stopAtMain: true });
    expect(res.ok).toBe(true);
    const main = res.symbols.find((s) => s.name === 'main')!;
    expect(last().state.pc).toBe(main.addr);
    expect(last().state.reason).toBe('step');
    host.rvRun();
    pump();
    expect(last().test?.verdict?.pass).toBe(true);
  });
});
