import { describe, expect, it } from 'vitest';
import { LEVELS } from './index';
import { allPass, pendingReason } from '../solutions/harness';

const playable = LEVELS.filter((l) => l.tests.length > 0);

describe('content', () => {
  it('has unique ids and known requirements', () => {
    const ids = new Set(LEVELS.map((l) => l.id));
    expect(ids.size).toBe(LEVELS.length);
    for (const l of LEVELS) for (const r of l.requires) expect(ids.has(r)).toBe(true);
  });

  it('E-RES-06: the empty starter board fails every playable level', () => {
    // Levels whose engine features are still landing are skipped (and named) by
    // the per-level E-RES-06 tests next to each phase's solutions.
    const checkable = playable.filter((l) => pendingReason(l, l.starter) === null);
    expect(checkable.length).toBeGreaterThan(0);
    for (const l of checkable) expect(allPass(l, l.starter), l.id).toBe(false);
  });

  it('every playable level has hints and an afterword', () => {
    for (const l of playable) {
      expect(l.hints.length, l.id).toBeGreaterThan(0);
      expect(l.afterword.length, l.id).toBeGreaterThan(0);
    }
  });
});
