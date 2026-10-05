/**
 * The live link check (CNT-02). Skipped unless LINK_CHECK=1, so `pnpm test`
 * never touches the network. Run it with:
 *
 *   LINK_CHECK=1 pnpm --filter @build-a-computer/content links
 *
 * It writes `report.md` and `issues.json` to LINK_CHECK_OUT (default
 * tools/link-check/dist). The weekly workflow turns issues.json into GitHub
 * issues; on pull requests it only prints the report (dry run). Failing links
 * never fail this test: the issues are the output, and links are never swapped.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../packages/content/src/full';
import { checkAll, formatReport, issuesFor, type FetchFn } from './check';

const OUT = process.env.LINK_CHECK_OUT ?? join(import.meta.dirname, 'dist');

describe.skipIf(!process.env.LINK_CHECK)('live link check', () => {
  it('checks every level resource', { timeout: 15 * 60_000 }, async () => {
    const items = LEVELS.flatMap((l) => l.resources.map((resource) => ({ levelId: l.id, resource })));
    const fetchFn: FetchFn = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    const results = await checkAll(items, { fetch: fetchFn, concurrency: 4 });
    const at = new Date().toISOString();
    mkdirSync(OUT, { recursive: true });
    const report = formatReport(results, at);
    writeFileSync(join(OUT, 'report.md'), report);
    writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    writeFileSync(join(OUT, 'issues.json'), JSON.stringify(issuesFor(results, at), null, 2));
    console.log(report);
    expect(results.length).toBeGreaterThan(0);
  });
});
