/**
 * C levels end to end with the REAL compiler (@build-a-computer/cc) and libc.
 * Skipped only while cc is still the placeholder that rejects everything.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '@build-a-computer/cc';
import { Level, TestSpec } from '@build-a-computer/schema';
import type { CaseResult } from '@build-a-computer/sim-logic';
import { buildProgram } from './build';
import { type RiscvTest, runRiscvTest } from './check';
import { createMachine, runMachine } from './machine';

const ccIsStub = compile('int main(void) { return 0; }\n').diagnostics.some((d) =>
  /not implemented/i.test(d.message),
);

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

const spec = (t: Record<string, unknown>): RiscvTest =>
  TestSpec.parse({ kind: 'riscv', ...t }) as RiscvTest;
const run = (src: string, t: Record<string, unknown>, lvl = level()): CaseResult =>
  [...runRiscvTest(src, spec(t), lvl)][0]!;

/** Line number (1-based) of the first line of `src` containing `needle`. */
const lineOf = (src: string, needle: string): number =>
  src.split('\n').findIndex((l) => l.includes(needle)) + 1;

describe.skipIf(ccIsStub)('C levels with the real compiler and libc', () => {
  it('main returns the exit code', () => {
    const src =
      'int main(void) {\n  int s = 0;\n  for (int i = 1; i <= 10; i++) s += i;\n  return s;\n}\n';
    const r = run(src, { expect: { exitCode: 55 } });
    expect(r.message).toBeUndefined();
    expect(r.pass).toBe(true);
  });

  it('printf and getchar go through the UART', () => {
    const src = `#include <stdio.h>
int main(void) {
  int c;
  int n = 0;
  while ((c = getchar()) != '\\n' && c != -1) n++;
  printf("read %d chars, %s %x\\n", n, "ok", 255);
  return 0;
}
`;
    const r = run(src, {
      input: 'hello\n',
      expect: { uart: 'read 5 chars, ok ff\n', exitCode: 0 },
    });
    expect(r.message).toBeUndefined();
    expect(r.pass).toBe(true);
  });

  it('malloc, strings and globals work', () => {
    const src = `#include <stdlib.h>
#include <string.h>
int counter = 3;
static char buf[16];
int main(void) {
  char *p = malloc(32);
  strcpy(p, "abc");
  strcpy(buf, p);
  counter += strlen(buf);
  free(p);
  return counter;
}
`;
    expect(run(src, { expect: { exitCode: 6 } }).pass).toBe(true);
  });

  it('a compile error is reported on its main.c line', () => {
    const src = 'int main(void) {\n  int x = 1\n  return x;\n}\n';
    const p = buildProgram(src, level());
    expect(p.ok).toBe(false);
    const d = p.diagnostics.find((x) => x.severity === 'error')!;
    expect(d.file).toBe('main.c');
    expect([2, 3]).toContain(d.line);
    expect(run(src, { expect: { exitCode: 0 } }).message).toMatch(/^The program does not compile/);
  });

  it('a call to a declared but undefined function is a link error at its C line', () => {
    const src = 'int missing(int);\nint main(void) {\n  return missing(1);\n}\n';
    const p = buildProgram(src, level());
    expect(p.ok).toBe(false);
    expect(p.diagnostics[0]).toMatchObject({
      file: 'main.c',
      line: 3,
      message: expect.stringMatching(/'missing' is used but never defined/),
    });
  });

  it('a trap names the C line', () => {
    const src = 'int main(void) {\n  volatile int *p = (int *)16;\n  *p = 1;\n  return 0;\n}\n';
    const r = run(src, { expect: { exitCode: 0 } });
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/^Store access fault at line 3/);
  });

  it('locate maps every main.c instruction to a line inside the source', () => {
    const src =
      'int add(int a, int b) {\n  return a + b;\n}\n\nint main(void) {\n  int x = add(2, 3);\n  return x * 2;\n}\n';
    const p = buildProgram(src, level());
    expect(p.ok).toBe(true);
    const main = p.symbols.find((s) => s.name === 'main')!;
    const add = p.symbols.find((s) => s.name === 'add')!;
    expect(p.symbols.some((s) => s.name.startsWith('.L'))).toBe(false);
    const lines = new Set<number>();
    for (const e of p.link.sourceMap) {
      const loc = p.locate(e.address);
      if (loc?.file === 'main.c') lines.add(loc.line);
    }
    expect([...lines].every((l) => l >= 1 && l <= 8)).toBe(true);
    expect(lines.has(lineOf(src, 'return a + b'))).toBe(true);
    expect(lines.has(lineOf(src, 'int x = add'))).toBe(true);
    expect(p.functionAt(main.addr + 4)).toBe('main');
    expect(p.breakpointAddresses(lineOf(src, 'return a + b')).length).toBeGreaterThan(0);
    // Line 4 is blank: it breaks at the next line with code.
    const bp4 = p.breakpointAddresses(4);
    expect(bp4.length).toBeGreaterThan(0);
    expect([p.breakpointAddresses(5), p.breakpointAddresses(6)]).toContainEqual(bp4);
    expect(p.functionAt(add.addr)).toBe('add');
  });

  it('library .h and .c files are compiled and linked with main.c', () => {
    const lvl = level({
      library: [
        { name: 'sq.h', text: 'int sq(int x);\n' },
        { name: 'sq.c', text: '#include "sq.h"\nint sq(int x) {\n  return x * x;\n}\n' },
        { name: 'neg.s', text: '.globl neg\nneg:\n  sub a0, zero, a0\n  ret\n' },
      ],
    });
    const src = '#include "sq.h"\nint neg(int);\nint main(void) {\n  return neg(-sq(7));\n}\n';
    const r = run(src, { expect: { exitCode: 49 } }, lvl);
    expect(r.message).toBeUndefined();
    expect(r.pass).toBe(true);
  });

  it('libc: false links no libc: main is the entry and its return value is the exit code', () => {
    const lvl = level({ libc: false });
    const p = buildProgram('int main(void) {\n  return 9;\n}\n', lvl);
    expect(p.ok).toBe(true);
    expect(p.symbols.map((s) => s.name)).not.toContain('printf');
    expect(p.entry).toBe(p.symbols.find((s) => s.name === 'main')!.addr);
    const m = createMachine(p, lvl);
    const r = runMachine(m, 10_000);
    expect(r.stop).toMatchObject({ kind: 'exit', code: 9 });
    // libc headers are not on the include path without libc.
    expect(buildProgram('#include <stdio.h>\nint main(void) { return 0; }\n', lvl).ok).toBe(false);
  });
});
