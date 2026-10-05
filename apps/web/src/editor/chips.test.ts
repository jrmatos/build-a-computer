import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Board, Part } from '@ground-up/schema';
import { pinsOf } from '@ground-up/sim-logic';
import {
  deleteChip,
  duplicateChip,
  enterChip,
  exitChip,
  makeChip,
  openChipDef,
  placeChip,
  renameChip,
  rootBoard,
  startChipLibrary,
} from './chips';
import { getChipRegistry } from './parts';
import { useEditor } from './store';

const part = (
  id: string,
  type: Part['type'],
  x: number,
  y: number,
  extra: Partial<Part> = {},
): Part => ({ id, type, x, y, rot: 0, flip: false, ...extra });

function notBoard(): Board {
  return {
    parts: [
      part('in', 'switch', 0, 0, { label: 'a' }),
      part('n', 'not', 4, 0),
      part('out', 'lamp', 8, 0, { label: 'y' }),
    ],
    wires: [
      { id: 'w1', from: { part: 'in', pin: 'out' }, to: { part: 'n', pin: 'in' }, points: [] },
      { id: 'w2', from: { part: 'n', pin: 'out' }, to: { part: 'out', pin: 'in' }, points: [] },
    ],
  };
}

const st = () => useEditor.getState();

beforeAll(async () => {
  await startChipLibrary();
});

beforeEach(() => {
  if (st().editStack.length) exitChip(0);
  st().set({
    board: notBoard(),
    past: [],
    future: [],
    selection: [],
    chips: {},
    readOnly: false,
    toasts: [],
    level: null,
  });
});

describe('make chip (CHIP-01)', () => {
  it('turns the board into a chip with ports in the chosen order and registers its pins', () => {
    const def = makeChip({ name: 'Inverter', inputs: ['in'], outputs: ['out'], color: '#fa5252' })!;
    expect(def.id).toBe('chip-inverter');
    expect(st().chips[def.id]).toBe(def);
    expect(getChipRegistry()[def.id]).toBe(def);
    const id = placeChip(def.id, { x: 20, y: 0 })!;
    const inst = st().board.parts.find((p) => p.id === id)!;
    expect(pinsOf(inst, st().chips).map((p) => p.name)).toEqual(['a', 'y']);
  });

  it('renaming keeps references (ids)', () => {
    const def = makeChip({ name: 'Inverter', inputs: ['in'], outputs: ['out'] })!;
    const id = placeChip(def.id)!;
    renameChip(def.id, 'NOT gate');
    expect(st().chips[def.id]!.name).toBe('NOT gate');
    expect(st().board.parts.find((p) => p.id === id)!.chip).toBe(def.id);
  });
});

describe('enter and exit (CHIP-02)', () => {
  it('editing inside a chip updates the definition and drops wires to removed pins on exit', () => {
    const def = makeChip({ name: 'Inv', inputs: ['in'], outputs: ['out'] })!;
    // Level board: switch -> chip -> lamp.
    st().set({
      board: {
        parts: [
          part('s', 'switch', 0, 0),
          part('c', 'chip', 4, 0, { chip: def.id }),
          part('l', 'lamp', 14, 0),
        ],
        wires: [
          { id: 'x1', from: { part: 's', pin: 'out' }, to: { part: 'c', pin: 'a' }, points: [] },
          { id: 'x2', from: { part: 'c', pin: 'y' }, to: { part: 'l', pin: 'in' }, points: [] },
        ],
      },
    });
    const level = st().board;
    enterChip('c');
    expect(st().editStack.map((f) => f.chipId)).toEqual([def.id]);
    expect(st().board).toBe(def.board);
    expect(rootBoard()).toBe(level);
    // Rename the input port "a" -> "x".
    st().commit((b) => ({
      ...b,
      parts: b.parts.map((p) => (p.id === 'in' ? { ...p, label: 'x' } : p)),
    }));
    const after = st().chips[def.id]!;
    expect(after.version).toBeGreaterThan(def.version);
    expect(after.board).toBe(st().board);
    exitChip(0);
    expect(st().editStack).toEqual([]);
    expect(st().board.wires.map((w) => w.id)).toEqual(['x2']);
    expect(st().toasts.some((t) => t.text.includes('c.a') || t.text.includes('Inv.a'))).toBe(true);
    // The pruning is one undoable step.
    st().undo();
    expect(st().board).toBe(level);
  });

  it('new switches inside a chip become new ports', () => {
    const def = makeChip({ name: 'Inv', inputs: ['in'], outputs: ['out'] })!;
    openChipDef(def.id);
    st().commit((b) => ({
      ...b,
      parts: [...b.parts, part('in2', 'switch', 0, 6, { label: 'b' })],
    }));
    expect(st().chips[def.id]!.ports.inputs).toEqual(['in', 'in2']);
    exitChip(0);
  });

  it('E-SIM-05: placing a chip inside itself, directly or indirectly, is blocked', () => {
    const inner = makeChip({ name: 'Inner', inputs: ['in'], outputs: ['out'] })!;
    // Outer contains Inner.
    st().set({
      board: {
        parts: [...notBoard().parts, part('ci', 'chip', 0, 10, { chip: inner.id })],
        wires: notBoard().wires,
      },
    });
    const outer = makeChip({ name: 'Outer', inputs: ['in'], outputs: ['out'] })!;
    openChipDef(inner.id);
    expect(placeChip(inner.id)).toBeNull();
    expect(placeChip(outer.id)).toBeNull();
    expect(st().toasts.at(-1)?.tone).toBe('error');
    // A paste that sneaks one in is undone.
    const before = st().chips[inner.id]!.board;
    st().commit((b) => ({
      ...b,
      parts: [...b.parts, part('sneak', 'chip', 0, 20, { chip: outer.id })],
    }));
    expect(st().board).toBe(before);
    expect(st().chips[inner.id]!.board).toBe(before);
    exitChip(0);
  });
});

describe('delete (E-DATA-08)', () => {
  it('E-DATA-08: deleting leaves a tombstone so boards using the chip still load', () => {
    const def = makeChip({ name: 'Inv', inputs: ['in'], outputs: ['out'] })!;
    const id = placeChip(def.id)!;
    expect(deleteChip(def.id)).toBe(true);
    expect(st().chips[def.id]!.deleted).toBe(true);
    const inst = st().board.parts.find((p) => p.id === id)!;
    expect(pinsOf(inst, st().chips)).toHaveLength(2);
    expect(placeChip(def.id)).toBeNull();
  });

  it('duplicate gets a new id and name', () => {
    const def = makeChip({ name: 'Inv', inputs: ['in'], outputs: ['out'] })!;
    const copy = duplicateChip(def.id)!;
    expect(copy.id).not.toBe(def.id);
    expect(copy.name).toBe('Inv (copy)');
  });
});
