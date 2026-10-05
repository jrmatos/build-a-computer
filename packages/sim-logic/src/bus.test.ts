import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Board, Part, PartProps, PartType, Wire } from '@build-a-computer/schema';
import { CompileError, LIMITS, compile } from './compile';
import { ReferenceEngine, type Engine, type EngineOptions } from './engine';
import { FastEngine } from './fast-engine';
import { V0, V1, VX } from './values';

/** Board builder with props. Pins are written `part.pin`. */
function board() {
  const parts: Part[] = [];
  const wires: Wire[] = [];
  const api = {
    part(id: string, type: PartType, props?: PartProps, label?: string) {
      parts.push({ id, type, x: 0, y: 0, rot: 0, flip: false, ...(props ? { props } : {}), ...(label ? { label } : {}) });
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

const engines: [string, (b: Board, o?: EngineOptions) => Engine][] = [
  ['reference', (b, o) => new ReferenceEngine(compile(b), o)],
  ['fast', (b, o) => new FastEngine(compile(b), o)],
];

describe.each(engines)('multi-bit engine (%s)', (_name, make) => {
  it('E-SIM-04: a bus width mismatch is a compile diagnostic naming both pins, and the design cannot run', () => {
    const b = board().part('A', 'switch', { width: 8 }).part('Y', 'lamp', { width: 4 }).wire('A.out', 'Y.in').build();
    const nl = compile(b);
    expect(nl.canRun).toBe(false);
    expect(nl.diagnostics).toContainEqual({ code: 'width-mismatch', net: nl.pinNet.get('A:out'), pins: ['A:out', 'Y:in'] });
    expect(() => make(b)).toThrow(CompileError);
  });

  it('bitwise gates over 8 bits with per-bit X (0 AND X = 0)', () => {
    const e = make(board().part('A', 'switch', { width: 8, value: 0b1100_1010 }).part('B', 'switch', { width: 8 }).part('g', 'and', { width: 8 })
      .part('o', 'or', { width: 8 }).part('n', 'not', { width: 8 }).part('Y', 'lamp', { width: 8 })
      .wire('A.out', 'g.a').wire('B.out', 'g.b').wire('A.out', 'o.a').wire('A.out', 'n.in').wire('g.out', 'Y.in').build());
    e.powerOn();
    expect(e.readSignal('g', 'out')).toEqual({ w: 8, v: 0, x: 0 });
    e.setValue('B', 0xff);
    expect(e.readSignal('Y', 'in')).toEqual({ w: 8, v: 0b1100_1010, x: 0 });
    // o.b floats: 1 OR X = 1, 0 OR X = X.
    expect(e.readSignal('o', 'out')).toEqual({ w: 8, v: 0b1100_1010, x: 0b0011_0101 });
    expect(e.readSignal('n', 'out')).toEqual({ w: 8, v: 0b0011_0101, x: 0 });
    expect(e.switchValue('A')).toBe(0b1100_1010);
  });

  it('32-bit values stay unsigned', () => {
    const e = make(board().part('A', 'switch', { width: 32 }).part('n', 'not', { width: 32 }).wire('A.out', 'n.in').build());
    e.powerOn();
    e.setValue('A', 0x7fffffff);
    expect(e.readSignal('n', 'out')).toEqual({ w: 32, v: 0x80000000, x: 0 });
    e.setValue('A', 0xffffffff);
    expect(e.readSignal('n', 'out').v).toBe(0);
  });

  it('const drives its value; button is momentary', () => {
    const e = make(board().part('K', 'const', { width: 4, value: 9 }).part('Bt', 'button').part('Y', 'lamp', { width: 4 }).part('L', 'lamp')
      .wire('K.out', 'Y.in').wire('Bt.out', 'L.in').build());
    e.powerOn();
    expect(e.readSignal('Y', 'in')).toEqual({ w: 4, v: 9, x: 0 });
    expect(e.readPin('L', 'in')).toBe(V0);
    e.press('Bt', true);
    expect(e.readPin('L', 'in')).toBe(V1);
    e.press('Bt', false);
    expect(e.readPin('L', 'in')).toBe(V0);
  });

  it('splitter and joiner: o0/i0 is the least significant chunk', () => {
    const e = make(board().part('A', 'switch', { width: 8 }).part('s', 'splitter', { width: 8, chunk: 4 }).part('j', 'joiner', { width: 8, chunk: 4 })
      .wire('A.out', 's.in').wire('s.o0', 'j.i1').wire('s.o1', 'j.i0').build());
    e.powerOn();
    e.setValue('A', 0x3c);
    expect(e.readSignal('s', 'o0')).toEqual({ w: 4, v: 0xc, x: 0 });
    expect(e.readSignal('s', 'o1')).toEqual({ w: 4, v: 0x3, x: 0 });
    expect(e.readSignal('j', 'out')).toEqual({ w: 8, v: 0xc3, x: 0 });
  });

  it('tri-state bus: one enabled driver wins, none floats to X, two disagreeing give contention', () => {
    const b = board().part('A', 'switch', { width: 4, value: 5 }).part('B', 'switch', { width: 4, value: 10 })
      .part('ea', 'switch').part('eb', 'switch')
      .part('ta', 'tristate', { width: 4 }).part('tb', 'tristate', { width: 4 }).part('Y', 'lamp', { width: 4 })
      .wire('A.out', 'ta.in').wire('ea.out', 'ta.en').wire('B.out', 'tb.in').wire('eb.out', 'tb.en')
      .wire('ta.out', 'Y.in').wire('tb.out', 'Y.in').build();
    const nl = compile(b);
    const bus = nl.pinNet.get('Y:in')!;
    const e = make(b);
    expect(e.powerOn().contentionNets).toEqual([]);
    expect(e.readSignal('Y', 'in')).toEqual({ w: 4, v: 0, x: 0xf }); // floating: X
    expect(e.setSwitch('ea', true).contentionNets).toEqual([]);
    expect(e.readSignal('Y', 'in')).toEqual({ w: 4, v: 5, x: 0 });
    const r = e.setSwitch('eb', true);
    expect(r.contentionNets).toEqual([bus]);
    expect(e.readSignal('Y', 'in')).toEqual({ w: 4, v: 0, x: 0xf });
    expect(e.setSwitch('ea', false).contentionNets).toEqual([]);
    expect(e.readSignal('Y', 'in')).toEqual({ w: 4, v: 10, x: 0 });
  });

  it('E-SIM-02: two plain drivers disagreeing on some bits give X only on those bits, with contention', () => {
    const b = board().part('A', 'switch', { width: 4, value: 0b0101 }).part('B', 'switch', { width: 4, value: 0b0110 }).part('Y', 'lamp', { width: 4 })
      .wire('A.out', 'Y.in').wire('B.out', 'Y.in').build();
    const e = make(b);
    const r = e.powerOn();
    expect(r.contentionNets.length).toBe(1);
    expect(e.readSignal('Y', 'in')).toEqual({ w: 4, v: 0b0100, x: 0b0011 });
  });

  it('a tri-state with an unknown enable drives X', () => {
    const e = make(board().part('A', 'switch', { width: 2, value: 3 }).part('t', 'tristate', { width: 2 }).wire('A.out', 't.in').build());
    e.powerOn();
    expect(e.readSignal('t', 'out')).toEqual({ w: 2, v: 0, x: 3 });
  });

  it('readPin is the 1-bit view of bit 0', () => {
    const e = make(board().part('A', 'switch', { width: 4, value: 3 }).build());
    e.powerOn();
    expect(e.readPin('A', 'out')).toBe(V1);
    expect(e.readPin('A', 'nope')).toBe(VX);
  });

  it('SIM-08: an 8-bit counter block counts 0 to 255 and wraps', () => {
    const e = make(board().part('C', 'clock').part('one', 'const', { width: 1, value: 1 }).part('zero', 'const', { width: 1, value: 0 })
      .part('k', 'counter', { width: 8 }).wire('C.out', 'k.clk').wire('one.out', 'k.en').wire('zero.out', 'k.load').build());
    e.powerOn();
    for (let i = 0; i < 256; i++) {
      expect(e.readSignal('k', 'q')).toEqual({ w: 8, v: i, x: 0 });
      e.tick();
      e.tick();
    }
    expect(e.readSignal('k', 'q').v).toBe(0);
  });

  it('SIM-08: an 8-bit counter from D flip-flops counts 0 to 255 and wraps', () => {
    // Ripple counter: each bit toggles (q -> not -> d) on the falling edge of the previous bit.
    const b = board().part('C', 'clock');
    let clk = 'C.out';
    for (let i = 0; i < 8; i++) {
      b.part(`f${i}`, 'dff').part(`n${i}`, 'not').wire(`f${i}.q`, `n${i}.in`).wire(`n${i}.out`, `f${i}.d`).wire(clk, `f${i}.clk`);
      clk = `n${i}.out`;
    }
    const e = make(b.build());
    e.powerOn();
    const value = () => Array.from({ length: 8 }, (_, i) => (e.readPin(`f${i}`, 'q') === V1 ? 1 << i : 0)).reduce((a, c) => a | c, 0);
    for (let i = 0; i < 256; i++) {
      expect(value()).toBe(i);
      e.tick();
      e.tick();
    }
    expect(value()).toBe(0);
  });

  it('register block loads d on the rising edge only when load = 1; memory() shows it', () => {
    const e = make(board().part('D', 'switch', { width: 8 }).part('L', 'switch').part('C', 'clock').part('r', 'register', { width: 8 })
      .wire('D.out', 'r.d').wire('L.out', 'r.load').wire('C.out', 'r.clk').build());
    e.powerOn();
    e.setValue('D', 0x42);
    e.tick();
    e.tick();
    expect(e.readSignal('r', 'q').v).toBe(0);
    e.setSwitch('L', true);
    e.tick(); // rising
    expect(e.readSignal('r', 'q')).toEqual({ w: 8, v: 0x42, x: 0 });
    expect(e.memory('r')).toEqual([0x42]);
  });

  it('E-SIM-08: power off clears RAM and registers but keeps ROM', () => {
    const b = board().part('A', 'switch', { width: 2 }).part('D', 'switch', { width: 8, value: 0x99 }).part('W', 'switch', { value: 1 })
      .part('C', 'clock').part('ram', 'ram', { width: 8, addrWidth: 2 }).part('rom', 'rom', { width: 8, addrWidth: 2, data: '11 22 33 44' })
      .wire('A.out', 'ram.addr').wire('D.out', 'ram.d').wire('W.out', 'ram.we').wire('C.out', 'ram.clk').wire('A.out', 'rom.addr').build();
    const e = make(b);
    e.powerOn();
    e.setValue('A', 2);
    expect(e.readSignal('rom', 'q').v).toBe(0x33);
    e.tick();
    expect(e.readSignal('ram', 'q').v).toBe(0x99);
    expect(e.memory('ram')).toEqual([0, 0, 0x99, 0]);
    e.powerOff();
    expect(e.memory('ram')).toEqual([]);
    expect(e.memory('rom')).toEqual([0x11, 0x22, 0x33, 0x44]);
    e.setSwitch('W', false);
    e.powerOn();
    expect(e.memory('ram')).toEqual([0, 0, 0, 0]);
    expect(e.readSignal('rom', 'q').v).toBe(0x33);
  });

  it('E-SIM-07: random power-on state of blocks is reproducible from the seed', () => {
    const b = board().part('r', 'register', { width: 32 }).build();
    const read = (seed: number) => {
      const e = make(b, { powerOnState: 'random', seed });
      e.powerOn();
      return e.readSignal('r', 'q').v;
    };
    expect(read(3)).toBe(read(3));
    expect(read(3)).not.toBe(read(4));
  });

  it('E-SIM-01: a loop through a bus inverter is unstable', () => {
    const b = board().part('n', 'not', { width: 4 }).wire('n.out', 'n.in').build();
    const r = make(b, { eventBudgetPerPart: 50 }).powerOn();
    expect(r.stable).toBe(false);
    expect(r.unstableNets).toEqual([compile(b).pinNet.get('n:out')]);
  });
});

describe('compile limits and diagnostics', () => {
  it('unsupported parts give a diagnostic instead of crashing', () => {
    const nl = compile(board().part('c', 'chip').build());
    expect(nl.diagnostics).toContainEqual({ code: 'unsupported-part', part: 'c' });
    expect(nl.canRun).toBe(false);
    expect(() => new FastEngine(nl)).toThrow(/cannot be simulated/);
  });

  it('SIM-10: designs over 64 MB of state are refused before running', () => {
    const b = board();
    for (let i = 0; i < 257; i++) b.part(`m${i}`, 'ram', { width: 32, addrWidth: 16 });
    let err: unknown;
    try {
      compile(b.build());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CompileError);
    expect((err as CompileError).code).toBe('too-much-state');
    expect(LIMITS.maxStateBytes).toBe(64 * 1024 * 1024);
  });

  it('netlists carry pin and net widths', () => {
    const nl = compile(board().part('s', 'splitter', { width: 8, chunk: 2 }).build());
    expect(nl.pinWidth.get('s:in')).toBe(8);
    expect(nl.pinWidth.get('s:o3')).toBe(2);
    expect(nl.netWidth[nl.pinNet.get('s:o0')!]).toBe(2);
  });
});

describe('SIM-07 properties', () => {
  it('SIM-07: split then join round-trips any value, for every chunk size', () => {
    fc.assert(
      fc.property(fc.constantFrom(1, 2, 4, 8, 16), fc.nat({ max: 0xffffffff }), (chunk, value) => {
        const w = 32;
        const b = board().part('A', 'switch', { width: w }).part('s', 'splitter', { width: w, chunk }).part('j', 'joiner', { width: w, chunk });
        b.wire('A.out', 's.in');
        for (let i = 0; i < w / chunk; i++) b.wire(`s.o${i}`, `j.i${i}`);
        for (const [, make] of engines) {
          const e = make(b.build());
          e.powerOn();
          e.setValue('A', value);
          expect(e.readSignal('j', 'out')).toEqual({ w, v: value >>> 0, x: 0 });
        }
      }),
      { seed: 7, numRuns: 100 },
    );
  });
});
