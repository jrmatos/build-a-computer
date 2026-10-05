/**
 * Typed AST produced by the parser (parse and type-check happen together).
 */

import type { Loc } from './diag';
import type { Member, Type } from './types';

export interface Attrs {
  aligned?: number;
  section?: string;
  packed?: boolean;
  naked?: boolean;
  /** `interrupt` / `interrupt("machine")` / `interrupt("supervisor")`. */
  interrupt?: 'machine' | 'supervisor';
  noreturn?: boolean;
  used?: boolean;
  weak?: boolean;
}

/** Bytes plus relocations for a global's initial value. */
export interface InitData {
  bytes: Uint8Array;
  relocs: { offset: number; label: string; addend: number }[];
}

/** A variable or function. */
export interface Obj {
  name: string;
  /** Symbol name in the assembly (static locals get a suffix). */
  asmName: string;
  type: Type;
  loc: Loc;
  isLocal: boolean;
  isFunction: boolean;
  isStatic: boolean;
  isExtern: boolean;
  isInline: boolean;
  /** Has a definition (function body or global with storage). */
  isDefinition: boolean;
  attrs: Attrs;
  /** Locals: frame offset from s0 (set by codegen). */
  offset?: number;
  /** Locals kept in a callee-saved register instead of the frame (set by codegen). */
  reg?: number;
  /** `register int x asm("a0")`. */
  asmReg?: string;
  /** Globals: initial value (undefined = zero / bss). */
  init?: InitData;
  /** String literal or compound literal pooled as an anonymous global. */
  isLiteral?: boolean;
  /** Functions. */
  params?: Obj[];
  locals?: Obj[];
  body?: Stmt;
  /** Objects this one references (for dropping unused static functions). */
  refs?: Set<Obj>;
  /** Function: hidden pointer for large struct returns (a local). */
  retPtr?: Obj;
  /** Function: va_start is used. */
  usesVarargs?: boolean;
  /** Function: last line of the body (for debug info). */
  endLine?: number;
  /** Line in the main file where this was declared (0 if from a header). */
  line: number;
}

interface Base {
  loc: Loc;
  /** Main-file line (0 when from a header). */
  line: number;
  /** Written inside parentheses (silences "assignment as a condition"). */
  paren?: boolean;
}

export type BinOp =
  | '+' | '-' | '*' | '/' | '%' | '&' | '|' | '^' | '<<' | '>>'
  | '==' | '!=' | '<' | '<=' | '>' | '>='; // prettier-ignore

export type Expr = Base & { type: Type } & (
    | { kind: 'num'; value: bigint }
    | { kind: 'var'; obj: Obj }
    | { kind: 'binary'; op: BinOp; lhs: Expr; rhs: Expr }
    /** pointer + integer (integer already scaled by element size? no: `scale` is the element size) */
    | { kind: 'padd'; ptr: Expr; idx: Expr; scale: number; neg: boolean }
    /** pointer - pointer, divided by `scale` */
    | { kind: 'pdiff'; lhs: Expr; rhs: Expr; scale: number }
    | { kind: 'logand' | 'logor'; lhs: Expr; rhs: Expr }
    | { kind: 'neg' | 'bitnot' | 'lognot'; operand: Expr }
    | { kind: 'assign'; lhs: Expr; rhs: Expr }
    /** lhs = (lhs.type)((opType)lhs op rhs); rhs already has opType (or is the scaled index for pointers) */
    | { kind: 'opassign'; op: BinOp; lhs: Expr; rhs: Expr; opType: Type; scale: number }
    | { kind: 'incdec'; lhs: Expr; delta: number; pre: boolean }
    | { kind: 'cond'; cond: Expr; then: Expr; else: Expr }
    | { kind: 'comma'; lhs: Expr; rhs: Expr }
    | { kind: 'cast'; operand: Expr }
    | { kind: 'addr'; operand: Expr }
    | { kind: 'deref'; operand: Expr }
    | { kind: 'member'; base: Expr; member: Member }
    | { kind: 'call'; callee: Expr; args: Expr[]; fnType: Type; direct?: Obj }
    | { kind: 'vaarg'; ap: Expr }
    | { kind: 'vastart'; ap: Expr }
    | { kind: 'vacopy'; dst: Expr; src: Expr }
    /** GNU statement expression ({ ... }); value is the last expression statement. */
    | { kind: 'stmtexpr'; body: Stmt[]; result?: Expr }
    /** Zero the bytes of a local object (initializers). */
    | { kind: 'memzero'; obj: Obj }
    /** Compound literal / initialized temporary: run `init`, then the value is `obj`. */
    | { kind: 'initvar'; obj: Obj; init: Stmt[] }
    | { kind: 'nop' }
  );

export interface AsmOperand {
  constraint: string;
  name?: string;
  expr: Expr;
}

export type Stmt = Base & (
    | { kind: 'block'; stmts: Stmt[] }
    | { kind: 'expr'; expr: Expr }
    | { kind: 'if'; cond: Expr; then: Stmt; else?: Stmt }
    | { kind: 'loop'; init?: Stmt; cond?: Expr; inc?: Expr; body: Stmt; doWhile: boolean; brk: number; cont: number }
    | { kind: 'switch'; cond: Expr; body: Stmt; cases: { lo: bigint; hi: bigint; label: number }[]; defaultLabel?: number; brk: number }
    | { kind: 'label'; label: number; stmt: Stmt }
    | { kind: 'jump'; label: number }
    | { kind: 'return'; expr?: Expr }
    | { kind: 'asm'; template: string; outputs: AsmOperand[]; inputs: AsmOperand[]; clobbers: string[]; labels: string[] }
    | { kind: 'null' }
  ); // prettier-ignore

/** A whole translation unit. */
export interface Program {
  globals: Obj[];
  functions: Obj[];
  /** Top-level `__asm__("...")` blocks. */
  toplevelAsm: { text: string; line: number }[];
}

/** Omit that distributes over a union (keeps each variant's own fields). */
export type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
