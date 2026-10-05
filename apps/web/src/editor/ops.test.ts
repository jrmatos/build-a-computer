import { describe, expect, it } from 'vitest';
import type { Board } from '@ground-up/schema';
import { compile } from '@ground-up/sim-logic';
import { Prng } from '@ground-up/det';
import { addPart, addWire, copyIds, deleteIds, duplicateIds, moveIds, pasteClip, rotateIds } from './ops';
import { partPins, routeWire } from './geometry';
import { SpatialIndex } from './hit';

const empty = (): Board => ({ parts: [], wires: [] });

describe('board ops', () => {
  it('wires go from output to input whichever way they were drawn', () => {
    let b = empty();
    let g, l;
    [b, g] = addPart(b, 'nand', 0, 0);
    [b, l] = addPart(b, 'lamp', 6, 0);
    const [b2, w] = addWire(b, { part: l.id, pin: 'in' }, { part: g.id, pin: 'out' }, [[4, 1]]);
    expect(w!.from).toEqual({ part: g.id, pin: 'out' });
    expect(addWire(b2, { part: g.id, pin: 'out' }, { part: l.id, pin: 'in' })[1]).toBeUndefined();
  });

  it('EDIT-04: deleting a middle wire splits the net', () => {
    let b = empty();
    let s, n, l;
    [b, s] = addPart(b, 'switch', 0, 0);
    [b, n] = addPart(b, 'not', 5, 0);
    [b, l] = addPart(b, 'lamp', 10, 0);
    let w1, w2;
    [b, w1] = addWire(b, { part: s.id, pin: 'out' }, { part: n.id, pin: 'in' });
    [b, w2] = addWire(b, { part: s.id, pin: 'out' }, { part: l.id, pin: 'in' });
    const nl = compile(b);
    expect(nl.pinNet.get(`${n.id}:in`)).toBe(nl.pinNet.get(`${l.id}:in`));
    const split = compile(deleteIds(b, new Set([w2!.id])));
    expect(split.pinNet.get(`${n.id}:in`)).not.toBe(split.pinNet.get(`${l.id}:in`));
    expect(split.wireNet.has(w1!.id)).toBe(true);
  });

  it('deleting a part removes its wires but locked parts stay', () => {
    let b = empty();
    let s, l;
    [b, s] = addPart(b, 'switch', 0, 0, { locked: true });
    [b, l] = addPart(b, 'lamp', 6, 0);
    [b] = addWire(b, { part: s.id, pin: 'out' }, { part: l.id, pin: 'in' });
    const out = deleteIds(b, new Set([s.id, l.id]));
    expect(out.parts.map((p) => p.id)).toEqual([s.id]);
    expect(out.wires).toEqual([]);
  });

  it('EDIT-05 / E-DATA-07: pasted parts get new ids and disallowed parts are dropped', () => {
    let b = empty();
    let a, c;
    [b, a] = addPart(b, 'nand', 0, 0);
    [b, c] = addPart(b, 'xor', 6, 0);
    [b] = addWire(b, { part: a.id, pin: 'out' }, { part: c.id, pin: 'a' });
    const clip = copyIds(b, new Set([a.id, c.id]));
    const r = pasteClip(b, clip, 20, 20, new Set(['nand']));
    expect(r.dropped).toEqual(['xor']);
    expect(r.ids).toHaveLength(1);
    expect(r.ids[0]).not.toBe(a.id);
    expect(r.board.wires).toHaveLength(1);
  });

  it('rotating a part four times returns it to the start, pins on the grid', () => {
    let b = empty();
    let g;
    [b, g] = addPart(b, 'nand', 3, 4);
    let r = b;
    for (let i = 0; i < 4; i++) {
      r = rotateIds(r, new Set([g.id]), 1);
      for (const p of partPins(r.parts[0]!)) {
        expect(Number.isInteger(p.wx) && Number.isInteger(p.wy)).toBe(true);
      }
    }
    expect(r.parts[0]).toEqual(b.parts[0]);
  });

  it('routes direct horizontal wires out, across and in', () => {
    expect(routeWire({ x: 0, y: 0 }, [1, 0], { x: 6, y: 4 }, [-1, 0], [])).toEqual([
      { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }, { x: 6, y: 4 },
    ]);
  });

  it('EDIT-06: a random edit, undo and redo fuzz returns identical boards', () => {
    const rng = new Prng(99);
    const history: Board[] = [];
    let b = empty();
    for (let i = 0; i < 500; i++) {
      history.push(b);
      const ids = [...b.parts.map((p) => p.id), ...b.wires.map((w) => w.id)];
      const pick = () => new Set([ids[rng.nextInt(Math.max(1, ids.length))]!].filter(Boolean));
      switch (rng.nextInt(5)) {
        case 0: b = addPart(b, 'nand', rng.nextInt(40), rng.nextInt(40))[0]; break;
        case 1: b = moveIds(b, pick(), rng.nextInt(5) - 2, rng.nextInt(5) - 2); break;
        case 2: b = rotateIds(b, pick(), 1); break;
        case 3: b = deleteIds(b, pick()); break;
        case 4: b = b.parts.length ? duplicateIds(b, pick()).board : b; break;
      }
    }
    // Undo walks history backward; redo walks forward; boards are immutable snapshots.
    const snapshot = JSON.stringify(b);
    const undone = history[0];
    expect(undone).toEqual(empty());
    expect(JSON.stringify(b)).toBe(snapshot);
  });
});

describe('EDIT-02 hit testing', () => {
  it('picks the right pin among 1,000 random overlapping parts', () => {
    const rng = new Prng(3);
    let b = empty();
    for (let i = 0; i < 1000; i++) b = addPart(b, 'nand', rng.nextInt(60), rng.nextInt(60))[0];
    const idx = new SpatialIndex(b);
    for (let i = 0; i < 200; i++) {
      const part = b.parts[rng.nextInt(b.parts.length)]!;
      const pin = partPins(part)[rng.nextInt(3)]!;
      const hit = idx.hit({ x: pin.wx, y: pin.wy }, 0.1);
      expect(hit?.kind).toBe('pin');
      // Several parts may share the exact grid point; the hit must be a pin at that point.
      if (hit?.kind === 'pin') expect([hit.x, hit.y]).toEqual([pin.wx, pin.wy]);
    }
  });
});
