import type { Board, Level } from '@build-a-computer/schema';
import { BoardBuilder, type Pin } from '../builder';

/**
 * Reference solutions for Track 1, Phases 0-2: one board per level, built only
 * from that level's palette on top of its starter. The content tests check
 * that each one passes its level (CNT-01 "missing solution" rule).
 */
type Solve = (b: BoardBuilder) => void;

/** Full adder from gates; returns [sum, carry]. */
function fullAdder(b: BoardBuilder, x: Pin, y: Pin, c: Pin): [Pin, Pin] {
  const p = b.gate('xor', x, y);
  const s = b.gate('xor', p, c);
  const cout = b.gate('or', b.gate('and', x, y), b.gate('and', p, c));
  return [s, cout];
}

/** One barrel stage: shift `x` (8 bits) by `k`, left or right, filling with `zero`. */
function shifted(b: BoardBuilder, x: Pin, k: number, dir: 'left' | 'right', zero: Pin): Pin {
  const bits = b.split(x, 8);
  const out = Array.from({ length: 8 }, (_, i) => {
    const src = dir === 'left' ? i - k : i + k;
    return src >= 0 && src < 8 ? bits[src]! : zero;
  });
  return b.join(out);
}

/** Barrel shifter: shift `x` by the 3 select pins `s` (bit 0 first). */
function barrel(b: BoardBuilder, x: Pin, s: Pin[], dir: 'left' | 'right', zero: Pin): Pin {
  let v = x;
  [1, 2, 4].forEach((k, i) => (v = b.mux(v, shifted(b, v, k, dir, zero), s[i]!, 8)));
  return v;
}

/** Mux tree over 2^n inputs with select pins `sel` (bit 0 first). */
function muxTree(b: BoardBuilder, inputs: Pin[], sel: Pin[], width: number): Pin {
  let level = inputs;
  for (const s of sel) {
    const next: Pin[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(b.mux(level[i]!, level[i + 1]!, s, width));
    level = next;
  }
  return level[0]!;
}

export const SOLUTIONS: Record<string, Solve> = {
  // Phase 0
  'wires-and-lamps': (b) => void b.wire(b.in('A'), b.out('Y')),
  switches: (b) => void b.wire(b.in('B'), b.out('X')).wire(b.in('A'), b.out('Y')).wire(b.in('A'), b.out('Z')),
  'meet-nand': (b) => void b.wire(b.gate('nand', b.in('A'), b.in('B')), b.out('Y')),

  // Phase 1
  'not-gate': (b) => void b.wire(b.nandNot(b.in('A')), b.out('Y')),
  'and-gate': (b) => void b.wire(b.not(b.gate('nand', b.in('A'), b.in('B'))), b.out('Y')),
  'or-gate': (b) => void b.wire(b.gate('nand', b.not(b.in('A')), b.not(b.in('B'))), b.out('Y')),
  'nor-gate': (b) => void b.wire(b.not(b.gate('or', b.in('A'), b.in('B'))), b.out('Y')),
  'xor-gate': (b) => {
    const a = b.in('A');
    const c = b.in('B');
    b.wire(b.gate('and', b.gate('or', a, c), b.gate('nand', a, c)), b.out('Y'));
  },
  'xnor-gate': (b) => void b.wire(b.not(b.gate('xor', b.in('A'), b.in('B'))), b.out('Y')),
  'and3-gate': (b) => void b.wire(b.gate('and', b.gate('and', b.in('A'), b.in('B')), b.in('C')), b.out('Y')),
  mux: (b) => {
    const s = b.in('S');
    b.wire(b.gate('or', b.gate('and', b.in('A'), b.not(s)), b.gate('and', b.in('B'), s)), b.out('Y'));
  },
  demux: (b) => {
    const s = b.in('S');
    const x = b.in('X');
    b.wire(b.gate('and', x, b.not(s)), b.out('A')).wire(b.gate('and', x, s), b.out('B'));
  },
  'decoder-2to4': (b) => {
    const a = b.in('S1');
    const c = b.in('S0');
    const na = b.not(a);
    const nc = b.not(c);
    b.wire(b.gate('and', na, nc), b.out('Y0'))
      .wire(b.gate('and', na, c), b.out('Y1'))
      .wire(b.gate('and', a, nc), b.out('Y2'))
      .wire(b.gate('and', a, c), b.out('Y3'));
  },

  // Phase 2
  'binary-counting': (b) => void b.wire(b.join(Array.from({ length: 8 }, (_, k) => b.in(`B${k}`))), b.out('Y')),
  'half-adder': (b) => {
    b.wire(b.gate('xor', b.in('A'), b.in('B')), b.out('S')).wire(b.gate('and', b.in('A'), b.in('B')), b.out('C'));
  },
  'full-adder': (b) => {
    const [s, c] = fullAdder(b, b.in('A'), b.in('B'), b.in('Cin'));
    b.wire(s, b.out('S')).wire(c, b.out('Cout'));
  },
  'adder-8bit': (b) => {
    const a = b.split(b.in('A'), 8);
    const y = b.split(b.in('B'), 8);
    let c = b.in('Cin');
    const sum: Pin[] = [];
    for (let i = 0; i < 8; i++) {
      const [s, co] = fullAdder(b, a[i]!, y[i]!, c);
      sum.push(s);
      c = co;
    }
    b.wire(b.join(sum), b.out('S')).wire(c, b.out('Cout'));
  },
  negation: (b) => {
    const [s] = b.adder(b.not(b.in('A'), 8), b.constant(0, 8), b.constant(1), 8);
    b.wire(s, b.out('Y'));
  },
  subtractor: (b) => {
    const [s] = b.adder(b.in('A'), b.not(b.in('B'), 8), b.constant(1), 8);
    b.wire(s, b.out('Y'));
  },
  equality: (b) => void b.wire(b.tree('and', b.split(b.gate('xnor', b.in('A'), b.in('B'), 8), 8)), b.out('Y')),
  'less-than': (b) => {
    const [, ge] = b.adder(b.in('A'), b.not(b.in('B'), 8), b.constant(1), 8);
    const ltu = b.not(ge);
    const a7 = b.split(b.in('A'), 8)[7]!;
    const b7 = b.split(b.in('B'), 8)[7]!;
    b.wire(ltu, b.out('LTU')).wire(b.gate('xor', ltu, b.gate('xor', a7, b7)), b.out('LTS'));
  },
  'logic-unit': (b) => {
    const a = b.in('A');
    const y = b.in('B');
    const ops = [b.gate('and', a, y, 8), b.gate('or', a, y, 8), b.gate('xor', a, y, 8), b.not(a, 8)];
    b.wire(muxTree(b, ops, b.split(b.in('OP'), 2), 8), b.out('Y'));
  },
  shifter: (b) => {
    const zero = b.constant(0);
    const s = b.split(b.in('SH'), 3);
    const left = barrel(b, b.in('A'), s, 'left', zero);
    const right = barrel(b, b.in('A'), s, 'right', zero);
    b.wire(b.mux(left, right, b.in('DIR'), 8), b.out('Y'));
  },
  'alu-8bit': (b) => {
    const a = b.in('A');
    const y = b.in('B');
    const zero = b.constant(0);
    const [add, addC] = b.adder(a, y, zero, 8);
    const [sub, subC] = b.adder(a, b.not(y, 8), b.constant(1), 8);
    const sh = b.split(y, 8).slice(0, 3);
    const results = [
      add,
      sub,
      b.gate('and', a, y, 8),
      b.gate('or', a, y, 8),
      b.gate('xor', a, y, 8),
      b.not(a, 8),
      barrel(b, a, sh, 'left', zero),
      barrel(b, a, sh, 'right', zero),
    ];
    const op = b.split(b.in('OP'), 3);
    const out = muxTree(b, results, op, 8);
    const bits = b.split(out, 8);
    b.wire(out, b.out('Y'))
      .wire(b.not(b.tree('or', bits)), b.out('Z'))
      .wire(bits[7]!, b.out('N'))
      .wire(b.gate('and', b.mux(addC, subC, op[0]!), b.gate('nor', op[1]!, op[2]!)), b.out('C'));
  },
  'alu-32bit': (b) => {
    const id = b.add('alu', { width: 32 });
    b.wire(b.in('A'), [id, 'a'])
      .wire(b.in('B'), [id, 'b'])
      .wire(b.in('OP'), [id, 'op'])
      .wire([id, 'out'], b.out('Y'))
      .wire([id, 'zero'], b.out('Z'))
      .wire([id, 'neg'], b.out('N'))
      .wire([id, 'carry'], b.out('C'));
  },
};

/** The reference solution board for a level, or undefined when none is written. */
export function solutionFor(level: Level): Board | undefined {
  const solve = SOLUTIONS[level.id];
  if (!solve) return undefined;
  const b = new BoardBuilder(level.starter);
  solve(b);
  return b.board();
}
