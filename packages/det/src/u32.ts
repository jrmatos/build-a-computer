/** 32-bit integer helpers. JavaScript numbers are doubles, so every result is normalized. */

export const u32 = (x: number): number => x >>> 0;
export const i32 = (x: number): number => x | 0;

export const add32 = (a: number, b: number): number => (a + b) >>> 0;
export const sub32 = (a: number, b: number): number => (a - b) >>> 0;
export const mul32 = (a: number, b: number): number => Math.imul(a, b) >>> 0;

/** Upper 32 bits of the signed 64-bit product (RISC-V MULH). */
export function mulh(a: number, b: number): number {
  const p = BigInt(a | 0) * BigInt(b | 0);
  return Number(BigInt.asIntN(32, p >> 32n)) >>> 0;
}

/** Upper 32 bits of the unsigned 64-bit product (RISC-V MULHU). */
export function mulhu(a: number, b: number): number {
  const p = BigInt(a >>> 0) * BigInt(b >>> 0);
  return Number(p >> 32n) >>> 0;
}

/** Sign-extend the low `bits` bits of x to 32 bits. */
export function signExtend(x: number, bits: number): number {
  const shift = 32 - bits;
  return ((x << shift) >> shift) >>> 0;
}

export const ltSigned = (a: number, b: number): boolean => (a | 0) < (b | 0);
export const ltUnsigned = (a: number, b: number): boolean => a >>> 0 < b >>> 0;
