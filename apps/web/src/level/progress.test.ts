import { describe, expect, it } from 'vitest';
import { LEVELS, levelById } from '@build-a-computer/content';
import type { Level } from '@build-a-computer/schema';
import {
  completedIds,
  emptyProgress,
  exportProgress,
  groupLevels,
  importProgress,
  ImportError,
  isOutdated,
  isUnlocked,
  levelState,
  newlyUnlockedParts,
  nextLevel,
  parseUntrustedJson,
  withCompleted,
} from './progress';

const L = (id: string): Level => levelById(id)!;

describe('unlock rules', () => {
  it('sandbox and levels without requirements are open', () => {
    expect(isUnlocked(L('sandbox'), [])).toBe(true);
    expect(isUnlocked(L('meet-nand'), [])).toBe(true);
  });
  it('a level opens only when all requirements are completed', () => {
    expect(isUnlocked(L('not-gate'), [])).toBe(false);
    expect(isUnlocked(L('not-gate'), ['meet-nand'])).toBe(true);
    expect(levelState(L('not-gate'), [])).toBe('locked');
    expect(levelState(L('not-gate'), ['meet-nand'])).toBe('open');
    expect(levelState(L('not-gate'), ['meet-nand', 'not-gate'])).toBe('completed');
  });
  it('every level is reachable by completing levels in order', () => {
    const done: string[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const l of LEVELS) {
        if (!done.includes(l.id) && isUnlocked(l, done)) {
          done.push(l.id);
          changed = true;
        }
      }
    }
    expect(done.sort()).toEqual(LEVELS.map((l) => l.id).sort());
  });
});

describe('next level and unlocked parts', () => {
  it('finds the next level in the track', () => {
    expect(nextLevel(L('meet-nand'), LEVELS)?.id).toBe('not-gate');
    expect(nextLevel(L('sandbox'), LEVELS)).toBeUndefined();
  });
  it('lists parts the next level adds', () => {
    expect(newlyUnlockedParts(L('not-gate'), L('and-gate'))).toEqual(['not']);
    expect(newlyUnlockedParts(L('meet-nand'), undefined)).toEqual([]);
  });
  it('groups the sandbox first, then by phase', () => {
    const g = groupLevels(LEVELS);
    expect(g[0]?.track).toBe('sandbox');
    expect(g.slice(1).map((x) => x.phase)).toEqual([...g.slice(1).map((x) => x.phase)].sort((a, b) => a - b));
  });
});

describe('progress', () => {
  it('records completions and never moves backward', () => {
    let p = withCompleted(emptyProgress(), L('meet-nand'));
    expect(completedIds(p)).toEqual(['meet-nand']);
    p = importProgress(
      p,
      JSON.stringify({ kind: 'build-a-computer/progress', version: 1, levels: { 'meet-nand': { status: 'open', levelVersion: 1 } } }),
    );
    expect(p.levels['meet-nand']?.status).toBe('completed');
  });
  it('flags levels completed on an older version (E-DATA-06)', () => {
    const lvl = { ...L('meet-nand'), version: 2 };
    const p = withCompleted(emptyProgress(), L('meet-nand'));
    expect(isOutdated(p, lvl)).toBe(true);
    expect(levelState(lvl, completedIds(p))).toBe('completed');
  });
  it('export and import round trip (LVL-06)', () => {
    const p = withCompleted(withCompleted(emptyProgress(), L('meet-nand')), L('not-gate'));
    expect(importProgress(emptyProgress(), exportProgress(p))).toEqual(p);
  });
  it('rejects bad files (E-DATA-03)', () => {
    const code = (text: string) => {
      try {
        importProgress(emptyProgress(), text);
        return 'ok';
      } catch (e) {
        return e instanceof ImportError ? e.code : 'other';
      }
    };
    expect(code('{nope')).toBe('not-json');
    expect(code('{"kind":"other"}')).toBe('invalid');
    expect(code('['.repeat(100) + ']'.repeat(100))).toBe('too-deep');
    expect(code(' '.repeat(5 * 1024 * 1024 + 1))).toBe('too-large');
  });
  it('strips prototype keys', () => {
    const data = parseUntrustedJson('{"__proto__":{"polluted":1},"a":{"constructor":1,"b":2}}') as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(['a']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(data.a).toEqual({ b: 2 });
  });
});
