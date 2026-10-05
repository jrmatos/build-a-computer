/** A 1-bit signal: 0, 1 or X (unknown). Stored as a byte so nets fit in a Uint8Array. */
export const V0 = 0;
export const V1 = 1;
export const VX = 2;
export type Value = typeof V0 | typeof V1 | typeof VX;

export const fromBit = (b: boolean | 0 | 1): Value => (b ? V1 : V0);

export const not = (a: number): Value => (a === VX ? VX : a === V1 ? V0 : V1);

/** X propagates unless the other input decides the result: 0 AND X = 0. */
export const and = (a: number, b: number): Value =>
  a === V0 || b === V0 ? V0 : a === V1 && b === V1 ? V1 : VX;

export const or = (a: number, b: number): Value =>
  a === V1 || b === V1 ? V1 : a === V0 && b === V0 ? V0 : VX;

export const xor = (a: number, b: number): Value => (a === VX || b === VX ? VX : ((a ^ b) as Value));

export const nand = (a: number, b: number): Value => not(and(a, b));

export const valueChar = (v: number): string => (v === V0 ? '0' : v === V1 ? '1' : 'X');

/**
 * A multi-bit signal. Bit i is unknown when bit i of `x` is set (its `v` bit
 * is then 0). `w` is the width in bits (1..32); bits above `w` are 0 in both
 * masks. All math uses `>>> 0` so values stay unsigned 32-bit.
 */
export interface Signal {
  w: number;
  v: number;
  x: number;
}

export const mask = (w: number): number => (w >= 32 ? 0xffffffff : ((1 << w) - 1) >>> 0);
export const sig = (w: number, v: number, x = 0): Signal => ({ w, v: (v & ~x & mask(w)) >>> 0, x: (x & mask(w)) >>> 0 });
export const allX = (w: number): Signal => ({ w, v: 0, x: mask(w) });
export const isKnown = (s: Signal): boolean => s.x === 0;

/** A 1-bit signal as the legacy 0/1/X byte. */
export const toValue = (s: Signal): Value => ((s.x & 1) !== 0 ? VX : ((s.v & 1) as Value));
export const fromValue = (v: number): Signal => (v === VX ? allX(1) : sig(1, v));
