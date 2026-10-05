/**
 * Raw DEFLATE (RFC 1951) for share links, with no dependency:
 * - compress: CompressionStream('deflate-raw') when the browser has it; else
 *   the caller stores the JSON uncompressed (see share.ts).
 * - decompress: DecompressionStream('deflate-raw') when available, else the
 *   small inflater below (puff-style canonical Huffman decoding).
 * Both decoders stop at `maxOut` bytes so a tiny link cannot expand into a
 * huge allocation (E-DATA-03).
 */

export class InflateError extends Error {
  override name = 'InflateError';
}

const MAXBITS = 15;
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Huffman {
  count: Uint16Array;
  symbol: Uint16Array;
}

function build(lengths: ArrayLike<number>, n: number): Huffman {
  const count = new Uint16Array(MAXBITS + 1);
  const symbol = new Uint16Array(n);
  for (let s = 0; s < n; s++) count[lengths[s]!]!++;
  const offs = new Uint16Array(MAXBITS + 1);
  for (let len = 1; len < MAXBITS; len++) offs[len + 1] = offs[len]! + count[len]!;
  for (let s = 0; s < n; s++) if (lengths[s]) symbol[offs[lengths[s]!]!++] = s;
  return { count, symbol };
}

let FIXED: { lit: Huffman; dist: Huffman } | null = null;
function fixed(): { lit: Huffman; dist: Huffman } {
  if (FIXED) return FIXED;
  const l = new Uint8Array(288);
  l.fill(8, 0, 144);
  l.fill(9, 144, 256);
  l.fill(7, 256, 280);
  l.fill(8, 280, 288);
  FIXED = { lit: build(l, 288), dist: build(new Uint8Array(30).fill(5), 30) };
  return FIXED;
}

/** Inflate raw DEFLATE data. Throws InflateError on corrupt input or when the output would pass `maxOut` bytes. */
export function inflateRaw(src: Uint8Array, maxOut = 2 * 1024 * 1024): Uint8Array {
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(Math.min(maxOut, Math.max(1024, src.length * 4)));
  let len = 0;

  const bits = (need: number): number => {
    let v = bitBuf;
    while (bitCnt < need) {
      if (pos >= src.length) throw new InflateError('Unexpected end of data');
      v |= src[pos++]! << bitCnt;
      bitCnt += 8;
    }
    bitBuf = v >>> need;
    bitCnt -= need;
    return v & ((1 << need) - 1);
  };
  const ensure = (extra: number) => {
    if (len + extra > maxOut) throw new InflateError('Data expands past the size limit');
    if (len + extra <= out.length) return;
    let size = out.length * 2;
    while (size < len + extra) size *= 2;
    const next = new Uint8Array(Math.min(size, maxOut));
    next.set(out.subarray(0, len));
    out = next;
  };
  const decode = (h: Huffman): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let l = 1; l <= MAXBITS; l++) {
      code |= bits(1);
      const count = h.count[l]!;
      if (code - count < first) return h.symbol[index + (code - first)]!;
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new InflateError('Bad Huffman code');
  };
  const codes = (lit: Huffman, dist: Huffman) => {
    for (;;) {
      let sym = decode(lit);
      if (sym < 256) {
        ensure(1);
        out[len++] = sym;
      } else if (sym === 256) return;
      else {
        sym -= 257;
        if (sym >= 29) throw new InflateError('Bad length code');
        const n = LBASE[sym]! + bits(LEXT[sym]!);
        const ds = decode(dist);
        if (ds >= 30) throw new InflateError('Bad distance code');
        const d = DBASE[ds]! + bits(DEXT[ds]!);
        if (d > len) throw new InflateError('Distance too far back');
        ensure(n);
        for (let i = 0; i < n; i++, len++) out[len] = out[len - d]!;
      }
    }
  };

  let last: number;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0;
      bitCnt = 0;
      if (pos + 4 > src.length) throw new InflateError('Unexpected end of data');
      const n = src[pos]! | (src[pos + 1]! << 8);
      const nn = src[pos + 2]! | (src[pos + 3]! << 8);
      pos += 4;
      if (n !== (~nn & 0xffff)) throw new InflateError('Stored block length mismatch');
      if (pos + n > src.length) throw new InflateError('Unexpected end of data');
      ensure(n);
      out.set(src.subarray(pos, pos + n), len);
      len += n;
      pos += n;
    } else if (type === 1) {
      const f = fixed();
      codes(f.lit, f.dist);
    } else if (type === 2) {
      const nlen = bits(5) + 257;
      const ndist = bits(5) + 1;
      const ncode = bits(4) + 4;
      if (nlen > 286 || ndist > 30) throw new InflateError('Bad code counts');
      const cl = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]!] = bits(3);
      const clh = build(cl, 19);
      const lengths = new Uint8Array(nlen + ndist);
      for (let i = 0; i < nlen + ndist; ) {
        const sym = decode(clh);
        if (sym < 16) lengths[i++] = sym;
        else {
          let rep: number;
          let val = 0;
          if (sym === 16) {
            if (i === 0) throw new InflateError('Repeat with no previous length');
            val = lengths[i - 1]!;
            rep = 3 + bits(2);
          } else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (i + rep > nlen + ndist) throw new InflateError('Too many lengths');
          while (rep--) lengths[i++] = val;
        }
      }
      if (lengths[256] === 0) throw new InflateError('No end-of-block code');
      codes(build(lengths.subarray(0, nlen), nlen), build(lengths.subarray(nlen), ndist));
    } else throw new InflateError('Bad block type');
  } while (!last);
  return out.slice(0, len);
}

// ---------------------------------------------------------------- base64url

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new InflateError('Not base64url');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------- streams

const hasStream = (kind: 'CompressionStream' | 'DecompressionStream'): boolean => {
  const C = (globalThis as Record<string, unknown>)[kind] as (new (f: string) => unknown) | undefined;
  if (typeof C !== 'function') return false;
  try {
    new C('deflate-raw');
    return true;
  } catch {
    return false;
  }
};

export const canCompress = (): boolean => hasStream('CompressionStream');

/** Deflate-raw with the platform stream, or null when the browser has none. */
export async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (!canCompress()) return null;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflate with the platform stream (stopping at `maxOut`), or the JS inflater. */
export async function inflate(data: Uint8Array, maxOut: number, preferJs = false): Promise<Uint8Array> {
  if (preferJs || !hasStream('DecompressionStream')) return inflateRaw(data, maxOut);
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxOut) {
        void reader.cancel().catch(() => undefined);
        throw new InflateError('Data expands past the size limit');
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof InflateError) throw e;
    throw new InflateError('Corrupt compressed data');
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
