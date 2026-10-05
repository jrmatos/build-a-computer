import { describe, expect, it } from 'vitest';
import type { Board, Level, Part, TestSpec } from '@build-a-computer/schema';
import type { CaseResult, DebugCheck, DebugFrame } from '@build-a-computer/sim-logic';
import { planStrip } from '../testStripModel';
import { fanInCone, labelWires } from './cone';
import { bitDiff, caseTarget, checkFor, cycleTarget, explain, failureRank, neighborCase, outputVerdicts, showValue, valuesAt } from './model';

const part = (id: string, type: Part['type'], label?: string, props?: Part['props']): Part => ({
  id,
  type,
  x: 0,
  y: 0,
  rot: 0,
  flip: false,
  ...(label ? { label } : {}),
  ...(props ? { props } : {}),
});
const wire = (id: string, a: string, ap: string, b: string, bp: string) => ({ id, from: { part: a, pin: ap }, to: { part: b, pin: bp }, points: [] });

/** Half adder: S = A xor B, C = A and B; plus an unrelated lamp. */
const halfAdder: Board = {
  parts: [
    part('A', 'switch', 'A'),
    part('B', 'switch', 'B'),
    part('x', 'xor'),
    part('n', 'and'),
    part('S', 'lamp', 'S'),
    part('C', 'lamp', 'C'),
  ],
  wires: [
    wire('wa1', 'A', 'out', 'x', 'a'),
    wire('wb1', 'B', 'out', 'x', 'b'),
    wire('wa2', 'n', 'a', 'A', 'out'), // drawn backwards: direction comes from pins, not wires
    wire('wb2', 'B', 'out', 'n', 'b'),
    wire('ws', 'x', 'out', 'S', 'in'),
    wire('wc', 'n', 'out', 'C', 'in'),
  ],
};

const level = (tests: TestSpec[], starter: Board = halfAdder): Level => ({ id: 'l', starter, tests }) as unknown as Level;

describe('fanInCone', () => {
  it('walks back from an output through gates to the inputs', () => {
    const c = fanInCone(halfAdder, 'S');
    expect(new Set(c.parts)).toEqual(new Set(['S', 'x', 'A', 'B']));
    expect(new Set(c.wires)).toEqual(new Set(['ws', 'wa1', 'wa2', 'wb1', 'wb2']));
    expect(new Set(c.sources)).toEqual(new Set(['A', 'B']));
  });

  it('stops at flip-flops and follows only a memory’s read address', () => {
    const b: Board = {
      parts: [part('D', 'switch', 'D'), part('ff', 'dff'), part('clk', 'clock'), part('rom', 'rom', 'ROM', { width: 8, addrWidth: 1 }), part('Q', 'lamp', 'Q', { width: 8 })],
      wires: [wire('w1', 'D', 'out', 'ff', 'd'), wire('w2', 'clk', 'out', 'ff', 'clk'), wire('w3', 'ff', 'q', 'rom', 'addr'), wire('w4', 'rom', 'q', 'Q', 'in')],
    };
    const c = fanInCone(b, 'Q');
    expect(new Set(c.parts)).toEqual(new Set(['Q', 'rom', 'ff']));
    expect(c.sources).toEqual(['ff']);
    expect(c.wires).not.toContain('w1');
  });

  it('is empty for an unknown part', () => {
    expect(fanInCone(halfAdder, 'nope')).toEqual({ parts: [], wires: [], sources: [] });
  });

  it('labelWires finds the wire on each labelled port', () => {
    expect(labelWires(halfAdder, ['A', 'S', 'missing'])).toEqual(['wa1', 'ws']);
  });
});

describe('caseTarget', () => {
  const tests: TestSpec[] = [
    { kind: 'truth-table', rows: [{ inputs: { A: 0, B: 1 }, expect: { S: 1, C: 0 } }] },
    { kind: 'sequence', steps: [{ set: { A: 1 }, ticks: 1 }, { ticks: 2, expect: { S: 1 } }] },
  ];
  const plan = planStrip(level(tests));

  it('maps strip columns to tests and case indexes', () => {
    expect(caseTarget(plan, 0)).toEqual({ column: 0, test: 0, index: 0, kind: 'truth-table', inputs: { A: 0, B: 1 } });
    expect(caseTarget(plan, 2)).toMatchObject({ column: 2, test: 1, index: 1, kind: 'sequence' });
    expect(caseTarget(plan, 3)).toBeNull();
  });

  it('skips tests that do not run on a board', () => {
    const p = planStrip(level([{ kind: 'js' } as unknown as TestSpec]));
    expect(caseTarget(p, 0)).toBeNull();
  });
});

describe('verdicts and explanations', () => {
  const ports = [
    { label: 'S', width: 1 },
    { label: 'C', width: 1 },
    { label: 'Z', width: 1 },
  ];
  const check = (actual: Record<string, number | null>, expect: Record<string, number>, extra: Partial<DebugCheck> = {}): DebugCheck => ({
    frame: 1,
    step: 0,
    expect,
    actual,
    pass: Object.entries(expect).every(([k, v]) => actual[k] === v),
    ...extra,
  });
  const widths = new Map([
    ['A', 1],
    ['B', 1],
  ]);

  it('marks each output', () => {
    const v = outputVerdicts(check({ S: 0, C: null }, { S: 1, C: 0 }), ports);
    expect(v.map((x) => x.status)).toEqual(['wrong', 'unknown', 'unchecked']);
  });

  it('explains a wrong 1-bit output in plain English', () => {
    const c = check({ S: 0, C: 0 }, { S: 1, C: 0 });
    const lines = explain(c, outputVerdicts(c, ports), { kind: 'truth-table', inputs: { A: 1, B: 0 }, widths });
    expect(lines).toEqual(['S should be 1 when A=1 and B=0, but your circuit gives 0.']);
  });

  it('names the wrong bits of a wide value', () => {
    const c = check({ SUM: 8 }, { SUM: 12 });
    const v = outputVerdicts(c, [{ label: 'SUM', width: 4 }]);
    expect(v[0]!.diff).toEqual({ want: '1100', got: '1000', differ: [2] });
    const [line] = explain(c, v, { kind: 'exhaustive', inputs: { A: 5, B: 7 }, widths: new Map([['A', 4], ['B', 4]]) });
    expect(line).toBe('SUM should be 12 (0xC) when A=5 and B=7, but your circuit gives 8. Bit 2 is wrong.');
  });

  it('explains unknown values and sequence steps', () => {
    const c = check({ Q: null }, { Q: 1 }, { step: 2 });
    const lines = explain(c, outputVerdicts(c, [{ label: 'Q', width: 1 }]), {
      kind: 'sequence',
      inputs: { D: 1 },
      widths,
      step: { set: { D: 1 }, ticks: 2, power: false },
    });
    expect(lines[0]).toBe('After step 3 (setting D=1 and 2 clock ticks), Q should be 1, but your circuit gives X (unknown).');
    expect(lines[1]).toMatch(/not connected/);
  });

  it('explains a program result and a pass', () => {
    const c = check({ R: 3 }, { R: 5 });
    expect(explain(c, outputVerdicts(c, [{ label: 'R', width: 8 }]), { kind: 'program', inputs: {}, widths, cycles: 42, halted: true })[0]).toBe(
      'When the program halted after 42 cycles, R should be 5, but your circuit gives 3. Bits 2 and 1 are wrong.',
    );
    const ok = check({ S: 1 }, { S: 1 });
    expect(explain(ok, outputVerdicts(ok, ports), { kind: 'truth-table', inputs: {}, widths })).toEqual(['Every checked output matches what the test expects.']);
  });

  it('falls back to the checker message when no output is wrong', () => {
    const c = check({}, {}, { pass: false, message: 'Input Z is missing from the board.' });
    expect(explain(c, [], { kind: 'truth-table', inputs: {}, widths })).toEqual(['Input Z is missing from the board.']);
  });

  it('bitDiff and showValue', () => {
    expect(bitDiff(0b1010, 0b0110, 4)).toEqual({ want: '1010', got: '0110', differ: [2, 3] });
    expect(showValue(null, 1)).toBe('X');
    expect(showValue(255, 8)).toBe('255 (0xFF)');
    expect(showValue(3, 8)).toBe('3');
  });
});

describe('navigation', () => {
  const r = (pass: boolean) => ({ pass }) as CaseResult;
  const results = [r(true), r(false), r(true), undefined, r(false)];

  it('steps between cases, or only failures', () => {
    expect(neighborCase(results, 5, 0, 1, false)).toBe(1);
    expect(neighborCase(results, 5, 4, 1, false)).toBeNull();
    expect(neighborCase(results, 5, 1, 1, true)).toBe(4);
    expect(neighborCase(results, 5, 4, -1, true)).toBe(1);
    expect(neighborCase(results, 5, 1, -1, true)).toBeNull();
  });

  it('ranks failures', () => {
    expect(failureRank(results, 4)).toEqual({ rank: 2, total: 2 });
    expect(failureRank(results, 0)).toEqual({ rank: 0, total: 2 });
  });
});

describe('timeline', () => {
  const frames: DebugFrame[] = [
    { tick: 0, step: 0, cause: 'power' },
    { tick: 0, step: 0, cause: 'set' },
    { tick: 1, step: 0, cause: 'tick' },
    { tick: 2, step: 0, cause: 'tick' },
    { tick: 3, step: 1, cause: 'tick' },
    { tick: 0, step: 2, cause: 'cycle' },
    { tick: 1, step: 2, cause: 'tick' },
  ];

  it('moves a clock cycle at a time, stopping at power cycles', () => {
    expect(cycleTarget(frames, 1, 1)).toBe(3);
    expect(cycleTarget(frames, 3, 1)).toBe(5);
    expect(cycleTarget(frames, 4, -1)).toBe(2);
    expect(cycleTarget(frames, 6, -1)).toBe(5);
    expect(cycleTarget(frames, 6, 1)).toBe(6);
  });

  it('picks the checkpoint for a frame and reads values', () => {
    const trace = {
      checks: [{ frame: 3 }, { frame: 4 }] as DebugCheck[],
      series: { A: [0, 1, 1, 1, null, 0, 0] },
    };
    expect(checkFor(trace, 0)).toBe(0);
    expect(checkFor(trace, 3)).toBe(0);
    expect(checkFor(trace, 4)).toBe(1);
    expect(checkFor(trace, 6)).toBe(1);
    expect(valuesAt(trace, ['A', 'B'], 2)).toEqual({ A: 1 });
    expect(valuesAt(trace, ['A'], 4)).toEqual({});
  });
});
