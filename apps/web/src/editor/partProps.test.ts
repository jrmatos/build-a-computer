import { describe, expect, it } from 'vitest';
import type { Board, ChipDef, Part } from '@build-a-computer/schema';
import { applyProps, canPlaceChip, chipUses, defaultProps, describeWire, memorySize, validateProps } from './partProps';

const part = (id: string, type: Part['type'], props?: Part['props'], extra: Partial<Part> = {}): Part => ({
  id,
  type,
  x: 0,
  y: 0,
  rot: 0,
  flip: false,
  ...(props ? { props } : {}),
  ...extra,
});

const wire = (id: string, from: [string, string], to: [string, string]) => ({
  id,
  from: { part: from[0], pin: from[1] },
  to: { part: to[0], pin: to[1] },
  points: [] as [number, number][],
});

describe('defaultProps', () => {
  it('copies PART_INFO defaults per type', () => {
    expect(defaultProps('nand')).toEqual({ width: 1 });
    expect(defaultProps('splitter')).toEqual({ width: 8, chunk: 1 });
    expect(defaultProps('rom')).toEqual({ width: 8, addrWidth: 4, data: '' });
    expect(defaultProps('lamp')).toEqual({ width: 1, format: 'hex' });
  });
});

describe('validateProps', () => {
  it('checks ranges', () => {
    expect(validateProps('and', { width: 0 })?.key).toBe('props.err.range');
    expect(validateProps('and', { width: 33 })?.key).toBe('props.err.range');
    expect(validateProps('and', { width: 32 })).toBeNull();
    expect(validateProps('decoder', { selectBits: 6 })?.key).toBe('props.err.range');
    expect(validateProps('ram', { addrWidth: 17 })?.key).toBe('props.err.range');
  });
  it('requires splitter width to be a multiple of chunk', () => {
    expect(validateProps('splitter', { width: 8, chunk: 3 })?.key).toBe('props.err.chunk');
    expect(validateProps('joiner', { width: 8, chunk: 4 })).toBeNull();
    expect(validateProps('splitter', { width: 4, chunk: 8 })?.key).toBe('props.err.chunk');
  });
});

describe('applyProps', () => {
  const board: Board = {
    parts: [part('s', 'splitter', { width: 8, chunk: 1 }), part('l0', 'lamp'), part('l7', 'lamp'), part('sw', 'switch', { width: 8 })],
    wires: [wire('w0', ['s', 'o0'], ['l0', 'in']), wire('w7', ['s', 'o7'], ['l7', 'in']), wire('win', ['sw', 'out'], ['s', 'in'])],
  };

  it('drops wires to pins that vanish, in one result', () => {
    const r = applyProps(board, new Set(['s']), { chunk: 4 });
    // chunk 4 → pins o0, o1: o7 is gone, o0 stays.
    expect(r.dropped.map((w) => w.id)).toEqual(['w7']);
    expect(r.board.wires.map((w) => w.id)).toEqual(['w0', 'win']);
    expect(r.board.parts[0]!.props).toEqual({ width: 8, chunk: 4 });
  });

  it('keeps every wire when pins stay (width change only)', () => {
    const r = applyProps(board, new Set(['sw']), { width: 16 });
    expect(r.dropped).toEqual([]);
    expect(r.board.parts[3]!.props?.width).toBe(16);
  });

  it('rejects invalid combinations and leaves the board alone', () => {
    const r = applyProps(board, new Set(['s']), { chunk: 3 });
    expect(r.rejected).toEqual(['s']);
    expect(r.board).toBe(board);
  });

  it('returns the same board when nothing changes', () => {
    expect(applyProps(board, new Set(['s']), { width: 8 }).board).toBe(board);
  });

  it('edits every selected part of the same type and skips locked ones', () => {
    const b: Board = { parts: [part('a', 'and'), part('b', 'and'), part('c', 'and', undefined, { locked: true })], wires: [] };
    const r = applyProps(b, new Set(['a', 'b', 'c']), { width: 4 });
    expect(r.board.parts.map((p) => p.props?.width)).toEqual([4, 4, undefined]);
  });

  it('masks a const value to its new width', () => {
    const b: Board = { parts: [part('k', 'const', { width: 8, value: 0xff })], wires: [] };
    expect(applyProps(b, new Set(['k']), { width: 4 }).board.parts[0]!.props?.value).toBe(0xf);
  });

  it('drops decoder outputs when select bits shrink', () => {
    const b: Board = {
      parts: [part('d', 'decoder', { width: 1, selectBits: 3 }), part('l', 'lamp')],
      wires: [wire('w', ['d', 'o6'], ['l', 'in'])],
    };
    const r = applyProps(b, new Set(['d']), { selectBits: 2 });
    expect(r.dropped.map((w) => w.id)).toEqual(['w']);
    expect(describeWire(b, r.dropped[0]!)).toBe('decoder.o6 → lamp.in');
  });
});

describe('memorySize', () => {
  it('counts words and bytes', () => {
    expect(memorySize(8, 4)).toEqual({ words: 16, bytes: 16 });
    expect(memorySize(32, 16)).toEqual({ words: 65536, bytes: 262144 });
  });
});

describe('chip recursion', () => {
  const def = (id: string, inner: string[]): ChipDef => ({
    id,
    name: id,
    version: 1,
    board: { parts: inner.map((c, i) => part(`p${i}`, 'chip', undefined, { chip: c })), wires: [] },
    ports: { inputs: [], outputs: [] },
  });
  const chips = { a: def('a', []), b: def('b', ['a']), c: def('c', ['b']) };
  it('E-SIM-05: a chip cannot be placed inside itself, directly or indirectly', () => {
    expect(chipUses(chips, 'c', 'a')).toBe(true);
    expect(chipUses(chips, 'a', 'c')).toBe(false);
    expect(canPlaceChip(chips, 'a', [])).toBe(true);
    expect(canPlaceChip(chips, 'a', ['a'])).toBe(false);
    expect(canPlaceChip(chips, 'c', ['a'])).toBe(false);
    expect(canPlaceChip(chips, 'a', ['c'])).toBe(true);
    expect(canPlaceChip(chips, 'missing', [])).toBe(false);
  });
});
