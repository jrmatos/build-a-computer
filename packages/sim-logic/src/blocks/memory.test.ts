import { Prng } from '@build-a-computer/det';
import type { Part, PartProps, PartType } from '@build-a-computer/schema';
import { describe, expect, it } from 'vitest';
import { inputsOf, outputsOf, PART_INFO } from '../parts-spec';
import { allX, sig, type Signal } from '../values';
import { BLOCKS } from './index';
import { parseRomData, type RamState, type RegisterState } from './memory';

const part = (type: PartType, props: PartProps = {}): Part => ({ id: 'p1', type, x: 0, y: 0, rot: 0, flip: false, props });
const zeroRng = { nextU32: () => 0 };
const s1 = (b: 0 | 1 | 'x'): Signal => (b === 'x' ? allX(1) : sig(1, b));
const val = (s: Signal | undefined): string => (s ? `${s.v}/${s.x}` : 'missing');

describe('BLOCKS registry', () => {
  it('registers every behavioral part type with the right output count', () => {
    for (const t of ['register', 'counter', 'ram', 'rom', 'mux', 'decoder', 'adder', 'alu'] as const) {
      const model = BLOCKS[t];
      expect(model, t).toBeDefined();
      const p = part(t, PART_INFO[t].defaults);
      const st = model!.init(p, 'zero', zeroRng);
      const ins = inputsOf(p).map((pin) => sig(pin.width, 0));
      const outs = model!.outputs(ins, st, p);
      expect(outs.map((o) => o.w)).toEqual(outputsOf(p).map((o) => o.width));
      expect(Boolean(model!.clock)).toBe(PART_INFO[t].clocked);
      expect(Boolean(model!.nonVolatile)).toBe(PART_INFO[t].nonVolatile);
    }
  });
});

describe('register', () => {
  const m = BLOCKS.register!;
  // pins: d, load, clk → q
  const ins = (d: Signal, load: Signal) => [d, load, s1(0)];

  it('loads d on an edge only when load = 1', () => {
    const p = part('register', { width: 8 });
    let st: RegisterState = m.init(p, 'zero', zeroRng);
    expect(val(m.outputs(ins(sig(8, 0x5a), s1(0)), st, p)[0])).toBe('0/0');
    st = m.clock!(ins(sig(8, 0x5a), s1(0)), st, p);
    expect(st.v).toBe(0);
    st = m.clock!(ins(sig(8, 0x5a), s1(1)), st, p);
    expect(val(m.outputs(ins(sig(8, 0), s1(0)), st, p)[0])).toBe(`${0x5a}/0`);
    expect(Array.from(m.inspect!(st))).toEqual([0x5a]);
  });

  it('X load on an edge makes the register all-X; d X bits are stored per bit', () => {
    const p = part('register', { width: 8 });
    let st: RegisterState = m.init(p, 'zero', zeroRng);
    st = m.clock!(ins(sig(8, 0xff), s1('x')), st, p);
    expect(st).toEqual({ v: 0, x: 0xff });
    st = m.clock!(ins(sig(8, 0xf0, 0x0f), s1(1)), st, p);
    expect(st).toEqual({ v: 0xf0, x: 0x0f });
  });

  it('works at widths 1 and 32', () => {
    const p1 = part('register', { width: 1 });
    expect(m.clock!(ins(sig(1, 1), s1(1)), m.init(p1, 'zero', zeroRng), p1).v).toBe(1);
    const p32 = part('register', { width: 32 });
    const st = m.clock!(ins(sig(32, 0xffffffff), s1(1)), m.init(p32, 'zero', zeroRng), p32);
    expect(m.outputs([], st, p32)[0]).toEqual(sig(32, 0xffffffff));
  });

  it('E-SIM-07: power-on value is 0 or seeded random, never X, and repeatable', () => {
    const p = part('register', { width: 32 });
    expect(m.init(p, 'zero', new Prng(1))).toEqual({ v: 0, x: 0 });
    const a = m.init(p, 'random', new Prng(42));
    const b = m.init(p, 'random', new Prng(42));
    expect(a).toEqual(b);
    expect(a.x).toBe(0);
    const p4 = part('register', { width: 4 });
    for (let s = 0; s < 50; s++) expect(m.init(p4, 'random', new Prng(s)).v).toBeLessThan(16);
  });
});

describe('counter', () => {
  const m = BLOCKS.counter!;
  // pins: d, load, en, clk → q
  const ins = (d: number, load: 0 | 1 | 'x', en: 0 | 1 | 'x', w = 8) => [sig(w, d), s1(load), s1(en), s1(0)];

  it('counts when en = 1, holds when en = 0, loads with priority', () => {
    const p = part('counter', { width: 8 });
    let st: RegisterState = m.init(p, 'zero', zeroRng);
    for (let i = 0; i < 5; i++) st = m.clock!(ins(0, 0, 1), st, p);
    expect(st.v).toBe(5);
    st = m.clock!(ins(0, 0, 0), st, p);
    expect(st.v).toBe(5);
    st = m.clock!(ins(200, 1, 1), st, p);
    expect(st.v).toBe(200);
    expect(m.outputs([], st, p)[0]).toEqual(sig(8, 200));
  });

  it('wraps at 2^width (widths 1, 8, 32)', () => {
    const p8 = part('counter', { width: 8 });
    expect(m.clock!(ins(0, 0, 1), { v: 255, x: 0 }, p8)).toEqual({ v: 0, x: 0 });
    const p1 = part('counter', { width: 1 });
    expect(m.clock!(ins(0, 0, 1, 1), { v: 1, x: 0 }, p1)).toEqual({ v: 0, x: 0 });
    const p32 = part('counter', { width: 32 });
    expect(m.clock!(ins(0, 0, 1, 32), { v: 0xffffffff, x: 0 }, p32)).toEqual({ v: 0, x: 0 });
    expect(m.clock!(ins(0, 0, 1, 32), { v: 0x7fffffff, x: 0 }, p32)).toEqual({ v: 0x80000000, x: 0 });
  });

  it('X load, X en, or an X count make the value all-X', () => {
    const p = part('counter', { width: 8 });
    const st = { v: 3, x: 0 };
    expect(m.clock!(ins(0, 'x', 0), st, p)).toEqual({ v: 0, x: 0xff });
    expect(m.clock!(ins(0, 0, 'x'), st, p)).toEqual({ v: 0, x: 0xff });
    expect(m.clock!(ins(0, 0, 1), { v: 2, x: 1 }, p)).toEqual({ v: 0, x: 0xff });
    // Holding keeps partial X as is; load = 1 ignores X en.
    expect(m.clock!(ins(0, 0, 0), { v: 2, x: 1 }, p)).toEqual({ v: 2, x: 1 });
    expect(m.clock!(ins(9, 1, 'x'), st, p)).toEqual({ v: 9, x: 0 });
  });
});

describe('ram', () => {
  const m = BLOCKS.ram!;
  // pins: addr, d, we, clk → q
  const ins = (addr: Signal, d: Signal, we: 0 | 1 | 'x') => [addr, d, s1(we), s1(0)];
  const p = part('ram', { width: 8, addrWidth: 4 });
  const read = (st: RamState, a: number) => m.outputs(ins(sig(4, a), sig(8, 0), 0), st, p)[0]!;

  it('reads asynchronously and writes on an edge only when we = 1', () => {
    let st: RamState = m.init(p, 'zero', zeroRng);
    expect(st.mem.length).toBe(16);
    st = m.clock!(ins(sig(4, 3), sig(8, 0xab), 0), st, p);
    expect(read(st, 3)).toEqual(sig(8, 0));
    st = m.clock!(ins(sig(4, 3), sig(8, 0xab), 1), st, p);
    expect(read(st, 3)).toEqual(sig(8, 0xab));
    st = m.clock!(ins(sig(4, 15), sig(8, 0x01), 1), st, p);
    expect(read(st, 15)).toEqual(sig(8, 1));
    expect(Array.from(m.inspect!(st)).slice(0, 4)).toEqual([0, 0, 0, 0xab]);
  });

  it('an X address reads all-X', () => {
    const st: RamState = m.init(p, 'zero', zeroRng);
    expect(m.outputs(ins(sig(4, 0, 1), sig(8, 0), 0), st, p)[0]).toEqual(allX(8));
  });

  it('X we makes the addressed word all-X; d X bits are stored per bit', () => {
    let st: RamState = m.init(p, 'zero', zeroRng);
    st = m.clock!(ins(sig(4, 5), sig(8, 0x11), 'x'), st, p);
    expect(read(st, 5)).toEqual(allX(8));
    expect(read(st, 4)).toEqual(sig(8, 0));
    st = m.clock!(ins(sig(4, 6), sig(8, 0xf0, 0x0f), 1), st, p);
    expect(read(st, 6)).toEqual(sig(8, 0xf0, 0x0f));
    // A later known write clears the X.
    st = m.clock!(ins(sig(4, 5), sig(8, 0x22), 1), st, p);
    expect(read(st, 5)).toEqual(sig(8, 0x22));
  });

  it('a partly X address on write makes every candidate word all-X', () => {
    let st: RamState = m.init(p, 'zero', zeroRng);
    // addr = 0b01?? → words 4..7
    st = m.clock!(ins(sig(4, 4, 3), sig(8, 0x99), 1), st, p);
    for (let a = 0; a < 16; a++) expect(read(st, a)).toEqual(a >= 4 && a < 8 ? allX(8) : sig(8, 0));
    // A fully X address with we = 0 writes nothing.
    const before = Array.from(st.mem);
    st = m.clock!(ins(allX(4), sig(8, 1), 0), st, p);
    expect(Array.from(st.mem)).toEqual(before);
  });

  it('widths 1 and 32, and a 64 Ki-word RAM', () => {
    const p1 = part('ram', { width: 1, addrWidth: 1 });
    let st: RamState = m.init(p1, 'zero', zeroRng);
    st = m.clock!([sig(1, 1), sig(1, 1), s1(1), s1(0)], st, p1);
    expect(m.outputs([sig(1, 1), sig(1, 0), s1(0), s1(0)], st, p1)[0]).toEqual(sig(1, 1));
    const p32 = part('ram', { width: 32, addrWidth: 16 });
    st = m.init(p32, 'zero', zeroRng);
    expect(st.mem.length).toBe(65536);
    st = m.clock!([sig(16, 0xffff), sig(32, 0x80000000), s1(1), s1(0)], st, p32);
    expect(m.outputs([sig(16, 0xffff), sig(32, 0), s1(0), s1(0)], st, p32)[0]).toEqual(sig(32, 0x80000000));
  });

  it('E-SIM-07: random init is seeded, deterministic and within width', () => {
    const a: RamState = m.init(p, 'random', new Prng(7));
    const b: RamState = m.init(p, 'random', new Prng(7));
    const c: RamState = m.init(p, 'random', new Prng(8));
    expect(Array.from(a.mem)).toEqual(Array.from(b.mem));
    expect(Array.from(a.mem)).not.toEqual(Array.from(c.mem));
    expect(Array.from(a.mem).every((w) => w < 256)).toBe(true);
    expect(a.xm).toBeNull();
    expect(BLOCKS.ram!.nonVolatile).toBeFalsy();
  });
});

describe('rom', () => {
  const m = BLOCKS.rom!;

  it('reads parsed props.data; missing entries are 0; non-volatile', () => {
    const p = part('rom', { width: 8, addrWidth: 2, data: '01 0x02 ff' });
    const st = m.init(p, 'zero', zeroRng);
    expect([0, 1, 2, 3].map((a) => m.outputs([sig(2, a)], st, p)[0]!.v)).toEqual([1, 2, 255, 0]);
    expect(Array.from(m.inspect!(st))).toEqual([1, 2, 255, 0]);
    expect(m.nonVolatile).toBe(true);
    expect(m.clock).toBeUndefined();
  });

  it('an X address reads all-X; empty data is all zero; random mode does not change contents', () => {
    const p = part('rom', { width: 8, addrWidth: 4, data: '' });
    const st = m.init(p, 'random', new Prng(3));
    expect(m.outputs([sig(4, 0, 8)], st, p)[0]).toEqual(allX(8));
    expect(Array.from(m.inspect!(st)).every((w) => w === 0)).toBe(true);
    const q = part('rom');
    expect(m.init(q, 'zero', zeroRng).words.length).toBe(16);
  });

  it('32-bit words', () => {
    const p = part('rom', { width: 32, addrWidth: 1, data: 'deadbeef 0x80000000' });
    const st = m.init(p, 'zero', zeroRng);
    expect(m.outputs([sig(1, 0)], st, p)[0]).toEqual(sig(32, 0xdeadbeef));
    expect(m.outputs([sig(1, 1)], st, p)[0]).toEqual(sig(32, 0x80000000));
  });
});

describe('parseRomData', () => {
  it('accepts bare and 0x hex, whitespace, commas, newlines and comments', () => {
    const text = '# header\n0x0A, 0B,0xc\n  d\t; comment, 99\r\nFF # tail';
    const r = parseRomData(text, 8, 3);
    expect(Array.from(r.words)).toEqual([10, 11, 12, 13, 255, 0, 0, 0]);
    expect(r.errors).toEqual([]);
    expect(r.count).toBe(5);
  });

  it('ignores extra entries and reports invalid tokens as 0', () => {
    const r = parseRomData('1 zz 3 0x 5 6', 8, 2);
    expect(Array.from(r.words)).toEqual([1, 0, 3, 0]);
    expect(r.errors).toEqual([
      { index: 1, token: 'zz', reason: 'invalid' },
      { index: 3, token: '0x', reason: 'invalid' },
    ]);
    expect(r.count).toBe(6);
  });

  it('masks values wider than the word and reports overflow', () => {
    const r = parseRomData('1ff 00000000ff 123456789', 8, 2);
    expect(Array.from(r.words)).toEqual([0xff, 0xff, 0x89, 0]);
    expect(r.errors.map((e) => [e.index, e.reason])).toEqual([
      [0, 'overflow'],
      [2, 'overflow'],
    ]);
    const w32 = parseRomData('ffffffff 1ffffffff', 32, 1);
    expect(Array.from(w32.words)).toEqual([0xffffffff, 0xffffffff]);
    expect(w32.errors.map((e) => e.index)).toEqual([1]);
  });

  it('empty and comment-only text gives all zeros', () => {
    expect(Array.from(parseRomData('', 8, 1).words)).toEqual([0, 0]);
    expect(parseRomData('; nothing\n# here', 8, 1).count).toBe(0);
  });
});
