import { describe, expect, it } from 'vitest';
import type { Board, Level } from '@ground-up/schema';
import { compile, runTruthTable } from '@ground-up/sim-logic';
import { LEVELS } from './index';

const playable = LEVELS.filter((l) => l.tests.length > 0);

function allPass(level: Level, board: Board): boolean {
  const nl = compile(board);
  return level.tests.every((t) => [...runTruthTable(nl, t)].every((r) => r.pass));
}

describe('content', () => {
  it('has unique ids and known requirements', () => {
    const ids = new Set(LEVELS.map((l) => l.id));
    expect(ids.size).toBe(LEVELS.length);
    for (const l of LEVELS) for (const r of l.requires) expect(ids.has(r)).toBe(true);
  });

  it('E-RES-06: the empty starter board fails every playable level', () => {
    for (const l of playable) expect(allPass(l, l.starter), l.id).toBe(false);
  });

  it('every playable level has hints and an afterword', () => {
    for (const l of playable) {
      expect(l.hints.length, l.id).toBeGreaterThan(0);
      expect(l.afterword.length, l.id).toBeGreaterThan(0);
    }
  });
});
