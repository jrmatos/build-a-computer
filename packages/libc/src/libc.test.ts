/**
 * libc tests. Every program in tests/*.c has the exact UART output it must
 * print (tests/<name>.out) and an exit code (tests/cases.json).
 *
 * - "gcc": libc and the programs built by riscv64-unknown-elf-gcc
 *   (gcc/generate.mjs, committed as gcc/golden/*.bin) run on our emulator.
 *   This checks libc itself, independently of our compiler.
 * - "cc": the same libc sources and programs built by @build-a-computer/cc and
 *   @build-a-computer/asm, linked in `withLibc` order, give the same results.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '@build-a-computer/asm';
import { compile } from '@build-a-computer/cc';
import { Machine, RAM_BASE } from '@build-a-computer/rv32';
import { describe, expect, it } from 'vitest';
import { HEADER_FILES, SOURCE_FILES } from './generated';
import { LIBC_HEADERS, LIBC_SOURCES, type LibFile, withLibc } from './index';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const readText = (...p: string[]): string => readFileSync(join(pkg, ...p), 'utf8');

interface Case {
  name: string;
  exitCode: number;
  input?: string;
}
const CASES = JSON.parse(readText('tests', 'cases.json')) as Case[];

const RAM_SIZE = 1024 * 1024;
const MAX_STEPS = 20_000_000;

interface RunResult {
  output: string;
  exitCode?: number;
  stop: string;
}

/** Run an image at the RAM base like a code level: sp = top of RAM, exit via ecall 93. */
function run(image: Uint8Array, entry: number, input = ''): RunResult {
  const m = new Machine({ ramSize: RAM_SIZE });
  m.load(RAM_BASE, image);
  m.uart.receive(input);
  const h = m.hart;
  h.pc = entry;
  h.x[2] = (RAM_BASE + RAM_SIZE) | 0;
  let stop: { what: string; code?: number } | undefined;
  // Stop at the first trap (the machine has no handler): exit for ecall a7 = 93.
  const hart = h as unknown as { takeTrap(cause: number, tval: number, epc: number): void };
  hart.takeTrap = (cause: number, tval: number, epc: number): void => {
    stop =
      cause === 11 && h.reg(17) === 93
        ? { what: 'exit', code: h.reg(10) >>> 0 }
        : {
            what: `trap cause ${cause} tval 0x${(tval >>> 0).toString(16)} pc 0x${(epc >>> 0).toString(16)}`,
          };
    throw stop;
  };
  try {
    m.run(MAX_STEPS);
  } catch (e) {
    if (e !== stop) throw e;
  }
  return {
    output: m.uart.output,
    stop: stop?.what ?? 'step budget',
    ...(stop?.code !== undefined ? { exitCode: stop.code } : {}),
  };
}

describe('libc sources', () => {
  it('generated.ts matches lib/ (run scripts/embed.mjs after editing lib/)', () => {
    for (const f of HEADER_FILES) expect(f.text, f.name).toBe(readText('lib', 'include', f.name));
    for (const f of SOURCE_FILES) expect(f.text, f.name).toBe(readText('lib', 'src', f.name));
  });

  it('exports headers and sources in link order', () => {
    expect(Object.keys(LIBC_HEADERS).sort()).toEqual([
      'assert.h',
      'ctype.h',
      'limits.h',
      'machine.h',
      'stdarg.h',
      'stdbool.h',
      'stddef.h',
      'stdint.h',
      'stdio.h',
      'stdlib.h',
      'string.h',
    ]);
    expect(LIBC_SOURCES[0]?.name).toBe('crt0.s');
    expect(LIBC_SOURCES.at(-1)?.name).toBe('end.s');
    const order = withLibc([{ name: 'main.c', text: '' }]).map((f) => f.name);
    expect(order[0]).toBe('crt0.s');
    expect(order[1]).toBe('main.c');
    expect(order.at(-1)).toBe('end.s');
  });
});

describe('libc built by gcc, run on the emulator', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const image = new Uint8Array(readFileSync(join(pkg, 'gcc', 'golden', `${c.name}.bin`)));
      const r = run(image, RAM_BASE, c.input);
      expect(r).toEqual({
        output: readText('tests', `${c.name}.out`),
        stop: 'exit',
        exitCode: c.exitCode,
      });
    });
  }
});

/** Compile .c files with our compiler and assemble everything; throws with the first errors. */
function buildWithCc(files: readonly LibFile[]): { image: Uint8Array; entry: number } {
  const asmFiles = files.map((f) => {
    if (!f.name.endsWith('.c')) return f;
    const r = compile(f.text, { file: f.name, headers: LIBC_HEADERS });
    if (!r.ok) {
      const errs = r.diagnostics
        .filter((d) => d.severity === 'error')
        .slice(0, 5)
        .map((d) => `${d.file}:${d.line}:${d.column}: ${d.message}`);
      throw new Error(`cc failed:\n${errs.join('\n')}`);
    }
    return { name: f.name.replace(/\.c$/, '.s'), text: r.asm };
  });
  const link = build(asmFiles, { base: RAM_BASE });
  if (!link.ok) {
    const errs = link.diagnostics
      .slice(0, 5)
      .map((d) => `${d.file}:${d.line}:${d.col}: ${d.message}`);
    throw new Error(`assembly failed:\n${errs.join('\n')}`);
  }
  return { image: link.image, entry: link.entry };
}

const ccReady = compile('int main(void) { return 0; }', { file: 'probe.c' }).ok;

describe.skipIf(!ccReady)(
  'libc built by @build-a-computer/cc (skipped when cc cannot compile a trivial program)',
  () => {
    for (const c of CASES) {
      it(c.name, () => {
        const prog = buildWithCc(
          withLibc([{ name: `${c.name}.c`, text: readText('tests', `${c.name}.c`) }]),
        );
        const r = run(prog.image, prog.entry, c.input);
        expect(r).toEqual({
          output: readText('tests', `${c.name}.out`),
          stop: 'exit',
          exitCode: c.exitCode,
        });
      });
    }
  },
);
