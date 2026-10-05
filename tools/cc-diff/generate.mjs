#!/usr/bin/env node
/* global console, process */
/**
 * Regenerates packages/cc/corpus/golden/*.json with riscv gcc (CC-07).
 *
 *   pnpm cc-golden              # every corpus program
 *   pnpm cc-golden 050-sorting  # only names containing one of the arguments
 *
 * 1. Builds the build-a-computer-cc-golden image if it is missing.
 * 2. Compiles every corpus/*.c with riscv64-unknown-elf-gcc at -O0 and -O2
 *    (rv32im, ilp32, freestanding, link.ld at 0x8000_0000, ref/crt0.s; the
 *    libc group links ref/libc.c, the freestanding group ref/support.c).
 *    Files go in and out of the container through tar on stdin/stdout.
 * 3. Runs both binaries on OUR emulator (golden.test.ts in write mode); they
 *    must agree (a disagreement means the program has undefined behavior or
 *    the emulator has a bug). The UART output, exit code and the -O2 image go
 *    into the golden JSON, so tests never need docker.
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const corpus = join(root, 'packages/cc/corpus');
const outDir = join(here, 'dist/gcc');
const IMAGE = 'build-a-computer-cc-golden';
const DOCKER = ['--context', 'default'];
/** Same rule as run.ts `groupOf`: programs that include a libc header use libc. */
const LIBC_INCLUDE = /^\s*#\s*include\s*<(stdio|stdlib|string)\.h>/m;

const filters = process.argv.slice(2);
const sources = readdirSync(corpus)
  .filter((f) => f.endsWith('.c'))
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)))
  .sort();
if (sources.length === 0) {
  console.error('no corpus programs match');
  process.exit(1);
}

try {
  execFileSync('docker', [...DOCKER, 'image', 'inspect', IMAGE], { stdio: 'ignore' });
} catch {
  execFileSync('docker', [...DOCKER, 'build', '-t', IMAGE, here], { stdio: 'inherit' });
}

const work = mkdtempSync(join(tmpdir(), 'build-a-computer-cc-golden-'));
try {
  const manifest = [];
  for (const f of sources) {
    const text = readFileSync(join(corpus, f), 'utf8');
    writeFileSync(join(work, f), text);
    manifest.push(`${f.slice(0, -2)} ${LIBC_INCLUDE.test(text) ? 'libc' : 'free'}`);
  }
  writeFileSync(join(work, 'manifest.txt'), manifest.join('\n') + '\n');
  cpSync(join(here, 'ref'), join(work, 'ref'), { recursive: true });
  writeFileSync(join(work, 'link.ld'), readFileSync(join(here, 'link.ld')));
  writeFileSync(join(work, 'build.sh'), readFileSync(join(here, 'build.sh')));
  const input = execFileSync('tar', ['-C', work, '-c', '.']);
  const output = execFileSync(
    'docker',
    [
      ...DOCKER,
      'run',
      '--rm',
      '-i',
      IMAGE,
      'sh',
      '-c',
      'tar -x && sh build.sh >&2 && tar -C out -c .',
    ],
    { input, maxBuffer: 256 << 20, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  if (filters.length === 0) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  execFileSync('tar', ['-C', outDir, '-x'], { input: output });
  writeFileSync(join(outDir, 'manifest.txt'), manifest.join('\n') + '\n');

  let failed = 0;
  for (const line of manifest) {
    const name = line.split(' ')[0];
    const err = existsSync(join(outDir, `${name}.err`))
      ? readFileSync(join(outDir, `${name}.err`), 'utf8').trim()
      : '';
    if (
      !existsSync(join(outDir, `${name}.O0.bin`)) ||
      !existsSync(join(outDir, `${name}.O2.bin`))
    ) {
      console.error(`${name}: gcc failed\n${err}`);
      failed++;
    } else if (err) console.warn(`${name}: gcc warnings\n${err}`);
  }

  // Run the binaries on our emulator and write the golden JSON.
  execFileSync(join(root, 'node_modules/.bin/vitest'), ['run', '--root', here, 'golden.test.ts'], {
    stdio: 'inherit',
    env: { ...process.env, CC_GOLDEN_WRITE: outDir },
  });
  console.log(`gcc built ${sources.length - failed} of ${sources.length} programs`);
  if (failed) process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
