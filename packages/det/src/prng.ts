/** Seeded xoshiro128** generator. Same sequence in Node and every browser. */
export class Prng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    // splitmix32 expands one 32-bit seed into four non-zero state words.
    let x = seed >>> 0;
    const next = (): number => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform integer in [0, n). n must be in [1, 2^32]. */
  nextInt(n: number): number {
    if (n <= 0) throw new RangeError('n must be positive');
    // Rejection sampling keeps the result unbiased.
    const limit = 0x100000000 - (0x100000000 % n);
    let v = this.nextU32();
    while (v >= limit) v = this.nextU32();
    return v % n;
  }

  nextBit(): 0 | 1 {
    return (this.nextU32() >>> 31) as 0 | 1;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
