import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Board, Part, TestSpec } from '@ground-up/schema';
import { compile, type Netlist } from '../compile';
import { ReferenceEngine, type EngineOptions, type SettleResult } from '../engine';
import { FastEngine } from '../fast-engine';
import { REFERENCES } from '../blocks/references';
import { V0, V1, VX, mask, sig, type Signal, type Value } from '../values';
import { caseCount, loadProgram, parseProgram, runTest, type CaseResult, type CheckOptions, type CheckerEngine } from '../checkers';

const part = (id: string, type: Part['type'], extra: Partial<Part> = {}): Part => ({ id, type, x: 0, y: 0, rot: 0, flip: false, ...extra });
const wire = (id: string, a: string, ap: string, b: string, bp: string) => ({ id, from: { part: a, pin: ap }, to: { part: b, pin: bp }, points: [] });
const all = (nl: Netlist, test: TestSpec, opts: CheckOptions = {}): CaseResult[] => [...runTest(nl, test, opts)];

/** A = switch, B = switch, Y = A xor B (or `gate`). */
const gate2Board = (gate: Part['type']): Board => ({
  parts: [part('A', 'switch', { label: 'A' }), part('B', 'switch', { label: 'B' }), part('g', gate), part('Y', 'lamp', { label: 'Y' })],
  wires: [wire('w1', 'A', 'out', 'g', 'a'), wire('w2', 'B', 'out', 'g', 'b'), wire('w3', 'g', 'out', 'Y', 'in')],
});

/** Q toggles on every rising clock edge. */
const toggleBoard: Board = {
  parts: [part('clk', 'clock'), part('ff', 'dff'), part('n', 'not'), part('Q', 'lamp', { label: 'Q' })],
  wires: [
    wire('w1', 'clk', 'out', 'ff', 'clk'),
    wire('w2', 'ff', 'q', 'n', 'in'),
    wire('w3', 'n', 'out', 'ff', 'd'),
    wire('w4', 'ff', 'q', 'Q', 'in'),
  ],
};

/** Q follows D on the rising edge. */
const dBoard: Board = {
  parts: [part('clk', 'clock'), part('D', 'switch', { label: 'D' }), part('ff', 'dff'), part('Q', 'lamp', { label: 'Q' })],
  wires: [wire('w1', 'clk', 'out', 'ff', 'clk'), wire('w2', 'D', 'out', 'ff', 'd'), wire('w3', 'ff', 'q', 'Q', 'in')],
};

const empty: Board = { parts: [], wires: [] };

beforeAll(() => {
  REFERENCES['test-xor'] = (i) => ({ Y: (i.A! ^ i.B!) & 1 });
  REFERENCES['test-wide'] = () => ({ Y: 0 });
  REFERENCES['test-add8'] = (i) => ({ S: (i.A! + i.B!) & 0xff });
});
afterAll(() => {
  delete REFERENCES['test-xor'];
  delete REFERENCES['test-wide'];
  delete REFERENCES['test-add8'];
});

/**
 * Fake multi-bit engine: Y = (A + B) & mask(width of Y), X when `xOut`.
 * HALT goes to 1 after `haltAfter` full cycles (never when undefined).
 */
class FakeEngine implements CheckerEngine {
  ticks = 0;
  values: Record<string, number> = {};
  powered = false;
  constructor(
    readonly nl: Netlist,
    private readonly cfg: { haltAfter?: number; xOut?: boolean; widths: Record<string, number> },
  ) {}
  private ok(): SettleResult {
    return { stable: true, unstableNets: [], contentionNets: [], events: 0 };
  }
  powerOn() {
    this.powered = true;
    this.ticks = 0;
    return this.ok();
  }
  powerOff() {
    this.powered = false;
  }
  tick() {
    this.ticks++;
    return this.ok();
  }
  setSwitch(id: string, on: boolean) {
    this.values[id] = on ? 1 : 0;
    return this.ok();
  }
  setValue(id: string, v: number) {
    this.values[id] = v;
    return this.ok();
  }
  readPin(id: string, pin: string): Value {
    const s = this.readSignal(id, pin);
    return (s.x ? VX : s.v & 1 ? V1 : V0) as Value;
  }
  readSignal(id: string, _pin: string): Signal {
    const w = this.cfg.widths[id] ?? 1;
    if (id === 'HALT') return sig(1, this.cfg.haltAfter !== undefined && this.ticks >= this.cfg.haltAfter * 2 ? 1 : 0);
    if (id === 'CYC') return sig(32, this.ticks >> 1);
    if (this.cfg.xOut) return { w, v: 0, x: 1 };
    if (id === 'Y' || id === 'S') return sig(w, ((this.values.A ?? 0) + (this.values.B ?? 0)) & mask(w));
    return sig(w, this.values[id] ?? 0);
  }
}

const fakeNl = (labels: [string, Part['type'], number][]): Netlist =>
  ({
    parts: labels.map(([id, type, width]) => ({
      id,
      type,
      label: id,
      width,
      behavior: { kind: type === 'lamp' ? 'lamp' : type === 'switch' ? 'switch' : 'gate' },
      inputNets: [],
      outputSlots: [],
      inLoop: false,
      initialOn: false,
    })),
  }) as unknown as Netlist;

const fake = (nl: Netlist, cfg: ConstructorParameters<typeof FakeEngine>[1]) => (n: Netlist) => new FakeEngine(n, cfg);

describe('truth-table', () => {
  const nl = compile(gate2Board('xor'));
  const test: TestSpec = {
    kind: 'truth-table',
    rows: [
      { inputs: { A: 0, B: 0 }, expect: { Y: 0 } },
      { inputs: { A: 1, B: 0 }, expect: { Y: 1 } },
      { inputs: { A: 1, B: 1 }, expect: { Y: 0 } },
    ],
  };

  it('passes a correct 1-bit circuit and tags each case', () => {
    const r = all(nl, test);
    expect(r.map((c) => c.pass)).toEqual([true, true, true]);
    expect(r[1]).toMatchObject({ kind: 'truth-table', actual: { Y: '1' }, actualNum: { Y: 1 } });
  });

  it('explains a wrong output in plain English', () => {
    const r = all(compile(gate2Board('and')), test);
    expect(r[1]!.pass).toBe(false);
    expect(r[1]!.message).toBe('Output Y is 0 but should be 1.');
  });

  it('an unconnected output is X and fails with a hint', () => {
    const b = gate2Board('xor');
    const r = all(compile({ ...b, wires: b.wires.slice(0, 2) }), test);
    expect(r.every((c) => !c.pass)).toBe(true);
    expect(r[0]).toMatchObject({ actual: { Y: 'X' }, actualNum: { Y: null } });
    expect(r[0]!.message).toMatch(/unknown \(X\)/);
  });

  it('a NOT ring is reported unstable', () => {
    const b: Board = { parts: [part('n', 'not'), part('Y', 'lamp', { label: 'Y' })], wires: [wire('w1', 'n', 'out', 'n', 'in'), wire('w2', 'n', 'out', 'Y', 'in')] };
    const r = all(compile(b), { kind: 'truth-table', rows: [{ inputs: {}, expect: { Y: 1 } }] });
    expect(r[0]!.pass).toBe(false);
    expect(r[0]!.message).toMatch(/never settled/);
  });

  it('multi-bit values through setValue/readSignal (fake engine)', () => {
    const nl = fakeNl([['A', 'switch', 8], ['B', 'switch', 8], ['Y', 'lamp', 8]]);
    const t: TestSpec = {
      kind: 'truth-table',
      rows: [
        { inputs: { A: 200, B: 55 }, expect: { Y: 255 } },
        { inputs: { A: 200, B: 56 }, expect: { Y: 0 } },
        { inputs: { A: 1, B: 1 }, expect: { Y: 3 } },
        { inputs: { A: 256, B: 0 }, expect: { Y: 0 } },
      ],
    };
    const r = all(nl, t, { createEngine: fake(nl, { widths: { A: 8, B: 8, Y: 8 } }) });
    expect(r.map((c) => c.pass)).toEqual([true, true, false, false]);
    expect(r[0]!.actual).toEqual({ Y: '255' });
    expect(r[2]!.message).toBe('Output Y is 2 but should be 3.');
    expect(r[3]!.message).toMatch(/8 bits wide, too narrow for the value 256/);
  });

  it('a partly unknown multi-bit output is a mismatch (fake engine)', () => {
    const nl = fakeNl([['A', 'switch', 8], ['Y', 'lamp', 8]]);
    const r = all(nl, { kind: 'truth-table', rows: [{ inputs: { A: 1 }, expect: { Y: 1 } }] }, {
      createEngine: fake(nl, { widths: { A: 8, Y: 8 }, xOut: true }),
    });
    expect(r[0]).toMatchObject({ pass: false, actual: { Y: 'X' }, actualNum: { Y: null } });
    expect(r[0]!.message).toMatch(/unknown bits/);
  });

  const multiBit = typeof (ReferenceEngine.prototype as { setValue?: unknown }).setValue === 'function';
  it.runIf(multiBit)('multi-bit switch to lamp on the real engine', () => {
    const b: Board = {
      parts: [part('A', 'switch', { label: 'A', props: { width: 8 } }), part('Y', 'lamp', { label: 'Y', props: { width: 8 } })],
      wires: [wire('w', 'A', 'out', 'Y', 'in')],
    };
    const r = all(compile(b), { kind: 'truth-table', rows: [{ inputs: { A: 0xa5 }, expect: { Y: 0xa5 } }] });
    expect(r[0]!.pass).toBe(true);
  });

  it('stops at the wall-clock budget', () => {
    let t = 0;
    const r = all(nl, test, { now: () => (t += 10), budgetMs: 15 });
    expect(r.at(-1)!.pass).toBe(false);
    expect(r.at(-1)!.message).toMatch(/ran out of time/);
    expect(r.length).toBeLessThan(test.rows.length + 1);
  });
});

describe('exhaustive', () => {
  const test: TestSpec = { kind: 'exhaustive', inputs: ['A', 'B'], outputs: ['Y'], reference: 'test-xor' };

  it('enumerates every combination, first input most significant', () => {
    const r = all(compile(gate2Board('xor')), test);
    expect(r.map((c) => c.inputs)).toEqual([{ A: 0, B: 0 }, { A: 0, B: 1 }, { A: 1, B: 0 }, { A: 1, B: 1 }]);
    expect(r.every((c) => c.pass && c.kind === 'exhaustive')).toBe(true);
    expect(caseCount(test)).toBe(4);
  });

  it('fails the cases where the circuit differs from the reference', () => {
    const r = all(compile(gate2Board('or')), test);
    expect(r.map((c) => c.pass)).toEqual([true, true, true, false]);
  });

  it('uses multi-bit widths (fake engine)', () => {
    const nl = fakeNl([['A', 'switch', 4], ['B', 'switch', 4], ['S', 'lamp', 8]]);
    const r = all(nl, { kind: 'exhaustive', inputs: ['A', 'B'], outputs: ['S'], reference: 'test-add8' }, {
      createEngine: fake(nl, { widths: { A: 4, B: 4, S: 8 } }),
    });
    expect(r).toHaveLength(256);
    expect(r[0x3c]!.inputs).toEqual({ A: 3, B: 12 });
    expect(r.every((c) => c.pass)).toBe(true);
  });

  it('refuses more than 16 input bits', () => {
    const labels = Array.from({ length: 17 }, (_, i) => `I${i}`);
    const b: Board = { parts: [...labels.map((l) => part(l, 'switch', { label: l })), part('Y', 'lamp', { label: 'Y' })], wires: [] };
    const r = all(compile(b), { kind: 'exhaustive', inputs: labels, outputs: ['Y'], reference: 'test-wide' });
    expect(r).toHaveLength(1);
    expect(r[0]!.pass).toBe(false);
    expect(r[0]!.message).toMatch(/17 input bits; the limit is 16/);
  });

  it('an unknown reference fails clearly', () => {
    const r = all(compile(gate2Board('xor')), { ...test, reference: 'nope' });
    expect(r[0]!.message).toMatch(/unknown reference model 'nope'/);
  });
});

describe('random', () => {
  const test: TestSpec = { kind: 'random', inputs: ['A', 'B'], outputs: ['Y'], reference: 'test-xor', count: 40, seed: 7 };

  it('runs `count` seeded vectors, the same every run', () => {
    const a = all(compile(gate2Board('xor')), test);
    const b = all(compile(gate2Board('xor')), test);
    expect(a).toHaveLength(40);
    expect(a.every((c) => c.pass && c.kind === 'random')).toBe(true);
    expect(a.map((c) => c.inputs)).toEqual(b.map((c) => c.inputs));
    expect(new Set(a.map((c) => `${c.inputs.A}${c.inputs.B}`)).size).toBe(4);
  });

  it('catches a wrong circuit', () => {
    const r = all(compile(gate2Board('nand')), test);
    expect(r.some((c) => !c.pass)).toBe(true);
  });

  it('masks random values to each input width (fake engine)', () => {
    const nl = fakeNl([['A', 'switch', 8], ['B', 'switch', 8], ['S', 'lamp', 8]]);
    const r = all(nl, { kind: 'random', inputs: ['A', 'B'], outputs: ['S'], reference: 'test-add8', count: 100, seed: 3 }, {
      createEngine: fake(nl, { widths: { A: 8, B: 8, S: 8 } }),
    });
    expect(r.every((c) => c.pass && c.inputs.A! < 256 && c.inputs.B! < 256)).toBe(true);
  });
});

describe('sequence', () => {
  it('ticks and checks each step', () => {
    const r = all(compile(toggleBoard), {
      kind: 'sequence',
      steps: [
        { ticks: 0, expect: { Q: 0 } },
        { ticks: 2, expect: { Q: 1 } },
        { ticks: 2, expect: { Q: 0 } },
        { ticks: 1, expect: { Q: 1 } },
      ],
    });
    expect(r.map((c) => c.pass)).toEqual([true, true, true, true]);
    expect(r.map((c) => [c.step, c.cycle])).toEqual([[0, 0], [1, 2], [2, 4], [3, 5]]);
    expect(r[0]!.kind).toBe('sequence');
  });

  it('sets inputs before ticking', () => {
    const r = all(compile(dBoard), {
      kind: 'sequence',
      steps: [
        { set: { D: 1 }, ticks: 0, expect: { Q: 0 } },
        { ticks: 2, expect: { Q: 1 } },
        { set: { D: 0 }, ticks: 2, expect: { Q: 1 } },
      ],
    });
    expect(r.map((c) => c.pass)).toEqual([true, true, false]);
    expect(r[2]!.message).toBe('Output Q is 0 but should be 1.');
  });

  it('power-cycle step clears volatile state (power: cycle)', () => {
    const r = all(compile(toggleBoard), {
      kind: 'sequence',
      steps: [
        { ticks: 2, expect: { Q: 1 } },
        { power: 'cycle', ticks: 0, expect: { Q: 0 } },
        { ticks: 2, expect: { Q: 1 } },
      ],
    });
    expect(r.map((c) => c.pass)).toEqual([true, true, true]);
    expect(r[1]!.cycle).toBe(0);
  });

  it('passes the level power mode to the engine', () => {
    const seen: EngineOptions[] = [];
    const nl = compile(toggleBoard);
    all(nl, { kind: 'sequence', steps: [{ ticks: 0 }] }, {
      powerOnState: 'random',
      createEngine: (n, o) => {
        seen.push(o);
        return new FastEngine(n, o);
      },
    });
    expect(seen[0]!.powerOnState).toBe('random');
  });

  it('stops at the wall-clock budget during long steps', () => {
    let t = 0;
    const r = all(compile(toggleBoard), { kind: 'sequence', steps: [{ ticks: 100_000 }, { ticks: 1 }] }, { now: () => (t += 1), budgetMs: 3 });
    expect(r).toHaveLength(1);
    expect(r[0]!.pass).toBe(false);
    expect(r[0]!.message).toMatch(/ran out of time during step 1/);
  });
});

describe('program', () => {
  const romBoard: Board = {
    parts: [part('rom1', 'rom', { label: 'ROM', props: { width: 8, addrWidth: 4, data: '' } }), part('h', 'lamp', { label: 'HALT' })],
    wires: [],
  };

  it('parses hex listings with comments, commas and 0x', () => {
    expect(parseProgram('0x01, 02 ; load\n# comment\nFF a')).toEqual({ data: '01 02 ff a' });
    expect(parseProgram('01 zz')).toEqual({ error: "The program has 'zz', which is not a hex number." });
  });

  it('loadProgram writes the ROM data without touching the original board', () => {
    const patched = loadProgram(romBoard, { program: '0x10 0x20', rom: 'ROM' });
    expect(patched.parts[0]!.props!.data).toBe('10 20');
    expect(patched.parts[0]!.props!.width).toBe(8);
    expect(romBoard.parts[0]!.props!.data).toBe('');
    expect(loadProgram(romBoard, { program: '10', rom: 'OTHER' })).toBe(romBoard);
  });

  const nl = fakeNl([['ROM', 'rom', 8], ['HALT', 'lamp', 1], ['CYC', 'lamp', 32]]);
  const spec = (maxCycles: number, expectCyc: number): TestSpec => ({ kind: 'program', program: '00', rom: 'ROM', halt: 'HALT', maxCycles, expect: { CYC: expectCyc } });

  it('runs until HALT and compares outputs, reporting cycles used', () => {
    const r = all(nl, spec(1000, 37), { createEngine: fake(nl, { haltAfter: 37, widths: {} }) });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'program', pass: true, halted: true, cycle: 37, summary: 'Halted after 37 of 1,000 cycles.' });
  });

  it('rejects an off-by-one result', () => {
    const r = all(nl, spec(1000, 36), { createEngine: fake(nl, { haltAfter: 37, widths: {} }) });
    expect(r[0]!.pass).toBe(false);
    expect(r[0]!.message).toBe('Output CYC is 37 but should be 36.');
  });

  it('E-SIM-10: a program that loops forever ends at the cycle budget and suggests a halt', () => {
    const r = all(nl, spec(500, 500), { createEngine: fake(nl, { widths: {} }) });
    expect(r[0]).toMatchObject({ pass: false, halted: false, cycle: 500 });
    expect(r[0]!.message).toMatch(/did not halt within 500 cycles.*halt instruction/);
  });

  it('E-SIM-10: an infinite loop ends at the wall-clock budget long before maxCycles', () => {
    let t = 0;
    const r = all(nl, spec(10_000_000, 0), { createEngine: fake(nl, { widths: {} }), now: () => (t += 1), budgetMs: 100 });
    expect(r).toHaveLength(1);
    expect(r[0]!.pass).toBe(false);
    expect(r[0]!.cycle).toBeLessThan(10_000);
    expect(r[0]!.message).toMatch(/time limit ran out.*halt instruction that sets HALT/);
  });

  it('E-SIM-10: a looping program on the real engine ends at the cycle budget', () => {
    const b: Board = { parts: [...romBoard.parts, part('clk', 'clock')], wires: [] };
    const real = compile(b);
    if (!real.parts.some((p) => p.type === 'rom')) return; // ROM not compiled by this engine yet
    const r = all(real, { kind: 'program', program: '00', rom: 'ROM', halt: 'HALT', maxCycles: 200, expect: {} });
    expect(r[0]).toMatchObject({ pass: false, cycle: 200 });
  });

  it('a board without the ROM fails clearly', () => {
    const r = all(compile(gate2Board('xor')), spec(10, 0));
    expect(r[0]!.message).toBe('There is no ROM labelled ROM on the board to load the program into.');
  });
});

describe('runTest', () => {
  it('refuses a netlist that cannot run (width mismatch)', () => {
    const nl = { ...compile(gate2Board('xor')), canRun: false, diagnostics: [{ code: 'width-mismatch', net: 0, pins: [] }] } as unknown as Netlist;
    const r = all(nl, { kind: 'truth-table', rows: [{ inputs: { A: 0 }, expect: { Y: 0 } }] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ pass: false, kind: 'truth-table' });
    expect(r[0]!.message).toMatch(/different widths/);
  });
});

describe('E-RES-06: an empty board fails every kind', () => {
  const nl = compile(empty);
  const tests: TestSpec[] = [
    { kind: 'truth-table', rows: [{ inputs: { A: 0 }, expect: { Y: 1 } }, { inputs: {}, expect: { Y: 0 } }] },
    { kind: 'exhaustive', inputs: ['A', 'B'], outputs: ['Y'], reference: 'test-xor' },
    { kind: 'random', inputs: ['A', 'B'], outputs: ['Y'], reference: 'test-xor', count: 10, seed: 1 },
    { kind: 'sequence', steps: [{ ticks: 2, expect: { Q: 0 } }, { set: { D: 1 }, ticks: 0 }] },
    { kind: 'program', program: '00', rom: 'ROM', halt: 'HALT', maxCycles: 10, expect: { OUT: 0 } },
  ];
  for (const test of tests) {
    it(`E-RES-06: ${test.kind} fails on an empty board`, () => {
      const r = all(nl, test);
      expect(r.length).toBeGreaterThan(0);
      expect(r.every((c) => !c.pass)).toBe(true);
      expect(r.every((c) => c.kind === test.kind && typeof c.message === 'string')).toBe(true);
    });
  }
});
