/** Test fixtures for flatten/chips/swap tests: NAND-built chips. Not exported from the package. */
import type { Board, ChipDef, ChipMap, Part, PartType, Wire } from '@build-a-computer/schema';

export function board() {
  const parts: Part[] = [];
  const wires: Wire[] = [];
  const api = {
    part(id: string, type: PartType, extra: Partial<Part> = {}) {
      parts.push({ id, type, x: 0, y: parts.length, rot: 0, flip: false, ...extra });
      return api;
    },
    chip(id: string, chip: string) {
      return api.part(id, 'chip', { chip });
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

export const def = (id: string, b: Board, inputs: string[], outputs: string[], extra: Partial<ChipDef> = {}): ChipDef => ({
  id,
  name: id.toUpperCase(),
  version: 1,
  board: b,
  ports: { inputs, outputs },
  ...extra,
});

/** Ports labelled like their ids so pin names are readable. */
const sw = (b: ReturnType<typeof board>, ...ids: string[]) => {
  for (const id of ids) b.part(id, 'switch', { label: id });
  return b;
};
const lamp = (b: ReturnType<typeof board>, ...ids: string[]) => {
  for (const id of ids) b.part(id, 'lamp', { label: id });
  return b;
};

/** NOT = NAND(a, a). */
export const notChip = () => def('not1', lamp(sw(board(), 'a').part('g', 'nand'), 'y').wire('a.out', 'g.a').wire('a.out', 'g.b').wire('g.out', 'y.in').build(), ['a'], ['y']);

/** AND = NOT(NAND(a, b)), using the NOT chip. */
export const andChip = () =>
  def(
    'and1',
    lamp(sw(board(), 'a', 'b').part('g', 'nand').chip('n', 'not1'), 'y')
      .wire('a.out', 'g.a')
      .wire('b.out', 'g.b')
      .wire('g.out', 'n.a')
      .wire('n.y', 'y.in')
      .build(),
    ['a', 'b'],
    ['y'],
  );

/** OR = NAND(NOT a, NOT b), using two NOT chips. */
export const orChip = () =>
  def(
    'or1',
    lamp(sw(board(), 'a', 'b').chip('na', 'not1').chip('nb', 'not1').part('g', 'nand'), 'y')
      .wire('a.out', 'na.a')
      .wire('b.out', 'nb.a')
      .wire('na.y', 'g.a')
      .wire('nb.y', 'g.b')
      .wire('g.out', 'y.in')
      .build(),
    ['a', 'b'],
    ['y'],
  );

/** XOR = (a OR b) AND NOT(a AND b): three levels of chips deep. */
export const xorChip = () =>
  def(
    'xor3',
    lamp(sw(board(), 'a', 'b').chip('o', 'or1').chip('n', 'and1').chip('inv', 'not1').chip('x', 'and1'), 'y')
      .wire('a.out', 'o.a')
      .wire('b.out', 'o.b')
      .wire('a.out', 'n.a')
      .wire('b.out', 'n.b')
      .wire('n.y', 'inv.a')
      .wire('o.y', 'x.a')
      .wire('inv.y', 'x.b')
      .wire('x.y', 'y.in')
      .build(),
    ['a', 'b'],
    ['y'],
  );

/** XOR from four NANDs, flat. */
export const xorNand = (id = 'xor4') =>
  def(
    id,
    lamp(sw(board(), 'a', 'b').part('m', 'nand').part('p', 'nand').part('q', 'nand').part('r', 'nand'), 'y')
      .wire('a.out', 'm.a')
      .wire('b.out', 'm.b')
      .wire('a.out', 'p.a')
      .wire('m.out', 'p.b')
      .wire('b.out', 'q.a')
      .wire('m.out', 'q.b')
      .wire('p.out', 'r.a')
      .wire('q.out', 'r.b')
      .wire('r.out', 'y.in')
      .build(),
    ['a', 'b'],
    ['y'],
  );

/** Full adder from nine NANDs: ports a, b, cin -> sum, cout. */
export const fullAdder = (id = 'fa') =>
  def(
    id,
    lamp(sw(board(), 'a', 'b', 'cin'), 'sum', 'cout')
      .part('n1', 'nand')
      .part('n2', 'nand')
      .part('n3', 'nand')
      .part('n4', 'nand') // n4 = a xor b
      .part('n5', 'nand')
      .part('n6', 'nand')
      .part('n7', 'nand')
      .part('n8', 'nand') // sum
      .part('n9', 'nand') // cout
      .wire('a.out', 'n1.a')
      .wire('b.out', 'n1.b')
      .wire('a.out', 'n2.a')
      .wire('n1.out', 'n2.b')
      .wire('b.out', 'n3.a')
      .wire('n1.out', 'n3.b')
      .wire('n2.out', 'n4.a')
      .wire('n3.out', 'n4.b')
      .wire('n4.out', 'n5.a')
      .wire('cin.out', 'n5.b')
      .wire('n4.out', 'n6.a')
      .wire('n5.out', 'n6.b')
      .wire('cin.out', 'n7.a')
      .wire('n5.out', 'n7.b')
      .wire('n6.out', 'n8.a')
      .wire('n7.out', 'n8.b')
      .wire('n8.out', 'sum.in')
      .wire('n1.out', 'n9.a')
      .wire('n5.out', 'n9.b')
      .wire('n9.out', 'cout.in')
      .build(),
    ['a', 'b', 'cin'],
    ['sum', 'cout'],
  );

/** n-bit ripple-carry adder of full-adder chips, 1-bit ports a0.., b0.., cin -> s0.., cout. */
export function rippleAdder(n: number, id = `add${n}`, fa = 'fa'): ChipDef {
  const b = board();
  const ins: string[] = [];
  const outs: string[] = [];
  for (let i = 0; i < n; i++) {
    b.part(`a${i}`, 'switch', { label: `a${i}` }).part(`b${i}`, 'switch', { label: `b${i}` });
    ins.push(`a${i}`, `b${i}`);
  }
  b.part('cin', 'switch', { label: 'cin' });
  ins.push('cin');
  for (let i = 0; i < n; i++) {
    b.chip(`fa${i}`, fa).part(`s${i}`, 'lamp', { label: `s${i}` });
    outs.push(`s${i}`);
    b.wire(`a${i}.out`, `fa${i}.a`).wire(`b${i}.out`, `fa${i}.b`).wire(i === 0 ? 'cin.out' : `fa${i - 1}.cout`, `fa${i}.cin`);
    b.wire(`fa${i}.sum`, `s${i}.in`);
  }
  b.part('cout', 'lamp', { label: 'cout' }).wire(`fa${n - 1}.cout`, 'cout.in');
  outs.push('cout');
  return def(id, b.build(), ins, outs);
}

export const toMap = (...defs: ChipDef[]): ChipMap => Object.fromEntries(defs.map((d) => [d.id, d]));
