/**
 * Fixups: places where an instruction or data field needs a value that may not
 * be known until link time. Each kind knows its range rule and how to pack the
 * value into the bytes.
 */

import { AsmError, type Span } from './diagnostics';
import { packB, packI, packJ, packS, packU, signExtend } from './encoding';
import type { Expr } from './expr';

/** How a fixup's value is checked and placed. */
export type FixupKind =
  | 'I12' // signed 12-bit I-type immediate
  | 'S12' // signed 12-bit S-type immediate
  | 'U20' // 20-bit U-type immediate, 0..0xfffff
  | 'SHAMT' // shift amount 0..31
  | 'ZIMM5' // CSR immediate 0..31 (rs1 field)
  | 'CSR12' // CSR number 0..4095
  | 'BRANCH' // pc-relative B-type target
  | 'JAL' // pc-relative J-type target
  | 'HI20' // %hi(): upper 20 bits, rounded for a following %lo
  | 'LO12_I' // %lo() in an I-type field
  | 'LO12_S' // %lo() in an S-type field
  | 'PCREL_HI20' // %pcrel_hi(): upper 20 bits of target - pc
  | 'PCREL_LO12_I' // %pcrel_lo(): low 12 bits of the paired %pcrel_hi
  | 'PCREL_LO12_S'
  | 'ABS8'
  | 'ABS16'
  | 'ABS32'
  | 'ABS64';

/** A field to fill at link time (or at assembly time when the value is constant). */
export interface Fixup {
  readonly kind: FixupKind;
  readonly section: string;
  readonly offset: number;
  readonly expr: Expr;
  readonly span: Span;
  /**
   * For PCREL_LO12 created by `la`, `call`, ... : the auipc this pairs with.
   * Explicit `%pcrel_lo(label)` leaves it undefined and `expr` names the auipc.
   */
  readonly hi?: { readonly section: string; readonly offset: number };
}

/** True when a fixup needs the address of the field itself. */
export function isPcRelative(kind: FixupKind): boolean {
  return kind === 'BRANCH' || kind === 'JAL' || kind === 'PCREL_HI20';
}

/** Byte width of the field a fixup patches. */
export function fixupWidth(kind: FixupKind): number {
  return kind === 'ABS8' ? 1 : kind === 'ABS16' ? 2 : kind === 'ABS64' ? 8 : 4;
}

const fmt = (v: bigint): string => (v < 0n ? `-0x${(-v).toString(16)}` : `0x${v.toString(16)}`);

function range(v: bigint, lo: bigint, hi: bigint, what: string, span: Span): void {
  if (v < lo || v > hi) {
    throw new AsmError(`${what} ${v} (${fmt(v)}) is out of range ${lo}..${hi}`, span);
  }
}

const readU32 = (b: Uint8Array, o: number): number =>
  ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;

/** Writes `v` little-endian into `width` bytes. */
export function writeLE(b: Uint8Array, o: number, v: bigint, width: number): void {
  let x = BigInt.asUintN(width * 8, v);
  for (let i = 0; i < width; i++) {
    b[o + i] = Number(x & 0xffn);
    x >>= 8n;
  }
}

/** Upper 20 bits of a 32-bit value, rounded so that adding the sign-extended low 12 gives it back. */
export function hi20(v: number): number {
  return ((v + 0x800) >>> 12) & 0xfffff;
}

/** Low 12 bits of a value, sign-extended. */
export function lo12(v: number): number {
  return signExtend(v, 12);
}

/**
 * Checks and packs `value` into `bytes[offset..]`.
 * `pc` is the field's own address (for pc-relative kinds). For PCREL_LO12_*,
 * `value` must already be `target - auipcAddress`.
 */
export function applyFixup(
  bytes: Uint8Array,
  offset: number,
  kind: FixupKind,
  value: bigint,
  pc: bigint,
  span: Span,
): void {
  const word = readU32(bytes, offset);
  const put = (w: number): void => writeLE(bytes, offset, BigInt(w >>> 0), 4);
  switch (kind) {
    case 'I12':
      range(value, -2048n, 2047n, 'immediate', span);
      return put(packI(word, Number(value)));
    case 'S12':
      range(value, -2048n, 2047n, 'offset', span);
      return put(packS(word, Number(value)));
    case 'U20':
      range(value, 0n, 0xfffffn, 'upper immediate', span);
      return put(packU(word, Number(value)));
    case 'SHAMT':
      range(value, 0n, 31n, 'shift amount', span);
      return put((word & ~(31 << 20)) | (Number(value) << 20));
    case 'ZIMM5':
      range(value, 0n, 31n, 'CSR immediate', span);
      return put((word & ~(31 << 15)) | (Number(value) << 15));
    case 'CSR12':
      range(value, 0n, 4095n, 'CSR number', span);
      return put((word & 0xfffff) | (Number(value) << 20));
    case 'BRANCH':
    case 'JAL': {
      const d = BigInt.asIntN(32, value - pc);
      if ((d & 1n) !== 0n)
        throw new AsmError(`jump target ${fmt(value)} is not 2-byte aligned`, span);
      const lim = kind === 'BRANCH' ? 4096n : 1048576n;
      if (d < -lim || d >= lim) {
        const what = kind === 'BRANCH' ? 'branch' : 'jal';
        throw new AsmError(
          `${what} target is too far away (${d} bytes; limit is ${-lim}..${lim - 2n})` +
            (kind === 'BRANCH' ? ': invert the branch and jump with j' : ': use call or tail'),
          span,
        );
      }
      return put(kind === 'BRANCH' ? packB(word, Number(d)) : packJ(word, Number(d)));
    }
    case 'HI20':
    case 'LO12_I':
    case 'LO12_S': {
      range(value, -0x80000000n, 0xffffffffn, 'value', span);
      const v = Number(BigInt.asIntN(32, value));
      if (kind === 'HI20') return put(packU(word, hi20(v)));
      return put(kind === 'LO12_I' ? packI(word, lo12(v)) : packS(word, lo12(v)));
    }
    case 'PCREL_HI20': {
      const d = Number(BigInt.asIntN(32, value - pc));
      return put(packU(word, hi20(d)));
    }
    case 'PCREL_LO12_I':
    case 'PCREL_LO12_S': {
      const d = Number(BigInt.asIntN(32, value));
      return put(kind === 'PCREL_LO12_I' ? packI(word, lo12(d)) : packS(word, lo12(d)));
    }
    case 'ABS8':
      range(value, -128n, 255n, '.byte value', span);
      return writeLE(bytes, offset, value, 1);
    case 'ABS16':
      range(value, -32768n, 65535n, '.half value', span);
      return writeLE(bytes, offset, value, 2);
    case 'ABS32':
      range(value, -0x80000000n, 0xffffffffn, '.word value', span);
      return writeLE(bytes, offset, value, 4);
    case 'ABS64':
      return writeLE(bytes, offset, value, 8);
  }
}
