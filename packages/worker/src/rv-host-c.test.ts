/**
 * The debugger on C levels with a FAKE compiler and libc (mocked by path, so
 * rv-check's imports get them too): C line mapping for the current line,
 * breakpoints, step-line and trap messages, plus C diagnostics and symbols.
 * The fake compiles `int name(...) {` to a global label (plus a prologue line
 * mapped to no C line) and `{{ a; b }}` to one assembly line per instruction
 * on that C line. Real-compiler tests live in rv-host-c-e2e.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { Level, TestSpec } from '@build-a-computer/schema';
import type { CaseResult } from '@build-a-computer/sim-logic';
import { SimHost } from './host';
import type { RvSnapshot } from './protocol';

vi.mock('../../cc/src/index.ts', () => ({
  compile(source: string, options: { file?: string } = {}) {
    const file = options.file ?? 'main.c';
    const asm: string[] = ['.text'];
    const lineMap: number[] = [0];
    const diagnostics: unknown[] = [];
    source.split('\n').forEach((text, i) => {
      const line = i + 1;
      const err = /#error (.*)/.exec(text);
      if (err)
        diagnostics.push({
          line,
          column: 2,
          endLine: line,
          endColumn: 7,
          message: err[1],
          severity: 'error',
          file,
        });
      const fn = /^int (\w+)\(.*\{/.exec(text);
      if (fn) {
        asm.push(`.globl ${fn[1]}`, `${fn[1]}:`, `.L${fn[1]}:`, '  addi sp, sp, 0');
        lineMap.push(line, line, 0, 0);
      }
      const body = /\{\{(.*)\}\}/.exec(text);
      if (body)
        for (const ins of body[1]!.split(';'))
          if (ins.trim()) {
            asm.push(`  ${ins.trim()}`);
            lineMap.push(line);
          }
    });
    const ok = diagnostics.length === 0;
    return { ok, asm: ok ? asm.join('\n') + '\n' : '', lineMap: ok ? lineMap : [], diagnostics };
  },
}));

vi.mock('../../libc/src/index.ts', () => ({
  LIBC_HEADERS: {},
  LIBC_SOURCES: [
    { name: 'crt0.s', text: '.globl _start\n_start:\n  call main\n  li a7, 93\n  ecall\n' },
  ],
}));

const level = (code: Record<string, unknown> = {}, tests: unknown[] = []): Level =>
  Level.parse({
    id: 'c',
    version: 1,
    track: 'sandbox',
    phase: 8,
    order: 0,
    title: 'C',
    goal: 'g',
    palette: [],
    starter: { parts: [], wires: [] },
    mode: 'code',
    code: { language: 'c', ...code },
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
    for (let n = 0; queue.length && n < 1000; n++) queue.shift()!();
  };
  return { host, pump, last: (): RvSnapshot => snaps.at(-1)! };
}

const SRC = [
  'int main() {',
  '  {{ addi sp, sp, -16; sw ra, 12(sp) }}',
  '',
  '  {{ li a0, 5 }}',
  '  {{ call add1 }}',
  '  {{ lw ra, 12(sp); addi sp, sp, 16; ret }}',
  '}',
  'int add1(int x) {',
  '  {{ addi a0, a0, 1 }}',
  '  {{ ret }}',
  '}',
  'int crash() {',
  '  {{ li t0, 2 }}',
  '  {{ sw t0, 0(zero) }}',
  '}',
  '',
].join('\n');

describe('RvHost on C levels', () => {
  it('rvLoad returns C diagnostics on main.c lines', async () => {
    const { host } = makeHost();
    const r = await host.rvLoad('int main() {\n#error expected expression\n}\n', level());
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toEqual([
      {
        file: 'main.c',
        line: 2,
        column: 2,
        endLine: 2,
        endColumn: 7,
        message: 'expected expression',
        severity: 'error',
      },
    ]);
    expect(r.symbols).toEqual([]);
  });

  it('rvLoad returns function symbols (no compiler-internal labels) and starts at crt0', async () => {
    const { host, last } = makeHost();
    const r = await host.rvLoad(SRC, level());
    expect(r.ok).toBe(true);
    const names = r.symbols.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['_start', 'main', 'add1', 'crash']));
    expect(names.some((n) => n.startsWith('.L'))).toBe(false);
    expect(r.entry).toBe(0x80000000);
    expect(last().state).toMatchObject({ pc: 0x80000000, file: 'crt0.s', line: 3 });
  });

  it('rvStepLine steps C lines of main.c, into calls, skipping lines without code', async () => {
    const { host, last } = makeHost();
    await host.rvLoad(SRC, level());
    host.rvStepLine(); // from crt0 into main's first line with a C line
    expect(last().state).toMatchObject({ reason: 'step', file: 'main.c', line: 2 });
    host.rvStepLine(); // two instructions on line 2, blank line 3
    expect(last().state).toMatchObject({ file: 'main.c', line: 4 });
    host.rvStepLine();
    expect(last().state.line).toBe(5);
    host.rvStepLine(); // into add1 (its prologue has no C line)
    expect(last().state).toMatchObject({ file: 'main.c', line: 9 });
    host.rvStepLine();
    expect(last().state.line).toBe(10);
    host.rvStepLine(); // back in main
    expect(last().state.line).toBe(6);
    expect(last().state.regs[10]).toBe(6);
  });

  it('breakpoints are C lines; a blank line breaks at the next line with code', async () => {
    const { host, pump, last } = makeHost();
    await host.rvLoad(SRC, level());
    host.rvSetBreakpoints([3, 9]);
    host.rvRun();
    pump();
    expect(last().state).toMatchObject({ reason: 'breakpoint', file: 'main.c', line: 4 });
    host.rvRun();
    pump();
    expect(last().state).toMatchObject({ reason: 'breakpoint', line: 9 });
    expect(last().state.regs[10]).toBe(5);
    host.rvRun();
    pump();
    expect(last().state).toMatchObject({ reason: 'exit', running: false });
    expect(last().state.exitCode).toBe(6);
  });

  it('a trap cites the C line', async () => {
    const { host, pump, last } = makeHost();
    await host.rvLoad(SRC.replace('call add1', 'call crash'), level());
    host.rvRun();
    pump();
    const s = last().state;
    expect(s).toMatchObject({ reason: 'trap', file: 'main.c', line: 14 });
    expect(s.trap!.message).toMatch(/^Store access fault at line 14 .*null pointer/);
  });

  it('applies the first test setup, disk included', async () => {
    const { host } = makeHost();
    const ok = await host.rvLoad(
      SRC,
      level({ devices: ['disk'] }, [
        { kind: 'riscv', setup: { disk: [{ sector: 1, hex: 'cafe' }] }, expect: {} },
      ]),
    );
    expect(ok.ok).toBe(true);
    const r = await host.rvLoad(
      SRC,
      level({ devices: ['uart'] }, [
        { kind: 'riscv', setup: { disk: [{ sector: 1, hex: 'cafe' }] }, expect: {} },
      ]),
    );
    expect(r.ok).toBe(false);
    expect(r.diagnostics.at(-1)).toMatchObject({
      file: 'main.c',
      message: expect.stringMatching(/no 'disk' device/),
    });
  });

  it('runTests runs C levels through the same build', async () => {
    const { host } = makeHost();
    const seen: CaseResult[] = [];
    const lvl = level({}, [
      { kind: 'riscv', expect: { exitCode: 6 } },
      { kind: 'riscv', expect: { exitCode: 7 } },
    ]);
    const res = await host.runTests(lvl, (r) => void seen.push(r), undefined, 10_000, SRC);
    expect(res).toEqual({ passed: 1, total: 2 });
    expect(seen[1]!.message).toMatch(/Exit code should be 7 but is 6/);
  });
});
