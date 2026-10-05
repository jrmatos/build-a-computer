import { asm, toBytes } from '@build-a-computer/rv32';
import type { Board, Part, TestSpec } from '@build-a-computer/schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compile } from '../compile';
import { parseRomData } from '../blocks/memory';
import { loadProgram, parseProgram, runTest } from '../checkers';

const part = (id: string, type: Part['type'], extra: Partial<Part> = {}): Part => ({ id, type, x: 0, y: 0, rot: 0, flip: false, ...extra });
const wire = (id: string, a: string, ap: string, b: string, bp: string) => ({ id, from: { part: a, pin: ap }, to: { part: b, pin: bp }, points: [] });

/** ADDR switch → ROM (width bits, 4 words) → OUT lamp. */
const romBoard = (width: number): Board => ({
  parts: [
    part('a', 'switch', { label: 'ADDR', props: { width: 2 } }),
    part('rom', 'rom', { label: 'ROM', props: { width, addrWidth: 2, data: '' } }),
    part('o', 'lamp', { label: 'OUT', props: { width } }),
  ],
  wires: [wire('w1', 'a', 'out', 'rom', 'addr'), wire('w2', 'rom', 'q', 'o', 'in')],
});

const spec = (program: string, addr: number, out: number, wordBytes?: 1 | 4): Extract<TestSpec, { kind: 'program' }> => ({
  kind: 'program',
  program,
  rom: 'ROM',
  halt: 'HALT',
  maxCycles: 1,
  set: { ADDR: addr },
  expect: { OUT: out },
  ...(wordBytes ? { wordBytes } : {}),
});

const hexBytes = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

describe('program checker: wordBytes', () => {
  it('wordBytes absent or 1 keeps one entry per word', () => {
    expect(parseProgram('01 02 ff')).toEqual({ data: '01 02 ff' });
    expect(parseProgram('01 02 ff', 1)).toEqual({ data: '01 02 ff' });
  });

  it('wordBytes 4 packs bytes little-endian into 32-bit words, zero-padding the last', () => {
    expect(parseProgram('13 05 a0 00  0x73, 00 10 00 ; ebreak\n ff', 4)).toEqual({ data: '00a00513 00100073 000000ff' });
    expect(parseProgram('', 4)).toEqual({ data: '' });
    expect(parseProgram('0x0ff 00 00 80', 4)).toEqual({ data: '800000ff' });
  });

  it('wordBytes 4 rejects entries wider than a byte', () => {
    expect(parseProgram('100', 4)).toEqual({ error: "The program has '100', which is not a byte (00 to ff)." });
    expect(parseProgram('00a00513', 4)).toEqual({ error: "The program has '00a00513', which is not a byte (00 to ff)." });
    expect(parseProgram('zz', 4)).toEqual({ error: "The program has 'zz', which is not a hex number." });
  });

  it('packed words round-trip the rv32 assembler bytes (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 0xffffffff }), { maxLength: 16 }), (words) => {
        const parsed = parseProgram(hexBytes(toBytes(words)), 4);
        if ('error' in parsed) throw new Error(parsed.error);
        const rom = parseRomData(parsed.data, 32, 4);
        expect(rom.errors).toEqual([]);
        expect(Array.from(rom.words.slice(0, words.length))).toEqual(words.map((w) => w >>> 0));
      }),
    );
  });

  it('loadProgram writes packed words into a 32-bit ROM', () => {
    const prog = hexBytes(toBytes([asm('addi', 10, 0, 10), asm('ebreak')]));
    const patched = loadProgram(romBoard(32), { program: prog, rom: 'ROM', wordBytes: 4 });
    expect(patched.parts[1]!.props!.data).toBe('00a00513 00100073');
    // Without wordBytes the same text is one byte per word.
    expect(loadProgram(romBoard(8), { program: '13 05', rom: 'ROM' }).parts[1]!.props!.data).toBe('13 05');
  });

  it('runs a packed program on the real engine (each ROM word reads back)', () => {
    const prog = hexBytes(toBytes([0x00a00513, 0x00100073, 0xdeadbeef]));
    const t1 = spec(prog, 1, 0x00100073, 4);
    const nl = compile(loadProgram(romBoard(32), t1));
    expect([...runTest(nl, t1)][0]).toMatchObject({ pass: true });
    const t2 = spec(prog, 2, 0xdeadbeef, 4);
    expect([...runTest(compile(loadProgram(romBoard(32), t2)), t2)][0]).toMatchObject({ pass: true });
    // Off by one word fails.
    const bad = spec(prog, 2, 0x00100073, 4);
    expect([...runTest(compile(loadProgram(romBoard(32), bad)), bad)][0]!.pass).toBe(false);
  });

  it('wordBytes 1 still runs 8-bit programs unchanged', () => {
    const t = spec('10 20 30', 2, 0x30);
    expect([...runTest(compile(loadProgram(romBoard(8), t)), t)][0]).toMatchObject({ pass: true });
  });

  it('wordBytes 4 needs a 32-bit ROM', () => {
    const t = spec('13 05 a0 00', 0, 0, 4);
    const r = [...runTest(compile(loadProgram(romBoard(8), t)), t)];
    expect(r).toHaveLength(1);
    expect(r[0]!.pass).toBe(false);
    expect(r[0]!.message).toBe('The ROM labelled ROM is 8 bits wide. RISC-V instructions need a 32-bit ROM.');
  });

  it('a non-byte entry fails the run with a clear message', () => {
    const t = spec('1234', 0, 0, 4);
    const r = [...runTest(compile(romBoard(32)), t)];
    expect(r[0]!.message).toBe("The program has '1234', which is not a byte (00 to ff).");
  });
});
