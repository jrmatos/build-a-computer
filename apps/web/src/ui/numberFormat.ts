/**
 * Number parsing and formatting for number inputs, the const editor and the
 * wire probe. Values are unsigned 32-bit numbers masked to a bit width.
 */

export const maskOf = (width: number): number => (width >= 32 ? 0xffffffff : (1 << width) - 1) >>> 0;

/** Two's-complement reading of an unsigned `width`-bit value. */
export function toSigned(v: number, width: number): number {
  const m = maskOf(width);
  const u = (v & m) >>> 0;
  if (width >= 32) return u | 0;
  return u & (1 << (width - 1)) ? u - 2 ** width : u;
}

/**
 * Parse what a player typed: `0x1F` / `1Fh` hex, `0b1010` binary, `-5` signed
 * decimal, or plain decimal. `$FF` also reads as hex. Underscores and spaces
 * are ignored. Returns null when the text is not a number or does not fit in
 * `width` bits (negative values must fit as signed).
 */
export function parseNumber(text: string, width: number): number | null {
  const s = text.trim().replace(/[_\s]/g, '').toLowerCase();
  if (!s) return null;
  let neg = false;
  let body = s;
  if (body.startsWith('-')) {
    neg = true;
    body = body.slice(1);
  }
  let n: number;
  if (/^0x[0-9a-f]+$/.test(body)) n = parseInt(body.slice(2), 16);
  else if (/^\$[0-9a-f]+$/.test(body)) n = parseInt(body.slice(1), 16);
  else if (/^[0-9a-f]+h$/.test(body)) n = parseInt(body.slice(0, -1), 16);
  else if (/^0b[01]+$/.test(body)) n = parseInt(body.slice(2), 2);
  else if (/^\d+$/.test(body)) n = parseInt(body, 10);
  else return null;
  if (!Number.isFinite(n)) return null;
  if (neg) {
    if (n === 0) return 0;
    if (n > 2 ** (width - 1)) return null;
    return (2 ** width - n) >>> 0;
  }
  if (n > maskOf(width)) return null;
  return n >>> 0;
}

/** Hex digits needed for `width` bits. */
export const hexDigits = (width: number): number => Math.max(1, Math.ceil(width / 4));

export function toHex(v: number, width: number): string {
  return (v >>> 0).toString(16).toUpperCase().padStart(hexDigits(width), '0');
}

export function toBin(v: number, width: number): string {
  return (v >>> 0).toString(2).padStart(width, '0');
}

/** Group a string from the right in chunks of `n`, separated by a thin space. */
export function groupDigits(s: string, n = 4, sep = ' '): string {
  const out: string[] = [];
  for (let i = s.length; i > 0; i -= n) out.unshift(s.slice(Math.max(0, i - n), i));
  return out.join(sep);
}

export interface ProbeText {
  width: number;
  /** MSB first, `x` for unknown bits, grouped by 4. */
  bin: string;
  /** null when any bit is unknown. */
  dec: string | null;
  signed: string | null;
  /** `X` for nibbles with any unknown bit. */
  hex: string;
  /** Number of unknown bits. */
  xBits: number;
}

/** Format a value with an unknown mask the way the probe shows it. */
export function probeText(width: number, v: number, x: number): ProbeText {
  const m = maskOf(width);
  const vv = (v & m) >>> 0;
  const xx = (x & m) >>> 0;
  let bin = '';
  for (let i = width - 1; i >= 0; i--) bin += (xx >>> i) & 1 ? 'x' : String((vv >>> i) & 1);
  let hex = '';
  for (let i = hexDigits(width) - 1; i >= 0; i--) {
    const nx = (xx >>> (i * 4)) & 0xf;
    hex += nx ? 'X' : ((vv >>> (i * 4)) & 0xf).toString(16).toUpperCase();
  }
  let xBits = 0;
  for (let i = 0; i < width; i++) xBits += (xx >>> i) & 1;
  return {
    width,
    bin: groupDigits(bin),
    dec: xx ? null : String(vv),
    signed: xx ? null : String(toSigned(vv, width)),
    hex,
    xBits,
  };
}

/** Text shown in the number input for a value, by display format. */
export function formatValue(v: number, width: number, format: 'hex' | 'dec' | 'bin' | 'signed'): string {
  switch (format) {
    case 'hex':
      return `0x${toHex(v, width)}`;
    case 'bin':
      return `0b${toBin(v, width)}`;
    case 'signed':
      return String(toSigned(v, width));
    default:
      return String(v >>> 0);
  }
}

/** Step a value by `delta`, wrapping within `width` bits. */
export function stepValue(v: number, delta: number, width: number): number {
  const size = 2 ** width;
  return ((((v + delta) % size) + size) % size) >>> 0;
}
