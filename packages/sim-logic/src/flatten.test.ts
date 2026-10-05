import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import type { Board, ChipMap } from '@build-a-computer/schema';
import { ChipCycleError, flattenBoard } from './flatten';
import { compile } from './compile';
import { ReferenceEngine } from './engine';
import { V0, V1, VX } from './values';
import { andChip, board, def, fullAdder, notChip, orChip, rippleAdder, toMap, xorChip, xorNand } from './chips.fixtures';

const chips3 = (): ChipMap => toMap(notChip(), andChip(), orChip(), xorChip(), xorNand());

/** Truth table of a board's lamps over every combination of its 1-bit switches. */
function truthTable(b: Board, chips: ChipMap, inputs: string[], outputs: string[]): string[] {
  const flat = flattenBoard(b, chips);
  const e = new ReferenceEngine(compile(flat.board));
  e.powerOn();
  const rows: string[] = [];
  for (let k = 0; k < 1 << inputs.length; k++) {
    inputs.forEach((id, i) => e.setSwitch(id, ((k >> i) & 1) === 1));
    rows.push(outputs.map((o) => e.readPin(o, 'in')).join(''));
  }
  return rows;
}

/** A top board with switches A, B -> chip `c` -> lamp Y. */
const harness2 = (chip: string) =>
  board().part('A', 'switch').part('B', 'switch').chip('c', chip).part('Y', 'lamp').wire('A.out', 'c.a').wire('B.out', 'c.b').wire('c.y', 'Y.in').build();

describe('flattenBoard', () => {
  it('a board without chips is returned as is', () => {
    const b = board().part('A', 'switch').part('Y', 'lamp').wire('A.out', 'Y.in').build();
    const r = flattenBoard(b, {});
    expect(r.board.parts).toEqual(b.parts);
    expect(r.board.wires).toEqual(b.wires);
    expect(r.problems).toEqual([]);
    expect(r.origin.get('A')).toEqual([]);
  });

  it('XOR built from chips nested 3 deep has the same truth table as the flat NAND XOR', () => {
    const chips = chips3();
    const nested = truthTable(harness2('xor3'), chips, ['A', 'B'], ['Y']);
    const flat = truthTable(harness2('xor4'), chips, ['A', 'B'], ['Y']);
    expect(nested).toEqual(['0', '1', '1', '0']);
    expect(nested).toEqual(flat);
  });

  it('nested ids are instance paths, ports vanish, origin keeps the path', () => {
    const r = flattenBoard(harness2('xor3'), chips3());
    const ids = r.board.parts.map((p) => p.id);
    // xor3 -> x (and1) -> n (not1) -> g (nand)
    expect(ids).toContain('c/x/n/g');
    expect(r.origin.get('c/x/n/g')).toEqual(['c', 'x', 'n']);
    // No chip parts, and no port switches/lamps from inside chips.
    expect(r.board.parts.every((p) => p.type !== 'chip')).toBe(true);
    expect(r.board.parts.filter((p) => p.type === 'switch').map((p) => p.id)).toEqual(['A', 'B']);
    expect(r.board.parts.filter((p) => p.type === 'lamp').map((p) => p.id)).toEqual(['Y']);
    // 1 + 2 + 2*1... count NANDs: or1 = 3, and1 = 2, not1 = 1, and1 = 2 -> 8.
    expect(r.board.parts.filter((p) => p.type === 'nand')).toHaveLength(8);
    expect(r.board.wires.every((w) => !w.from.part.endsWith('/a') && !w.to.part.endsWith('/y'))).toBe(true);
    expect(compile(r.board).diagnostics).toEqual([]);
  });

  it('a nested full adder chain adds correctly (4-bit ripple of NAND full adders)', () => {
    const chips = toMap(fullAdder(), rippleAdder(4));
    const b = board().chip('add', 'add4');
    const ins: string[] = [];
    for (const n of [...[0, 1, 2, 3].flatMap((i) => [`a${i}`, `b${i}`]), 'cin']) {
      b.part(`S${n}`, 'switch').wire(`S${n}.out`, `add.${n}`);
      ins.push(`S${n}`);
    }
    const outs = ['s0', 's1', 's2', 's3', 'cout'];
    for (const n of outs) b.part(`L${n}`, 'lamp').wire(`add.${n}`, `L${n}.in`);
    const e = new ReferenceEngine(compile(flattenBoard(b.build(), chips).board));
    e.powerOn();
    for (const [a, c, cin] of [[0, 0, 0], [5, 9, 0], [15, 1, 0], [7, 8, 1], [15, 15, 1], [3, 12, 1]] as const) {
      for (let i = 0; i < 4; i++) {
        e.setSwitch(`Sa${i}`, ((a >> i) & 1) === 1);
        e.setSwitch(`Sb${i}`, ((c >> i) & 1) === 1);
      }
      e.setSwitch('Scin', cin === 1);
      const got = outs.reduce((s, o, i) => s + (e.readPin(`L${o}`, 'in') === V1 ? 1 << i : 0), 0);
      expect(got).toBe(a + c + cin);
    }
  });

  it('zero-delay ports: an SR latch built across chip boundaries settles exactly like the flat one', () => {
    // One NAND per chip; the cross-coupling wires run outside the chips.
    const nandChip = def(
      'nandc',
      board().part('a', 'switch').part('b', 'switch').part('g', 'nand').part('y', 'lamp')
        .wire('a.out', 'g.a').wire('b.out', 'g.b').wire('g.out', 'y.in').build(),
      ['a', 'b'],
      ['y'],
    );
    const chipped = board().part('S', 'switch', { on: true }).part('R', 'switch', { on: true })
      .chip('u', 'nandc').chip('v', 'nandc').part('Q', 'lamp')
      .wire('S.out', 'u.a').wire('v.y', 'u.b').wire('R.out', 'v.a').wire('u.y', 'v.b').wire('u.y', 'Q.in').build();
    const flat = board().part('S', 'switch', { on: true }).part('R', 'switch', { on: true })
      .part('u', 'nand').part('v', 'nand').part('Q', 'lamp')
      .wire('S.out', 'u.a').wire('v.out', 'u.b').wire('R.out', 'v.a').wire('u.out', 'v.b').wire('u.out', 'Q.in').build();
    const ec = new ReferenceEngine(compile(flattenBoard(chipped, { nandc: nandChip }).board));
    const ef = new ReferenceEngine(compile(flat));
    const a = ec.powerOn();
    const b = ef.powerOn();
    expect(a.stable && b.stable).toBe(true);
    expect(ec.readPin('Q', 'in')).toBe(ef.readPin('Q', 'in'));
    // Set (S low), hold, reset (R low), hold: same values and same event counts each step.
    for (const [s, r] of [[false, true], [true, true], [true, false], [true, true], [false, true]] as const) {
      const rc = [ec.setSwitch('S', s), ec.setSwitch('R', r)];
      const rf = [ef.setSwitch('S', s), ef.setSwitch('R', r)];
      expect(rc.map((x) => [x.stable, x.events])).toEqual(rf.map((x) => [x.stable, x.events]));
      expect(ec.readPin('Q', 'in')).toBe(ef.readPin('Q', 'in'));
    }
    expect(ec.readPin('Q', 'in')).toBe(V1);
  });

  it('E-SIM-03: an unconnected chip input reads X inside and is reported floating', () => {
    const b = board().chip('n', 'not1').part('Y', 'lamp').wire('n.y', 'Y.in').build();
    const r = flattenBoard(b, toMap(notChip()));
    const nl = compile(r.board);
    const e = new ReferenceEngine(nl);
    e.powerOn();
    expect(e.readPin('Y', 'in')).toBe(VX);
    expect(nl.diagnostics).toContainEqual({ code: 'floating-input', part: 'n/g', pin: 'a' });
  });

  it('an unconnected chip output reads X outside', () => {
    const dead = def('dead', board().part('a', 'switch').part('y', 'lamp').build(), ['a'], ['y']);
    const b = board().part('A', 'switch').chip('d', 'dead').part('Y', 'lamp').wire('A.out', 'd.a').wire('d.y', 'Y.in').build();
    const e = new ReferenceEngine(compile(flattenBoard(b, { dead }).board));
    e.powerOn();
    expect(e.readPin('Y', 'in')).toBe(VX);
  });

  it('a pass-through chip (output lamp wired straight to an input switch) works, nested twice', () => {
    const wire1 = def('wire1', board().part('a', 'switch').part('y', 'lamp').wire('a.out', 'y.in').build(), ['a'], ['y']);
    const wire2 = def('wire2', board().part('a', 'switch').chip('w', 'wire1').part('y', 'lamp').wire('a.out', 'w.a').wire('w.y', 'y.in').build(), ['a'], ['y']);
    const b = board().part('A', 'switch').chip('p', 'wire2').part('Y', 'lamp').part('Z', 'lamp')
      .wire('A.out', 'p.a').wire('p.y', 'Y.in').wire('p.y', 'Z.in').build();
    const r = flattenBoard(b, toMap(wire1, wire2));
    expect(r.board.parts.map((p) => p.id)).toEqual(['A', 'Y', 'Z']);
    const e = new ReferenceEngine(compile(r.board));
    e.powerOn();
    expect([e.readPin('Y', 'in'), e.readPin('Z', 'in')]).toEqual([V0, V0]);
    e.setSwitch('A', true);
    expect([e.readPin('Y', 'in'), e.readPin('Z', 'in')]).toEqual([V1, V1]);
  });

  it('chips with a model run as one built-in part; pins renamed by port order', () => {
    const chips = toMap({ ...xorNand('myxor'), model: 'xor' });
    const r = flattenBoard(harness2('myxor'), chips);
    expect(r.board.parts.find((p) => p.id === 'c')).toMatchObject({ type: 'xor', props: { width: 1 } });
    expect(r.board.wires.map((w) => `${w.from.part}.${w.from.pin}>${w.to.part}.${w.to.pin}`)).toEqual(['A.out>c.a', 'B.out>c.b', 'c.out>Y.in']);
    expect(truthTable(harness2('myxor'), chips, ['A', 'B'], ['Y'])).toEqual(['0', '1', '1', '0']);
    // simulateGates runs the player's NANDs instead.
    const gates = flattenBoard(harness2('myxor'), toMap({ ...xorNand('myxor'), model: 'xor', simulateGates: true }));
    expect(gates.board.parts.filter((p) => p.type === 'nand')).toHaveLength(4);
  });

  it('a model whose pins do not match the ports is rejected and the gates run instead', () => {
    const r = flattenBoard(harness2('myxor'), toMap({ ...xorNand('myxor'), model: 'not' }));
    expect(r.problems.map((p) => p.code)).toEqual(['model-mismatch']);
    expect(r.board.parts.filter((p) => p.type === 'nand')).toHaveLength(4);
  });

  it('E-DATA-08: a tombstoned chip still loads and runs; a missing chip is reported, not thrown', () => {
    const chips = chips3();
    chips.xor4 = { ...chips.xor4!, deleted: true };
    const r = flattenBoard(harness2('xor4'), chips);
    expect(r.problems).toEqual([expect.objectContaining({ code: 'deleted-chip', part: 'c' })]);
    expect(truthTable(harness2('xor4'), chips, ['A', 'B'], ['Y'])).toEqual(['0', '1', '1', '0']);

    const missing = flattenBoard(harness2('gone'), chips);
    expect(missing.problems).toEqual([expect.objectContaining({ code: 'missing-chip', part: 'c' })]);
    expect(missing.board.parts.map((p) => p.id)).toEqual(['A', 'B', 'Y']);
    expect(missing.board.wires).toEqual([]);
    expect(() => compile(missing.board)).not.toThrow();
  });

  it('bad ports and wires to unknown chip pins are reported', () => {
    const bad = def('bad', board().part('a', 'nand').part('y', 'lamp').build(), ['a'], ['y']);
    const b = board().part('A', 'switch').chip('c', 'bad').wire('A.out', 'c.a').build();
    const r = flattenBoard(b, { bad });
    expect(r.problems.map((p) => p.code)).toEqual(['bad-port', 'unknown-pin']);
  });

  it('E-SIM-05: a chip that contains itself directly throws ChipCycleError', () => {
    const self = def('self', board().part('a', 'switch').chip('me', 'self').build(), ['a'], []);
    const b = board().chip('top', 'self').build();
    expect(() => flattenBoard(b, { self })).toThrow(ChipCycleError);
    try {
      flattenBoard(b, { self });
    } catch (e) {
      expect((e as ChipCycleError).path).toEqual(['self', 'self']);
    }
  });

  it('E-SIM-05: a chip that contains itself through other chips throws with the path', () => {
    const a = def('A', board().chip('x', 'B').build(), [], []);
    const b = def('B', board().chip('y', 'C').build(), [], []);
    const c = def('C', board().chip('z', 'A').build(), [], []);
    let err: unknown;
    try {
      flattenBoard(board().chip('top', 'A').build(), toMap(a, b, c));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ChipCycleError);
    expect((err as ChipCycleError).path).toEqual(['A', 'B', 'C', 'A']);
    expect((err as Error).message).toContain('A → B → C → A');
  });

  it('the same chip used twice side by side is not a cycle', () => {
    const r = flattenBoard(board().chip('p', 'not1').chip('q', 'not1').build(), toMap(notChip()));
    expect(r.board.parts.map((p) => p.id)).toEqual(['p/g', 'q/g']);
  });

  it('is fast: a 32-bit adder of 32 NAND full adders, and 8 doubling levels of nesting', () => {
    const chips = toMap(fullAdder(), rippleAdder(32));
    const t0 = performance.now();
    const r = flattenBoard(board().chip('add', 'add32').build(), chips);
    expect(r.board.parts.filter((p) => p.type === 'nand')).toHaveLength(32 * 9);
    expect(compile(r.board).diagnostics.filter((d) => d.code !== 'floating-input')).toEqual([]);

    // L0 = NOT; Lk = two L(k-1) in series. L8 = 256 NANDs, 8 levels deep.
    const levels: ChipMap = { L0: { ...notChip(), id: 'L0' } };
    for (let k = 1; k <= 8; k++) {
      levels[`L${k}`] = def(
        `L${k}`,
        board().part('a', 'switch', { label: 'a' }).chip('p', `L${k - 1}`).chip('q', `L${k - 1}`).part('y', 'lamp', { label: 'y' })
          .wire('a.out', 'p.a').wire('p.y', 'q.a').wire('q.y', 'y.in').build(),
        ['a'],
        ['y'],
      );
    }
    const deep = board().part('A', 'switch').chip('top', 'L8').part('Y', 'lamp').wire('A.out', 'top.a').wire('top.y', 'Y.in').build();
    const f = flattenBoard(deep, levels);
    expect(f.board.parts.filter((p) => p.type === 'nand')).toHaveLength(256);
    expect(f.board.parts.some((p) => p.id === 'top/p/p/p/p/p/p/p/p/g')).toBe(true);
    const e = new ReferenceEngine(compile(f.board));
    e.powerOn();
    expect(e.readPin('Y', 'in')).toBe(V0); // even number of inverters
    e.setSwitch('A', true);
    expect(e.readPin('Y', 'in')).toBe(V1);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
