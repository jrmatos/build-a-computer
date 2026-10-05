/**
 * Pure helpers for the ROM hex editor (SIM-13): converting between the
 * `props.data` text and words, nibble-by-nibble typing, paste, and .bin/.hex
 * import and export.
 */
import { parseRomData, type RomParseError } from '@build-a-computer/sim-logic';
import { hexDigits, maskOf, toHex } from './numberFormat';

export const COLUMNS = 16;

export interface GridData {
  words: Uint32Array;
  errors: RomParseError[];
}

/** ROM contents for these props (2^addrWidth words, missing entries 0). */
export function wordsFromData(data: string, width: number, addrWidth: number): GridData {
  const r = parseRomData(data, width, addrWidth);
  return { words: r.words, errors: r.errors };
}

/**
 * Text for `props.data`: hex words, 16 per line, padded to the word's digit
 * count. Trailing zero words are left out (they read back as 0).
 */
export function dataFromWords(words: ArrayLike<number>, width: number): string {
  let end = words.length;
  while (end > 0 && words[end - 1] === 0) end--;
  const lines: string[] = [];
  for (let i = 0; i < end; i += COLUMNS) {
    const row: string[] = [];
    for (let j = i; j < Math.min(end, i + COLUMNS); j++) row.push(toHex(words[j]! >>> 0, width));
    lines.push(row.join(' '));
  }
  return lines.join('\n');
}

export interface Cursor {
  addr: number;
  /** Nibble being typed, 0 = most significant digit of the word. */
  nibble: number;
}

/**
 * Overwrite one hex digit of a word at the cursor and advance, like a classic
 * hex editor. Returns the new word value and the next cursor.
 */
export function typeDigit(word: number, digit: number, width: number, cur: Cursor, size: number): { word: number; cursor: Cursor } {
  const digits = hexDigits(width);
  const shift = (digits - 1 - cur.nibble) * 4;
  const cleared = (word & ~(0xf << shift)) >>> 0;
  const next = ((cleared | ((digit & 0xf) << shift)) & maskOf(width)) >>> 0;
  let cursor: Cursor;
  if (cur.nibble + 1 < digits) cursor = { addr: cur.addr, nibble: cur.nibble + 1 };
  else if (cur.addr + 1 < size) cursor = { addr: cur.addr + 1, nibble: 0 };
  else cursor = { addr: cur.addr, nibble: digits - 1 };
  return { word: next, cursor };
}

/** Move the cursor by whole words (arrows); clamps to the ROM. */
export function moveCursor(cur: Cursor, delta: number, size: number): Cursor {
  return { addr: Math.max(0, Math.min(size - 1, cur.addr + delta)), nibble: 0 };
}

export interface PasteResult {
  values: number[];
  errors: RomParseError[];
}

/** Parse pasted text (same syntax as props.data) into words; invalid tokens are reported. */
export function parsePaste(text: string, width: number, max = 1 << 16): PasteResult {
  const r = parseRomData(text, width, 16);
  return { values: Array.from(r.words.subarray(0, Math.min(r.count, max))), errors: r.errors };
}

/** Write `values` into a copy of `words` starting at `at`; values past the end are dropped. */
export function writeAt(words: Uint32Array, at: number, values: readonly number[]): Uint32Array {
  const out = words.slice();
  for (let i = 0; i < values.length && at + i < out.length; i++) out[at + i] = values[i]!;
  return out;
}

const bytesPer = (width: number): number => Math.max(1, Math.ceil(width / 8));

/** Raw binary to words: little-endian, ceil(width/8) bytes per word, masked to width. */
export function bytesToWords(bytes: Uint8Array, width: number, size: number): Uint32Array {
  const n = bytesPer(width);
  const m = maskOf(width);
  const out = new Uint32Array(size);
  for (let i = 0; i < size && i * n < bytes.length; i++) {
    let v = 0;
    for (let b = 0; b < n; b++) v += (bytes[i * n + b] ?? 0) * 2 ** (8 * b);
    out[i] = (v & m) >>> 0;
  }
  return out;
}

/** Words to raw binary, little-endian, ceil(width/8) bytes each. */
export function wordsToBytes(words: ArrayLike<number>, width: number): Uint8Array {
  const n = bytesPer(width);
  const out = new Uint8Array(words.length * n);
  for (let i = 0; i < words.length; i++) {
    const v = words[i]! >>> 0;
    for (let b = 0; b < n; b++) out[i * n + b] = Math.floor(v / 2 ** (8 * b)) & 0xff;
  }
  return out;
}

/** One printable character for the ASCII column (low byte), '.' otherwise. */
export function asciiOf(word: number): string {
  const c = word & 0xff;
  return c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.';
}

/** Address label padded to the ROM's address width. */
export function addrLabel(addr: number, addrWidth: number): string {
  return toHex(addr, addrWidth);
}

/**
 * Intel HEX (lines starting with ':') to bytes, honoring data (00) and
 * extended linear/segment address (04/02) records. Returns null when the text
 * is not Intel HEX or a checksum fails.
 */
export function parseIntelHex(text: string): Uint8Array | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length || !lines.every((l) => l.startsWith(':'))) return null;
  const bytes: number[] = [];
  let base = 0;
  for (const line of lines) {
    if (!/^:[0-9a-fA-F]+$/.test(line) || line.length < 11 || line.length % 2 === 0) return null;
    const rec = [];
    for (let i = 1; i < line.length; i += 2) rec.push(parseInt(line.slice(i, i + 2), 16));
    const len = rec[0]!;
    if (rec.length !== len + 5) return null;
    if (rec.reduce((a, b) => a + b, 0) & 0xff) return null;
    const addr = (rec[1]! << 8) | rec[2]!;
    const type = rec[3]!;
    const data = rec.slice(4, 4 + len);
    if (type === 0) {
      const at = base + addr;
      if (at + len > 1 << 20) return null;
      for (let i = 0; i < len; i++) bytes[at + i] = data[i]!;
    } else if (type === 1) break;
    else if (type === 2) base = ((data[0]! << 8) | data[1]!) * 16;
    else if (type === 4) base = ((data[0]! << 8) | data[1]!) * 65536;
  }
  return Uint8Array.from(bytes, (b) => b ?? 0);
}
