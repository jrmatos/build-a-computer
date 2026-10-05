import { describe, expect, it } from 'vitest';
import type { Board, Part, PartType, Wire } from '@ground-up/schema';
import { CompileError, LIMITS, ReferenceEngine, V0, V1, VX, compile, runTruthTable } from './index';

/** Tiny board builder for tests. */
function board() {
  const parts: Part[] = [];
  const wires: Wire[] = [];
  const api = {
    part(id: string, type: PartType, label?: string) {
      parts.push({ id, type, x: 0, y: 0, rot: 0, flip: false, ...(label ? { label } : {}) });
      return api;
    },
    wire(from: string, to: string) {
      const [fp, fpin] = from.split('.') as [string, string];
      const [tp, tpin] = to.split('.') as [string, string];
      wires.push({ id: `w${wires.length}`, from: { part: fp, pin: fpin }, to: { part: tp, pin: tpin }, points: [] });
      return api;
    },
    build: (): Board => ({ parts, wires }),
  };
  return api;
}

/** NOT from one NAND: both inputs tied to A. */
const notFromNand = () =>
  board().part('A', 'switch', 'A').part('g', 'nand').part('Y', 'lamp', 'Y')
    .wire('A.out', 'g.a').wire('A.out', 'g.b').wire('g.out', 'Y.in');

describe('reference engine', () => {
  it('NAND-built NOT passes its truth table', () => {
    const nl = compile(notFromNand().build());
    const rows = [...runTruthTable(nl, { kind: 'truth-table', rows: [
      { inputs: { A: 0 }, expect: { Y: 1 } },
      { inputs: { A: 1 }, expect: { Y: 0 } },
    ] })];
    expect(rows.every((r) => r.pass)).toBe(true);
  });

  it('NAND-built AND, OR and XOR pass their truth tables', () => {
    // AND = NOT(NAND(a,b))
    const andB = board().part('A', 'switch', 'A').part('B', 'switch', 'B').part('n1', 'nand').part('n2', 'nand').part('Y', 'lamp', 'Y')
      .wire('A.out', 'n1.a').wire('B.out', 'n1.b').wire('n1.out', 'n2.a').wire('n1.out', 'n2.b').wire('n2.out', 'Y.in');
    // OR = NAND(NOT a, NOT b)
    const orB = board().part('A', 'switch', 'A').part('B', 'switch', 'B').part('na', 'nand').part('nb', 'nand').part('n', 'nand').part('Y', 'lamp', 'Y')
      .wire('A.out', 'na.a').wire('A.out', 'na.b').wire('B.out', 'nb.a').wire('B.out', 'nb.b')
      .wire('na.out', 'n.a').wire('nb.out', 'n.b').wire('n.out', 'Y.in');
    // XOR from four NANDs.
    const xorB = board().part('A', 'switch', 'A').part('B', 'switch', 'B').part('m', 'nand').part('p', 'nand').part('q', 'nand').part('r', 'nand').part('Y', 'lamp', 'Y')
      .wire('A.out', 'm.a').wire('B.out', 'm.b').wire('A.out', 'p.a').wire('m.out', 'p.b')
      .wire('B.out', 'q.a').wire('m.out', 'q.b').wire('p.out', 'r.a').wire('q.out', 'r.b').wire('r.out', 'Y.in');
    const table = (f: (a: number, b: number) => number) => ({
      kind: 'truth-table' as const,
      rows: [0, 1].flatMap((a) => [0, 1].map((b) => ({ inputs: { A: a as 0 | 1, B: b as 0 | 1 }, expect: { Y: f(a, b) as 0 | 1 } }))),
    });
    for (const [b, f] of [[andB, (a: number, c: number) => a & c], [orB, (a: number, c: number) => a | c], [xorB, (a: number, c: number) => a ^ c]] as const) {
      const results = [...runTruthTable(compile(b.build()), table(f))];
      expect(results.map((r) => r.pass)).toEqual([true, true, true, true]);
    }
  });

  it('an SR latch from two NANDs settles and holds its state', () => {
    // Active-low set and reset.
    const nl = compile(board().part('S', 'switch').part('R', 'switch').part('g1', 'nand').part('g2', 'nand')
      .wire('S.out', 'g1.a').wire('g2.out', 'g1.b').wire('R.out', 'g2.a').wire('g1.out', 'g2.b').build());
    const e = new ReferenceEngine(nl);
    e.setSwitch('S', true);
    e.setSwitch('R', true);
    expect(e.powerOn().stable).toBe(true);
    expect([e.readPin('g1', 'out'), e.readPin('g2', 'out')].sort()).toEqual([V0, V1]);
    e.setSwitch('S', false); // set
    expect(e.readPin('g1', 'out')).toBe(V1);
    e.setSwitch('S', true); // hold
    expect(e.readPin('g1', 'out')).toBe(V1);
    expect(e.readPin('g2', 'out')).toBe(V0);
    e.setSwitch('R', false); // reset
    e.setSwitch('R', true);
    expect(e.readPin('g1', 'out')).toBe(V0);
  });

  it('E-SIM-01: a NOT gate wired to itself is reported unstable within the budget', () => {
    const nl = compile(board().part('n', 'not').wire('n.out', 'n.in').build());
    const r = new ReferenceEngine(nl, { eventBudgetPerPart: 100 }).powerOn();
    expect(r.stable).toBe(false);
    expect(r.unstableNets).toEqual([nl.pinNet.get('n:out')]);
    expect(r.events).toBeLessThanOrEqual(102);
  });

  it('E-SIM-01: a ring of three inverters is unstable', () => {
    const nl = compile(board().part('a', 'not').part('b', 'not').part('c', 'not')
      .wire('a.out', 'b.in').wire('b.out', 'c.in').wire('c.out', 'a.in').build());
    const r = new ReferenceEngine(nl).powerOn();
    expect(r.stable).toBe(false);
    expect(r.unstableNets.length).toBe(3);
  });

  it('E-SIM-02: two outputs driving one net with different values give X and contention', () => {
    const nl = compile(board().part('A', 'switch').part('B', 'switch').part('Y', 'lamp')
      .wire('A.out', 'Y.in').wire('B.out', 'Y.in').build());
    const e = new ReferenceEngine(nl);
    e.setSwitch('A', true);
    const r = e.powerOn();
    expect(e.readPin('Y', 'in')).toBe(VX);
    expect(r.contentionNets).toEqual([nl.pinNet.get('Y:in')]);
    expect(e.setSwitch('B', true).contentionNets).toEqual([]);
    expect(e.readPin('Y', 'in')).toBe(V1);
  });

  it('E-SIM-03: an unconnected input reads X and is reported', () => {
    const nl = compile(board().part('g', 'nand').part('A', 'switch', 'A').part('Y', 'lamp', 'Y')
      .wire('A.out', 'g.a').wire('g.out', 'Y.in').build());
    expect(nl.diagnostics).toContainEqual({ code: 'floating-input', part: 'g', pin: 'b' });
    const [row] = [...runTruthTable(nl, { kind: 'truth-table', rows: [{ inputs: { A: 1 }, expect: { Y: 0 } }] })];
    expect(row!.pass).toBe(false);
    expect(row!.actual.Y).toBe('X');
    // X does not propagate when the other input decides: NAND(0, X) = 1.
    const [row0] = [...runTruthTable(nl, { kind: 'truth-table', rows: [{ inputs: { A: 0 }, expect: { Y: 1 } }] })];
    expect(row0!.pass).toBe(true);
  });

  it('E-SIM-06: a design over the gate limit is refused before running', () => {
    const parts = Array.from({ length: LIMITS.maxGates + 1 }, (_, i) => ({ id: `g${i}`, type: 'nand' as const, x: 0, y: 0, rot: 0 as const, flip: false }));
    expect(() => compile({ parts, wires: [] })).toThrow(CompileError);
  });

  it('a D flip-flop samples on the rising clock edge', () => {
    const nl = compile(board().part('D', 'switch').part('C', 'clock').part('f', 'dff')
      .wire('D.out', 'f.d').wire('C.out', 'f.clk').build());
    const e = new ReferenceEngine(nl);
    e.powerOn();
    expect(e.readPin('f', 'q')).toBe(V0);
    e.setSwitch('D', true);
    expect(e.readPin('f', 'q')).toBe(V0); // no edge yet
    e.tick(); // rising
    expect(e.readPin('f', 'q')).toBe(V1);
    e.setSwitch('D', false);
    e.tick(); // falling
    expect(e.readPin('f', 'q')).toBe(V1);
    e.tick(); // rising
    expect(e.readPin('f', 'q')).toBe(V0);
  });

  it('E-SIM-08: power off clears volatile state', () => {
    const nl = compile(board().part('D', 'switch').part('C', 'clock').part('f', 'dff')
      .wire('D.out', 'f.d').wire('C.out', 'f.clk').build());
    const e = new ReferenceEngine(nl);
    e.setSwitch('D', true);
    e.powerOn();
    e.tick();
    expect(e.readPin('f', 'q')).toBe(V1);
    e.powerOff();
    expect(e.tick().events).toBe(0);
    expect(e.readPin('f', 'q')).toBe(VX);
    e.powerOn();
    expect(e.readPin('f', 'q')).toBe(V0);
  });

  it('E-SIM-07: random power-on state is reproducible from the seed', () => {
    const b = board();
    for (let i = 0; i < 16; i++) b.part(`f${i}`, 'dff');
    const nl = compile(b.build());
    const read = (seed: number) => {
      const e = new ReferenceEngine(nl, { powerOnState: 'random', seed });
      e.powerOn();
      return nl.parts.map((p) => e.readPin(p.id, 'q')).join('');
    };
    expect(read(5)).toBe(read(5));
    expect(read(5)).not.toBe(read(6));
  });
});
