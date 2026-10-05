/**
 * Differential tests against riscv gcc: every program in `programs/` is built
 * with our compiler and run on the emulator; its UART output and exit code
 * must equal the gcc build's (`programs/golden/*.json`, made by
 * scripts/gcc-golden.mjs with docker). Write mode (CC_PROGRAMS_WRITE=<dir>)
 * runs the gcc -O0 and -O2 images instead and writes the goldens.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run, runImage } from './test/harness';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../programs');
const goldenDir = join(dir, 'golden');
const writeDir = process.env.CC_PROGRAMS_WRITE;
const headers = { 'prelude.h': readFileSync(join(dir, 'prelude.h'), 'utf8') };
const names = readdirSync(dir)
  .filter((f) => f.endsWith('.c'))
  .map((f) => f.slice(0, -2))
  .sort();
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

interface Golden {
  sourceSha256: string;
  uart: string;
  exitCode: number | null;
}

describe.runIf(writeDir)('write goldens', () => {
  const built = existsSync(join(writeDir ?? '', 'manifest.txt'))
    ? readFileSync(join(writeDir ?? '', 'manifest.txt'), 'utf8').split('\n').filter(Boolean)
    : [];
  for (const n of built) {
    it(n, () => {
      const img = (o: string): Uint8Array => new Uint8Array(readFileSync(join(writeDir ?? '', `${n}.${o}.bin`)));
      const r0 = runImage(img('O0'), 0x80000000, 50_000_000);
      const r2 = runImage(img('O2'), 0x80000000, 50_000_000);
      expect(r0.end).toBe('exit');
      expect(r2.end).toBe('exit');
      expect(r0.uart, 'gcc -O0 and -O2 differ (undefined behavior?)').toBe(r2.uart);
      expect(r0.exitCode).toBe(r2.exitCode);
      const g: Golden = { sourceSha256: sha(readFileSync(join(dir, `${n}.c`), 'utf8')), uart: r2.uart, exitCode: r2.exitCode };
      writeFileSync(join(goldenDir, `${n}.json`), JSON.stringify(g, null, 1) + '\n');
    });
  }
});

describe.skipIf(writeDir)('programs: our compiler vs riscv gcc', () => {
  for (const n of names) {
    it(n, () => {
      const src = readFileSync(join(dir, `${n}.c`), 'utf8');
      const gp = join(goldenDir, `${n}.json`);
      expect(existsSync(gp), `no golden for ${n}: run scripts/gcc-golden.mjs`).toBe(true);
      const g = JSON.parse(readFileSync(gp, 'utf8')) as Golden;
      expect(g.sourceSha256, `golden for ${n} is stale: run scripts/gcc-golden.mjs ${n}`).toBe(sha(src));
      const r = run(src, { file: `${n}.c`, headers, maxSteps: 50_000_000, noSupport: true });
      expect(r.end).toBe('exit');
      expect(r.uart).toBe(g.uart);
      expect(r.exitCode).toBe(g.exitCode);
    });
  }
});

describe.skipIf(writeDir)('programs with noRegisterVariables (every local in the frame)', () => {
  for (const n of names.filter((x) => !x.startsWith('fuzz'))) {
    it(n, () => {
      const src = readFileSync(join(dir, `${n}.c`), 'utf8');
      const g = JSON.parse(readFileSync(join(goldenDir, `${n}.json`), 'utf8')) as Golden;
      const r = run(src, { file: `${n}.c`, headers, maxSteps: 50_000_000, noSupport: true, noRegisterVariables: true });
      expect(r.uart).toBe(g.uart);
      expect(r.exitCode).toBe(g.exitCode);
    });
  }
});
