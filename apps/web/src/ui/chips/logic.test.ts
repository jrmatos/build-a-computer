import { describe, expect, it } from 'vitest';
import type { Board, ChipDef, ChipMap, Part } from '@build-a-computer/schema';
import {
  copyName,
  mergeChips,
  portCandidates,
  pruneChipWires,
  remapBoardChips,
  stableStringify,
  syncPorts,
} from './logic';

const part = (
  id: string,
  type: Part['type'],
  x: number,
  y: number,
  extra: Partial<Part> = {},
): Part => ({
  id,
  type,
  x,
  y,
  rot: 0,
  flip: false,
  ...extra,
});

/** a, b -> NAND -> out */
function nandBoard(): Board {
  return {
    parts: [
      part('a', 'switch', 0, 0, { label: 'a' }),
      part('b', 'switch', 0, 4, { label: 'b' }),
      part('g', 'nand', 4, 1),
      part('o', 'lamp', 9, 2, { label: 'out' }),
    ],
    wires: [
      { id: 'w1', from: { part: 'a', pin: 'out' }, to: { part: 'g', pin: 'a' }, points: [] },
      { id: 'w2', from: { part: 'b', pin: 'out' }, to: { part: 'g', pin: 'b' }, points: [] },
      { id: 'w3', from: { part: 'g', pin: 'out' }, to: { part: 'o', pin: 'in' }, points: [] },
    ],
  };
}

const chip = (id: string, extra: Partial<ChipDef> = {}): ChipDef => ({
  id,
  name: id,
  version: 1,
  board: nandBoard(),
  ports: { inputs: ['a', 'b'], outputs: ['o'] },
  ...extra,
});

describe('chip ports', () => {
  it('lists switches and lamps top to bottom', () => {
    const b = nandBoard();
    b.parts.push(part('c', 'switch', 0, -3));
    const c = portCandidates(b);
    expect(c.inputs.map((p) => p.id)).toEqual(['c', 'a', 'b']);
    expect(c.outputs.map((p) => p.id)).toEqual(['o']);
  });

  it('keeps the chosen order, drops removed ports and appends new ones', () => {
    const b = nandBoard();
    b.parts = b.parts.filter((p) => p.id !== 'a');
    b.parts.push(part('z', 'switch', 0, 9), part('o2', 'lamp', 9, 9));
    expect(syncPorts({ inputs: ['b', 'a'], outputs: ['o'] }, b)).toEqual({
      inputs: ['b', 'z'],
      outputs: ['o', 'o2'],
    });
    const same = { inputs: ['b', 'a'], outputs: ['o'] };
    expect(syncPorts(same, nandBoard())).toBe(same);
  });
});

describe('pruning wires to chip pins', () => {
  it('CHIP-02: drops wires to pins the definition no longer has, naming them', () => {
    const def = chip('half');
    const chips: ChipMap = { half: def };
    const board: Board = {
      parts: [
        part('s', 'switch', 0, 0),
        part('i', 'chip', 4, 0, { chip: 'half' }),
        part('l', 'lamp', 12, 0),
      ],
      wires: [
        { id: 'x1', from: { part: 's', pin: 'out' }, to: { part: 'i', pin: 'a' }, points: [] },
        { id: 'x2', from: { part: 'i', pin: 'out' }, to: { part: 'l', pin: 'in' }, points: [] },
      ],
    };
    expect(pruneChipWires(board, chips).dropped).toEqual([]);
    // Rename the "a" port: the pin is now called "x".
    const renamed: ChipMap = {
      half: {
        ...def,
        board: {
          ...def.board,
          parts: def.board.parts.map((p) => (p.id === 'a' ? { ...p, label: 'x' } : p)),
        },
      },
    };
    const r = pruneChipWires(board, renamed);
    expect(r.board.wires.map((w) => w.id)).toEqual(['x2']);
    expect(r.dropped.map((d) => d.end)).toEqual(['half.a']);
  });

  it('leaves instances of unknown chips alone', () => {
    const board: Board = {
      parts: [part('s', 'switch', 0, 0), part('i', 'chip', 4, 0, { chip: 'gone' })],
      wires: [
        { id: 'x1', from: { part: 's', pin: 'out' }, to: { part: 'i', pin: 'a' }, points: [] },
      ],
    };
    expect(pruneChipWires(board, {}).board).toBe(board);
  });
});

describe('merging imported chips', () => {
  it('adds unknown chips', () => {
    const r = mergeChips({}, { a: chip('a') });
    expect(Object.keys(r.chips)).toEqual(['a']);
    expect(r.changed).toEqual(['a']);
  });

  it('never overwrites a newer local version', () => {
    const local = { a: chip('a', { version: 5, name: 'Local' }) };
    const r = mergeChips(local, { a: chip('a', { version: 3, name: 'Old' }) });
    expect(r.chips.a!.name).toBe('Local');
    expect(r.changed).toEqual([]);
  });

  it('takes a higher imported version', () => {
    const r = mergeChips({ a: chip('a') }, { a: chip('a', { version: 4, name: 'New' }) });
    expect(r.chips.a!.name).toBe('New');
  });

  it('keeps both when the same id and version differ, re-iding the imported one and its references', () => {
    const user = chip('user', {
      board: { parts: [part('i', 'chip', 0, 0, { chip: 'a' })], wires: [] },
      ports: { inputs: [], outputs: [] },
    });
    const r = mergeChips(
      { a: chip('a', { name: 'Mine' }) },
      { a: chip('a', { name: 'Theirs' }), user },
    );
    const newId = r.remap.get('a')!;
    expect(newId).toBe('a-copy');
    expect(r.chips.a!.name).toBe('Mine');
    expect(r.chips[newId]!.name).toBe('Theirs');
    expect(r.chips.user!.board.parts[0]!.chip).toBe(newId);
  });

  it('identical content with keys in another order is not a conflict', () => {
    const a = chip('a');
    const shuffled = JSON.parse(stableStringify(a)) as ChipDef;
    expect(mergeChips({ a }, { a: shuffled }).changed).toEqual([]);
  });

  it('rewrites board references', () => {
    const b: Board = { parts: [part('i', 'chip', 0, 0, { chip: 'a' })], wires: [] };
    expect(remapBoardChips(b, new Map([['a', 'b']])).parts[0]!.chip).toBe('b');
    expect(remapBoardChips(b, new Map())).toBe(b);
  });
});

it('copy names do not collide', () => {
  const chips = { a: chip('a', { name: 'Adder' }), b: chip('b', { name: 'Adder (copy)' }) };
  expect(copyName('Adder', chips)).toBe('Adder (copy 2)');
});
