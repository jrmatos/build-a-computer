import { describe, expect, it } from 'vitest';
import { Prng } from '@build-a-computer/det';
import type { Level, TestSpec } from '@build-a-computer/schema';
import {
  actualValue,
  assignResults,
  cellFor,
  columnState,
  columnWidth,
  exhaustiveCount,
  exhaustiveVector,
  formatNum,
  parseActual,
  planStrip,
  randomVectors,
  sequenceColumns,
  type StreamedCase,
} from './testStripModel';

const lvl = (tests: TestSpec[], parts: Level['starter']['parts'] = []): Pick<Level, 'starter' | 'tests'> => ({
  starter: { parts, wires: [] },
  tests,
});
const sw = (label: string, width = 1) => ({ id: `s${label}`, type: 'switch' as const, x: 0, y: 0, rot: 0 as const, flip: false, label, props: { width } });
const res = (index: number, pass: boolean, extra: Partial<StreamedCase> = {}): StreamedCase => ({
  index,
  pass,
  inputs: {},
  expected: {},
  actual: {},
  ...extra,
});

const nandRows = [
  { inputs: { A: 0, B: 0 }, expect: { Y: 1 } },
  { inputs: { A: 0, B: 1 }, expect: { Y: 1 } },
  { inputs: { A: 1, B: 0 }, expect: { Y: 1 } },
  { inputs: { A: 1, B: 1 }, expect: { Y: 0 } },
];

describe('test strip vectors', () => {
  it('enumerates exhaustive vectors with the first input most significant', () => {
    const ports = [
      { label: 'A', width: 1 },
      { label: 'B', width: 1 },
    ];
    expect([0, 1, 2, 3].map((i) => exhaustiveVector(ports, i))).toEqual([
      { A: 0, B: 0 },
      { A: 0, B: 1 },
      { A: 1, B: 0 },
      { A: 1, B: 1 },
    ]);
    expect(exhaustiveVector([{ label: 'A', width: 8 }, { label: 'B', width: 8 }], 0x1234)).toEqual({ A: 0x12, B: 0x34 });
    expect(exhaustiveCount([{ label: 'A', width: 8 }, { label: 'B', width: 8 }])).toBe(65_536);
    expect(exhaustiveCount([{ label: 'A', width: 17 }])).toBe(0);
  });

  it('plans truth-table columns and rows straight from the rows', () => {
    const plan = planStrip(lvl([{ kind: 'truth-table', rows: nandRows }]));
    expect(plan.count).toBe(4);
    expect(plan.inputs.map((p) => p.label)).toEqual(['A', 'B']);
    expect(plan.outputs).toEqual([{ label: 'Y', width: 1 }]);
    expect(plan.column(3)).toMatchObject({ inputs: { A: 1, B: 1 }, expect: { Y: 0 }, kind: 'truth-table', index: 3 });
  });

  it('plans exhaustive columns with reference outputs and starter widths', () => {
    const plan = planStrip(lvl([{ kind: 'exhaustive', inputs: ['A', 'B'], outputs: ['Y'], reference: 'xor' }]));
    expect(plan.count).toBe(4);
    expect(plan.column(1)).toMatchObject({ inputs: { A: 0, B: 1 }, expect: { Y: 1 } });
    expect(plan.column(3)).toMatchObject({ inputs: { A: 1, B: 1 }, expect: { Y: 0 } });

    const wide = planStrip(lvl([{ kind: 'exhaustive', inputs: ['A', 'B'], outputs: ['Y'], reference: 'sub8' }], [sw('A', 8), sw('B', 8)]));
    expect(wide.count).toBe(65_536);
    expect(wide.inputs).toEqual([
      { label: 'A', width: 8 },
      { label: 'B', width: 8 },
    ]);
    expect(wide.column(0x0503)).toMatchObject({ inputs: { A: 5, B: 3 }, expect: { Y: 2 } });
  });

  it('plans random columns with the same seeded vectors as the checker', () => {
    const plan = planStrip(lvl([{ kind: 'random', inputs: ['A', 'B'], outputs: ['Y'], reference: 'sub8', count: 10, seed: 7 }]));
    expect(plan.count).toBe(10);
    const prng = new Prng(7);
    const a = prng.nextU32() & 0xff;
    const b = prng.nextU32() & 0xff;
    expect(plan.column(0)).toMatchObject({ inputs: { A: a, B: b }, expect: { Y: (a - b) & 0xff } });
    expect(randomVectors([{ label: 'A', width: 1 }], 3, 7)).toHaveLength(3);
  });

  it('makes one sequence column per step with tick counts and held inputs', () => {
    const test: Extract<TestSpec, { kind: 'sequence' }> = {
      kind: 'sequence',
      steps: [
        { set: { D: 1, CLK: 0 }, ticks: 0 },
        { set: { CLK: 1 }, ticks: 2, expect: { Q: 1 } },
        { set: { D: 0 }, ticks: 1 },
        { ticks: 3, expect: { Q: 1 }, power: 'cycle' },
      ],
    };
    const cols = sequenceColumns(test, 0);
    expect(cols).toHaveLength(4);
    expect(cols[1]).toMatchObject({ step: 1, ticks: 2, inputs: { D: 1, CLK: 1 }, expect: { Q: 1 } });
    expect(cols[2]?.expect).toBeUndefined();
    expect(cols[3]).toMatchObject({ step: 3, ticks: 3, inputs: { D: 0, CLK: 1 }, power: true });
  });

  it('plans a program test as one column with its cycle budget', () => {
    const plan = planStrip(lvl([{ kind: 'program', program: '00', rom: 'ROM', halt: 'HALT', maxCycles: 500, expect: { OUT: 42 } }]));
    expect(plan.count).toBe(1);
    expect(plan.column(0)).toMatchObject({ kind: 'program', maxCycles: 500, expect: { OUT: 42 } });
  });
});

describe('test strip result mapping', () => {
  const two = planStrip(
    lvl([
      { kind: 'truth-table', rows: nandRows.slice(0, 2) },
      { kind: 'truth-table', rows: nandRows },
    ]),
  );

  it('fills columns in arrival order across tests', () => {
    const cases = [res(0, true), res(1, true), res(0, true), res(1, false)];
    const { byColumn, extra } = assignResults(two, cases);
    expect(byColumn.slice(0, 4).map((c) => c?.pass)).toEqual([true, true, true, false]);
    expect(byColumn[4]).toBeUndefined();
    expect(extra).toEqual([]);
  });

  it('starts the next test early when the checker index restarts', () => {
    const plan = planStrip(
      lvl([
        { kind: 'truth-table', rows: nandRows },
        { kind: 'truth-table', rows: nandRows },
      ]),
    );
    const { byColumn } = assignResults(plan, [res(0, true), res(1, true), res(0, false)]);
    expect(byColumn[2]).toBeUndefined();
    expect(byColumn[4]?.pass).toBe(false);
  });

  it('places results by the test index the worker reports', () => {
    const { byColumn } = assignResults(two, [res(1, false, { test: 1 })]);
    expect(byColumn[3]?.pass).toBe(false);
    expect(byColumn[1]).toBeUndefined();
  });

  it('places sequence results by step when the checker reports it', () => {
    const plan = planStrip(
      lvl([
        {
          kind: 'sequence',
          steps: [
            { ticks: 1, expect: { Q: 0 } },
            { ticks: 1 },
            { ticks: 1, expect: { Q: 1 } },
          ],
        },
      ]),
    );
    const { byColumn } = assignResults(plan, [res(2, true, { step: 2, kind: 'sequence', test: 0 })]);
    expect(byColumn[0]).toBeUndefined();
    expect(byColumn[2]?.pass).toBe(true);
  });

  it('keeps results past the plan as extras', () => {
    const plan = planStrip(lvl([{ kind: 'truth-table', rows: nandRows.slice(0, 1) }]));
    expect(assignResults(plan, [res(0, true), res(1, true)]).extra).toHaveLength(1);
  });

  it('maps column state from result and run cursor', () => {
    expect(columnState(undefined, 3, 3, true)).toBe('active');
    expect(columnState(undefined, 3, 3, false)).toBe('pending');
    expect(columnState(undefined, 4, 3, true)).toBe('pending');
    expect(columnState(res(0, true), 3, 3, true)).toBe('pass');
    expect(columnState(res(0, false), 0, 3, false)).toBe('fail');
  });
});

describe('test strip cells', () => {
  it('parses checker values', () => {
    expect(parseActual('0')).toBe(0);
    expect(parseActual('1')).toBe(1);
    expect(parseActual('X')).toBe('x');
    expect(parseActual('255')).toBe(255);
    expect(parseActual('0xff')).toBe(255);
    expect(parseActual('1X0')).toBe('x');
    expect(parseActual(undefined)).toBeUndefined();
  });

  it('prefers actualNum over the actual string', () => {
    expect(actualValue(res(0, true, { actual: { Y: 'X' }, actualNum: { Y: 7 } }), 'Y')).toBe(7);
    expect(actualValue(res(0, true, { actual: { Y: '1' } }), 'Y')).toBe(1);
    expect(actualValue(res(0, true, { actual: { Y: 'X' }, actualNum: { Y: null } }), 'Y')).toBe('x');
    expect(actualValue(undefined, 'Y')).toBeUndefined();
  });

  it('draws 1-bit values as leaves and wider ones as numbers', () => {
    expect(cellFor(1, 1)).toEqual({ kind: 'leaf', bit: 1 });
    expect(cellFor(0, 1)).toEqual({ kind: 'leaf', bit: 0 });
    expect(cellFor('x', 1)).toEqual({ kind: 'unknown' });
    expect(cellFor(undefined, 8)).toEqual({ kind: 'empty' });
    expect(cellFor(1, 8)).toEqual({ kind: 'num', value: 1 });
  });

  it('formats number pills and sizes columns', () => {
    expect(formatNum(10, 8, 'hex')).toBe('0A');
    expect(formatNum(10, 8, 'dec')).toBe('10');
    expect(formatNum(0xdeadbeef, 32, 'hex')).toBe('DEADBEEF');
    expect(columnWidth([{ label: 'A', width: 1 }], 'hex')).toBe(28);
    expect(columnWidth([{ label: 'A', width: 8 }], 'dec')).toBeGreaterThan(columnWidth([{ label: 'A', width: 8 }], 'hex') - 1);
  });
});
