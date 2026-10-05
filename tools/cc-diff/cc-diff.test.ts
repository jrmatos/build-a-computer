/**
 * CC-07: our compiler against riscv gcc on the C corpus. Every program must
 * produce the golden UART output and exit code. Writes RESULTS.md and prints
 * a pass/fail table. Run with `pnpm cc-diff`; needs no docker.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type DiffResult, diffOne, listCorpus, resultsMarkdown, table } from './run';

const corpus = listCorpus();
const filter = process.env.CC_DIFF_FILTER ?? '';
const results: DiffResult[] = [];

describe.skipIf(process.env.CC_GOLDEN_WRITE)('cc-diff: our compiler vs riscv gcc', () => {
  for (const p of corpus.filter((c) => c.name.includes(filter))) {
    it(
      p.name,
      async () => {
        const r = await diffOne(p);
        results.push(r);
        expect(r.status, [r.summary, ...r.details].join('\n')).toBe('pass');
      },
      120_000,
    );
  }

  afterAll(() => {
    results.sort((a, b) => a.name.localeCompare(b.name));
    console.log('\n' + table(results));
    // Only a full run rewrites the committed report.
    if (!filter) writeFileSync(join(import.meta.dirname, 'RESULTS.md'), resultsMarkdown(results));
  });
});
