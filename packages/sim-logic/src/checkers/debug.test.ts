import type { Board, Part, TestSpec } from '@build-a-computer/schema';
import { describe, expect, it } from 'vitest';
import { compile, type Netlist } from '../compile';
import { FastEngine } from '../fast-engine';
import { Rig, debugPlan, loadProgram, runTest, stepCase, type DebugPlan } from '../checkers';

const part = (id: string, type: Part['type'], extra: Partial<Part> = {}): Part => ({ id, type, x: 0, y: 0, rot: 0, flip: false, ...extra });
const wire = (id: string, a: string, ap: string, b: string, bp: string) => ({ id, from: { part: a, pin: ap }, to: { part: b, pin: bp }, points: [] });

const gateBoard = (gate: Part['type']): Board => ({
  parts: [part('A', 'switch', { label: 'A' }), part('B', 'switch', { label: 'B' }), part('g', gate), part('Y', 'lamp', { label: 'Y' })],
  wires: [wire('w1', 'A', 'out', 'g', 'a'), wire('w2', 'B', 'out', 'g', 'b'), wire('w3', 'g', 'out', 'Y', 'in')],
});

/** Q follows D on the rising edge. */
const dBoard: Board = {
  parts: [part('clk', 'clock'), part('D', 'switch', { label: 'D' }), part('ff', 'dff'), part('Q', 'lamp', { label: 'Q' })],
  wires: [wire('w1', 'clk', 'out', 'ff', 'clk'), wire('w2', 'D', 'out', 'ff', 'd'), wire('w3', 'ff', 'q', 'Q', 'in')],
};

const fast = () => ({ createEngine: (nl: Netlist) => new FastEngine(nl) });

function trace(board: Board, test: TestSpec, index: number, inputs?: Record<string, number>, until?: number) {
  const plan = debugPlan(test, index, inputs) as DebugPlan;
  const rig = new Rig(compile(board), fast());
  return stepCase(rig, plan, until === undefined ? {} : { until });
}

const xorTable: TestSpec = {
  kind: 'truth-table',
  rows: [
    { inputs: { A: 0, B: 0 }, expect: { Y: 0 } },
    { inputs: { A: 1, B: 0 }, expect: { Y: 1 } },
    { inputs: { A: 0, B: 1 }, expect: { Y: 1 } },
    { inputs: { A: 1, B: 1 }, expect: { Y: 0 } },
  ],
};

describe('debugPlan', () => {
  it('truth table: power, set, check', () => {
    const plan = debugPlan(xorTable, 1) as DebugPlan;
    expect(plan.ops).toEqual([{ op: 'power' }, { op: 'set', inputs: { A: 1, B: 0 }, step: 0 }, { op: 'check', step: 0, expect: { Y: 1 } }]);
    expect(plan.inputs).toEqual(['A', 'B']);
    expect(plan.outputs).toEqual(['Y']);
  });

  it('exhaustive needs the case inputs', () => {
    const t: TestSpec = { kind: 'exhaustive', inputs: ['A'], outputs: ['Y'], reference: 'nope' };
    expect(debugPlan(t, 0)).toHaveProperty('error');
  });

  it('sequence: every step, focus on the requested one, power cycles kept', () => {
    const t: TestSpec = {
      kind: 'sequence',
      steps: [{ set: { D: 1 }, ticks: 2, expect: { Q: 1 } }, { power: 'cycle', ticks: 0, expect: { Q: 0 } }],
    };
    const plan = debugPlan(t, 1) as DebugPlan;
    expect(plan.focus).toBe(1);
    expect(plan.ops.map((o) => o.op)).toEqual(['power', 'set', 'tick', 'check', 'cycle', 'check']);
  });

  it('out of range and non-board tests are errors', () => {
    expect(debugPlan(xorTable, 9)).toHaveProperty('error');
    expect(debugPlan({ kind: 'js', entry: 'main', call: [] } as unknown as TestSpec, 0)).toHaveProperty('error');
  });
});

describe('stepCase', () => {
  it('matches the checker on every truth-table row (passing and failing boards)', () => {
    for (const gate of ['xor', 'or'] as const) {
      const board = gateBoard(gate);
      const results = [...runTest(compile(board), xorTable, fast())];
      results.forEach((r, i) => {
        const { trace: tr } = trace(board, xorTable, i);
        const c = tr.checks[tr.focus]!;
        expect(c.pass).toBe(r.pass);
        expect(c.actual).toEqual(r.actualNum);
      });
    }
  });

  it('records a frame per power-on, set and tick, with series values', () => {
    const t: TestSpec = { kind: 'sequence', steps: [{ set: { D: 1 }, ticks: 2, expect: { Q: 1 } }, { set: { D: 0 }, ticks: 2, expect: { Q: 0 } }] };
    const { trace: tr } = trace(dBoard, t, 1);
    expect(tr.frames.map((f) => f.cause)).toEqual(['power', 'set', 'tick', 'tick', 'set', 'tick', 'tick']);
    expect(tr.frames.map((f) => f.tick)).toEqual([0, 0, 1, 2, 2, 3, 4]);
    expect(tr.checks.map((c) => c.frame)).toEqual([3, 6]);
    expect(tr.series.D).toEqual([0, 1, 1, 1, 0, 0, 0]);
    expect(tr.series.Q![3]).toBe(1);
    expect(tr.series.Q![6]).toBe(0);
    const results = [...runTest(compile(dBoard), t, fast())];
    expect(tr.checks.map((c) => c.pass)).toEqual(results.map((r) => r.pass));
  });

  it('stops at `until` and leaves the engine there', () => {
    const t: TestSpec = { kind: 'sequence', steps: [{ set: { D: 1 }, ticks: 4, expect: { Q: 1 } }] };
    const plan = debugPlan(t, 0) as DebugPlan;
    const rig = new Rig(compile(dBoard), fast());
    const r = stepCase(rig, plan, { until: 2, record: false });
    expect(r.frame).toBe(2);
    expect(r.trace.frames).toEqual([]);
    expect(rig.read('Q')?.v).toBe(1);
  });

  it('reports a missing input as an error check', () => {
    const t: TestSpec = { kind: 'truth-table', rows: [{ inputs: { Z: 1 }, expect: { Y: 1 } }] };
    const { trace: tr } = trace(gateBoard('and'), t, 0);
    expect(tr.error).toMatch(/Z is missing/);
    expect(tr.checks[0]!.pass).toBe(false);
  });

  it('program: runs the cycles and matches the checker', () => {
    const board: Board = {
      parts: [
        part('a', 'switch', { label: 'ADDR', props: { width: 2 } }),
        part('rom', 'rom', { label: 'ROM', props: { width: 8, addrWidth: 2, data: '' } }),
        part('o', 'lamp', { label: 'OUT', props: { width: 8 } }),
      ],
      wires: [wire('w1', 'a', 'out', 'rom', 'addr'), wire('w2', 'rom', 'q', 'o', 'in')],
    };
    const t: Extract<TestSpec, { kind: 'program' }> = { kind: 'program', program: '11 22 33 44', rom: 'ROM', halt: 'HALT', maxCycles: 3, set: { ADDR: 2 }, expect: { OUT: 0x33 } };
    const loaded = loadProgram(board, t);
    const { trace: tr } = trace(loaded, t, 0);
    const [r] = [...runTest(compile(loaded), t, fast())];
    expect(tr.cycles).toBe(r!.cycle);
    expect(tr.frames.length).toBe(2 + 3 * 2);
    expect(tr.checks[0]!.pass).toBe(r!.pass);
    expect(tr.checks[0]!.actual).toEqual({ OUT: 0x33 });
  });
});
