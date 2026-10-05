import { describe, expect, it } from 'vitest';
import { ImportError, LevelPack, NewerVersionError, PACK_KIND, packSlug, parsePackFile, SharedBoard, slugify } from './index';

const level = {
  id: 'not',
  version: 1,
  track: 'nand-to-os',
  phase: 0,
  order: 1,
  title: 'NOT',
  goal: 'Invert.',
  palette: ['nand'],
  starter: { parts: [], wires: [] },
  tests: [{ kind: 'truth-table', rows: [{ inputs: { A: 0 }, expect: { Y: 1 } }] }],
};
const pack = { kind: PACK_KIND, version: 1, name: 'Gates & More', levels: [level], solutions: { not: { board: { parts: [], wires: [] } } } };

describe('LevelPack', () => {
  it('parses a pack and derives its slug', () => {
    const p = parsePackFile(JSON.stringify(pack));
    expect(p.chips).toEqual({});
    expect(packSlug(p)).toBe('gates-more');
    expect(slugify('  ---  ')).toBe('pack');
    expect(slugify('A very long pack name that goes on')).toHaveLength(20);
  });

  it('rejects duplicate level ids and non-pack files', () => {
    expect(LevelPack.safeParse({ ...pack, levels: [level, level] }).success).toBe(false);
    expect(() => parsePackFile(JSON.stringify({ kind: 'build-a-computer/save' }))).toThrow(ImportError);
  });

  it('E-DATA-04: refuses a newer pack version', () => {
    expect(() => parsePackFile(JSON.stringify({ ...pack, version: 2 }))).toThrow(NewerVersionError);
  });

  it('E-DATA-03: applies size and depth limits', () => {
    expect(() => parsePackFile(JSON.stringify(pack), { maxBytes: 10, maxDepth: 64 })).toThrow(ImportError);
    expect(() => parsePackFile(JSON.stringify(pack), { maxBytes: 1 << 20, maxDepth: 3 })).toThrow(ImportError);
  });
});

describe('SharedBoard', () => {
  it('defaults chips and validates the board', () => {
    expect(SharedBoard.parse({ kind: 'build-a-computer/share', version: 1, board: { parts: [], wires: [] } }).chips).toEqual({});
    expect(SharedBoard.safeParse({ kind: 'build-a-computer/share', version: 1, board: {} }).success).toBe(false);
  });
});
