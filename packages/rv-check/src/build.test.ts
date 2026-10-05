/**
 * The C build pipeline with a FAKE compiler and libc (vi.mock), so line
 * mapping, diagnostics, libc on/off and library files are tested
 * independently of @build-a-computer/cc. The fake "compiles":
 * - `int name(...) {`  -> `.globl name` / `name:` plus a prologue line mapped to C line 0;
 * - `{{ a; b }}`        -> one assembly line per instruction, mapped to that C line;
 * - `#include "x.h"`    -> error unless x.h is among the headers;
 * - `#error msg`        -> a compile error at that line;
 * - `.L` labels are emitted for every function (internal labels).
 * Real-compiler end-to-end tests are in c-e2e.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { Level, TestSpec } from '@build-a-computer/schema';
import type { CaseResult } from '@build-a-computer/sim-logic';
import { BLOCK_REG, RAM_BASE } from '@build-a-computer/rv32';
import { buildProgram } from './build';
import { type RiscvTest, runRiscvTest } from './check';
import { DISK_SIZE, SetupError, createMachine, runMachine, trapMessage, where } from './machine';

vi.mock('@build-a-computer/cc', () => ({
  compile(source: string, options: { file?: string; headers?: Record<string, string> } = {}) {
    const file = options.file ?? 'main.c';
    const asm: string[] = [];
    const lineMap: number[] = [];
    const diagnostics: {
      line: number;
      column: number;
      endLine: number;
      endColumn: number;
      message: string;
      severity: 'error';
      file: string;
    }[] = [];
    const emit = (text: string, line: number): void => {
      asm.push(text);
      lineMap.push(line);
    };
    emit('.text', 0);
    source.split('\n').forEach((text, i) => {
      const line = i + 1;
      const inc = /#include\s+["<]([^">]+)[">]/.exec(text);
      if (inc && !(options.headers ?? {})[inc[1]!])
        diagnostics.push({
          line,
          column: 1,
          endLine: line,
          endColumn: text.length + 1,
          message: `cannot find ${inc[1]}`,
          severity: 'error',
          file,
        });
      const err = /#error (.*)/.exec(text);
      if (err)
        diagnostics.push({
          line,
          column: 1,
          endLine: line,
          endColumn: text.length + 1,
          message: err[1]!,
          severity: 'error',
          file,
        });
      const fn = /^int (\w+)\(.*\{/.exec(text);
      if (fn) {
        emit(`.globl ${fn[1]}`, line);
        emit(`${fn[1]}:`, line);
        emit(`.L${fn[1]}_entry:`, 0);
        emit('  addi sp, sp, 0', 0);
      }
      const body = /\{\{(.*)\}\}/.exec(text);
      if (body)
        for (const ins of body[1]!.split(';')) if (ins.trim()) emit(`  ${ins.trim()}`, line);
    });
    const ok = diagnostics.length === 0;
    return { ok, asm: ok ? asm.join('\n') + '\n' : '', lineMap: ok ? lineMap : [], diagnostics };
  },
}));

vi.mock('@build-a-computer/libc', () => ({
  LIBC_HEADERS: { 'twice.h': 'int twice(int);' },
  LIBC_SOURCES: [
    { name: 'crt0.s', text: '.globl _start\n_start:\n  call main\n  li a7, 93\n  ecall\n' },
    { name: 'twice.c', text: 'int twice(int x) {\n{{ add a0, a0, a0; ret }}\n}\n' },
  ],
}));

const level = (code: Record<string, unknown> = {}): Level =>
  Level.parse({
    id: 't',
    version: 1,
    track: 'sandbox',
    phase: 8,
    order: 0,
    title: 'T',
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

// main returns twice(21) = 42 through libc's crt0.
const MAIN = `#include "twice.h"
int main() {
  {{ addi sp, sp, -16; sw ra, 12(sp) }}
  {{ li a0, 21 }}
  {{ call twice }}
  {{ lw ra, 12(sp); addi sp, sp, 16 }}
  {{ ret }}
}
`;

describe('buildProgram for C levels (fake compiler)', () => {
  it('links main.c with libc: crt0 is the entry and main returns the exit code', () => {
    const p = buildProgram(MAIN, level());
    expect(p.diagnostics).toEqual([]);
    expect(p.ok).toBe(true);
    expect(p.language).toBe('c');
    expect(p.mainFile).toBe('main.c');
    expect(p.entry).toBe(p.symbols.find((s) => s.name === '_start')!.addr);
    const r = run(MAIN, { expect: { exitCode: 42 } });
    expect(r.message).toBeUndefined();
    expect(r.pass).toBe(true);
  });

  it("crt0 (libc's first file) is linked first, at the RAM base", () => {
    expect(buildProgram(MAIN, level()).entry).toBe(RAM_BASE);
  });

  it("defining a name libc also defines points at the player's definition", () => {
    const src = 'int main() {\n{{ ret }}\n}\n\nint twice(int x) {\n{{ ret }}\n}\n';
    const p = buildProgram(src, level());
    expect(p.ok).toBe(false);
    expect(p.diagnostics).toEqual([
      expect.objectContaining({
        file: 'main.c',
        line: 5,
        message: "'twice' is already defined by libc (twice.c); pick another name.",
      }),
    ]);
  });

  it('symbols are function names; compiler-internal .L labels are hidden', () => {
    const names = buildProgram(MAIN, level()).symbols.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['main', 'twice', '_start']));
    expect(names.some((n) => n.startsWith('.L'))).toBe(false);
  });

  it('locate maps pc -> assembly line -> C line; unmapped code has no line', () => {
    const p = buildProgram(MAIN, level());
    const main = p.symbols.find((s) => s.name === 'main')!.addr;
    expect(p.locate(main)).toBeUndefined(); // the prologue, C line 0
    expect(p.locate(main + 4)).toEqual({ file: 'main.c', line: 3 });
    expect(p.locate(main + 8)).toEqual({ file: 'main.c', line: 3 });
    expect(p.locate(main + 12)).toEqual({ file: 'main.c', line: 4 });
    const twice = p.symbols.find((s) => s.name === 'twice')!.addr;
    expect(p.locate(twice + 4)).toEqual({ file: 'twice.c', line: 2 });
    expect(p.locate(p.entry)).toEqual({ file: 'crt0.s', line: 3 });
    expect(p.functionAt(main + 12)).toBe('main');
  });

  it('breakpointAddresses: one address per contiguous run, blank lines move to the next line with code', () => {
    const p = buildProgram(MAIN, level());
    const main = p.symbols.find((s) => s.name === 'main')!.addr;
    expect(p.breakpointAddresses(3)).toEqual([main + 4]);
    expect(p.breakpointAddresses(1)).toEqual([main + 4]);
    expect(p.breakpointAddresses(4)).toEqual([main + 12]);
    expect(p.breakpointAddresses(99)).toEqual([]);
    expect(p.breakpointAddresses(2, 'twice.c')).toEqual([
      p.symbols.find((s) => s.name === 'twice')!.addr + 4,
    ]);
  });

  it('a trap in C names the C line', () => {
    const src = 'int main() {\n{{ li a0, 0 }}\n{{ sw a1, 8(a0) }}\n{{ ret }}\n}\n';
    const r = run(src, { expect: { exitCode: 0 } });
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/^Store access fault at line 3 .*null pointer/);
  });

  it('a long loop in C suggests returning from main', () => {
    const src = 'int main() {\n{{ spin: j spin }}\n}\n';
    const r = run(src, { expect: { exitCode: 0 }, maxSteps: 1000 });
    expect(r.message).toMatch(/still going at line 2\. Return from main/);
  });

  it('compiler errors are reported on main.c lines and the case says it does not compile', () => {
    const src = 'int main() {\n#error expected ;\n}\n';
    const p = buildProgram(src, level());
    expect(p.ok).toBe(false);
    expect(p.diagnostics).toEqual([
      expect.objectContaining({ file: 'main.c', line: 2, message: 'expected ;' }),
    ]);
    const r = run(src, { expect: { exitCode: 0 } });
    expect(r.message).toMatch(
      /^The program does not compile \(1 error\):\nmain\.c:2:1: expected ;/,
    );
    expect(r.summary).toBe('Not run: compile errors.');
  });

  it('an assembler error in generated code is an internal compiler error at the C line', () => {
    const p = buildProgram('int main() {\n{{ bogus a0 }}\n}\n', level());
    expect(p.ok).toBe(false);
    expect(p.diagnostics[0]).toMatchObject({ file: 'main.c', line: 2, column: 1 });
    expect(p.diagnostics[0]!.message).toMatch(/^Internal compiler error \(not your fault\)/);
  });

  it('an assembler error on a C line with inline asm is the author’s', () => {
    const p = buildProgram('int main() {\nasm("bogus"); {{ bogus a0 }}\n}\n', level());
    expect(p.diagnostics[0]).toMatchObject({ file: 'main.c', line: 2 });
    expect(p.diagnostics[0]!.message).not.toMatch(/Internal/);
  });

  it('a call to an undefined function is reported at the C line', () => {
    const p = buildProgram('int main() {\n\n{{ call nowhere }}\n}\n', level());
    expect(p.ok).toBe(false);
    expect(p.diagnostics[0]).toMatchObject({ file: 'main.c', line: 3 });
    expect(p.diagnostics[0]!.message).toMatch(/'nowhere' is used but never defined/);
  });

  it('a program without main is told so (crt0 calls main)', () => {
    const p = buildProgram('int helper() {\n{{ ret }}\n}\n', level());
    expect(p.ok).toBe(false);
    expect(p.diagnostics).toEqual([
      expect.objectContaining({
        file: 'main.c',
        line: 1,
        message: expect.stringMatching(/no main function/),
      }),
    ]);
  });

  it('a duplicate global names the other C file and line', () => {
    const lib = [{ name: 'other.c', text: '\nint main() {\n{{ ret }}\n}\n' }];
    const p = buildProgram('int main() {\n{{ ret }}\n}\n', level({ library: lib }));
    expect(p.ok).toBe(false);
    expect(p.diagnostics.map((d) => d.message).join('\n')).toMatch(/also in main\.c:1/);
  });

  it('libc: false links no libc; main is the entry and its ret exits through the stub', () => {
    const lvl = level({ libc: false });
    const src = 'int main() {\n{{ li a0, 7 }}\n{{ ret }}\n}\n';
    const p = buildProgram(src, lvl);
    expect(p.ok).toBe(true);
    expect(p.symbols.map((s) => s.name)).not.toContain('_start');
    expect(p.entry).toBe(p.symbols.find((s) => s.name === 'main')!.addr);
    expect(run(src, { expect: { exitCode: 7 } }, lvl).pass).toBe(true);
    // libc functions and headers are gone.
    expect(buildProgram(MAIN, lvl).diagnostics[0]).toMatchObject({
      file: 'main.c',
      line: 1,
      message: 'cannot find twice.h',
    });
    expect(
      buildProgram('int main() {\n{{ call twice }}\n}\n', lvl).diagnostics[0]!.message,
    ).toMatch(/'twice' is used but never defined/);
  });

  it('libc: false with the level bringing its own _start uses it', () => {
    const lvl = level({
      libc: false,
      library: [{ name: 'start.s', text: '.globl _start\n_start:\n  call main\n  ebreak\n' }],
    });
    const p = buildProgram('int main() {\n{{ li a0, 3 }}\n{{ ret }}\n}\n', lvl);
    expect(p.entry).toBe(p.symbols.find((s) => s.name === '_start')!.addr);
    expect(
      run('int main() {\n{{ li a0, 3 }}\n{{ ret }}\n}\n', { expect: { regs: { a0: 3 } } }, lvl)
        .pass,
    ).toBe(true);
  });

  it('library .h files are headers, .c files are compiled, .s files are assembled', () => {
    const library = [
      { name: 'lib.h', text: 'int add3(int);' },
      {
        name: 'lib.c',
        text: '#include "lib.h"\nint add3(int x) {\n{{ addi a0, a0, 3; ret }}\n}\n',
      },
      { name: 'neg.s', text: '.globl neg\nneg:\n  sub a0, zero, a0\n  ret\n' },
    ];
    const src = `#include "lib.h"
int main() {
  {{ addi sp, sp, -16; sw ra, 12(sp) }}
  {{ li a0, 4; call add3; call neg }}
  {{ lw ra, 12(sp); addi sp, sp, 16; ret }}
}
`;
    const lvl = level({ library });
    const p = buildProgram(src, lvl);
    expect(p.diagnostics).toEqual([]);
    expect(p.locate(p.symbols.find((s) => s.name === 'add3')!.addr + 4)).toEqual({
      file: 'lib.c',
      line: 3,
    });
    expect(p.locate(p.symbols.find((s) => s.name === 'neg')!.addr)).toEqual({
      file: 'neg.s',
      line: 3,
    });
    expect(run(src, { expect: { exitCode: -7 >>> 0 } }, lvl).pass).toBe(true);
    // A trap inside a library C file names that file and its C line.
    const bad = level({
      library: [{ name: 'bad.c', text: 'int crash() {\n\n{{ lw a0, 1(zero) }}\n}\n' }],
    });
    const r = run('int main() {\n{{ call crash }}\n}\n', { expect: { exitCode: 0 } }, bad);
    expect(r.message).toMatch(/Misaligned load at bad\.c line 3/);
  });

  it('errors in a library C file carry its name', () => {
    const p = buildProgram(
      MAIN,
      level({ library: [{ name: 'broken.c', text: '\n#error nope\n' }] }),
    );
    expect(p.diagnostics).toEqual([
      expect.objectContaining({ file: 'broken.c', line: 2, message: 'nope' }),
    ]);
  });

  it('rebuilding the same source for the same level reuses the program', () => {
    const lvl = level();
    expect(buildProgram(MAIN, lvl)).toBe(buildProgram(MAIN, lvl));
    expect(buildProgram(MAIN + '\n', lvl)).not.toBe(buildProgram(MAIN, lvl));
  });

  it('where() and trapMessage() use C lines', () => {
    const p = buildProgram(
      'int main() {\n{{ li a0, 0 }}\n{{ sw a0, 2(zero) }}\n}\n',
      level({ libc: false }),
    );
    const m = createMachine(p, level({ libc: false }));
    const r = runMachine(m, 100);
    expect(r.stop?.kind).toBe('trap');
    if (r.stop?.kind !== 'trap') return;
    expect(where(p, r.stop.pc)).toBe('line 3');
    expect(trapMessage(m, p, r.stop)).toMatch(/^Misaligned store at line 3 \(sw/);
    expect(where(p, p.entry)).toBe(`address 0x${p.entry.toString(16)} (in main)`);
  });
});

describe('setup.disk', () => {
  const asmLevel = (devices: string[]): Level => level({ language: 'rv32-asm', devices });
  // Read sector 3 and return its first word as the exit code.
  const READER = `
  li t0, 0x10002000
  li t1, 3
  sw t1, ${BLOCK_REG.sector}(t0)
  li t1, 1
  sw t1, ${BLOCK_REG.command}(t0)
  lw a0, ${BLOCK_REG.buffer}(t0)
  li a7, 93
  ecall
`;

  it('writes the test sectors to the disk before running', () => {
    const lvl = asmLevel(['uart', 'disk']);
    const r = run(
      READER,
      { setup: { disk: [{ sector: 3, hex: '2a 00 00 00' }] }, expect: { exitCode: 42 } },
      lvl,
    );
    expect(r.message).toBeUndefined();
    expect(r.pass).toBe(true);
    const m = createMachine(buildProgram(READER, lvl), lvl, {
      disk: [
        { sector: 0, hex: 'aa bb' },
        { sector: 2047, hex: '01' },
      ],
    });
    expect(m.block.sectorCount).toBe(DISK_SIZE / 512);
    expect(Array.from(m.block.storage.subarray(0, 3))).toEqual([0xaa, 0xbb, 0]);
    expect(m.block.storage[2047 * 512]).toBe(1);
  });

  it('disk data past the end of the 1 MiB disk is a clear setup error', () => {
    const lvl = asmLevel(['disk']);
    const r = run(
      READER,
      { setup: { disk: [{ sector: 2047, hex: '00'.repeat(513) }] }, expect: { exitCode: 0 } },
      lvl,
    );
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(
      /513 bytes at disk sector 2047, past the end of the disk \(2048 sectors of 512 bytes\)/,
    );
    expect(() =>
      createMachine(buildProgram(READER, lvl), lvl, { disk: [{ sector: 4096, hex: '00' }] }),
    ).toThrow(SetupError);
  });

  it('disk data without the disk device is a setup error', () => {
    const r = run(
      READER,
      { setup: { disk: [{ sector: 0, hex: '00' }] }, expect: { exitCode: 0 } },
      asmLevel(['uart']),
    );
    expect(r.message).toMatch(/no 'disk' device/);
  });

  it('a level with the disk device and no setup gets a blank disk', () => {
    const lvl = asmLevel(['disk']);
    const m = createMachine(buildProgram('ebreak', lvl), lvl);
    expect(m.block.storage.every((b) => b === 0)).toBe(true);
    expect(RAM_BASE).toBe(0x80000000);
  });
});
