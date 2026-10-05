import { describe, expect, it } from 'vitest';
import {
  causeKey,
  decodeMstatus,
  decodeSatp,
  formatReg,
  irqBits,
  keyText,
  paintFramebuffer,
  parseAddress,
  sinceClear,
  sortSymbols,
  symbolize,
  walkStack,
} from './rv';

const syms = sortSymbols([
  { name: 'main', addr: 0x80000010 },
  { name: '_start', addr: 0x80000000 },
  { name: '.L1', addr: 0x80000014 },
  { name: 'buf', addr: 0x80001000 },
]);

describe('rv debugger helpers', () => {
  it('formats registers in hex and signed decimal', () => {
    expect(formatReg(0xffffffff, 'hex')).toBe('0xffffffff');
    expect(formatReg(0xffffffff, 'dec')).toBe('-1');
    expect(formatReg(42, 'dec')).toBe('42');
  });

  it('symbolizes addresses by the nearest label at or below', () => {
    expect(symbolize(0x80000000, syms)).toBe('_start');
    expect(symbolize(0x80000018, syms)).toBe('main+0x8');
    expect(symbolize(0x10, syms)).toBeNull();
  });

  it('parses hex, decimal, registers, symbols and offsets', () => {
    const regs = Array.from({ length: 32 }, (_, i) => i * 0x100);
    expect(parseAddress('0x8000_0000', regs, syms)).toBe(0x80000000);
    expect(parseAddress('80000000', regs, syms)).toBe(0x80000000);
    expect(parseAddress('#16', regs, syms)).toBe(16);
    expect(parseAddress('sp', regs, syms)).toBe(0x200);
    expect(parseAddress('x10', regs, syms)).toBe(0xa00);
    expect(parseAddress('buf + 0x10', regs, syms)).toBe(0x80001010);
    expect(parseAddress('sp-4', regs, syms)).toBe(0x1fc);
    expect(parseAddress('nope', regs, syms)).toBeNull();
  });

  it('decodes mcause, mstatus, mie and satp', () => {
    expect(causeKey(2)).toBe('exc.illegalInstruction');
    expect(causeKey(0x80000007)).toBe('irq.mti');
    expect(causeKey(10)).toBeNull();
    expect(decodeMstatus((1 << 3) | (3 << 11))).toBe('MIE MPP=M');
    expect(irqBits((1 << 7) | (1 << 11))).toEqual(['MTI', 'MEI']);
    expect(decodeSatp(0)).toBe('Bare');
    expect(decodeSatp(0x80080010)).toBe('Sv32 asid=0 ppn=0x80010');
  });

  it('walks frames through the frame-pointer chain', () => {
    const mem = new Map<number, number>([
      [0x1ffc, 0x80000040], // saved ra of frame at fp=0x2000
      [0x1ff8, 0x2100], // caller fp
      [0x20fc, 0x80000008],
      [0x20f8, 0],
    ]);
    const regs = new Array(32).fill(0);
    regs[1] = 0x80000030;
    regs[2] = 0x1f00;
    regs[8] = 0x2000;
    const frames = walkStack(0x80000050, regs, (a) => mem.get(a) ?? null);
    expect(frames.map((f) => [f.addr, f.via])).toEqual([
      [0x80000050, 'pc'],
      [0x80000030, 'ra'],
      [0x80000040, 'fp'],
      [0x80000008, 'fp'],
    ]);
  });

  it('falls back to pc and ra without a frame pointer', () => {
    const regs = new Array(32).fill(0);
    regs[1] = 0x80000030;
    expect(walkStack(0x80000050, regs, () => null)).toHaveLength(2);
  });

  it('shows console output since the last clear, also after the buffer slid', () => {
    expect(sinceClear('hello world', '')).toBe('hello world');
    expect(sinceClear('hello world', 'hello ')).toBe('world');
    expect(sinceClear('new', 'hello')).toBe('new');
    // The 64 KiB buffer dropped its first bytes after the clear.
    const old = `${'x'.repeat(1000)}0123456789`;
    expect(sinceClear(`${old.slice(5)} world`, old)).toBe(' world');
  });

  it('maps console keys to bytes', () => {
    const k = (key: string, ctrlKey = false) => keyText({ key, ctrlKey, metaKey: false, altKey: false });
    expect(k('a')).toBe('a');
    expect(k('Enter')).toBe('\n');
    expect(k('d', true)).toBe('\x04');
    expect(k('c', true)).toBeNull();
    expect(k('ArrowUp')).toBeNull();
  });

  it('paints indexed pixels through a 0x00RRGGBB palette', () => {
    const out = new Uint8ClampedArray(8);
    paintFramebuffer(new Uint8Array([0, 1]), new Uint32Array([0x000000, 0x123456]), out);
    expect([...out]).toEqual([0, 0, 0, 255, 0x12, 0x34, 0x56, 255]);
  });
});
