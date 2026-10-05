import { describe, expect, it } from 'vitest';
import { BLOCKS } from './blocks/index';
import { ReferenceEngine } from './engine';
import { checkEquivalence } from './swap';
import { board, def, fullAdder, notChip, orChip, toMap, xorNand } from './chips.fixtures';

/** The multi-bit engine API (setValue/readSignal) has landed. */
const busEngine = typeof (ReferenceEngine.prototype as unknown as { setValue?: unknown }).setValue === 'function';

describe('behavioral swap equivalence (CHIP-04)', () => {
  it('a NAND-built XOR matches the xor model, exhaustively', () => {
    expect(checkEquivalence(xorNand(), {}, 'xor')).toEqual({ ok: true, vectors: 4, exhaustive: true, sequential: false });
  });

  it('random vectors are used when the input space is larger than the budget', () => {
    const r = checkEquivalence(xorNand(), {}, 'xor', { vectors: 3, seed: 9 });
    expect(r).toEqual({ ok: true, vectors: 3, exhaustive: false, sequential: false });
  });

  it('E-SIM-09: a chip that differs from the model is refused and the differing input is shown', () => {
    // An OR chip claiming to be XOR: right on 3 of 4 rows (it would pass a partial test).
    const r = checkEquivalence(orChip(), toMap(notChip()), 'xor');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('mismatch');
    expect(r.vector!.inputs).toEqual({ a: 1, b: 1 });
    expect(r.vector!.expected.y).toMatchObject({ w: 1, v: 0, x: 0 });
    expect(r.vector!.actual.y).toMatchObject({ w: 1, v: 1, x: 0 });
    expect(r.message).toContain('a=1 b=1');
  });

  it('E-SIM-09: random fuzzing also catches a difference', () => {
    const r = checkEquivalence(orChip(), toMap(notChip()), 'xor', { vectors: 50, seed: 3 });
    expect(r).toMatchObject({ ok: false, reason: 'mismatch', vector: { inputs: { a: 1, b: 1 } } });
  });

  it('a model whose pins do not match the ports is refused', () => {
    expect(checkEquivalence(xorNand(), {}, 'not')).toMatchObject({ ok: false, reason: 'ports' });
  });

  it('an unstable chip is refused as unstable', () => {
    // y = NOT(y) ring through a NAND with the input: oscillates when a = 1.
    const ring = def(
      'ring',
      board().part('a', 'switch', { label: 'a' }).part('b', 'switch', { label: 'b' }).part('g', 'nand').part('y', 'lamp', { label: 'y' })
        .wire('a.out', 'g.a').wire('g.out', 'g.b').wire('g.out', 'y.in').build(),
      ['a', 'b'],
      ['y'],
    );
    // Matches nand while a = 0, then oscillates.
    expect(checkEquivalence(ring, {}, 'nand')).toMatchObject({ ok: false, reason: 'unstable', vector: { inputs: { a: 1 } } });
  });

  it('sequential: a chip around a D flip-flop matches the dff model; a transparent wire does not', () => {
    const reg = def(
      'reg',
      board().part('d', 'switch', { label: 'd' }).part('clk', 'switch', { label: 'clk' }).part('f', 'dff').part('q', 'lamp', { label: 'q' })
        .wire('d.out', 'f.d').wire('clk.out', 'f.clk').wire('f.q', 'q.in').build(),
      ['d', 'clk'],
      ['q'],
    );
    expect(checkEquivalence(reg, {}, 'dff', { vectors: 200 })).toEqual({ ok: true, vectors: 200, exhaustive: false, sequential: true });

    const leaky = def(
      'leaky',
      board().part('d', 'switch', { label: 'd' }).part('clk', 'switch', { label: 'clk' }).part('q', 'lamp', { label: 'q' }).wire('d.out', 'q.in').build(),
      ['d', 'clk'],
      ['q'],
    );
    const r = checkEquivalence(leaky, {}, 'dff', { vectors: 200 });
    expect(r).toMatchObject({ ok: false, reason: 'mismatch', vector: { phase: 'settle', inputs: { d: 1 } } });
  });

  it.skipIf(!BLOCKS.adder)('a NAND-built full adder matches the 1-bit adder model', () => {
    expect(checkEquivalence(fullAdder(), {}, 'adder')).toMatchObject({ ok: true, exhaustive: true, vectors: 8 });
  });

  it.skipIf(!BLOCKS.adder)('E-SIM-09: a full adder with a wrong carry is refused', () => {
    const fa = fullAdder();
    // cout = NAND(n1, n1) = a AND b: forgets the carry-in path.
    const wrong = { ...fa, board: { ...fa.board, wires: fa.board.wires.map((w) => (w.to.part === 'n9' && w.to.pin === 'b' ? { ...w, from: { part: 'n1', pin: 'out' } } : w)) } };
    const r = checkEquivalence(wrong, {}, 'adder');
    expect(r).toMatchObject({ ok: false, reason: 'mismatch' });
  });

  it.skipIf(!BLOCKS.adder || !busEngine)('multi-bit: a 4-bit adder chip on buses matches the adder model', () => {
    // A(4), B(4), cin -> splitters -> 4 full-adder chips -> joiner -> S(4), cout.
    const b = board()
      .part('A', 'switch', { label: 'a', props: { width: 4 } })
      .part('B', 'switch', { label: 'b', props: { width: 4 } })
      .part('C', 'switch', { label: 'cin' })
      .part('sa', 'splitter', { props: { width: 4, chunk: 1 } })
      .part('sb', 'splitter', { props: { width: 4, chunk: 1 } })
      .part('j', 'joiner', { props: { width: 4, chunk: 1 } })
      .part('S', 'lamp', { label: 'sum', props: { width: 4 } })
      .part('CO', 'lamp', { label: 'cout' })
      .wire('A.out', 'sa.in')
      .wire('B.out', 'sb.in')
      .wire('j.out', 'S.in');
    for (let i = 0; i < 4; i++) {
      b.chip(`fa${i}`, 'fa')
        .wire(`sa.o${i}`, `fa${i}.a`)
        .wire(`sb.o${i}`, `fa${i}.b`)
        .wire(i === 0 ? 'C.out' : `fa${i - 1}.cout`, `fa${i}.cin`)
        .wire(`fa${i}.sum`, `j.i${i}`);
    }
    b.wire('fa3.cout', 'CO.in');
    const add4 = def('add4', b.build(), ['A', 'B', 'C'], ['S', 'CO']);
    expect(checkEquivalence(add4, toMap(fullAdder()), 'adder')).toEqual({ ok: true, vectors: 512, exhaustive: true, sequential: false });
    // Over the budget: random vectors.
    expect(checkEquivalence(add4, toMap(fullAdder()), 'adder', { vectors: 300 })).toMatchObject({ ok: true, exhaustive: false });
  });
});
