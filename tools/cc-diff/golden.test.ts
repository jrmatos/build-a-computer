/**
 * Golden outputs for the C corpus (CC-07).
 *
 * Normal mode (no docker): every corpus program has a golden, the golden was
 * made from the current source, and the committed gcc -O2 image still gives
 * the golden output on our emulator (a regression check for packages/rv32).
 *
 * Write mode (CC_GOLDEN_WRITE=<dir of gcc .bin files>, used by generate.mjs):
 * run the gcc -O0 and -O2 builds on our emulator, require both to exit with
 * the same output and exit code, and write packages/cc/corpus/golden/*.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOLDEN_DIR, type Golden, listCorpus, readGolden, runImage, sha256 } from './run';

const writeDir = process.env.CC_GOLDEN_WRITE;
const corpus = listCorpus();

describe.runIf(writeDir)('write goldens from gcc builds', () => {
  const dir = writeDir ?? '';
  const tool = existsSync(join(dir, 'version.txt'))
    ? readFileSync(join(dir, 'version.txt'), 'utf8').trim()
    : 'riscv64-unknown-elf-gcc';
  const built = existsSync(join(dir, 'manifest.txt'))
    ? readFileSync(join(dir, 'manifest.txt'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split(' ')[0]!)
    : [];
  for (const p of corpus.filter((c) => built.includes(c.name))) {
    it(
      p.name,
      () => {
        const bin = (opt: string): Uint8Array => {
          const f = join(dir, `${p.name}.${opt}.bin`);
          if (!existsSync(f))
            throw new Error(`gcc did not build ${p.name} at -${opt}; see ${p.name}.err`);
          return new Uint8Array(readFileSync(f));
        };
        const o2 = bin('O2');
        const r0 = runImage(bin('O0'));
        const r2 = runImage(o2);
        expect(r2.end, `gcc -O2 build: ${r2.detail}`).toBe('exit');
        expect(r0.end, `gcc -O0 build: ${r0.detail}`).toBe('exit');
        expect(r0.uart, '-O0 and -O2 output differ: undefined behavior in the program?').toBe(
          r2.uart,
        );
        expect(r0.exitCode, '-O0 and -O2 exit codes differ').toBe(r2.exitCode);
        const golden: Golden = {
          source: p.file,
          sourceSha256: sha256(p.source),
          group: p.group,
          tool: `${tool}; -march=rv32im -mabi=ilp32 -std=c99 -ffreestanding -nostdlib -O0 and -O2 agree; image is -O2`,
          uart: r2.uart,
          exitCode: r2.exitCode ?? 0,
          steps: r2.steps,
          image: Buffer.from(o2).toString('base64'),
        };
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(join(GOLDEN_DIR, `${p.name}.json`), JSON.stringify(golden, null, 2) + '\n');
      },
      120_000,
    );
  }
});

describe.skipIf(writeDir)('committed goldens (no docker needed)', () => {
  it('the corpus has at least 60 programs', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(60);
  });
  for (const p of corpus) {
    it(`${p.name}: golden is current and gcc's image reproduces it on our emulator`, () => {
      const g = readGolden(p.name);
      expect(g, `no golden for ${p.file}; run pnpm cc-golden`).toBeDefined();
      if (!g) return;
      expect(
        g.sourceSha256,
        `${p.file} changed since its golden was made; run pnpm cc-golden ${p.name}`,
      ).toBe(sha256(p.source));
      const r = runImage(new Uint8Array(Buffer.from(g.image, 'base64')));
      expect(r.end).toBe('exit');
      expect(r.uart).toBe(g.uart);
      expect(r.exitCode).toBe(g.exitCode);
      expect(r.steps).toBe(g.steps);
    }, 60_000);
  }
});
