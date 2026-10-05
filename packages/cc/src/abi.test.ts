/**
 * CC-05: calls work both ways with gcc-compiled functions. programs/abi/
 * abi_gcc.s is riscv gcc -O2's assembly for abi_gcc.c (scripts/abi-gcc.sh);
 * it is linked with our build of abi_ours.c, and the run must print what the
 * all-gcc build (programs/abi/gcc.bin) prints.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '@build-a-computer/asm';
import { RAM_BASE } from '@build-a-computer/rv32';
import { expect, it } from 'vitest';
import { CRT0, SUPPORT_C, compileOk, runImage } from './test/harness';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../programs/abi');
const read = (f: string): string => readFileSync(join(dir, f), 'utf8');

/**
 * gcc's output uses two things @build-a-computer/asm does not accept (yet):
 * `.type sym, @function` and the `sgtu` pseudo-instruction. Drop / rewrite them.
 */
const forOurAssembler = (s: string): string =>
  s
    .replace(/^\s*\.(type|size)\b.*$/gm, '')
    .replace(/\.section\s+\.note\.GNU-stack.*$/gm, '')
    .replace(/\bsgtu\s+(\w+),\s*(\w+),\s*(\w+)/g, 'sltu $1, $3, $2')
    .replace(/\bsgt\s+(\w+),\s*(\w+),\s*(\w+)/g, 'slt $1, $3, $2');

it('CC-05: our code and gcc code call each other (structs, long long, varargs, callbacks)', () => {
  const ours = compileOk(read('abi_ours.c'), { file: 'abi_ours.c', headers: { 'abi.h': read('abi.h') } });
  const sup = compileOk(SUPPORT_C, { file: 'support.c' });
  const link = build(
    [
      { name: 'crt0.s', text: CRT0 },
      { name: 'abi_ours.s', text: ours.asm },
      { name: 'abi_gcc.s', text: forOurAssembler(read('abi_gcc.s')) },
      { name: 'support.s', text: sup.asm },
    ],
    { base: RAM_BASE },
  );
  expect(link.diagnostics.map((d) => `${d.file}:${d.line}: ${d.message}`)).toEqual([]);
  const mixed = runImage(link.image, link.entry);
  const gcc = runImage(new Uint8Array(readFileSync(join(dir, 'gcc.bin'))), RAM_BASE);
  expect(gcc.end).toBe('exit');
  expect(mixed.end).toBe('exit');
  expect(mixed.uart).toBe(gcc.uart);
  expect(mixed.uart).toContain('back = ');
});
