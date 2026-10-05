import { describe, expect, it } from 'vitest';
import type { Board, Level } from '@build-a-computer/schema';
import { SimHost } from './host';

const p = (id: string, type: Board['parts'][number]['type'], label?: string): Board['parts'][number] => ({ id, type, x: 0, y: 0, rot: 0, flip: false, ...(label ? { label } : {}) });
const w = (id: string, a: string, ap: string, b: string, bp: string) => ({ id, from: { part: a, pin: ap }, to: { part: b, pin: bp }, points: [] });

/** Q follows D on the rising clock edge. */
const dBoard: Board = {
  parts: [p('clk', 'clock'), p('D', 'switch', 'D'), p('ff', 'dff'), p('Q', 'lamp', 'Q')],
  wires: [w('w1', 'clk', 'out', 'ff', 'clk'), w('w2', 'D', 'out', 'ff', 'd'), w('w3', 'ff', 'q', 'Q', 'in')],
};

const level = {
  id: 'dbg',
  power: 'zero',
  tests: [{ kind: 'sequence', steps: [{ set: { D: 1 }, ticks: 2, expect: { Q: 1 } }, { set: { D: 0 }, ticks: 2, expect: { Q: 1 } }] }],
} as unknown as Level;

describe('SimHost case debugger', () => {
  it('records the case, leaves the live board at its checkpoint, and seeks', () => {
    const host = new SimHost(() => 0, () => 0 as unknown as ReturnType<typeof setTimeout>);
    host.load(dBoard);
    const r = host.debugStart(level, 0, 1, undefined, dBoard);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trace.checks.map((c) => c.pass)).toEqual([true, false]);
    expect(r.frame).toBe(6);
    expect(host.snapshot().pins['Q:in']).toBe(0);
    expect(host.debugSeek(3)).toEqual({ frame: 3, tick: 2 });
    expect(host.snapshot().pins['Q:in']).toBe(1);
    expect(host.snapshot().switchesOn).toContain('D');
  });

  it('watching wires replays the case so the waveform has it', () => {
    const host = new SimHost(() => 0, () => 0 as unknown as ReturnType<typeof setTimeout>);
    host.load(dBoard);
    host.debugStart(level, 0, 1, undefined, dBoard);
    host.watch(['w3']);
    expect(host.history().values.w3!.map((v) => v.v)).toEqual([1, 1, 0, 0]);
    host.debugEnd();
    host.watch(['w3']);
    expect(host.history().ticks).toEqual([]);
  });

  it('reports a bad test index', () => {
    const host = new SimHost();
    host.load(dBoard);
    expect(host.debugStart(level, 4, 0)).toEqual({ ok: false, error: 'This test does not exist.' });
  });
});
