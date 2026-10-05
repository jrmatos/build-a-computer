/** A board with one of every part (and every display state) for visual review of the renderer. */
import type { Board, Part, Wire } from '@build-a-computer/schema';
import type { Snapshot } from '@build-a-computer/worker';

type P = Omit<Part, 'rot' | 'flip'> & Partial<Pick<Part, 'rot' | 'flip'>>;

export function showcaseBoard(): Board {
  const parts: Part[] = [];
  const wires: Wire[] = [];
  const add = (q: P): void => {
    parts.push({ rot: 0, flip: false, ...q });
  };
  let n = 0;
  const wire = (a: string, ap: string, b: string, bp: string): void => {
    wires.push({ id: `w${n++}`, from: { part: a, pin: ap }, to: { part: b, pin: bp }, points: [] });
  };

  // Row 1: inputs and 1-bit outputs.
  add({ id: 'sw0', type: 'switch', x: 0, y: 0, label: 'off' });
  add({ id: 'sw1', type: 'switch', x: 4, y: 0, label: 'on', on: true });
  add({ id: 'num', type: 'switch', x: 8, y: 0, props: { width: 8, value: 0x2a }, label: 'number' });
  add({ id: 'btn0', type: 'button', x: 12, y: 0, label: 'button' });
  add({ id: 'btn1', type: 'button', x: 16, y: 0, label: 'pressed' });
  add({ id: 'k1', type: 'const', x: 20, y: 0, props: { value: 1 }, label: 'const' });
  add({ id: 'k8', type: 'const', x: 24, y: 0, props: { width: 8, value: 0x7f }, label: 'const 8' });
  add({ id: 'clk', type: 'clock', x: 28, y: 0, label: 'clock' });
  add({ id: 'l0', type: 'lamp', x: 32, y: 0, label: '0' });
  add({ id: 'l1', type: 'lamp', x: 36, y: 0, label: '1' });
  add({ id: 'lx', type: 'lamp', x: 40, y: 0, label: 'X' });

  // Row 2: multi-bit displays.
  add({ id: 'dhex', type: 'lamp', x: 0, y: 5, props: { width: 8, format: 'hex' }, label: 'hex' });
  add({ id: 'ddec', type: 'lamp', x: 4, y: 5, props: { width: 8, format: 'dec' }, label: 'dec' });
  add({ id: 'dsig', type: 'lamp', x: 8, y: 5, props: { width: 8, format: 'signed' }, label: 'signed' });
  add({ id: 'dbin', type: 'lamp', x: 12, y: 5, props: { width: 4, format: 'bin' }, label: 'bin' });
  add({ id: 'dx', type: 'lamp', x: 16, y: 5, props: { width: 8 }, label: 'X' });
  add({ id: 'dzero', type: 'lamp', x: 20, y: 5, props: { width: 8 }, label: 'zero' });
  add({ id: 'd32', type: 'lamp', x: 24, y: 5, props: { width: 32 }, label: '32-bit' });
  add({ id: 'dlock', type: 'lamp', x: 28, y: 5, props: { width: 8 }, label: 'out', locked: true });

  // Row 3: gates and buffers.
  const gates = ['nand', 'and', 'or', 'nor', 'xor', 'xnor'] as const;
  gates.forEach((t, i) => add({ id: t, type: t, x: i * 5, y: 10 }));
  add({ id: 'not', type: 'not', x: 30, y: 10 });
  add({ id: 'buf', type: 'buffer', x: 34, y: 10 });
  add({ id: 'tri', type: 'tristate', x: 38, y: 10 });
  add({ id: 'and8', type: 'and', x: 42, y: 10, props: { width: 8 }, label: 'and ×8' });

  // Row 4: wiring with buses.
  add({ id: 'bsrc', type: 'switch', x: 0, y: 17, props: { width: 8, value: 0xa5 }, label: 'bus' });
  add({ id: 'spl1', type: 'splitter', x: 5, y: 14, props: { width: 8, chunk: 1 } });
  for (let i = 0; i < 4; i++) add({ id: `bit${i}`, type: 'lamp', x: 9, y: 12 + 2 * i });
  add({ id: 'bsrc2', type: 'const', x: 11, y: 17, props: { width: 8, value: 0xa5 } });
  add({ id: 'spl4', type: 'splitter', x: 15, y: 17, props: { width: 8, chunk: 4 } });
  add({ id: 'lo', type: 'lamp', x: 19, y: 15, props: { width: 4 }, label: 'lo' });
  add({ id: 'hi', type: 'lamp', x: 19, y: 19, props: { width: 4 }, label: 'hi' });
  add({ id: 'ka', type: 'const', x: 25, y: 15, props: { width: 4, value: 0xc } });
  add({ id: 'kb', type: 'const', x: 25, y: 19, props: { width: 4, value: 0x3 } });
  add({ id: 'join', type: 'joiner', x: 31, y: 17, props: { width: 8, chunk: 4 } });
  add({ id: 'jout', type: 'lamp', x: 36, y: 16, props: { width: 8 }, label: 'joined' });
  add({ id: 'xsrc', type: 'switch', x: 40, y: 16, props: { width: 8 }, label: 'X bus' });
  add({ id: 'xdst', type: 'lamp', x: 46, y: 16, props: { width: 8 } });
  wire('bsrc', 'out', 'spl1', 'in');
  for (let i = 0; i < 4; i++) wire('spl1', `o${i}`, `bit${i}`, 'in');
  wire('bsrc2', 'out', 'spl4', 'in');
  wire('spl4', 'o0', 'lo', 'in');
  wire('spl4', 'o1', 'hi', 'in');
  wire('ka', 'out', 'join', 'i0');
  wire('kb', 'out', 'join', 'i1');
  wire('join', 'out', 'jout', 'in');
  wire('xsrc', 'out', 'xdst', 'in');

  // Row 5: memory.
  add({ id: 'dff', type: 'dff', x: 0, y: 26 });
  add({ id: 'reg', type: 'register', x: 6, y: 26 });
  add({ id: 'ctr', type: 'counter', x: 18, y: 26 });
  add({ id: 'ram', type: 'ram', x: 30, y: 26 });
  add({ id: 'rom', type: 'rom', x: 41, y: 26, props: { width: 8, addrWidth: 8 } });

  // Row 6: arithmetic.
  add({ id: 'mux', type: 'mux', x: 0, y: 35 });
  add({ id: 'dec', type: 'decoder', x: 10, y: 35 });
  add({ id: 'add', type: 'adder', x: 20, y: 35 });
  add({ id: 'alu', type: 'alu', x: 30, y: 35 });

  // Row 7: custom chips, a rotated block.
  add({ id: 'chipA', type: 'chip', chip: 'add4', x: 0, y: 44, label: 'adder chip' });
  add({ id: 'chipB', type: 'chip', chip: 'flags', x: 10, y: 44 });
  add({ id: 'chipC', type: 'chip', chip: 'pc', x: 20, y: 44 });
  add({ id: 'chipD', type: 'chip', chip: 'gone', x: 30, y: 44, label: 'deleted' });
  add({ id: 'regR', type: 'register', x: 40, y: 44, rot: 90, props: { width: 4 } });

  return { parts, wires };
}

export function showcaseSnapshot(board: Board): Snapshot {
  const s: Snapshot = {
    wires: {},
    buses: {},
    busPins: {},
    switchValues: { num: 0x2a, bsrc: 0xa5, xsrc: 0 },
    pins: {},
    switchesOn: ['sw1'],
    powered: true,
    running: true,
    ticks: 1,
    clock: 1,
    stable: true,
    unstablePins: [],
    contentionPins: [],
  };
  const bus = (key: string, w: number, v: number, x = 0): void => {
    s.busPins[key] = { w, v, x };
    s.pins[key] = x ? 2 : v ? 1 : 0;
  };
  const bit = (key: string, b: 0 | 1 | 2): void => {
    s.pins[key] = b;
  };
  bit('sw1:out', 1);
  bit('sw0:out', 0);
  bit('btn1:out', 1);
  bit('btn0:out', 0);
  bit('k1:out', 1);
  bit('clk:out', 1);
  bit('l0:in', 0);
  bit('l1:in', 1);
  bit('lx:in', 2);
  bus('num:out', 8, 0x2a);
  bus('k8:out', 8, 0x7f);
  bus('dhex:in', 8, 0x2a);
  bus('ddec:in', 8, 42);
  bus('dsig:in', 8, 0xf6);
  bus('dbin:in', 4, 0b1010);
  bus('dx:in', 8, 0x20, 0x0f);
  bus('dzero:in', 8, 0);
  bus('d32:in', 32, 0xdeadbeef);
  bus('dlock:in', 8, 0x99);
  for (const g of ['nand', 'and', 'or', 'nor', 'xor', 'xnor']) {
    bit(`${g}:a`, 1);
    bit(`${g}:b`, 0);
    bit(`${g}:out`, g === 'and' || g === 'nor' || g === 'xnor' ? 0 : 1);
  }
  bit('not:in', 0);
  bit('not:out', 1);
  bit('buf:in', 1);
  bit('buf:out', 1);
  bit('tri:in', 1);
  bit('tri:en', 0);
  bit('tri:out', 2);
  bus('and8:a', 8, 0xf0);
  bus('and8:b', 8, 0x3c);
  bus('and8:out', 8, 0x30);
  bus('reg:d', 8, 0x13);
  bit('reg:load', 1);
  bit('reg:clk', 0);
  bus('reg:q', 8, 0x2a);
  bus('ctr:q', 8, 0x07);
  bit('ctr:en', 1);
  bus('ram:addr', 4, 3);
  bus('ram:q', 8, 0xc4);
  bit('ram:we', 0);
  bus('rom:addr', 8, 0x10);
  bus('rom:q', 8, 0x3e, 0);
  bit('mux:sel', 1);
  bus('alu:a', 8, 5);
  bus('alu:b', 8, 3);
  bus('alu:op', 3, 1);
  bus('alu:out', 8, 2);
  bit('alu:zero', 0);
  bit('alu:carry', 1);
  bus('regR:q', 4, 0x9);
  // Wires follow their source pins.
  const vals: Record<string, [number, number, number]> = {};
  for (let i = 0; i < 8; i++) vals[`spl1:o${i}`] = [1, (0xa5 >> i) & 1, 0];
  vals['bsrc:out'] = [8, 0xa5, 0];
  vals['bsrc2:out'] = [8, 0xa5, 0];
  vals['spl4:o0'] = [4, 0x5, 0];
  vals['spl4:o1'] = [4, 0xa, 0];
  vals['ka:out'] = [4, 0xc, 0];
  vals['kb:out'] = [4, 0x3, 0];
  vals['join:out'] = [8, 0x3c, 0];
  vals['xsrc:out'] = [8, 0, 0xff];
  for (const w of board.wires) {
    const [bw, bv, bx] = vals[`${w.from.part}:${w.from.pin}`] ?? [1, 0, 0];
    s.wires[w.id] = bx ? 2 : bv ? 1 : 0;
    if (bw > 1) s.buses[w.id] = { w: bw, v: bv, x: bx };
    for (const ref of [w.from, w.to]) {
      const key = `${ref.part}:${ref.pin}`;
      if (bw > 1) bus(key, bw, bv, bx);
      else bit(key, bx ? 2 : bv ? 1 : 0);
    }
  }
  return s;
}
