/**
 * ISA compliance: every riscv-tests binary in $ISA_OUT must pass.
 * Run with `pnpm --filter @build-a-computer/rv32 isa` (builds the binaries in Docker).
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readManifest, runOne } from './run';

const dir = process.env.ISA_OUT ?? new URL('./dist/riscv-tests', import.meta.url).pathname;
const filter = process.env.ISA_FILTER ?? '';
const have = existsSync(`${dir}/manifest.json`);

describe.skipIf(!have)('riscv-tests', () => {
  const entries = have ? readManifest(dir).filter((e) => e.name.includes(filter)) : [];
  const results: { name: string; pass: boolean }[] = [];
  for (const e of entries) {
    it(e.name, () => {
      const r = runOne(dir, e);
      results.push(r);
      expect(r.detail).toBe('pass');
      // The v environment must really run with Sv32 enabled.
      if (e.name.includes('-v-')) expect(r.paged).toBe(true);
    });
  }
  it('summary', () => {
    const suites = new Map<string, [number, number]>();
    for (const r of results) {
      const suite = r.name.split('-').slice(0, 2).join('-');
      const s = suites.get(suite) ?? [0, 0];
      s[0] += r.pass ? 1 : 0;
      s[1] += 1;
      suites.set(suite, s);
    }
    for (const [suite, [p, t]] of suites) console.log(`${suite}: ${p}/${t}`);
    expect(results.length).toBe(entries.length);
  });
});
