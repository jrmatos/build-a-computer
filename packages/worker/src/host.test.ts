import { describe, expect, it } from 'vitest';
import { levelById } from '@ground-up/content';
import type { Board } from '@ground-up/schema';
import { SimHost } from './host';

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
