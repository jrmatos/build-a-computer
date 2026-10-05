#!/usr/bin/env node
/* global console, process */
/**
 * Regenerates packages/asm/corpus/golden/*.json from GNU binutils.
 *
 *   docker build -t build-a-computer-asm-golden tools/asm-golden
 *   node tools/asm-golden/generate.mjs
 *
 * Each corpus/*.s is assembled with
 *   riscv64-unknown-elf-as -march=rv32ima_zicsr_zifencei -mabi=ilp32 -mno-relax
 * and linked with link.ld at 0x80000000 (--no-relax), then objcopy -O binary.
 * Files go in and out of the container through tar on stdin/stdout, so no
 * volume mounts are needed. Tests read the JSON; they never need docker.
 */
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const corpus = join(here, '../../packages/asm/corpus');
const goldenDir = join(corpus, 'golden');
const IMAGE = 'build-a-computer-asm-golden';

const work = mkdtempSync(join(tmpdir(), 'build-a-computer-asm-golden-'));
try {
  const sources = readdirSync(corpus)
    .filter((f) => f.endsWith('.s'))
    .sort();
  for (const f of sources) writeFileSync(join(work, f), readFileSync(join(corpus, f)));
  writeFileSync(join(work, 'link.ld'), readFileSync(join(here, 'link.ld')));
  writeFileSync(join(work, 'run.sh'), readFileSync(join(here, 'run.sh')));
  const input = execFileSync('tar', ['-C', work, '-c', '.']);
  const output = execFileSync(
    'docker',
    ['run', '--rm', '-i', IMAGE, 'sh', '-c', 'tar -x && sh run.sh >&2 && tar -C out -c .'],
    { input, maxBuffer: 64 << 20 },
  );
  const outDir = join(work, 'out');
  mkdirSync(outDir);
  execFileSync('tar', ['-C', outDir, '-x'], { input: output });
  mkdirSync(goldenDir, { recursive: true });
  let failed = 0;
  for (const f of sources) {
    const name = f.slice(0, -2);
    const err = existsSync(join(outDir, `${name}.err`))
      ? readFileSync(join(outDir, `${name}.err`), 'utf8')
      : '';
    const binPath = join(outDir, `${name}.bin`);
    if (!existsSync(binPath)) {
      console.error(`${f}: GNU toolchain failed\n${err}`);
      failed++;
      continue;
    }
    const bin = readFileSync(binPath);
    const hex = bin.toString('hex');
    const image = [];
    for (let i = 0; i < hex.length; i += 64) image.push(hex.slice(i, i + 64));
    const symbols = {};
    for (const line of readFileSync(join(outDir, `${name}.nm`), 'utf8').split('\n')) {
      const m = /^([0-9a-f]+) ([a-zA-Z]) (.+)$/.exec(line.trim());
      if (!m || !/[tTdDrRbB]/.test(m[2]) || m[3].startsWith('.L') || m[3].startsWith('$')) continue;
      symbols[m[3]] = '0x' + m[1];
    }
    const golden = {
      source: f,
      tool: 'GNU as/ld 2.40, -march=rv32ima_zicsr_zifencei -mabi=ilp32 -mno-relax, base 0x80000000',
      size: bin.length,
      image,
      symbols,
    };
    writeFileSync(join(goldenDir, `${name}.json`), JSON.stringify(golden, null, 2) + '\n');
    if (err.trim()) console.warn(`${f}: ${err.trim()}`);
  }
  // Keep the committed JSON in the repo's Prettier style.
  execFileSync('npx', ['prettier', '--log-level', 'warn', '--write', goldenDir], {
    stdio: 'inherit',
  });
  console.log(`wrote ${sources.length - failed} golden files to ${goldenDir}`);
  if (failed) process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
