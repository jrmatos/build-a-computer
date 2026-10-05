import { describe, expect, it } from 'vitest';
import { levelById } from '@build-a-computer/content';
import type { Board } from '@build-a-computer/schema';
import { HISTORY_TICKS, SimHost } from './host';

const notBoard: Board = {
  parts: [
    { id: 'A', type: 'switch', x: 0, y: 0, rot: 0, flip: false, label: 'A' },
    { id: 'g', type: 'nand', x: 0, y: 0, rot: 0, flip: false },
    { id: 'Y', type: 'lamp', x: 0, y: 0, rot: 0, flip: false, label: 'Y' },
  ],
  wires: [
    { id: 'w1', from: { part: 'A', pin: 'out' }, to: { part: 'g', pin: 'a' }, points: [] },
    { id: 'w2', from: { part: 'A', pin: 'out' }, to: { part: 'g', pin: 'b' }, points: [] },
    { id: 'w3', from: { part: 'g', pin: 'out' }, to: { part: 'Y', pin: 'in' }, points: [] },
  ],
};

describe('SimHost', () => {
  it('a switch toggle updates its lamp in the next snapshot', () => {
    let clock = 0;
    const host = new SimHost(() => (clock += 100), () => 0 as unknown as ReturnType<typeof setTimeout>);
    const snaps: number[] = [];
    host.subscribe((s) => snaps.push(s.pins['Y:in'] ?? -1));
    host.load(notBoard);
    expect(snaps.at(-1)).toBe(1);
    host.setSwitch('A', true);
    expect(snaps.at(-1)).toBe(0);
    expect(host.snapshot().wires.w3).toBe(0);
  });

  it('keeps switch positions across reloads', () => {
    const host = new SimHost();
    host.load(notBoard);
    host.setSwitch('A', true);
    host.load(notBoard);
    expect(host.snapshot().switchesOn).toEqual(['A']);
  });

  it('runs level tests and streams each case', async () => {
    const host = new SimHost();
    host.load(notBoard);
    const seen: boolean[] = [];
    const res = await host.runTests(levelById('not-gate')!, (r) => {
      seen.push(r.pass);
    });
    expect(res).toEqual({ passed: 2, total: 2 });
    expect(seen).toEqual([true, true]);
  });
});

const part = (id: string, type: Board['parts'][number]['type'], props?: Board['parts'][number]['props']) => ({
  id, type, x: 0, y: 0, rot: 0 as const, flip: false, ...(props ? { props } : {}),
});
const wire = (id: string, from: string, to: string) => {
  const [fp, fpin] = from.split('.') as [string, string];
  const [tp, tpin] = to.split('.') as [string, string];
  return { id, from: { part: fp, pin: fpin }, to: { part: tp, pin: tpin }, points: [] };
};

describe('SimHost multi-bit', () => {
  const busBoard: Board = {
    parts: [part('A', 'switch', { width: 8 }), part('n', 'not', { width: 8 }), part('Y', 'lamp', { width: 8 }), part('B', 'button'), part('L', 'lamp')],
    wires: [wire('w1', 'A.out', 'n.in'), wire('w2', 'n.out', 'Y.in'), wire('w3', 'B.out', 'L.in')],
  };

  it('setValue and press drive buses and buttons; snapshots carry bus values', () => {
    const host = new SimHost();
    expect(host.load(busBoard).ok).toBe(true);
    host.setValue('A', 0x0f);
    let s = host.snapshot();
    expect(s.buses.w1).toEqual({ w: 8, v: 0x0f, x: 0 });
    expect(s.buses.w2).toEqual({ w: 8, v: 0xf0, x: 0 });
    expect(s.busPins['Y:in']).toEqual({ w: 8, v: 0xf0, x: 0 });
    expect(s.switchValues).toEqual({ A: 0x0f });
    expect(s.wires.w2).toBe(1);
    expect(s.buses.w3).toBeUndefined();
    host.press('B', true);
    s = host.snapshot();
    expect(s.wires.w3).toBe(1);
    expect(s.switchesOn).toContain('B');
    host.press('B', false);
    expect(host.snapshot().wires.w3).toBe(0);
    // Values survive a reload.
    host.load(busBoard);
    expect(host.snapshot().switchValues).toEqual({ A: 0x0f });
  });

  it('a bus summary is 2 when bits are X and none is 1', () => {
    const host = new SimHost();
    host.load({ parts: [part('n', 'not', { width: 4 }), part('Y', 'lamp', { width: 4 })], wires: [wire('w', 'n.out', 'Y.in')] });
    expect(host.snapshot().wires.w).toBe(2);
  });

  it('E-SIM-04: a width mismatch fails the load with the diagnostic', () => {
    const host = new SimHost();
    const r = host.load({ parts: [part('A', 'switch', { width: 8 }), part('Y', 'lamp', { width: 4 })], wires: [wire('w', 'A.out', 'Y.in')] });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({ code: 'width-mismatch', pins: ['A:out', 'Y:in'] });
    expect(host.snapshot().powered).toBe(false);
  });

  it('watch records watched wires every tick in a ring buffer of 4,096', () => {
    const host = new SimHost();
    host.load({ parts: [part('C', 'clock'), part('L', 'lamp')], wires: [wire('c', 'C.out', 'L.in')] });
    host.watch(['c', 'missing']);
    host.step(5000);
    const h = host.history();
    expect(h.ticks.length).toBe(HISTORY_TICKS);
    expect(h.ticks[0]).toBe(5000 - HISTORY_TICKS + 1);
    expect(h.ticks.at(-1)).toBe(5000);
    expect(h.values.c!.at(-1)).toEqual({ w: 1, v: 0, x: 0 });
    expect(h.values.c!.at(-2)).toEqual({ w: 1, v: 1, x: 0 });
    expect(h.values.missing).toBeUndefined();
  });

  it('memory shows a register, and the level power mode is used', () => {
    const board: Board = { parts: [part('r', 'register', { width: 32 })], wires: [] };
    const host = new SimHost();
    host.load(board, {}, { power: 'random', seed: 9 });
    const [v] = host.memory('r');
    expect(v).not.toBe(0);
    host.load(board);
    expect(host.memory('r')).toEqual([0]);
  });

  it('snapshots stay cheap for a 5,000-part board', () => {
    const parts = [part('A', 'switch', { width: 8 })];
    const wires = [];
    for (let i = 0; i < 5000; i++) {
      parts.push(part(`g${i}`, i % 2 ? 'not' : 'xor', { width: i % 3 ? 1 : 8 }));
    }
    for (let i = 0; i < 5000; i++) if (i % 3 === 0) wires.push(wire(`w${i}`, 'A.out', `g${i}.${i % 2 ? 'in' : 'a'}`));
    const host = new SimHost();
    expect(host.load({ parts, wires }).ok).toBe(true);
    host.snapshot();
    // Best of 10: a parallel test run can stall any single sample; the budget is about the code.
    let ms = Infinity;
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      host.snapshot();
      ms = Math.min(ms, performance.now() - t0);
    }
    expect(ms).toBeLessThan(16);
  });
});
