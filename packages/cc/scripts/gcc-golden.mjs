#!/usr/bin/env node
/* global console, process */
/**
 * Regenerates packages/cc/programs/golden/*.json with riscv gcc, for the
 * compiler's own differential tests (src/programs.test.ts).
 *
 *   node packages/cc/scripts/gcc-golden.mjs [name-filter...]
 *
 * Uses the docker image from tools/cc-diff/Dockerfile. Builds each program at
 * -O0 and -O2, runs both on our emulator (they must agree), and writes the
 * UART output and exit code. Tests never need docker.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const root = join(pkg, '../..');
const progs = join(pkg, 'programs');
const IMAGE = 'build-a-computer-cc-golden';
const DOCKER = ['--context', 'default'];
const filters = process.argv.slice(2);
const names = readdirSync(progs)
  .filter((f) => f.endsWith('.c'))
  .map((f) => f.slice(0, -2))
  .filter((n) => filters.length === 0 || filters.some((x) => n.includes(x)))
  .sort();
try {
  execFileSync('docker', [...DOCKER, 'image', 'inspect', IMAGE], { stdio: 'ignore' });
} catch {
  execFileSync('docker', [...DOCKER, 'build', '-t', IMAGE, join(root, 'tools/cc-diff')], { stdio: 'inherit' });
}
const work = mkdtempSync(join(tmpdir(), 'cc-programs-'));
const out = join(pkg, 'node_modules/.cache/cc-programs');
try {
  cpSync(progs, work, { recursive: true, filter: (src) => !src.includes('golden') && (!src.endsWith('.c') || names.some((n) => src.endsWith(`/${n}.c`))) });
  cpSync(join(root, 'tools/cc-diff/link.ld'), join(work, 'link.ld'));
  cpSync(join(root, 'tools/cc-diff/ref/crt0.s'), join(work, 'crt0.s'));
  writeFileSync(join(work, 'manifest.txt'), names.join('\n') + '\n');
  const input = execFileSync('tar', ['-C', work, '-c', '.'], { maxBuffer: 256 << 20 });
  const res = execFileSync('docker', [...DOCKER, 'run', '--rm', '-i', IMAGE, 'sh', '-c', 'tar -x && sh build.sh >&2 && tar -C out -c .'], {
    input,
    maxBuffer: 256 << 20,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  execFileSync('tar', ['-C', out, '-x'], { input: res });
  writeFileSync(join(out, 'manifest.txt'), names.join('\n') + '\n');
  for (const n of names) if (!existsSync(join(out, `${n}.O2.bin`))) console.error(`${n}: gcc failed`);
  execFileSync(join(root, 'node_modules/.bin/vitest'), ['run', '--root', pkg, 'src/programs.test.ts'], {
    stdio: 'inherit',
    env: { ...process.env, CC_PROGRAMS_WRITE: out },
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
