import { describe, expect, it } from 'vitest';
import { bytesToWords, dataFromWords, moveCursor, parseIntelHex, parsePaste, typeDigit, wordsFromData, wordsToBytes, writeAt, asciiOf } from './romGrid';

describe('ROM data ↔ words', () => {
  it('round-trips and trims trailing zeros', () => {
    const { words } = wordsFromData('01 02 0x0A\nff', 8, 4);
    expect(Array.from(words.slice(0, 5))).toEqual([1, 2, 10, 255, 0]);
    expect(dataFromWords(words, 8)).toBe('01 02 0A FF');
    expect(wordsFromData(dataFromWords(words, 8), 8, 4).words).toEqual(words);
  });
  it('writes 16 words per line, padded to the width', () => {
    const w = new Uint32Array(20).fill(1);
    expect(dataFromWords(w, 12).split('\n')).toEqual([Array(16).fill('001').join(' '), Array(4).fill('001').join(' ')]);
    expect(dataFromWords(new Uint32Array(8), 8)).toBe('');
  });
  it('reports parse errors', () => {
    const r = wordsFromData('01 zz 1FF', 8, 2);
    expect(r.errors.map((e) => [e.index, e.reason])).toEqual([
      [1, 'invalid'],
      [2, 'overflow'],
    ]);
  });
});

describe('editing', () => {
  it('types hex digits nibble by nibble and advances', () => {
    let cur = { addr: 0, nibble: 0 };
    let r = typeDigit(0, 0xa, 8, cur, 4);
    expect(r).toEqual({ word: 0xa0, cursor: { addr: 0, nibble: 1 } });
    cur = r.cursor;
    r = typeDigit(r.word, 0x5, 8, cur, 4);
    expect(r).toEqual({ word: 0xa5, cursor: { addr: 1, nibble: 0 } });
    // Last address stays on its last nibble.
    expect(typeDigit(0, 1, 8, { addr: 3, nibble: 1 }, 4).cursor).toEqual({ addr: 3, nibble: 1 });
    // Narrow words mask the digit.
    expect(typeDigit(0, 0xf, 3, { addr: 0, nibble: 0 }, 4).word).toBe(7);
  });
  it('moves and clamps the cursor', () => {
    expect(moveCursor({ addr: 5, nibble: 1 }, 16, 16)).toEqual({ addr: 15, nibble: 0 });
    expect(moveCursor({ addr: 5, nibble: 0 }, -16, 16)).toEqual({ addr: 0, nibble: 0 });
  });
  it('pastes at an address and drops what does not fit', () => {
    const p = parsePaste('11 22 33', 8);
    expect(p.values).toEqual([0x11, 0x22, 0x33]);
    const w = writeAt(new Uint32Array(4), 2, p.values);
    expect(Array.from(w)).toEqual([0, 0, 0x11, 0x22]);
    expect(parsePaste('11 nope', 8).errors[0]?.token).toBe('nope');
  });
  it('shows printable ASCII', () => {
    expect(asciiOf(0x41)).toBe('A');
    expect(asciiOf(0x0a)).toBe('.');
    expect(asciiOf(0x141)).toBe('A');
  });
});

describe('binary import and export', () => {
  it('8-bit words are one byte each', () => {
    const w = bytesToWords(new Uint8Array([1, 2, 3]), 8, 4);
    expect(Array.from(w)).toEqual([1, 2, 3, 0]);
    expect(Array.from(wordsToBytes(w, 8))).toEqual([1, 2, 3, 0]);
  });
  it('wider words are little-endian and masked', () => {
    const w = bytesToWords(new Uint8Array([0x34, 0x12, 0xff, 0xff]), 12, 2);
    expect(Array.from(w)).toEqual([0x234, 0xfff]);
    expect(Array.from(wordsToBytes([0xdeadbeef], 32))).toEqual([0xef, 0xbe, 0xad, 0xde]);
  });
  it('reads Intel HEX', () => {
    const text = ':0300000001020AF0\n:00000001FF\n';
    expect(Array.from(parseIntelHex(text)!)).toEqual([1, 2, 10]);
    expect(parseIntelHex('01 02')).toBeNull();
    expect(parseIntelHex(':0300000001020AF1')).toBeNull(); // bad checksum
  });
});
