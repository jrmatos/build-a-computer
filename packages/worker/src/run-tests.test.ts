import { describe, expect, it } from 'vitest';
import { Level, type Board, type TestSpec } from '@ground-up/schema';
import type { CaseResult } from '@ground-up/sim-logic';
import { SimHost } from './host';

const p = (id: string, type: Board['parts'][number]['type'], label?: string) => ({ id, type, x: 0, y: 0, rot: 0 as const, flip: false, ...(label ? { label } : {}) });
const w = (id: string, a: string, ap: string, b: string, bp: string) => ({ id, from: { part: a, pin: ap }, to: { part: b, pin: bp }, points: [] });

const toggle: Board = {
  parts: [p('clk', 'clock'), p('ff', 'dff'), p('n', 'not'), p('Q', 'lamp', 'Q')],
  wires: [w('w1', 'clk', 'out', 'ff', 'clk'), w('w2', 'ff', 'q', 'n', 'in'), w('w3', 'n', 'out', 'ff', 'd'), w('w4', 'ff', 'q', 'Q', 'in')],
};

const level = (tests: TestSpec[]): Level =>
  Level.parse({ id: 't', version: 1, track: 'sandbox', phase: 0, order: 0, title: 'T', goal: 'g', palette: [], starter: { parts: [], wires: [] }, tests });

describe('SimHost.runTests', () => {
  it('runs sequence tests and tags each case with its test index', async () => {
    const host = new SimHost();
    host.load(toggle);
    const seen: CaseResult[] = [];
    const res = await host.runTests(
      level([
        { kind: 'sequence', steps: [{ ticks: 2, expect: { Q: 1 } }, { power: 'cycle', ticks: 0, expect: { Q: 0 } }] },
        { kind: 'sequence', steps: [{ ticks: 2, expect: { Q: 0 } }] },
      ]),
      (r) => {
        seen.push(r);
      },
    );
    expect(res).toEqual({ passed: 2, total: 3 });
    expect(seen.map((c) => [c.test, c.step, c.pass])).toEqual([[0, 0, true], [0, 1, true], [1, 0, false]]);
  });

  it('a program test without the board fails with a message', async () => {
    const host = new SimHost();
    host.load(toggle);
    const seen: CaseResult[] = [];
    const res = await host.runTests(level([{ kind: 'program', program: '00', rom: 'ROM', halt: 'HALT', maxCycles: 10, expect: {} }]), (r) => {
      seen.push(r);
    });
    expect(res).toEqual({ passed: 0, total: 1 });
    expect(seen[0]!.message).toMatch(/board/);
  });

  it('a program test with the board but no ROM fails clearly', async () => {
    const host = new SimHost();
    host.load(toggle);
    const seen: CaseResult[] = [];
    await host.runTests(level([{ kind: 'program', program: '00', rom: 'ROM', halt: 'HALT', maxCycles: 10, expect: {} }]), (r) => {
      seen.push(r);
    }, toggle);
    expect(seen[0]!.message).toMatch(/no ROM labelled ROM/);
  });

  it('E-SIM-10: each test gets a wall-clock budget', async () => {
    let t = 0;
    const host = new SimHost(() => (t += 5), () => 0 as unknown as ReturnType<typeof setTimeout>);
    host.load(toggle);
    const seen: CaseResult[] = [];
    const res = await host.runTests(level([{ kind: 'sequence', steps: [{ ticks: 1_000_000, expect: { Q: 0 } }] }]), (r) => {
      seen.push(r);
    }, undefined, 1000);
    expect(res.passed).toBe(0);
    expect(seen[0]!.message).toMatch(/ran out of time/);
  });
});
