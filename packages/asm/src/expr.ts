/**
 * Assembly-time expressions: parse from tokens, evaluate with a symbol resolver.
 *
 * Precedence follows GNU as (highest first): unary `- ~ !`; `* / % << >>`;
 * `| & ^ !`; `+ -`; comparisons `== != <> < > <= >=` (true is -1).
 * Arithmetic is done on 64-bit signed integers (BigInt, wrapped), like GNU as on
 * a 64-bit host (so `>>` is a logical shift of the 64-bit value); the caller range-checks the result for the field it fills.
 */

import { AsmError, type Span, spanOf, spanJoin } from './diagnostics';
import type { Token } from './lexer';

/** Expression tree. `dot` is the location counter `.` captured where it was written. */
export type Expr =
  | { readonly k: 'num'; readonly v: bigint; readonly span: Span }
  | { readonly k: 'sym'; readonly name: string; readonly span: Span }
  | { readonly k: 'dot'; readonly section: string; readonly offset: number; readonly span: Span }
  | { readonly k: 'un'; readonly op: string; readonly e: Expr; readonly span: Span }
  | {
      readonly k: 'bin';
      readonly op: string;
      readonly l: Expr;
      readonly r: Expr;
      readonly span: Span;
    };

/** A value during evaluation: an absolute number, or an offset inside a section. */
export interface Value {
  /** Section name, or null for an absolute value. */
  readonly section: string | null;
  readonly off: bigint;
}

/** Resolves a symbol to a value, or returns undefined when it is unknown. */
export type Resolver = (name: string, span: Span) => Value | undefined;

/** Thrown (internally) when a symbol is not known yet. */
export class UnknownSymbol extends Error {
  constructor(
    readonly symbol: string,
    readonly span: Span,
  ) {
    super(`undefined symbol '${symbol}'`);
  }
}

const LEVELS: readonly (readonly string[])[] = [
  ['==', '!=', '<>', '<', '>', '<=', '>='],
  ['+', '-'],
  ['|', '&', '^', '!'],
  ['*', '/', '%', '<<', '>>'],
];

/** Context the parser needs to name local labels and the location counter. */
export interface ExprContext {
  /** Maps a numeric local label reference (`1f`, `1b`) to its internal symbol name. */
  readonly localRef: (n: bigint, dir: 'f' | 'b', tok: Token) => string;
  /** Section and offset that `.` means here. */
  readonly dot: () => { section: string; offset: number };
}

/** Parses tokens[0..] as one expression that must use every token. */
export function parseExpr(tokens: readonly Token[], ctx: ExprContext, whole: Span): Expr {
  if (tokens.length === 0) throw new AsmError('expected an expression', whole);
  let p = 0;
  const peek = (): Token | undefined => tokens[p];

  const primary = (): Expr => {
    const t = peek();
    if (!t) {
      const last = tokens[tokens.length - 1];
      throw new AsmError('expression ends too early', last ? spanOf(last) : whole);
    }
    p++;
    switch (t.kind) {
      case 'number':
      case 'char':
        return { k: 'num', v: t.value ?? 0n, span: spanOf(t) };
      case 'localRef':
        return { k: 'sym', name: ctx.localRef(t.value ?? 0n, t.dir ?? 'b', t), span: spanOf(t) };
      case 'symbol':
      case 'csr':
      case 'label':
        if (t.text === '.') {
          const d = ctx.dot();
          return { k: 'dot', section: d.section, offset: d.offset, span: spanOf(t) };
        }
        return { k: 'sym', name: t.text, span: spanOf(t) };
      case 'register':
        throw new AsmError(`register '${t.text}' cannot be used in an expression here`, spanOf(t));
      case 'lparen': {
        const e = level(0);
        const close = peek();
        if (!close || close.kind !== 'rparen')
          throw new AsmError("missing ')'", close ? spanOf(close) : spanOf(t));
        p++;
        return { ...e, span: spanJoin(spanOf(t), spanOf(close)) } as Expr;
      }
      case 'operator':
        if (t.text === '-' || t.text === '~' || t.text === '!' || t.text === '+') {
          const e = primary();
          if (t.text === '+') return e;
          return { k: 'un', op: t.text, e, span: spanJoin(spanOf(t), e.span) };
        }
        break;
      case 'reloc':
        throw new AsmError(`${t.text}(...) is only allowed as a whole operand`, spanOf(t));
      default:
        break;
    }
    throw new AsmError(`unexpected '${t.text}' in expression`, spanOf(t));
  };

  const level = (n: number): Expr => {
    if (n >= LEVELS.length) return primary();
    let left = level(n + 1);
    const ops = LEVELS[n] ?? [];
    for (;;) {
      const t = peek();
      if (!t || t.kind !== 'operator' || !ops.includes(t.text)) return left;
      p++;
      const right = level(n + 1);
      left = { k: 'bin', op: t.text, l: left, r: right, span: spanJoin(left.span, right.span) };
    }
  };

  const e = level(0);
  const extra = tokens[p];
  if (extra) throw new AsmError(`unexpected '${extra.text}' after expression`, spanOf(extra));
  return e;
}

const wrap = (v: bigint): bigint => BigInt.asIntN(64, v);

/**
 * Evaluates an expression. Section-relative values support `sec + n`,
 * `sec - n` and `sec - sec` (same section); anything else on them is an error.
 * Throws UnknownSymbol when the resolver returns undefined. With
 * `sectionBase`, the location counter `.` becomes absolute (used by the linker).
 */
export function evaluate(
  e: Expr,
  resolve: Resolver,
  sectionBase?: (section: string) => bigint,
): Value {
  const ev = (x: Expr): Value => evaluate(x, resolve, sectionBase);
  switch (e.k) {
    case 'num':
      return { section: null, off: e.v };
    case 'dot':
      return sectionBase
        ? { section: null, off: sectionBase(e.section) + BigInt(e.offset) }
        : { section: e.section, off: BigInt(e.offset) };
    case 'sym': {
      const v = resolve(e.name, e.span);
      if (!v) throw new UnknownSymbol(e.name, e.span);
      return v;
    }
    case 'un': {
      const v = absolute(ev(e.e), e.span, e.op);
      if (e.op === '-') return { section: null, off: wrap(-v) };
      if (e.op === '~') return { section: null, off: wrap(~v) };
      return { section: null, off: v === 0n ? 1n : 0n };
    }
    case 'bin': {
      const l = ev(e.l);
      const r = ev(e.r);
      if (e.op === '+') {
        if (l.section && r.section) throw new AsmError('cannot add two addresses', e.span);
        return { section: l.section ?? r.section, off: wrap(l.off + r.off) };
      }
      if (e.op === '-') {
        if (r.section) {
          if (l.section === r.section) return { section: null, off: wrap(l.off - r.off) };
          throw new AsmError('cannot subtract addresses from different sections', e.span);
        }
        return { section: l.section, off: wrap(l.off - r.off) };
      }
      const a = absolute(l, e.l.span, e.op);
      const b = absolute(r, e.r.span, e.op);
      return { section: null, off: binop(e.op, a, b, e) };
    }
  }
}

function absolute(v: Value, span: Span, op: string): bigint {
  if (v.section !== null) {
    throw new AsmError(`operator '${op}' needs a constant, not an address`, span);
  }
  return v.off;
}

function binop(op: string, a: bigint, b: bigint, e: Expr): bigint {
  const t = (c: boolean): bigint => (c ? -1n : 0n);
  switch (op) {
    case '*':
      return wrap(a * b);
    case '/':
    case '%':
      if (b === 0n) throw new AsmError('division by zero', e.span);
      return wrap(op === '/' ? a / b : a % b);
    case '<<':
      return b < 0n || b > 63n ? 0n : wrap(a << b);
    case '>>':
      // GNU as shifts right logically on the 64-bit value: -1 >> 1 is 0x7fff_ffff_ffff_ffff.
      return b < 0n || b > 63n ? 0n : wrap(BigInt.asUintN(64, a) >> b);
    case '&':
      return a & b;
    case '|':
      return a | b;
    case '^':
      return a ^ b;
    case '!':
      return a | ~b;
    case '==':
      return t(a === b);
    case '!=':
    case '<>':
      return t(a !== b);
    case '<':
      return t(a < b);
    case '>':
      return t(a > b);
    case '<=':
      return t(a <= b);
    case '>=':
      return t(a >= b);
    default:
      throw new AsmError(`unknown operator '${op}'`, e.span);
  }
}

/** Every symbol name an expression mentions. */
export function symbolsOf(e: Expr, out: string[] = []): string[] {
  if (e.k === 'sym') out.push(e.name);
  else if (e.k === 'un') symbolsOf(e.e, out);
  else if (e.k === 'bin') {
    symbolsOf(e.l, out);
    symbolsOf(e.r, out);
  }
  return out;
}
