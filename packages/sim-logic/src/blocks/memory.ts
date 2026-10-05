import type { Part } from '@ground-up/schema';
import { allX, mask, sig, type Signal } from '../values';
import type { BlockModel } from './types';
import { bit, input, numProp, randomWord } from './bits';

/**
 * Clocked and memory blocks: register, counter, RAM, ROM.
 *
 * X rules (shared):
 * - The engine decides when a rising edge happens; an X clock never fires.
 * - On an edge, an X `load` (register/counter) or an X `en` with load = 0
 *   (counter) makes the whole stored word X: we can't know whether it changed.
 * - Stored words keep per-bit X: loading `d` with some X bits stores those
 *   bits as X; incrementing a counter with any X bit gives an all-X word.
 * - RAM: an X address on read gives all-X `q`. On a write edge (we = 1 or X)
 *   every address consistent with the known address bits is affected: if the
 *   address is fully known only that word, otherwise each candidate word
 *   becomes all-X (we can't know which one was written). we = X makes the
 *   written word(s) all-X; we = 0 writes nothing.
 * - Power on: 'zero' fills with 0, 'random' with words from the seeded rng
 *   (E-SIM-07). Never X, so tests check behavior after reset, not luck.
 */

// ---------------------------------------------------------------- register

export interface RegisterState {
  /** Known bits of the stored word. */
  v: number;
  /** Unknown bits of the stored word. */
  x: number;
}

const wordInit = (part: Part, mode: 'zero' | 'random', rng: { nextU32(): number }): RegisterState => ({
  v: mode === 'random' ? randomWord(rng, numProp(part, 'width')) : 0,
  x: 0,
});

/** Pins: d, load, clk → q. On a rising edge: load ? d : q. */
export const registerModel: BlockModel<RegisterState> = {
  init: wordInit,
  outputs(_inputs, s, part) {
    return [sig(numProp(part, 'width'), s.v, s.x)];
  },
  clock(inputs, s, part) {
    const w = numProp(part, 'width');
    const load = bit(inputs, 1);
    if (load === 0) return s;
    if (load === 2) return { v: 0, x: mask(w) };
    const d = input(inputs, 0, w);
    return { v: d.v, x: d.x };
  },
  inspect: (s) => [s.v],
};

// ----------------------------------------------------------------- counter

/** Pins: d, load, en, clk → q. On a rising edge: load ? d : en ? q + 1 : q (wraps). */
export const counterModel: BlockModel<RegisterState> = {
  init: wordInit,
  outputs(_inputs, s, part) {
    return [sig(numProp(part, 'width'), s.v, s.x)];
  },
  clock(inputs, s, part) {
    const w = numProp(part, 'width');
    const m = mask(w);
    const load = bit(inputs, 1);
    if (load === 2) return { v: 0, x: m };
    if (load === 1) {
      const d = input(inputs, 0, w);
      return { v: d.v, x: d.x };
    }
    const en = bit(inputs, 2);
    if (en === 0) return s;
    if (en === 2 || s.x !== 0) return { v: 0, x: m };
    return { v: ((s.v + 1) & m) >>> 0, x: 0 };
  },
  inspect: (s) => [s.v],
};

// --------------------------------------------------------------------- RAM

export interface RamState {
  /** Known bits of each word (unknown bits are 0 here). */
  mem: Uint32Array;
  /** Unknown bits of each word; null until the first X write (most runs never have one). */
  xm: Uint32Array | null;
}

/** Visit every address that matches the known bits of `a` (all of them when a.x covers every bit). */
function forEachCandidate(a: Signal, fn: (addr: number) => void): void {
  const free = a.x;
  // Enumerate subsets of the unknown bits (standard submask walk).
  let sub = free;
  for (;;) {
    fn((a.v | sub) >>> 0);
    if (sub === 0) break;
    sub = (sub - 1) & free;
  }
}

/**
 * Pins: addr, d, we, clk → q. Asynchronous read q = mem[addr]; on a rising
 * edge with we = 1, mem[addr] = d. 2^addrWidth words of `width` bits. Volatile.
 * `clock` updates the state in place and returns the same object (copying up
 * to 64 Ki words per edge would be too slow).
 */
export const ramModel: BlockModel<RamState> = {
  init(part, mode, rng) {
    const w = numProp(part, 'width');
    const mem = new Uint32Array(1 << numProp(part, 'addrWidth'));
    if (mode === 'random') for (let i = 0; i < mem.length; i++) mem[i] = randomWord(rng, w);
    return { mem, xm: null };
  },
  outputs(inputs, s, part) {
    const w = numProp(part, 'width');
    const a = input(inputs, 0, numProp(part, 'addrWidth'));
    if (a.x !== 0) return [allX(w)];
    return [sig(w, s.mem[a.v] ?? 0, s.xm ? (s.xm[a.v] ?? 0) : 0)];
  },
  clock(inputs, s, part) {
    const w = numProp(part, 'width');
    const m = mask(w);
    const we = bit(inputs, 2);
    if (we === 0) return s;
    const a = input(inputs, 0, numProp(part, 'addrWidth'));
    const d = input(inputs, 1, w);
    // Fully known write: just store d (with its X bits).
    if (we === 1 && a.x === 0) {
      s.mem[a.v] = d.v;
      if (d.x !== 0 || s.xm) {
        s.xm ??= new Uint32Array(s.mem.length);
        s.xm[a.v] = d.x;
      }
      return s;
    }
    // Unknown write enable or address: every candidate word becomes all-X.
    const xm = (s.xm ??= new Uint32Array(s.mem.length));
    forEachCandidate(a, (addr) => {
      s.mem[addr] = 0;
      xm[addr] = m;
    });
    return s;
  },
  inspect: (s) => s.mem,
};

// --------------------------------------------------------------------- ROM

export interface RomParseError {
  /** Entry index (= address) of the bad token. */
  index: number;
  token: string;
  /** 'invalid': not hex (stored as 0). 'overflow': wider than `width` (stored masked). */
  reason: 'invalid' | 'overflow';
}

export interface RomParseResult {
  /** 2^addrWidth words; missing entries are 0. */
  words: Uint32Array;
  errors: RomParseError[];
  /** Number of entries found in the text (entries past the end are ignored). */
  count: number;
}

const HEX = /^(?:0[xX])?([0-9a-fA-F]+)$/;

/**
 * Parse ROM contents: hex entries, one per address, `0x`-prefixed or bare,
 * separated by whitespace, commas or newlines. `#` and `;` start a comment
 * that runs to the end of the line. Missing entries are 0, extra entries are
 * ignored, invalid tokens read as 0 and are listed in `errors` (for the hex
 * editor), values wider than `width` are masked and listed as 'overflow'.
 */
export function parseRomData(text: string, width: number, addrWidth: number): RomParseResult {
  const size = 1 << addrWidth;
  const m = mask(width);
  const words = new Uint32Array(size);
  const errors: RomParseError[] = [];
  let index = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const cut = rawLine.search(/[#;]/);
    const line = cut >= 0 ? rawLine.slice(0, cut) : rawLine;
    for (const token of line.split(/[\s,]+/)) {
      if (token === '') continue;
      const i = index++;
      if (i >= size) continue;
      const match = HEX.exec(token);
      if (!match) {
        errors.push({ index: i, token, reason: 'invalid' });
        continue;
      }
      const digits = match[1]!.replace(/^0+/, '') || '0';
      // Keep the low 32 bits without going through floats above 2^53.
      const low = parseInt(digits.slice(-8), 16) >>> 0;
      const value = (low & m) >>> 0;
      if (digits.length > 8 || value !== low) errors.push({ index: i, token, reason: 'overflow' });
      words[i] = value;
    }
  }
  return { words, errors, count: index };
}

export interface RomState {
  words: Uint32Array;
}

/** Pins: addr → q. Contents from props.data (see parseRomData). Non-volatile; no X ever stored. */
export const romModel: BlockModel<RomState> = {
  nonVolatile: true,
  init(part) {
    const data = (part.props?.data as string | undefined) ?? '';
    return { words: parseRomData(data, numProp(part, 'width'), numProp(part, 'addrWidth')).words };
  },
  outputs(inputs, s, part) {
    const w = numProp(part, 'width');
    const a = input(inputs, 0, numProp(part, 'addrWidth'));
    if (a.x !== 0) return [allX(w)];
    return [sig(w, s.words[a.v] ?? 0)];
  },
  inspect: (s) => s.words,
};
