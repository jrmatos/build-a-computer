import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { fromBase64Url, inflateRaw, InflateError, toBase64Url } from './deflate';
import { decodeShare, encodeShare, makeShareLink, sharePayload, shareFromHash, ShareError, SHARE_MAX_CHARS } from './share';
import { notBoard } from './fixtures.test-util';

const enc = new TextEncoder();

function seeded(n: number, seed = 7): Uint8Array {
  let s = seed;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out[i] = (s >>> 16) & 0xff;
  }
  return out;
}

describe('inflateRaw (JS fallback)', () => {
  const samples: [string, Uint8Array][] = [
    ['empty', new Uint8Array(0)],
    ['text', enc.encode('hello hello hello hello, share links! '.repeat(50))],
    ['json', enc.encode(JSON.stringify(sharePayload(notBoard(), {})))],
    ['random', seeded(5000)],
    ['runs', new Uint8Array(70_000).fill(65)],
  ];
  for (const [name, data] of samples) {
    for (const level of [0, 1, 6, 9]) {
      it(`matches zlib for ${name} at level ${level}`, () => {
        const z = new Uint8Array(deflateRawSync(data, { level }));
        expect(inflateRaw(z, 1 << 20)).toEqual(data);
      });
    }
  }

  it('E-DATA-03: stops at the output limit (no decompression bombs)', () => {
    const z = new Uint8Array(deflateRawSync(new Uint8Array(1 << 20)));
    expect(() => inflateRaw(z, 1000)).toThrow(InflateError);
  });

  it('rejects truncated and garbage input', () => {
    const z = new Uint8Array(deflateRawSync(enc.encode('x'.repeat(1000) + 'abc'.repeat(300))));
    expect(() => inflateRaw(z.subarray(0, z.length - 3))).toThrow(InflateError);
    expect(() => inflateRaw(new Uint8Array([0xff, 0xff, 0xff]))).toThrow(InflateError);
  });
});

describe('base64url', () => {
  it('round-trips every byte value without + / =', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const s = toBase64Url(all);
    expect(s).not.toMatch(/[+/=]/);
    expect(fromBase64Url(s)).toEqual(all);
  });
});

describe('share links (COM-01)', () => {
  const payload = sharePayload(notBoard(), {}, 'nand-not', 'My NOT');

  it('round-trips a board through a compressed fragment', async () => {
    const value = await encodeShare(payload);
    expect(value[0]).toBe('z');
    expect(await decodeShare(value)).toEqual(payload);
    // The JS inflater opens the same link (browsers without DecompressionStream).
    expect(await decodeShare(value, { preferJs: true })).toEqual(payload);
  });

  it('falls back to plain JSON when compression is unavailable', async () => {
    const value = await encodeShare(payload, false);
    expect(value[0]).toBe('j');
    expect(await decodeShare(value)).toEqual(payload);
  });

  it('builds a #share= link and reads it back from the hash', async () => {
    const link = await makeShareLink(payload, 'https://example.test/app/?level=x#level=y');
    expect(link.kind).toBe('link');
    if (link.kind !== 'link') return;
    const url = new URL(link.url);
    expect(url.search).toBe('');
    const value = shareFromHash(url.hash);
    expect(value).not.toBeNull();
    expect(await decodeShare(value!)).toEqual(payload);
    expect(shareFromHash('#level=and')).toBeNull();
  });

  it('large boards fall back to a file', async () => {
    const parts = Array.from({ length: 2000 }, (_, i) => ({ id: `p${i}`, type: 'nand' as const, x: (i * 7919) % 997, y: (i * 104729) % 991, rot: 0 as const, flip: false, label: `n${(i * 31337) % 100003}` }));
    const big = sharePayload({ parts, wires: [] }, {});
    const link = await makeShareLink(big, 'https://example.test/');
    expect(link.kind).toBe('too-large');
    expect(link.chars).toBeGreaterThan(SHARE_MAX_CHARS);
  });

  it('E-DATA-03: rejects damaged, oversized, deep, prototype-polluting or invalid links', async () => {
    await expect(decodeShare('zAAAA')).rejects.toBeInstanceOf(ShareError);
    await expect(decodeShare('q' + toBase64Url(enc.encode('{}')))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(decodeShare('j' + 'A'.repeat(70_000))).rejects.toMatchObject({ code: 'too-long' });
    // A bomb: tiny link, huge JSON.
    const bomb = 'z' + toBase64Url(new Uint8Array(deflateRawSync(enc.encode(' '.repeat(3 * 1024 * 1024) + '{}'))));
    await expect(decodeShare(bomb)).rejects.toMatchObject({ code: 'too-long' });
    await expect(decodeShare(bomb, { preferJs: true })).rejects.toMatchObject({ code: 'too-long' });
    const deep = 'j' + toBase64Url(enc.encode('['.repeat(100) + ']'.repeat(100)));
    await expect(decodeShare(deep)).rejects.toMatchObject({ code: 'corrupt' });
    const invalid = 'j' + toBase64Url(enc.encode(JSON.stringify({ kind: 'build-a-computer/share', version: 1, board: { parts: 'nope' } })));
    await expect(decodeShare(invalid)).rejects.toMatchObject({ code: 'invalid' });
    const proto = JSON.stringify(payload).replace('"chips":{}', '"chips":{},"__proto__":{"polluted":true}');
    const decoded = await decodeShare('j' + toBase64Url(enc.encode(proto)));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(decoded, '__proto__')).toBe(false);
  });
});
