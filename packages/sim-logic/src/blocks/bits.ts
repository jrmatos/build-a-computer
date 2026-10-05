import type { Part } from '@build-a-computer/schema';
import { PART_INFO } from '../parts-spec';
import { allX, mask, sig, type Signal } from '../values';

/** Numeric prop with the PART_INFO default (same rule as pinsOf). */
export function numProp(p: Part, key: 'width' | 'selectBits' | 'addrWidth'): number {
  return (p.props?.[key] as number | undefined) ?? (PART_INFO[p.type].defaults[key] as number | undefined) ?? 1;
}

/** Input `i` normalized to width `w`; a missing input reads as all-X. */
export function input(inputs: readonly Signal[], i: number, w: number): Signal {
  const s = inputs[i];
  if (!s) return allX(w);
  return sig(w, s.v, s.x);
}

/** A 1-bit input as 0, 1 or 2 (X). */
export function bit(inputs: readonly Signal[], i: number): 0 | 1 | 2 {
  const s = inputs[i];
  if (!s || (s.x & 1) !== 0) return 2;
  return (s.v & 1) as 0 | 1;
}

export const ONE = (): Signal => sig(1, 1);
export const ZERO = (): Signal => sig(1, 0);
export const X1 = (): Signal => allX(1);
export const bitSig = (b: 0 | 1 | 2): Signal => (b === 2 ? allX(1) : sig(1, b));

/** Random word of width `w` from the engine's seeded generator. */
export const randomWord = (rng: { nextU32(): number }, w: number): number => (rng.nextU32() & mask(w)) >>> 0;
