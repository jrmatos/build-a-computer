import { Prng } from '@build-a-computer/det';

/**
 * Seeded random numbers for weight init, dropout, shuffling and sampling.
 * The same seed gives the same numbers in Node and every browser, so training
 * runs and checks are reproducible. `Math.random` is never used.
 */
export class Rng {
  private prng: Prng;
  private spareNormal: number | null = null;

  constructor(seed = 0) {
    this.prng = new Prng(seed);
  }

  /** Uniform float in [0, 1) with 53 random bits. */
  uniform(): number {
    const hi = this.prng.nextU32() >>> 5; // 27 bits
    const lo = this.prng.nextU32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Uniform float in [low, high). */
  range(low: number, high: number): number {
    return low + (high - low) * this.uniform();
  }

  /** Standard normal sample (mean 0, std 1) by the Box-Muller transform. */
  normal(): number {
    if (this.spareNormal !== null) {
      const v = this.spareNormal;
      this.spareNormal = null;
      return v;
    }
    let u = this.uniform();
    while (u === 0) u = this.uniform();
    const v = this.uniform();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spareNormal = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return this.prng.nextInt(n);
  }

  /** Shuffles an array in place (Fisher-Yates) and returns it. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = items[i]!;
      items[i] = items[j]!;
      items[j] = t;
    }
    return items;
  }

  /** Picks index i with probability weights[i] / sum(weights). */
  categorical(weights: ArrayLike<number>): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i]!;
    if (!(total > 0)) throw new RangeError('categorical: weights must have a positive sum.');
    let r = this.uniform() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}

let globalRng = new Rng(0);

/** Reseeds the shared generator used when no `rng` option is given. */
export function manualSeed(seed: number): void {
  globalRng = new Rng(seed);
}

/** The shared generator used when no `rng` option is given. */
export function defaultRng(): Rng {
  return globalRng;
}
