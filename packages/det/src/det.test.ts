import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Prng, add32, canonicalJson, mul32, mulh, mulhu, sha256, signExtend, sub32 } from './index';

describe('Prng', () => {
  it('is deterministic for a seed', () => {
    const a = new Prng(42);
    const b = new Prng(42);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('matches the golden sequence for seed 1', () => {
    const p = new Prng(1);
    // Golden values: if these change, every seeded save and test changes too.
    expect([p.nextU32(), p.nextU32(), p.nextU32()]).toMatchSnapshot();
  });

  it('nextInt stays in range', () => {
    const p = new Prng(7);
    for (let i = 0; i < 1000; i++) {
      const v = p.nextInt(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });
});

describe('E-CPU-02 32-bit boundaries', () => {
  const edges = [0, 1, -1, 0x7fffffff, 0x80000000];
  it('add and sub wrap', () => {
    expect(add32(0xffffffff, 1)).toBe(0);
    expect(add32(0x7fffffff, 1)).toBe(0x80000000);
    expect(sub32(0, 1)).toBe(0xffffffff);
  });
  it('mul matches BigInt for boundary values', () => {
    for (const a of edges)
      for (const b of edges) {
        const big = BigInt.asUintN(32, BigInt(a >>> 0) * BigInt(b >>> 0));
        expect(mul32(a, b)).toBe(Number(big));
        expect(mulhu(a, b)).toBe(Number((BigInt(a >>> 0) * BigInt(b >>> 0)) >> 32n));
        const sp = BigInt(a | 0) * BigInt(b | 0);
        expect(mulh(a, b)).toBe(Number(BigInt.asUintN(32, sp >> 32n)));
      }
  });
  it('sign extension', () => {
    expect(signExtend(0x800, 12)).toBe(0xfffff800);
    expect(signExtend(0x7ff, 12)).toBe(0x7ff);
  });
});

describe('canonicalJson', () => {
  it('sorts keys and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: [true, null], c: undefined })).toBe('{"a":[true,null],"b":1}');
  });
});

describe('sha256', () => {
  it('matches node crypto', () => {
    for (const s of ['', 'abc', 'x'.repeat(1000), 'ground up ✓']) {
      expect(sha256(s)).toBe(createHash('sha256').update(s).digest('hex'));
    }
  });
});
