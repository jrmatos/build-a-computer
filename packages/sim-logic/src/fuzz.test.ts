import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compile } from './compile';
import { acyclicCircuit, emptyStats, loopCircuit, runDiff, scenario, specToBoard } from './gen';

/**
 * Differential fuzzing: FastEngine against ReferenceEngine, every observable
 * compared after every step (see the header of fast-engine.ts).
 *
 * Default run: 1,000 acyclic circuits (SIM-03 acceptance) and 1,000 circuits
 * with loops. FUZZ_FULL=1 runs the SIM-04 acceptance count of 10,000 circuits
 * with loops. FUZZ_SEED overrides the fixed seed.
 */
const FULL = process.env.FUZZ_FULL === '1';
const SEED = Number(process.env.FUZZ_SEED ?? 20261004);
const LOOP_RUNS = FULL ? 10_000 : 1_000;

describe('differential fuzz: fast engine vs reference', () => {
  it('SIM-03: matches the reference on 1,000 random acyclic circuits', () => {
    const stats = emptyStats();
    let circuits = 0;
    fc.assert(
      fc.property(scenario(acyclicCircuit()), (sc) => {
        circuits++;
        runDiff(sc, stats);
      }),
      { seed: SEED, numRuns: 1_000 },
    );
    expect(circuits).toBe(1_000);
    expect(stats.fastSettles).toBeGreaterThan(stats.settles / 2);
    expect(stats.timedParts).toBe(0);
    console.info('acyclic fuzz', stats);
  }, 120_000);

  it(`SIM-04: matches the reference on every tick of ${LOOP_RUNS.toLocaleString('en')} random circuits with loops`, () => {
    const stats = emptyStats();
    let circuits = 0;
    const withLoops = loopCircuit().filter((spec) => compile(specToBoard(spec)).parts.some((p) => p.inLoop));
    fc.assert(
      fc.property(scenario(withLoops), (sc) => {
        circuits++;
        runDiff(sc, stats);
      }),
      { seed: SEED + 1, numRuns: LOOP_RUNS },
    );
    expect(circuits).toBe(LOOP_RUNS);
    // The fuzz must reach every interesting path.
    expect(stats.fastSettles).toBeGreaterThan(0);
    expect(stats.exactSettles).toBeGreaterThan(0);
    expect(stats.fallbacks).toBeGreaterThan(0);
    expect(stats.unstable).toBeGreaterThan(0);
    expect(stats.contention).toBeGreaterThan(0);
    console.info('loop fuzz', stats);
  }, 600_000);
});
