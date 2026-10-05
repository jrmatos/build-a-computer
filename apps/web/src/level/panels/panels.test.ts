import { describe, expect, it, vi } from 'vitest';
import type { Board, Part } from '@ground-up/schema';
import type { Snapshot } from '@ground-up/worker';

// The Toy-8 helpers are written in parallel; pin their behavior for these tests.
vi.mock('@ground-up/content', () => ({
  assembleLine: (line: string, labels?: Record<string, number>) => {
    const m = /^LDI R(\d), (\d+)$/i.exec(line.trim());
    if (m) return [0x10 + Number(m[1]), Number(m[2])];
    const j = /^JMP (\w+)$/i.exec(line.trim());
    if (j) {
      const v = /^\d+$/.test(j[1]!) ? Number(j[1]) : labels?.[j[1]!];
      if (v === undefined) throw new Error(`unknown label '${j[1]}'`);
      return [0x60, v];
    }
    if (/^HLT$/i.test(line.trim())) return [0xff];
    throw new Error(`Unknown instruction: ${line.trim()}`);
  },
  disassemble: (bytes: ArrayLike<number>) => {
    const b = bytes[0] ?? 0;
    if (b >= 0x10 && b < 0x14) return { mnemonic: 'LDI', size: 2, text: `LDI R${b - 0x10}, ${bytes[1] ?? 0}` };
    if (b === 0xff) return { mnemonic: 'HLT', size: 1, text: 'HLT' };
    return { mnemonic: '?', size: 1, text: '?' };
  },
}));

const { segments, formatBus, formatValue, clampView, zoomView, panView, findClockWire, niceStride } = await import('./waveform');
const { collectDiagnostics, groupPins } = await import('./diagnostics');
const { parseProgram, dataToBytes, bytesToData, programText, mnemonicAt } = await import('./romCode');
const { memoryParts, capacityOf, contentsOf, findCpu, partValue, changedCells } = await import('./memory');
const { clampHeight, useDock } = await import('./dockState');

const part = (id: string, type: Part['type'], extra: Partial<Part> = {}): Part => ({ id, type, x: 0, y: 0, rot: 0, flip: false, ...extra });
const wire = (id: string, a: string, ap: string, b: string, bp: string) => ({ id, from: { part: a, pin: ap }, to: { part: b, pin: bp }, points: [] });

const snap = (patch: Partial<Snapshot> = {}): Snapshot => ({
  wires: {},
  buses: {},
  busPins: {},
  switchValues: {},
  pins: {},
  switchesOn: [],
  powered: true,
  running: false,
  ticks: 0,
  clock: 0,
  stable: true,
  unstablePins: [],
  contentionPins: [],
  ...patch,
});

describe('waveform model', () => {
  const b = (v: number, x = 0, w = 1) => ({ w, v, x });

  it('collapses equal samples into segments', () => {
    const s = segments([b(0), b(0), b(1), b(1), b(1), b(0, 1)]);
    expect(s.map((x) => [x.from, x.to])).toEqual([
      [0, 2],
      [2, 5],
      [5, 6],
    ]);
    expect(segments([b(0), b(1), b(1)], 1, 3)).toHaveLength(1);
  });

  it('formats buses as hex with unknown nibbles as X', () => {
    expect(formatBus({ w: 8, v: 0x3c, x: 0 })).toBe('3C');
    expect(formatBus({ w: 8, v: 0x3c, x: 0x0f })).toBe('3X');
    expect(formatBus({ w: 12, v: 0xabc, x: 0 })).toBe('ABC');
    expect(formatBus({ w: 32, v: 0xdeadbeef, x: 0 })).toBe('DEADBEEF');
    expect(formatValue({ w: 1, v: 1, x: 0 })).toBe('1');
    expect(formatValue({ w: 1, v: 0, x: 1 })).toBe('X');
    expect(formatValue({ w: 8, v: 255, x: 0 })).toBe('0xFF');
    expect(formatValue(undefined)).toBe('–');
  });

  it('follows the newest tick, zooms around the anchor and pans', () => {
    expect(clampView({ start: 0, span: 100, follow: true }, 1000).start).toBe(900);
    const z = zoomView({ start: 0, span: 100, follow: false }, 0.5, 0.5, 1000);
    expect(z.span).toBe(50);
    expect(z.start).toBe(25);
    const p = panView({ start: 100, span: 100, follow: false }, 50, 1000);
    expect(p.start).toBe(150);
    expect(panView(p, 10_000, 1000).follow).toBe(true);
    expect(clampView({ start: 0, span: 1, follow: false }, 10).span).toBeGreaterThanOrEqual(8);
    expect(niceStride(3)).toBe(5);
    expect(niceStride(12)).toBe(20);
  });

  it('puts the clock wire on top', () => {
    const board: Board = { parts: [part('c', 'clock'), part('l', 'lamp')], wires: [wire('w1', 'c', 'out', 'l', 'in')] };
    expect(findClockWire(board)).toBe('w1');
    expect(findClockWire({ parts: [], wires: [] })).toBeUndefined();
  });
});

describe('diagnostics', () => {
  const board: Board = {
    parts: [part('a', 'switch', { label: 'A' }), part('b', 'switch', { label: 'B' }), part('g', 'and'), part('l', 'lamp')],
    wires: [wire('w1', 'a', 'out', 'l', 'in'), wire('w2', 'b', 'out', 'l', 'in')],
  };

  it('describes compile diagnostics in plain English with the ids to show', () => {
    const out = collectDiagnostics(board, [{ code: 'floating-input', part: 'g', pin: 'a' }, { code: 'bad-wire', wire: 'w2' }], null);
    expect(out).toHaveLength(2);
    const floating = out.find((d) => d.code === 'floating-input')!;
    expect(floating.text).toContain('Input a of AND');
    expect(floating.ids).toEqual(['g']);
    expect(out[0]!.severity).toBe('error'); // errors sort first
  });

  it('turns live contention pins into one entry per wire group', () => {
    const out = collectDiagnostics(board, [], snap({ contentionPins: ['a:out', 'b:out', 'l:in'] }));
    expect(out).toHaveLength(1);
    expect(out[0]!.live).toBe(true);
    expect(out[0]!.ids).toEqual(expect.arrayContaining(['a', 'b', 'w1', 'w2']));
    expect(groupPins(board, ['a:out', 'g:y'])).toHaveLength(2);
  });

  it('maps unstable nets to the unstable pins of the snapshot and tolerates unknown codes', () => {
    const out = collectDiagnostics(board, [{ code: 'unstable', nets: [3] }, { code: 'mystery', message: 'Odd thing' }], snap({ unstablePins: ['g:y'] }));
    expect(out.find((d) => d.code === 'unstable')!.ids).toEqual(['g']);
    expect(out.find((d) => d.code === 'mystery')!.text).toBe('Odd thing');
    // ids that are not on the board are dropped, so clicking never zooms to nothing
    expect(collectDiagnostics(board, [{ code: 'width-mismatch', wire: 'gone', expected: 8, actual: 4 }], null)[0]!.ids).toEqual([]);
  });
});

describe('machine-code editor', () => {
  it('parses hex lines and reports bad tokens inline', () => {
    const p = parseProgram('10 05 ; load\n\nFF\nZZ', 'hex');
    expect(p.bytes).toEqual([0x10, 0x05, 0xff]);
    expect(p.lines.map((l) => l.addr)).toEqual([0, 2, 2, 3]);
    expect(p.errors).toBe(1);
    expect(p.lines[3]!.error).toContain('ZZ');
    expect(parseProgram('1FF', 'hex').lines[0]!.error).toContain('8 bits');
    expect(parseProgram('1FF', 'hex', 12).errors).toBe(0);
    expect(parseProgram('01 02 03', 'hex', 8, 2).errors).toBe(1);
  });

  it('assembles Toy-8 lines and keeps raw hex lines as data', () => {
    const p = parseProgram('LDI R1, 7\nHLT\nAA BB\nJMP nowhere', 'asm');
    expect(p.bytes).toEqual([0x11, 7, 0xff, 0xaa, 0xbb]);
    expect(p.lines[3]!.error).toMatch(/unknown label/);
    expect(mnemonicAt(p.bytes, 0)).toBe('LDI R1, 7');
    expect(mnemonicAt(p.bytes, 2)).toBe('HLT');
  });

  it('resolves labels defined anywhere in the program', () => {
    const p = parseProgram('start: LDI R0, 1\nloop: JMP end\nJMP start\nend: HLT', 'asm');
    expect(p.errors).toBe(0);
    expect(p.bytes).toEqual([0x10, 1, 0x60, 6, 0x60, 0, 0xff]);
  });

  it('round-trips ROM data and splits it into one instruction per line', () => {
    expect(dataToBytes(' 10 5 ff ')).toEqual([0x10, 5, 0xff]);
    expect(bytesToData([0x10, 5, 0, 0])).toBe('10 05');
    expect(bytesToData([0x123], 12)).toBe('123');
    expect(programText([0x11, 7, 0xff])).toBe('11 07\nFF');
  });
});

describe('memory and CPU view', () => {
  it('lists memory parts and their contents', () => {
    const rom = part('r', 'rom', { props: { addrWidth: 4, data: '01 02' } });
    const board: Board = { parts: [part('x', 'register'), rom, part('m', 'ram'), part('n', 'nand')], wires: [] };
    expect(memoryParts(board).map((p) => p.id)).toEqual(['r', 'm', 'x']);
    expect(capacityOf(rom)).toBe(16);
    expect(contentsOf(rom, undefined).slice(0, 3)).toEqual([1, 2, 0]);
    expect(contentsOf(rom, [9])[0]).toBe(9);
    expect(changedCells([1, 2, 3], [1, 5, 3])).toEqual(new Set([1]));
    expect(changedCells(null, [1]).size).toBe(0);
  });

  it('finds a Toy-8 CPU by part labels', () => {
    const board: Board = {
      parts: [part('p', 'counter', { label: 'PC' }), part('i', 'register', { label: 'IR' }), part('z', 'lamp', { label: 'Z' }), part('r', 'rom', { label: 'ROM' })],
      wires: [],
    };
    const cpu = findCpu(board)!;
    expect(cpu.regs.map((r) => r.name)).toEqual(['PC', 'IR']);
    expect(cpu.flags.map((f) => f.name)).toEqual(['Z']);
    expect(cpu.rom?.id).toBe('r');
    expect(findCpu({ parts: [part('i', 'register', { label: 'IR' })], wires: [] })).toBeNull();
  });

  it('reads a part value from memory, bus pins or 1-bit pins', () => {
    const reg = part('i', 'register', { props: { width: 8 } });
    expect(partValue(reg, null, [42])).toEqual({ w: 8, v: 42, x: 0 });
    expect(partValue(reg, snap({ busPins: { 'i:d': { w: 8, v: 1, x: 0 }, 'i:q': { w: 8, v: 7, x: 0 } } }))?.v).toBe(7);
    expect(partValue(part('z', 'lamp'), snap({ pins: { 'z:in': 2 } }))).toEqual({ w: 1, v: 0, x: 1 });
  });
});

describe('dock state', () => {
  it('clamps the height and keeps pinned lanes in order', () => {
    expect(clampHeight(10)).toBe(140);
    expect(clampHeight(9999)).toBe(640);
    const s = useDock.getState();
    s.setPinned([]);
    s.pin('a');
    s.pin('b');
    s.pin('a');
    expect(useDock.getState().pinned).toEqual(['a', 'b']);
    s.movePin('b', -1);
    expect(useDock.getState().pinned).toEqual(['b', 'a']);
    s.unpin('b');
    expect(useDock.getState().pinned).toEqual(['a']);
  });

  it('survives storage that throws', () => {
    const ls = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    vi.stubGlobal('localStorage', ls);
    expect(() => useDock.getState().setHeight(300)).not.toThrow();
    expect(useDock.getState().height).toBe(300);
    vi.unstubAllGlobals();
  });
});
