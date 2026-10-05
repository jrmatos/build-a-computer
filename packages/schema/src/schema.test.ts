import { describe, expect, it } from 'vitest';
import {
  Board,
  ImportError,
  NewerVersionError,
  Save,
  mergeProgress,
  migrateSave,
  parseUntrustedJson,
  type Progress,
} from './index';

const save = {
  kind: 'ground-up/save',
  version: 1,
  levelId: 'sandbox',
  levelVersion: 1,
  updatedAt: '2026-10-04T12:00:00.000Z',
  board: {
    parts: [{ id: 'p1', type: 'nand', x: 0, y: 0, rot: 0, flip: false }],
    wires: [{ id: 'w1', from: { part: 'p1', pin: 'out' }, to: { part: 'p1', pin: 'a' }, points: [] }],
  },
};

describe('Save', () => {
  it('round-trips through JSON', () => {
    const parsed = Save.parse(save);
    expect(Save.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('rejects unknown part types and bad rotations', () => {
    expect(() => Board.parse({ parts: [{ id: 'a', type: 'laser', x: 0, y: 0 }], wires: [] })).toThrow();
    expect(() => Board.parse({ parts: [{ id: 'a', type: 'nand', x: 0, y: 0, rot: 45 }], wires: [] })).toThrow();
  });
});

describe('E-DATA-03 hostile imports', () => {
  it('strips prototype keys', () => {
    const out = parseUntrustedJson('{"a":1,"__proto__":{"polluted":true},"b":{"constructor":2}}');
    expect(out).toEqual({ a: 1, b: {} });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('rejects deep nesting', () => {
    expect(() => parseUntrustedJson('['.repeat(100) + ']'.repeat(100))).toThrow(ImportError);
  });
  it('rejects files over 5 MB', () => {
    expect(() => parseUntrustedJson(`"${'x'.repeat(5 * 1024 * 1024)}"`)).toThrow(ImportError);
  });
  it('rejects malformed JSON', () => {
    expect(() => parseUntrustedJson('{nope')).toThrow(ImportError);
  });
});

describe('E-DATA-04 / E-DATA-05 migrations', () => {
  it('refuses a save from a newer version', () => {
    expect(() => migrateSave({ ...save, version: 99 })).toThrow(NewerVersionError);
  });
  it('migrates the current version without touching the input', () => {
    const input = structuredClone(save);
    const out = migrateSave(input);
    expect(input).toEqual(save);
    expect(out.version).toBe(1);
  });
});

describe('E-PLAT-01 progress merge', () => {
  it('never moves backward', () => {
    const a: Progress = { kind: 'ground-up/progress', version: 1, levels: { x: { status: 'completed', levelVersion: 1 } } };
    const b: Progress = { kind: 'ground-up/progress', version: 1, levels: { x: { status: 'open', levelVersion: 1 }, y: { status: 'open', levelVersion: 1 } } };
    const m = mergeProgress(a, b);
    expect(m.levels.x?.status).toBe('completed');
    expect(m.levels.y?.status).toBe('open');
  });
});
