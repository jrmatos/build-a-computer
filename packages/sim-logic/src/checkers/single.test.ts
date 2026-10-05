import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Board, Part, TestSpec } from '@build-a-computer/schema';
import fc from 'fast-check';
import { compile } from '../compile';
import { FastEngine } from '../fast-engine';
import { REFERENCES } from '../blocks/references';
import { caseIndexOf, loadProgram, runTest, runTestCase, type CheckOptions } from '../checkers';

const part = (id: string, type: Part['type'], extra: Partial<Part> = {}): Part => ({ id, type, x: 0, y: 0, rot: 0, flip: false, ...extra });
const wire = (id: string, a: string, ap: string, b: string, bp: string) => ({ id, from: { part: a, pin: ap }, to: { part: b, pin: bp }, points: [] });

const xorBoard: Board = {
  parts: [part('A', 'switch', { label: 'A' }), part('B', 'switch', { label: 'B' }), part('g', 'xor'), part('Y', 'lamp', { label: 'Y' })],
  wires: [wire('w1', 'A', 'out', 'g', 'a'), wire('w2', 'B', 'out', 'g', 'b'), wire('w3', 'g', 'out', 'Y', 'in')],
};

/** SR latch from two NOR gates: a stateful circuit, so a row's result depends on the rows before it. */
const latchBoard: Board = {
  parts: [part('S', 'switch', { label: 'S' }), part('R', 'switch', { label: 'R' }), part('n1', 'nor'), part('n2', 'nor'), part('Q', 'lamp', { label: 'Q' })],
  wires: [
    wire('w1', 'R', 'out', 'n1', 'a'),
    wire('w2', 'n2', 'out', 'n1', 'b'),
    wire('w3', 'S', 'out', 'n2', 'a'),
    wire('w4', 'n1', 'out', 'n2', 'b'),
    wire('w5', 'n1', 'out', 'Q', 'in'),
  ],
};

const dBoard: Board = {
  parts: [part('clk', 'clock'), part('D', 'switch', { label: 'D' }), part('ff', 'dff'), part('Q', 'lamp', { label: 'Q' })],
  wires: [wire('w1', 'clk', 'out', 'ff', 'clk'), wire('w2', 'D', 'out', 'ff', 'd'), wire('w3', 'ff', 'q', 'Q', 'in')],
};

const romBoard: Board = {
  parts: [
    part('a', 'switch', { label: 'ADDR', props: { width: 2 } }),
    part('rom', 'rom', { label: 'ROM', props: { width: 8, addrWidth: 2, data: '' } }),
    part('o', 'lamp', { label: 'OUT', props: { width: 8 } }),
  ],
  wires: [wire('w1', 'a', 'out', 'rom', 'addr'), wire('w2', 'rom', 'q', 'o', 'in')],
};

const opts: CheckOptions = { seed: 1, createEngine: (nl, o) => new FastEngine(nl, o) };

/** Every case of a full run equals the single-case run for its index. */
function expectSameAsFull(board: Board, test: TestSpec): void {
  const nl = compile(test.kind === 'program' ? loadProgram(board, test) : board);
  const full = [...runTest(nl, test, opts)];
  expect(full.length).toBeGreaterThan(0);
  for (const r of full) expect(runTestCase(nl, test, caseIndexOf(r), opts)).toEqual(r);
}

beforeAll(() => {
  REFERENCES['single-xor'] = (i) => ({ Y: (i.A! ^ i.B!) & 1 });
  REFERENCES['single-wrong'] = (i) => ({ Y: i.A! & 1 });
});
afterAll(() => {
  delete REFERENCES['single-xor'];
  delete REFERENCES['single-wrong'];
});

describe('runTestCase: one case equals the same case of a full run', () => {
  it('truth-table (combinational and stateful)', () => {
    const rows = [
      { inputs: { A: 0, B: 0 }, expect: { Y: 0 } },
      { inputs: { A: 1, B: 0 }, expect: { Y: 1 } },
      { inputs: { A: 1, B: 1 }, expect: { Y: 1 } },
    ];
    expectSameAsFull(xorBoard, { kind: 'truth-table', rows });
    const latch: TestSpec = {
      kind: 'truth-table',
      rows: [
        { inputs: { S: 1, R: 0 }, expect: { Q: 1 } },
        { inputs: { S: 0, R: 0 }, expect: { Q: 1 } },
        { inputs: { S: 0, R: 1 }, expect: { Q: 0 } },
        { inputs: { S: 0, R: 0 }, expect: { Q: 0 } },
      ],
    };
    expectSameAsFull(latchBoard, latch);
    // Row 2 holds the value set by row 1: replayed in order, it passes alone too.
    expect(runTestCase(compile(latchBoard), latch, 1, opts).pass).toBe(true);
  });

  it('exhaustive and random (same vectors as the full run)', () => {
    expectSameAsFull(xorBoard, { kind: 'exhaustive', reference: 'single-xor', inputs: ['A', 'B'], outputs: ['Y'] });
    expectSameAsFull(xorBoard, { kind: 'exhaustive', reference: 'single-wrong', inputs: ['A', 'B'], outputs: ['Y'] });
    expectSameAsFull(xorBoard, { kind: 'random', reference: 'single-xor', inputs: ['A', 'B'], outputs: ['Y'], count: 40, seed: 7 });
    expectSameAsFull(xorBoard, { kind: 'random', reference: 'single-wrong', inputs: ['A', 'B'], outputs: ['Y'], count: 40, seed: 1 });
  });

  it('sequence (steps from power on, with power cycles)', () => {
    expectSameAsFull(dBoard, {
      kind: 'sequence',
      steps: [
        { set: { D: 1 }, ticks: 2, expect: { Q: 1 } },
        { set: { D: 0 }, ticks: 0, expect: { Q: 1 } },
        { power: 'cycle', ticks: 2, expect: { Q: 1 } },
        { set: { D: 1 }, ticks: 2, expect: { Q: 1 } },
      ],
    });
  });

  it('program (the whole run is case 0)', () => {
    expectSameAsFull(romBoard, { kind: 'program', program: '0a 0b 0c', rom: 'ROM', halt: 'HALT', maxCycles: 1, set: { ADDR: 2 }, expect: { OUT: 12 } });
    expectSameAsFull(romBoard, { kind: 'program', program: '0a 0b 0c', rom: 'ROM', halt: 'HALT', maxCycles: 1, set: { ADDR: 1 }, expect: { OUT: 12 } });
  });

  it('random truth tables on the latch (property)', () => {
    const row = fc.record({ inputs: fc.record({ S: fc.integer({ min: 0, max: 1 }), R: fc.integer({ min: 0, max: 1 }) }), expect: fc.record({ Q: fc.integer({ min: 0, max: 1 }) }) });
    fc.assert(
      fc.property(fc.array(row, { minLength: 1, maxLength: 8 }), (rows) => {
        expectSameAsFull(latchBoard, { kind: 'truth-table', rows });
      }),
      { numRuns: 40 },
    );
  });
});

describe('runTestCase: cases a full run never reaches', () => {
  it('a test that stops early reports why for the requested case', () => {
    const nl = compile(xorBoard);
    const r = runTestCase(nl, { kind: 'exhaustive', reference: 'single-xor', inputs: ['A', 'C'], outputs: ['Y'] }, 2, opts);
    expect(r).toMatchObject({ index: 2, pass: false, message: 'Input C is missing from the board.' });
  });

  it('out of time before the case', () => {
    let t = 0;
    const r = runTestCase(compile(xorBoard), { kind: 'random', reference: 'single-xor', inputs: ['A', 'B'], outputs: ['Y'], count: 100, seed: 1 }, 50, {
      ...opts,
      now: () => (t += 1),
      budgetMs: 10,
    });
    expect(r).toMatchObject({ index: 50, pass: false });
    expect(r.message).toMatch(/ran out of time/);
  });

  it('an index past the end, or negative, is not a case', () => {
    const nl = compile(xorBoard);
    const test: TestSpec = { kind: 'truth-table', rows: [{ inputs: { A: 1, B: 0 }, expect: { Y: 1 } }] };
    expect(runTestCase(nl, test, 3, opts)).toMatchObject({ index: 3, pass: false, message: 'There is no case 4 in this test.' });
    expect(runTestCase(nl, test, -1, opts).pass).toBe(false);
    const seq: TestSpec = { kind: 'sequence', steps: [{ ticks: 0 }] };
    expect(runTestCase(compile(dBoard), seq, 5, opts)).toMatchObject({ step: 5, pass: false });
  });
});
