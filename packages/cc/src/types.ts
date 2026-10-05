/**
 * C types for the ilp32 ABI (CC-04): sizes, alignment, struct layout,
 * integer promotions and the usual arithmetic conversions.
 */

import type { Loc } from './diag';

export type Kind =
  | 'void'
  | 'bool'
  | 'char'
  | 'short'
  | 'int'
  | 'long'
  | 'llong'
  | 'enum'
  | 'ptr'
  | 'array'
  | 'func'
  | 'struct'
  | 'union';

export interface Member {
  name: string | undefined;
  type: Type;
  offset: number;
  /** Bit-field: width and bit offset inside the storage unit at `offset`. */
  bitWidth?: number;
  bitOffset?: number;
  loc?: Loc;
}

export interface Record {
  tag: string | undefined;
  members: Member[];
  size: number;
  align: number;
  complete: boolean;
  isUnion: boolean;
  /** Last member is a flexible array (`int data[];`). */
  flexible: boolean;
  packed: boolean;
  loc?: Loc;
}

export interface Param {
  name: string | undefined;
  type: Type;
  loc?: Loc;
}

export interface Type {
  kind: Kind;
  size: number;
  align: number;
  unsigned: boolean;
  isConst?: boolean;
  isVolatile?: boolean;
  /** ptr / array element type. */
  base?: Type;
  /** array length; -1 for an incomplete array (`int a[]`). */
  len?: number;
  /** func */
  ret?: Type;
  params?: Param[];
  variadic?: boolean;
  /** `int f()` (no prototype): any arguments accepted. */
  oldStyle?: boolean;
  /** struct / union */
  rec?: Record;
  /** enum tag name, for messages. */
  enumTag?: string;
  /** Name of the typedef this came from, for messages. */
  typedefName?: string;
  /** Plain `char` (distinct from signed/unsigned char for messages and compatibility). */
  plainChar?: boolean;
  /** The type of a bit-field member expression: its width (affects promotion). */
  bitWidth?: number;
}

const mk = (kind: Kind, size: number, unsigned = false, align = size): Type => ({
  kind,
  size,
  align,
  unsigned,
});

export const ty = {
  void: mk('void', 1, false, 1),
  bool: mk('bool', 1, true),
  char: mk('char', 1, false),
  schar: mk('char', 1, false),
  uchar: mk('char', 1, true),
  short: mk('short', 2),
  ushort: mk('short', 2, true),
  int: mk('int', 4),
  uint: mk('int', 4, true),
  long: mk('long', 4),
  ulong: mk('long', 4, true),
  llong: mk('llong', 8),
  ullong: mk('llong', 8, true),
};

/** Plain `char` signedness (set per compile). */
export function setCharSigned(signed: boolean): void {
  ty.char = { ...mk('char', 1, !signed), plainChar: true };
}
setCharSigned(true);

export const isInteger = (t: Type): boolean =>
  t.kind === 'bool' ||
  t.kind === 'char' ||
  t.kind === 'short' ||
  t.kind === 'int' ||
  t.kind === 'long' ||
  t.kind === 'llong' ||
  t.kind === 'enum';
export const isPtr = (t: Type): boolean => t.kind === 'ptr';
export const isArith = isInteger;
export const isScalar = (t: Type): boolean => isInteger(t) || t.kind === 'ptr';
export const isRecord = (t: Type): boolean => t.kind === 'struct' || t.kind === 'union';
export const isFunc = (t: Type): boolean => t.kind === 'func';
export const is64 = (t: Type): boolean => t.kind === 'llong';
/** Pointer or array (things you can index). */
export const isPtrLike = (t: Type): boolean => t.kind === 'ptr' || t.kind === 'array';
export const isVoid = (t: Type): boolean => t.kind === 'void';

export function pointerTo(base: Type): Type {
  return { kind: 'ptr', size: 4, align: 4, unsigned: true, base };
}

export function arrayOf(base: Type, len: number): Type {
  return {
    kind: 'array',
    size: len < 0 ? 0 : base.size * len,
    align: base.align,
    unsigned: false,
    base,
    len,
  };
}

export function funcType(ret: Type, params: Param[], variadic: boolean, oldStyle = false): Type {
  return { kind: 'func', size: 1, align: 1, unsigned: false, ret, params, variadic, oldStyle };
}

export function enumType(tag?: string): Type {
  return { ...ty.int, kind: 'enum', ...(tag ? { enumTag: tag } : {}) };
}

export function newRecord(isUnion: boolean, tag: string | undefined): Type {
  const rec: Record = {
    tag,
    members: [],
    size: 0,
    align: 1,
    complete: false,
    isUnion,
    flexible: false,
    packed: false,
  };
  return { kind: isUnion ? 'union' : 'struct', size: 0, align: 1, unsigned: false, rec };
}

/** Copy of a type with qualifiers. Records share their layout object. */
export function qualified(t: Type, q: { isConst?: boolean; isVolatile?: boolean }): Type {
  if (!q.isConst && !q.isVolatile) return t;
  const r: Type = { ...t };
  if (q.isConst) r.isConst = true;
  if (q.isVolatile) r.isVolatile = true;
  return r;
}

export function unqualified(t: Type): Type {
  if (!t.isConst && !t.isVolatile) return t;
  const r: Type = { ...t };
  delete r.isConst;
  delete r.isVolatile;
  return r;
}

/** The size of a record type stays live (incomplete types completed later). */
export function sizeOf(t: Type): number {
  if (t.rec) return t.rec.size;
  if (t.kind === 'array' && t.base) return t.len !== undefined && t.len >= 0 ? sizeOf(t.base) * t.len : 0;
  return t.size;
}

export function alignOf(t: Type): number {
  if (t.rec) return Math.max(t.rec.align, t.align);
  if (t.kind === 'array' && t.base) return Math.max(t.align, alignOf(t.base));
  return t.align;
}

export function isComplete(t: Type): boolean {
  if (t.kind === 'void') return false;
  if (t.rec) return t.rec.complete;
  if (t.kind === 'array') return (t.len ?? -1) >= 0 && !!t.base && isComplete(t.base);
  return true;
}

/** Integer conversion rank. */
function rank(t: Type): number {
  switch (t.kind) {
    case 'bool': return 1;
    case 'char': return 2;
    case 'short': return 3;
    case 'int': case 'enum': return 4;
    case 'long': return 5;
    case 'llong': return 6;
    default: return 4;
  } // prettier-ignore
}

/** Integer promotion: types narrower than int become int. */
export function promote(t: Type): Type {
  // a bit-field narrower than int promotes to int even when unsigned
  if (t.bitWidth !== undefined && t.bitWidth < 32 && t.kind !== 'llong') return ty.int;
  if (t.kind === 'bool' || t.kind === 'char' || t.kind === 'short' || t.kind === 'enum') return ty.int;
  if (t.kind === 'int') return t.unsigned ? ty.uint : ty.int;
  if (t.kind === 'long') return t.unsigned ? ty.ulong : ty.long;
  if (t.kind === 'llong') return t.unsigned ? ty.ullong : ty.llong;
  return t;
}

/** Usual arithmetic conversions on two integer types. */
export function commonType(a: Type, b: Type): Type {
  const x = promote(a);
  const y = promote(b);
  if (x.kind === y.kind && x.unsigned === y.unsigned) return x;
  if (x.unsigned === y.unsigned) return rank(x) >= rank(y) ? x : y;
  const [u, s] = x.unsigned ? [x, y] : [y, x];
  if (rank(u) >= rank(s)) return u;
  if (s.size > u.size) return s;
  // signed type can't hold all unsigned values: unsigned version of the signed type
  return s.kind === 'llong' ? ty.ullong : s.kind === 'long' ? ty.ulong : ty.uint;
}

/** Human-readable type name for diagnostics, e.g. "int *", "struct point". */
export function typeName(t: Type, inner = ''): string {
  const q = (t.isConst ? 'const ' : '') + (t.isVolatile ? 'volatile ' : '');
  if (t.typedefName && !inner) return q + t.typedefName;
  switch (t.kind) {
    case 'void': return join(q + 'void', inner);
    case 'bool': return join(q + '_Bool', inner);
    case 'char': return join(q + (t.plainChar ? 'char' : t.unsigned ? 'unsigned char' : 'signed char'), inner);
    case 'short': return join(q + (t.unsigned ? 'unsigned short' : 'short'), inner);
    case 'int': return join(q + (t.unsigned ? 'unsigned int' : 'int'), inner);
    case 'long': return join(q + (t.unsigned ? 'unsigned long' : 'long'), inner);
    case 'llong': return join(q + (t.unsigned ? 'unsigned long long' : 'long long'), inner);
    case 'enum': return join(q + `enum ${t.enumTag ?? '<anonymous>'}`, inner);
    case 'struct':
    case 'union': return join(q + `${t.kind} ${t.rec?.tag ?? '<anonymous>'}`, inner);
    case 'ptr': {
      const b = t.base ?? ty.void;
      const qq = (t.isConst ? ' const' : '') + (t.isVolatile ? ' volatile' : '');
      const s = '*' + qq + (inner && qq ? ' ' : '') + inner;
      if (b.kind === 'array' || b.kind === 'func') return typeName(b, `(${s})`);
      return typeName(b, s);
    }
    case 'array': return typeName(t.base ?? ty.int, `${inner}[${(t.len ?? -1) >= 0 ? t.len : ''}]`);
    case 'func': {
      const ps = (t.params ?? []).map((p) => typeName(p.type));
      if (t.variadic) ps.push('...');
      if (ps.length === 0 && !t.oldStyle) ps.push('void');
      return typeName(t.ret ?? ty.int, `${inner}(${ps.join(', ')})`);
    }
  } // prettier-ignore
}

function join(base: string, inner: string): string {
  if (!inner) return base;
  return inner.startsWith('[') || inner.startsWith('(') ? base + ' ' + inner : base + ' ' + inner;
}

/** Same type, ignoring top-level qualifiers? (structural compatibility, simplified). */
export function sameType(a: Type, b: Type, ignoreQual = true): boolean {
  if (a === b) return true;
  if (!ignoreQual && (!!a.isConst !== !!b.isConst || !!a.isVolatile !== !!b.isVolatile)) return false;
  if (a.kind !== b.kind) {
    // enum is compatible with int (its underlying type)
    if ((a.kind === 'enum' && b.kind === 'int' && !b.unsigned) || (b.kind === 'enum' && a.kind === 'int' && !a.unsigned)) return true;
    return false;
  }
  switch (a.kind) {
    case 'ptr':
      return sameType(a.base ?? ty.void, b.base ?? ty.void, false) ||
        (sameType(a.base ?? ty.void, b.base ?? ty.void, true));
    case 'array':
      return sameType(a.base ?? ty.int, b.base ?? ty.int) && (a.len === b.len || a.len === -1 || b.len === -1);
    case 'struct':
    case 'union':
      return a.rec === b.rec;
    case 'func': {
      if (!sameType(a.ret ?? ty.int, b.ret ?? ty.int)) return false;
      if (a.oldStyle || b.oldStyle) return true;
      const pa = a.params ?? [];
      const pb = b.params ?? [];
      if (pa.length !== pb.length || !!a.variadic !== !!b.variadic) return false;
      return pa.every((p, i) => sameType(p.type, (pb[i] as Param).type));
    }
    case 'char':
      return a.unsigned === b.unsigned && !!a.plainChar === !!b.plainChar;
    default:
      return a.unsigned === b.unsigned;
  } // prettier-ignore
}

/** Lay out a struct or union per the ilp32 ABI (natural alignment). */
export function layoutRecord(rec: Record, members: Member[], explicitAlign = 0): void {
  let align = 1;
  let bitPos = 0; // bit position within the struct for bit-fields
  if (rec.isUnion) {
    let size = 0;
    for (const m of members) {
      m.offset = 0;
      if (m.bitWidth !== undefined) m.bitOffset = 0;
      const a = rec.packed ? 1 : alignOf(m.type);
      align = Math.max(align, a);
      size = Math.max(size, sizeOf(m.type));
    }
    align = Math.max(align, explicitAlign);
    rec.members = members;
    rec.size = alignUp(size, align);
    rec.align = align;
    rec.complete = true;
    return;
  }
  for (const m of members) {
    const msize = sizeOf(m.type);
    const malign = rec.packed ? 1 : alignOf(m.type);
    if (m.bitWidth !== undefined) {
      // GCC-compatible bit-field layout: a field is placed at the current bit
      // position unless it would straddle a boundary of its declared type.
      const unitBits = msize * 8;
      if (m.bitWidth === 0) {
        bitPos = alignUp(bitPos, unitBits);
        continue;
      }
      if (!rec.packed && Math.floor(bitPos / unitBits) !== Math.floor((bitPos + m.bitWidth - 1) / unitBits)) {
        bitPos = alignUp(bitPos, unitBits);
      }
      const unitStart = rec.packed ? Math.floor(bitPos / 8) : Math.floor(bitPos / unitBits) * msize;
      m.offset = unitStart;
      m.bitOffset = bitPos - unitStart * 8;
      bitPos += m.bitWidth;
      if (m.name !== undefined) align = Math.max(align, malign);
      continue;
    }
    const offset = alignUp(Math.ceil(bitPos / 8), malign);
    m.offset = offset;
    bitPos = (offset + msize) * 8;
    align = Math.max(align, malign);
  }
  align = Math.max(align, explicitAlign);
  rec.members = members;
  rec.size = alignUp(Math.ceil(bitPos / 8), align);
  rec.align = align;
  rec.complete = true;
}

export const alignUp = (v: number, a: number): number => Math.ceil(v / a) * a;

/** Find a member by name, searching anonymous struct/union members. Returns the path. */
export function findMember(rec: Record, name: string): Member[] | undefined {
  for (const m of rec.members) {
    if (m.name === name) return [m];
    if (m.name === undefined && m.type.rec) {
      const inner = findMember(m.type.rec, name);
      if (inner) return [m, ...inner];
    }
  }
  return undefined;
}
