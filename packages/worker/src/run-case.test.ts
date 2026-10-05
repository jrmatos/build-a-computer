import { describe, expect, it } from 'vitest';
import { LEVELS } from '@build-a-computer/content/full';
import { referenceSolution, referenceSource } from '@build-a-computer/content/solutions';
import { Level, type Board, type TestSpec } from '@build-a-computer/schema';
import { caseIndexOf, type CaseResult } from '@build-a-computer/sim-logic';
import { SimHost } from './host';

/**
 * "Run this case" (SimHost.runCase) must report exactly what a full run
 * reports for that case, for every test kind. Checked over the real levels:
 * board levels with their reference solution (mostly passing) and their
 * starter board (mostly failing), code levels with their reference source.
 */

/** Which cases of a test to re-run alone: all of a small test, else a spread plus every failure up to a cap. */
function pick(cases: CaseResult[]): CaseResult[] {
  if (cases.length <= 48) return cases;
  const at = new Set([0, 1, cases.length >> 1, cases.length - 2, cases.length - 1, Math.floor(cases.length * 0.37)]);
  const out = [...at].map((i) => cases[i]!);
  for (const c of cases) if (!c.pass && out.length < 12 && !out.includes(c)) out.push(c);
  return out;
}

/** Track 2 results report how long the code ran ("Stopped after 3 ms."): wall time differs between runs. */
const timeless = (level: Level, r: CaseResult): unknown =>
  level.mode === 'js' ? JSON.parse(JSON.stringify(r).replace(/\d+(\.\d+)? ?(ms|s)\b/g, 'T')) : r;

async function full(host: SimHost, level: Level, board?: Board, source?: string): Promise<CaseResult[]> {
  const seen: CaseResult[] = [];
  await host.runTests(level, (r) => void seen.push(r), board, Number.POSITIVE_INFINITY, source);
  return seen;
}

async function expectSingleMatchesFull(level: Level, board?: Board, source?: string): Promise<number> {
  const host = new SimHost();
  if (board) host.load(board, {}, { power: level.power ?? 'zero' });
  const all = await full(host, level, board, source);
  let n = 0;
  for (const [ti] of level.tests.entries()) {
    for (const r of pick(all.filter((c) => c.test === ti))) {
      const one = await host.runCase(level, ti, caseIndexOf(r), board, Number.POSITIVE_INFINITY, source);
      expect(timeless(level, one), `${level.id} test ${ti} case ${caseIndexOf(r)}`).toEqual(timeless(level, r));
      n++;
    }
  }
  return n;
}

const boardLevels = LEVELS.filter((l) => l.mode !== 'code' && l.mode !== 'js' && l.track !== 'sandbox' && l.tests.length > 0);
const codeLevels = LEVELS.filter((l) => l.mode === 'code' && l.tests.length > 0);
/** Track 2 levels run in a sandbox (a worker thread per test): the first few keep the suite quick. */
const jsLevels = LEVELS.filter((l) => l.mode === 'js' && l.tests.length > 0).slice(0, 3);

describe('SimHost.runCase equals the same case of a full run (content levels)', () => {
  it('covers every board test kind', () => {
    const kinds = new Set<TestSpec['kind']>(boardLevels.flatMap((l) => l.tests.map((t) => t.kind)));
    for (const k of ['truth-table', 'exhaustive', 'random', 'sequence', 'program'] as const) expect(kinds.has(k), k).toBe(true);
  });

  it.each(boardLevels.map((l) => [l.id, l] as const))('board level %s: solution and starter', async (_id, level) => {
    const solution = referenceSolution(level);
    let n = await expectSingleMatchesFull(level, level.starter);
    if (solution) n += await expectSingleMatchesFull(level, solution);
    expect(n).toBeGreaterThan(0);
  }, 60_000);

  it.each(codeLevels.map((l) => [l.id, l] as const))('code level %s: reference source and empty source', async (_id, level) => {
    const source = referenceSource(level);
    let n = await expectSingleMatchesFull(level, undefined, '');
    if (source) n += await expectSingleMatchesFull(level, undefined, source);
    expect(n).toBeGreaterThan(0);
  }, 60_000);
});

describe('SimHost.runCase equals a full run (Track 2 levels)', () => {
  it.each(jsLevels.map((l) => [l.id, l] as const))('js level %s: reference source and empty source', async (_id, level) => {
    const source = referenceSource(level);
    let n = await expectSingleMatchesFull(level, undefined, '');
    if (source) n += await expectSingleMatchesFull(level, undefined, source);
    expect(n).toBeGreaterThan(0);
  }, 120_000);
});

describe('SimHost.runCase edge cases', () => {
  const lvl = (tests: TestSpec[]): Level =>
    Level.parse({ id: 't', version: 1, track: 'sandbox', phase: 0, order: 0, title: 'T', goal: 'g', palette: [], starter: { parts: [], wires: [] }, tests });

  it('a missing test or a case past a one-case test fails with a message', async () => {
    const host = new SimHost();
    const r = await host.runCase(lvl([{ kind: 'truth-table', rows: [{ inputs: {}, expect: {} }] }]), 3, 0);
    expect(r).toMatchObject({ pass: false, test: 3, message: 'This test does not exist.' });
    expect(await host.runCase(codeLevels[0]!, 0, 2, undefined, undefined, '')).toMatchObject({ pass: false, index: 2, test: 0, message: 'There is no case 3 in this test.' });
  });

  it('a program test without a board fails like the full run', async () => {
    const host = new SimHost();
    host.load({ parts: [], wires: [] });
    const level = lvl([{ kind: 'program', program: '00', rom: 'ROM', halt: 'HALT', maxCycles: 10, expect: {} }]);
    const all = await full(host, level);
    expect(await host.runCase(level, 0, 0)).toEqual(all[0]);
  });
});
