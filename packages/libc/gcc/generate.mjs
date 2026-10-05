#!/usr/bin/env node
/* global console */
/**
 * Rebuilds packages/libc/gcc/golden/*.bin: libc and every tests/*.c compiled
 * by GCC (riscv64-unknown-elf-gcc -march=rv32im -mabi=ilp32), linked with
 * link.ld at 0x80000000 with crt0 first and end.s last. libc.test.ts runs
 * them on the emulator, so tests never need docker.
 *
 *   docker --context default build -t build-a-computer-libc-gcc packages/libc/gcc
 *   node packages/libc/gcc/generate.mjs
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const golden = join(here, 'golden');
const work = mkdtempSync(join(tmpdir(), 'build-a-computer-libc-gcc-'));
try {
  cpSync(join(pkg, 'lib'), join(work, 'lib'), { recursive: true });
  mkdirSync(join(work, 'tests'));
  for (const f of readdirSync(join(pkg, 'tests')).filter((f) => f.endsWith('.c')))
    copyFileSync(join(pkg, 'tests', f), join(work, 'tests', f));
  copyFileSync(join(here, 'link.ld'), join(work, 'link.ld'));
  copyFileSync(join(here, 'run.sh'), join(work, 'run.sh'));
  const input = execFileSync('tar', ['-C', work, '-c', '.']);
  const output = execFileSync(
    'docker',
    [
      '--context',
      'default',
      'run',
      '--rm',
      '-i',
      'build-a-computer-libc-gcc',
      'sh',
      '-c',
      'tar -x && sh run.sh >&2 && tar -C out -c .',
    ],
    { input, maxBuffer: 64 << 20, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const out = join(work, 'out');
  mkdirSync(out);
  execFileSync('tar', ['-C', out, '-x'], { input: output });
  rmSync(golden, { recursive: true, force: true });
  mkdirSync(golden);
  for (const f of readdirSync(out).filter((f) => f.endsWith('.bin'))) {
    copyFileSync(join(out, f), join(golden, f));
    console.log(`golden/${f}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
