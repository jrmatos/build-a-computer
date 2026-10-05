import { describe, expect, it } from 'vitest';
import type { Board, ChipDef, Progress, Save, Workspace } from '@build-a-computer/schema';
import { defaultChoices, isNoopMerge, mergeWorkspace, resolveImport, type LocalWorkspace } from './merge';

const nand = (id: string, x = 0): Board['parts'][number] => ({ id, type: 'nand', x, y: 0, rot: 0, flip: false });
const board = (...parts: Board['parts']): Board => ({ parts, wires: [] });
const chipPart = (id: string, chip: string): Board['parts'][number] => ({ id, type: 'chip', chip, x: 0, y: 0, rot: 0, flip: false });

const chip = (id: string, version: number, b: Board = board(nand('c1'))): ChipDef => ({
  id,
  name: id,
  version,
  board: b,
  ports: { inputs: [], outputs: [] },
});

const save = (levelId: string, b: Board, updatedAt = '2026-10-01T00:00:00.000Z', chips: Save['chips'] = {}): Save => ({
  kind: 'build-a-computer/save',
  version: 2,
  levelId,
  levelVersion: 1,
  updatedAt,
  board: b,
  chips,
});

const progress = (levels: Progress['levels']): Progress => ({ kind: 'build-a-computer/progress', version: 1, levels });

const ws = (p: Partial<Workspace>): Workspace => ({
  kind: 'build-a-computer/workspace',
  version: 1,
  exportedAt: '2026-10-05T00:00:00.000Z',
  progress: progress({}),
  saves: {},
  chips: {},
  ...p,
});

const empty: LocalWorkspace = { progress: progress({}), saves: {}, chips: {} };

describe('E-PLAT-01 workspace import merge', () => {
  it('E-PLAT-01: progress never moves backward; best status wins', () => {
    const local = { ...empty, progress: progress({ a: { status: 'completed', levelVersion: 1 }, b: { status: 'open', levelVersion: 1 } }) };
    const m = mergeWorkspace(
      local,
      ws({ progress: progress({ a: { status: 'open', levelVersion: 1 }, b: { status: 'completed', levelVersion: 1 }, c: { status: 'completed', levelVersion: 2 } }) }),
    );
    expect(m.progress.levels.a?.status).toBe('completed');
    expect(m.progress.levels.b?.status).toBe('completed');
    expect(m.progressGained).toEqual(['b', 'c']);
  });

  it('E-PLAT-01: a board only in the file is added', () => {
    const m = mergeWorkspace(empty, ws({ saves: { x: save('x', board(nand('p'))) } }));
    expect(Object.keys(m.added)).toEqual(['x']);
    expect(m.conflicts).toEqual([]);
  });

  it('E-PLAT-01: identical boards are unchanged, and the merge is a no-op', () => {
    const s = save('x', board(nand('p')));
    const m = mergeWorkspace({ ...empty, saves: { x: { ...s, updatedAt: '2026-10-03T00:00:00.000Z' } } }, ws({ saves: { x: s } }));
    expect(m.unchanged).toEqual(['x']);
    expect(isNoopMerge(m)).toBe(true);
  });

  it('E-PLAT-01: differing boards become a conflict with the newer side preselected', () => {
    const mine = save('x', board(nand('p')), '2026-10-01T00:00:00.000Z');
    const theirs = save('x', board(nand('p'), nand('q', 40)), '2026-10-02T00:00:00.000Z');
    const m = mergeWorkspace({ ...empty, saves: { x: mine } }, ws({ saves: { x: theirs } }));
    expect(m.conflicts).toHaveLength(1);
    expect(m.conflicts[0]?.newer).toBe('incoming');
    expect(defaultChoices(m)).toEqual({ x: 'incoming' });
    expect(isNoopMerge(m)).toBe(false);

    const older = mergeWorkspace({ ...empty, saves: { x: { ...mine, updatedAt: '2026-10-09T00:00:00.000Z' } } }, ws({ saves: { x: theirs } }));
    expect(older.conflicts[0]?.newer).toBe('local');
  });

  it('E-PLAT-01: nothing is overwritten silently: "Use file" keeps a backup, "Keep mine" writes nothing', () => {
    const mine = save('x', board(nand('p')));
    const theirs = save('x', board(nand('q')), '2026-10-02T00:00:00.000Z');
    const m = mergeWorkspace({ ...empty, saves: { x: mine } }, ws({ saves: { x: theirs, y: save('y', board()) } }));
    const now = new Date('2026-10-05T10:00:00.000Z');

    const keep = resolveImport(m, { x: 'local' }, now);
    expect(Object.keys(keep.write)).toEqual(['y']);
    expect(keep.backups).toEqual({});

    const use = resolveImport(m, { x: 'incoming' }, now);
    expect(use.write.x?.board).toEqual(theirs.board);
    expect(use.backups[`x~before-import-${now.getTime()}`]).toEqual(mine);

    // No choice recorded: the local board stays.
    expect(resolveImport(m, {}, now).write.x).toBeUndefined();
  });

  it('chips: never downgrade a local chip', () => {
    const local = { ...empty, chips: { half: chip('half', 3, board(nand('a'), nand('b'))) } };
    const m = mergeWorkspace(local, ws({ chips: { half: chip('half', 2) } }));
    expect(m.chips.half?.version).toBe(3);
    expect(m.chipsChanged).toEqual([]);
  });

  it('chips: a newer chip from the file replaces the local one', () => {
    const local = { ...empty, chips: { half: chip('half', 1) } };
    const m = mergeWorkspace(local, ws({ chips: { half: chip('half', 4, board(nand('z'))) } }));
    expect(m.chips.half?.version).toBe(4);
    expect(m.chipsChanged).toEqual(['half']);
  });

  it('chips: id clash with different content gets a re-id copy, and boards follow the new id', () => {
    const local = { ...empty, chips: { half: chip('half', 1) } };
    const theirs = chip('half', 1, board(nand('other'), nand('two', 40)));
    const s = save('x', board(chipPart('u1', 'half')), undefined, { half: theirs });
    const m = mergeWorkspace(local, ws({ chips: { half: theirs }, saves: { x: s } }));
    expect(m.chips.half).toEqual(local.chips.half);
    expect(m.chips['half-copy']?.board).toEqual(theirs.board);
    const added = m.added.x!;
    expect(added.board.parts[0]?.chip).toBe('half-copy');
    expect(Object.keys(added.chips)).toEqual(['half-copy']);
  });

  it('chips embedded only in a save still join the library', () => {
    const s = save('x', board(chipPart('u1', 'adder')), undefined, { adder: chip('adder', 2) });
    const m = mergeWorkspace(empty, ws({ saves: { x: s } }));
    expect(m.chips.adder?.version).toBe(2);
    expect(m.chipsChanged).toEqual(['adder']);
  });
});
