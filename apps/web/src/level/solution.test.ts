import { describe, expect, it } from 'vitest';
import { LEVELS, levelById } from '@build-a-computer/content';
import { referenceSolution } from '@build-a-computer/content/solutions';
import { compile, loadProgram, runTest } from '@build-a-computer/sim-logic';
import { partRect, rectsIntersect } from '../editor/geometry';
import { layoutSolution } from './solution';

describe('layoutSolution', () => {
  it('lays OR out between the inputs and the output without overlaps', () => {
    const level = levelById('or-gate')!;
    const board = layoutSolution(referenceSolution(level)!);
    const free = board.parts.filter((p) => !p.locked);
    expect(free.map((p) => p.type).sort()).toEqual(['nand', 'not', 'not']);
    const a = board.parts.find((p) => p.label === 'A')!;
    const y = board.parts.find((p) => p.label === 'Y')!;
    for (const p of free) {
      expect(p.x).toBeGreaterThan(a.x);
      expect(p.x).toBeLessThan(y.x);
    }
    const rects = board.parts.map(partRect);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) expect(rectsIntersect(rects[i]!, rects[j]!)).toBe(false);
  });

  it('keeps every laid-out solution passing its tests (layout never changes the circuit)', () => {
    for (const level of LEVELS) {
      const ref = referenceSolution(level);
      if (!ref || !level.tests.length) continue;
      const board = layoutSolution(ref);
      for (const t of level.tests) {
        const nl = compile(t.kind === 'program' ? loadProgram(board, t) : board);
        const results = [...runTest(nl, t, { powerOnState: level.power })];
        expect(results.every((r) => r.pass), `${level.id} ${t.kind}`).toBe(true);
      }
    }
  }, 120_000);
});
