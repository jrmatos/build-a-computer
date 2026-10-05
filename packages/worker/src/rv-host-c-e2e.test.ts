/**
 * The debugger on a C level with the REAL compiler and libc: the current
 * line, breakpoints, step-line and trap messages are main.c lines. Skipped
 * only while @build-a-computer/cc is still the placeholder.
 */
import { describe, expect, it } from 'vitest';
import { buildProgram } from '@build-a-computer/rv-check';
import { Level } from '@build-a-computer/schema';
import { SimHost } from './host';
import type { RvSnapshot } from './protocol';

const level = (code: Record<string, unknown> = {}): Level =>
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
  });

const ccIsStub = buildProgram('int main(void) { return 0; }\n', level()).diagnostics.some((d) =>
  /not implemented/i.test(d.message),
);

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

const SRC = `int add1(int x) {
  return x + 1;
}

int main(void) {
  int a = 5;
  int b = add1(a);
  int *p = (int *)16;
  if (b == 7) *p = 1;
  return b;
}
`;

describe.skipIf(ccIsStub)('RvHost on a C level (real compiler)', () => {
  it('loads with function symbols and runs to the exit code from main', async () => {
    const { host, pump, last } = makeHost();
    const r = await host.rvLoad(SRC, level());
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.symbols.map((s) => s.name)).toEqual(
      expect.arrayContaining(['main', 'add1', '_start']),
    );
    host.rvRun();
    pump();
    expect(last().state).toMatchObject({ reason: 'exit', exitCode: 6 });
  });

  it('a breakpoint on a C line stops there; a blank line breaks at the next line with code', async () => {
    const { host, pump, last } = makeHost();
    await host.rvLoad(SRC, level());
    host.rvSetBreakpoints([2]);
    host.rvRun();
    pump();
    expect(last().state).toMatchObject({ reason: 'breakpoint', file: 'main.c', line: 2 });
    expect(last().state.regs[10]).toBe(5); // a0 = x
    host.rvSetBreakpoints([4]);
    host.rvReset();
    host.rvRun();
    pump();
    expect(last().state).toMatchObject({ reason: 'breakpoint', file: 'main.c' });
    expect(last().state.line).toBeGreaterThanOrEqual(5);
    expect(last().state.line).toBeLessThanOrEqual(6);
  });

  it('rvStepLine walks main.c lines, into calls and back', async () => {
    const { host, last } = makeHost();
    await host.rvLoad(SRC, level());
    host.rvSetBreakpoints([]);
    const seen: number[] = [];
    for (let i = 0; i < 12 && last().state.reason !== 'exit'; i++) {
      host.rvStepLine();
      const s = last().state;
      if (s.reason === 'exit') break;
      expect(s.file).toBe('main.c');
      if (seen.at(-1) !== s.line) seen.push(s.line!);
    }
    // Lines in order of execution (some may be skipped when they hold no code of their own).
    expect(seen).toContain(6);
    expect(seen).toContain(7);
    expect(seen).toContain(2);
    expect(seen.indexOf(2)).toBeGreaterThan(seen.indexOf(7));
    expect(seen.lastIndexOf(10)).toBeGreaterThan(seen.indexOf(2));
  });

  it('a trap stops at the C line with a message naming it', async () => {
    const { host, pump, last } = makeHost();
    await host.rvLoad(SRC.replace('return x + 1;', 'return x + 2;'), level());
    host.rvRun();
    pump();
    const s = last().state;
    expect(s).toMatchObject({ reason: 'trap', file: 'main.c', line: 9 });
    expect(s.trap!.message).toMatch(/^Store access fault at line 9/);
  });

  it('C compile errors come back as main.c diagnostics', async () => {
    const { host } = makeHost();
    const r = await host.rvLoad('int main(void) {\n  return undefined_name;\n}\n', level());
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({ file: 'main.c', line: 2, severity: 'error' });
  });
});
