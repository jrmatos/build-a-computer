import { describe, expect, it } from 'vitest';
import { boardBuilder as board, rippleAdderBoard } from './boards';
import { FastEngine } from './fast-engine';
import { emptyStats, runDiff, type CircuitSpec } from './gen';
import { compile, R_FREE, R_TIMED, levelize, V0, V1, VX } from './index';

describe('levelize (SIM-03)', () => {
  it('puts a purely combinational adder entirely in the free region, levelized', () => {
    const nl = compile(rippleAdderBoard(4));
    const prog = levelize(nl);
    expect(prog.timedCount).toBe(0);
    expect(prog.freeCount).toBe(36);
    // Every free gate sits above all the free gates it reads.
    for (const p of prog.order) {
      for (const n of [prog.in0[p]!, prog.in1[p]!]) {
        for (let k = prog.drvStart[n]!; k < prog.drvStart[n + 1]!; k++) {
          const q = nl.slotPart[prog.drv[k]!]!;
          if (prog.region[q] === R_FREE) expect(prog.level[q]).toBeLessThan(prog.level[p]!);
        }
      }
    }
    // order is sorted by level.
    const levels = [...prog.order].map((p) => prog.level[p]!);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });

  it('marks loop gates and their fan-in cone as timed, and leaves the fan-out free', () => {
    // S -> buf(n0) -> SR latch (g1, g2) -> n3 -> lamp
    const nl = compile(board().part('S', 'switch').part('R', 'switch').part('n0', 'and').part('g1', 'nand').part('g2', 'nand')
      .part('n3', 'not').part('Y', 'lamp')
      .wire('S.out', 'n0.a').wire('S.out', 'n0.b').wire('n0.out', 'g1.a').wire('g2.out', 'g1.b')
      .wire('R.out', 'g2.a').wire('g1.out', 'g2.b').wire('g1.out', 'n3.in').wire('n3.out', 'Y.in').build());
    const prog = levelize(nl);
    const region = (id: string) => prog.region[nl.partIndex.get(id)!];
    expect(prog.comboLoop[nl.partIndex.get('g1')!]).toBe(1);
    expect(region('g1')).toBe(R_TIMED);
    expect(region('g2')).toBe(R_TIMED);
    expect(region('n0')).toBe(R_TIMED);
    expect(region('n3')).toBe(R_FREE);
  });

  it('treats a flip-flop feedback loop with a clean clock as acyclic logic', () => {
    // Toggle flip-flop: q -> not -> d, clock from the global clock.
    const nl = compile(board().part('C', 'clock').part('f', 'dff').part('n', 'not')
      .wire('C.out', 'f.clk').wire('f.q', 'n.in').wire('n.out', 'f.d').build());
    expect(nl.parts[nl.partIndex.get('n')!]!.inLoop).toBe(true); // compile's Tarjan sees the DFF edge
    const prog = levelize(nl);
    expect(prog.comboLoop[nl.partIndex.get('n')!]).toBe(0);
    expect(prog.cleanClock[nl.partIndex.get('f')!]).toBe(1);
    expect(prog.region[nl.partIndex.get('n')!]).toBe(R_FREE);
  });

  it('keeps the whole cone of a flip-flop clocked from logic timed', () => {
    const nl = compile(board().part('C', 'clock').part('E', 'switch').part('g', 'and').part('D', 'switch').part('x', 'not').part('f', 'dff')
      .wire('C.out', 'g.a').wire('E.out', 'g.b').wire('g.out', 'f.clk').wire('D.out', 'x.in').wire('x.out', 'f.d').build());
    const prog = levelize(nl);
    expect(prog.cleanClock[nl.partIndex.get('f')!]).toBe(0);
    expect(prog.region[nl.partIndex.get('g')!]).toBe(R_TIMED);
    expect(prog.region[nl.partIndex.get('x')!]).toBe(R_TIMED);
  });
});

describe('fast engine (SIM-04, SIM-05)', () => {
  it('E-SIM-01: a NOT gate wired to itself is reported unstable within the budget (fast engine)', () => {
    const nl = compile(board().part('n', 'not').wire('n.out', 'n.in').build());
    const r = new FastEngine(nl, { eventBudgetPerPart: 100 }).powerOn();
    expect(r.stable).toBe(false);
    expect(r.unstableNets).toEqual([nl.pinNet.get('n:out')]);
    expect(r.events).toBeLessThanOrEqual(102);
  });

  it('E-SIM-01: a ring of three inverters feeding free logic is unstable (fast engine)', () => {
    const nl = compile(board().part('a', 'not').part('b', 'not').part('c', 'not').part('d', 'not').part('Y', 'lamp')
      .wire('a.out', 'b.in').wire('b.out', 'c.in').wire('c.out', 'a.in').wire('c.out', 'd.in').wire('d.out', 'Y.in').build());
    const e = new FastEngine(nl);
    const r = e.powerOn();
    expect(r.stable).toBe(false);
    // The ring and the inverter it feeds are all still moving.
    expect(r.unstableNets.length).toBe(4);
    expect(e.stats.fallbacks).toBe(1);
  });

  it('E-SIM-02: contention on a net is reported and resolves to X', () => {
    const nl = compile(board().part('A', 'switch').part('B', 'switch').part('Y', 'lamp')
      .wire('A.out', 'Y.in').wire('B.out', 'Y.in').build());
    const e = new FastEngine(nl);
    e.setSwitch('A', true);
    const r = e.powerOn();
    expect(e.readPin('Y', 'in')).toBe(VX);
    expect(r.contentionNets).toEqual([nl.pinNet.get('Y:in')]);
    expect(e.setSwitch('B', true).contentionNets).toEqual([]);
    expect(e.readPin('Y', 'in')).toBe(V1);
  });

  it('adds a 32-bit ripple adder correctly on the fast path', () => {
    const nl = compile(rippleAdderBoard(32));
    const e = new FastEngine(nl);
    e.powerOn();
    const set = (prefix: string, v: number) => {
      for (let i = 0; i < 32; i++) e.setSwitch(`${prefix}${i}`, ((v >>> i) & 1) === 1);
    };
    const read = () => {
      let s = 0;
      for (let i = 0; i < 32; i++) if (e.readPin(`S${i}`, 'in') === V1) s |= 1 << i;
      return [s >>> 0, e.readPin('COUT', 'in')];
    };
    set('A', 0xffffffff);
    set('B', 0);
    e.setSwitch('CIN', true);
    expect(read()).toEqual([0, V1]);
    set('A', 0x12345678);
    set('B', 0x0fedcba9);
    e.setSwitch('CIN', false);
    expect(read()).toEqual([(0x12345678 + 0x0fedcba9) >>> 0, V0]);
    expect(e.stats.exactSettles).toBe(0);
    expect(e.stats.fallbacks).toBe(0);
  });

  it('a D flip-flop samples on the rising edge; power off clears state', () => {
    const nl = compile(board().part('D', 'switch').part('C', 'clock').part('f', 'dff')
      .wire('D.out', 'f.d').wire('C.out', 'f.clk').build());
    const e = new FastEngine(nl);
    e.powerOn();
    e.setSwitch('D', true);
    expect(e.readPin('f', 'q')).toBe(V0);
    e.tick();
    expect(e.readPin('f', 'q')).toBe(V1);
    e.powerOff();
    expect(e.tick().events).toBe(0);
    expect(e.readPin('f', 'q')).toBe(VX);
    e.powerOn();
    expect(e.readPin('f', 'q')).toBe(V0);
  });

  // Hand-picked timing-sensitive circuits, compared against the reference step by step.
  const diff = (spec: CircuitSpec, steps: number) =>
    runDiff({ spec, steps: Array.from({ length: steps }, (_, i) => (i % 3 === 2 ? { op: 'tick' as const } : { op: 'toggle' as const, sw: i })), opts: {} });

  it('matches the reference on a gated clock whose enable glitches', () => {
    // clk' = AND(clock, XOR(E, buf(E))): XOR of a signal with its delayed copy glitches.
    // types: 0 switch E, 1 clock, 2 not, 3 not, 4 xor, 5 and, 6 dff, 7 lamp
    const spec: CircuitSpec = {
      types: ['switch', 'clock', 'not', 'not', 'xor', 'and', 'dff', 'lamp'],
      wires: [[0, 2, 0], [2, 3, 0], [0, 4, 0], [3, 4, 1], [1, 5, 0], [4, 5, 1], [5, 6, 1], [0, 6, 0], [6, 7, 0]],
    };
    const s = diff(spec, 30);
    expect(s.steps).toBe(30);
  });

  it('matches the reference on a latch whose inputs race through free-looking logic', () => {
    // SR latch whose set and reset come from the same switch through different delays.
    const spec: CircuitSpec = {
      types: ['switch', 'not', 'not', 'nand', 'nand', 'not', 'lamp'],
      wires: [[0, 1, 0], [1, 2, 0], [0, 3, 0], [4, 3, 1], [2, 4, 0], [3, 4, 1], [3, 5, 0], [5, 6, 0]],
    };
    diff(spec, 20);
  });

  it('matches the reference on a toggle counter with a glitchy D cone (fast path)', () => {
    // 2-bit synchronous counter; the D logic is free because the clock is clean.
    const spec: CircuitSpec = {
      types: ['clock', 'dff', 'dff', 'not', 'xor', 'lamp', 'lamp'],
      wires: [[0, 1, 1], [0, 2, 1], [1, 3, 0], [3, 1, 0], [1, 4, 0], [2, 4, 1], [4, 2, 0], [1, 5, 0], [2, 6, 0]],
    };
    const s = emptyStats();
    runDiff({ spec, steps: Array.from({ length: 16 }, () => ({ op: 'tick' as const })), opts: {} }, s);
    expect(s.fastSettles).toBeGreaterThan(0);
    expect(s.fallbacks).toBe(0);
  });

  it('stays exact after an unstable settle leaves a free gate stale, then a glitch wakes it', () => {
    // E enables a ring oscillator; F = AND(ring, X) is free and is left stale when
    // the budget cuts the oscillation. X = XOR(A, NOT A) glitches when A toggles,
    // which wakes F in the reference even though X ends where it started.
    const spec: CircuitSpec = {
      types: ['switch', 'switch', 'nand', 'not', 'not', 'not', 'xor', 'and', 'lamp'],
      wires: [[0, 2, 0], [4, 2, 1], [2, 3, 0], [3, 4, 0], [1, 5, 0], [1, 6, 0], [5, 6, 1], [4, 7, 0], [6, 7, 1], [7, 8, 0]],
    };
    const t = (sw: number) => ({ op: 'toggle' as const, sw });
    const stats = emptyStats();
    for (const budget of [1, 2, 3, 4, 5, 7, 10, 40]) {
      for (const steps of [
        [t(0), t(0), t(1), t(1), t(1)],
        [t(1), t(0), t(0), t(1), t(1)],
        [t(0), t(1), t(0), t(1), t(1), t(1)],
      ]) {
        runDiff({ spec, steps, opts: { eventBudgetPerPart: budget } }, stats);
      }
    }
    expect(stats.unstable).toBeGreaterThan(0);
    expect(stats.fastSettles).toBeGreaterThan(0);
  });

  it('stays exact after power on forces a free gate on a flip-flop loop out of X', () => {
    // K = AND(Z, floating) is X, sits on the loop f.q -> Z -> K -> f.d, and is
    // forced to 0 at power on, so it no longer equals its function. Z = OR(q, Y)
    // glitches when A toggles (Y = XOR(A, NOT A)); the reference then re-evaluates K.
    const spec: CircuitSpec = {
      types: ['switch', 'clock', 'dff', 'not', 'xor', 'or', 'and', 'lamp'],
      wires: [[6, 2, 0], [1, 2, 1], [0, 3, 0], [0, 4, 0], [3, 4, 1], [2, 5, 0], [4, 5, 1], [5, 6, 0], [6, 7, 0]],
    };
    const t = { op: 'toggle' as const, sw: 0 };
    const stats = emptyStats();
    runDiff({ spec, steps: [t, t, { op: 'tick' }, t, { op: 'tick' }, t], opts: {} }, stats);
    expect(stats.fastSettles).toBeGreaterThan(0);
  });
});
