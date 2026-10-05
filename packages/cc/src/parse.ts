/**
 * Parser and type checker (CC-03, CC-04): tokens -> typed AST. Errors are
 * reported with ranges; the parser recovers at statement and declaration
 * boundaries so one mistake does not hide the rest.
 */

import type { AsmOperand, Attrs, BinOp, DistOmit, Expr, InitData, Obj, Program, Stmt } from './ast';
import { Bail, type Diags, type Loc, TooMany, span } from './diag';
import { type Token, decodeLiteral } from './lexer';
import {
  type Member,
  type Param,
  type Type,
  alignOf,
  arrayOf,
  commonType,
  enumType,
  findMember,
  funcType,
  isComplete,
  isInteger,
  isPtr,
  isRecord,
  isScalar,
  layoutRecord,
  newRecord,
  pointerTo,
  promote,
  qualified,
  sameType,
  sizeOf,
  ty,
  typeName,
  unqualified,
} from './types';

type ScopeEntry =
  | { kind: 'var'; obj: Obj }
  | { kind: 'typedef'; type: Type }
  | { kind: 'enumconst'; value: bigint; type: Type };

interface Scope {
  vars: Map<string, ScopeEntry>;
  tags: Map<string, Type>;
}

interface DeclSpec {
  type: Type;
  storage?: 'typedef' | 'static' | 'extern' | 'register' | 'auto';
  isInline: boolean;
  attrs: Attrs;
  /** No type specifier was given (implicit int). */
  implicit: boolean;
}

interface Declarator {
  type: Type;
  name?: string;
  nameTok?: Token;
  attrs: Attrs;
  /** `asm("label")` after the declarator. */
  asmLabel?: string;
  /** Parameter objects for a function declarator (names kept). */
  paramNames?: (Token | undefined)[];
}

interface Init {
  type: Type;
  expr?: Expr;
  children?: (Init | undefined)[];
  /** Array of unknown length (grows as elements are given). */
  flexible?: boolean;
  /** For unions: the member that was initialized last. */
  unionIdx?: number;
  loc?: Loc;
}

interface LabelInfo {
  id: number;
  defined: boolean;
  tok: Token;
}

const TYPE_KEYWORDS = new Set([
  'void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', '_Bool',
  'struct', 'union', 'enum', 'const', 'volatile', 'restrict', 'typedef', 'static', 'extern',
  'inline', 'register', 'auto', '_Noreturn', '_Alignas', '__attribute__', '__attribute',
  '__builtin_va_list', 'typeof', '__typeof__', '__typeof', '_Thread_local', '_Atomic', '_Complex',
]); // prettier-ignore

const KEYWORDS = new Set([
  ...TYPE_KEYWORDS, 'if', 'else', 'while', 'do', 'for', 'switch', 'case', 'default', 'break',
  'continue', 'return', 'goto', 'sizeof', '_Alignof', 'asm', '__asm__', '__asm', '_Static_assert',
]); // prettier-ignore

/** RISC-V register names that cannot be global symbols in our assembler. */
const REG_NAMES = new Set([
  'zero', 'ra', 'sp', 'gp', 'tp', 'fp', 'pc',
  ...Array.from({ length: 32 }, (_, i) => `x${i}`),
  ...Array.from({ length: 7 }, (_, i) => `t${i}`),
  ...Array.from({ length: 12 }, (_, i) => `s${i}`),
  ...Array.from({ length: 8 }, (_, i) => `a${i}`),
]); // prettier-ignore

const VA_LIST: Type = { ...pointerTo(ty.void), typedefName: '__builtin_va_list' };

export interface ParseOptions {
  /** Counter shared with codegen for unique label numbers. */
  labels: { next: number };
}

export class Parser {
  private pos = 0;
  private scopes: Scope[] = [{ vars: new Map(), tags: new Map() }];
  private globals: Obj[] = [];
  private functions: Obj[] = [];
  private toplevelAsm: { text: string; line: number }[] = [];
  private globalByName = new Map<string, Obj>();
  /** Current function, or undefined at file scope. */
  private fn: Obj | undefined;
  private fnLabels = new Map<string, LabelInfo>();
  private brk: number[] = [];
  private cont: number[] = [];
  private switches: { cases: { lo: bigint; hi: bigint; label: number }[]; defaultLabel?: number; tok: Token }[] = [];
  private strings = new Map<string, Obj>();
  private uniq = 0;

  constructor(
    private toks: Token[],
    private diags: Diags,
    private opts: ParseOptions,
  ) {}

  // ------------------------------------------------------------------ tokens

  private get tok(): Token {
    return this.toks[this.pos] ?? (this.toks[this.toks.length - 1] as Token);
  }

  private peek(k = 1): Token {
    return this.toks[this.pos + k] ?? (this.toks[this.toks.length - 1] as Token);
  }

  private next(): Token {
    const t = this.tok;
    if (t.kind !== 'eof') this.pos++;
    return t;
  }

  private is(text: string): boolean {
    const t = this.tok;
    return t.text === text && (t.kind === 'punct' || t.kind === 'ident');
  }

  private consume(text: string): boolean {
    if (this.is(text)) {
      this.pos++;
      return true;
    }
    return false;
  }

  /** The previous token (for "expected ';' after ..." positions). */
  private prev(): Token {
    return this.toks[this.pos - 1] ?? this.tok;
  }

  private fail(at: Loc, msg: string): never {
    const t = at as Token;
    if (t.kind === 'punct' && (t.text === '@' || t.text === '`' || t.text === '\\')) msg = `stray '${t.text}' in the program`;
    this.diags.error(at, msg);
    throw new Bail();
  }

  private afterPrev(): Loc {
    const p = this.prev();
    return { file: p.file, line: p.endLine, col: p.endCol, endLine: p.endLine, endCol: p.endCol + 1 };
  }

  private expect(text: string, what?: string): Token {
    if (this.is(text)) return this.next();
    const t = this.tok;
    const found = t.kind === 'eof' ? 'end of file' : `'${t.text}'`;
    const msg = what ? `expected '${text}' ${what}` : `expected '${text}' but found ${found}`;
    // Missing ';' / ')' are reported just after the previous token, like gcc.
    if ((text === ';' || text === ')' || text === ']') && this.pos > 0 && t.line !== this.prev().endLine)
      this.fail(this.afterPrev(), msg);
    this.fail(t, msg);
  }

  private line(t: Token = this.tok): number {
    return t.mainLine ?? 0;
  }

  // ------------------------------------------------------------------ scopes

  private enter(): void {
    this.scopes.push({ vars: new Map(), tags: new Map() });
  }

  private leave(): void {
    this.scopes.pop();
  }

  private lookup(name: string): ScopeEntry | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const e = this.scopes[i]?.vars.get(name);
      if (e) return e;
    }
    return undefined;
  }

  private lookupTag(name: string): Type | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const e = this.scopes[i]?.tags.get(name);
      if (e) return e;
    }
    return undefined;
  }

  private get scope(): Scope {
    return this.scopes[this.scopes.length - 1] as Scope;
  }

  private isTypedefName(t: Token): boolean {
    if (t.kind !== 'ident') return false;
    return this.lookup(t.text)?.kind === 'typedef';
  }

  private isTypeStart(t: Token = this.tok): boolean {
    if (t.kind !== 'ident') return false;
    return TYPE_KEYWORDS.has(t.text) || this.isTypedefName(t);
  }

  // ------------------------------------------------------------------ program

  parseProgram(): Program {
    while (this.tok.kind !== 'eof') {
      const start = this.pos;
      try {
        this.topLevel();
      } catch (e) {
        if (e instanceof TooMany) break;
        if (!(e instanceof Bail)) throw e;
        this.fn = undefined;
        while (this.scopes.length > 1) this.leave();
        this.syncTop();
        if (this.pos === start) this.next();
      }
    }
    this.checkTentatives();
    return { globals: this.globals, functions: this.functions, toplevelAsm: this.toplevelAsm };
  }

  /** Skip to the end of the current top-level declaration. */
  private syncTop(): void {
    let depth = 0;
    while (this.tok.kind !== 'eof') {
      const t = this.next();
      if (t.text === '{' || t.text === '(' || t.text === '[') depth++;
      else if (t.text === '}' || t.text === ')' || t.text === ']') {
        depth--;
        if (depth <= 0 && t.text === '}') {
          this.consume(';');
          return;
        }
        if (depth < 0) depth = 0;
      } else if (t.text === ';' && depth === 0) return;
    }
  }

  private checkTentatives(): void {
    for (const g of this.globals) {
      if (g.type.kind === 'array' && (g.type.len ?? 0) < 0 && !g.isExtern) {
        // int a[]; at file scope: one element
        g.type = arrayOf(g.type.base ?? ty.int, 1);
      }
      if (!g.isExtern && !g.isFunction && !isComplete(g.type) && g.isDefinition)
        this.diags.error(g.loc, `'${g.name}' has incomplete type '${typeName(g.type)}'`);
    }
  }

  private topLevel(): void {
    if (this.consume(';')) return;
    if (this.is('_Static_assert')) {
      this.staticAssert();
      return;
    }
    if (this.is('asm') || this.is('__asm__') || this.is('__asm')) {
      const t = this.next();
      this.expect('(', 'after asm');
      const text = this.stringBytes();
      this.expect(')');
      this.expect(';', 'after asm(...)');
      this.toplevelAsm.push({ text: String.fromCharCode(...text), line: this.line(t) });
      return;
    }
    const startTok = this.tok;
    const spec = this.declSpec(true);
    if (this.consume(';')) return; // struct/enum declaration only
    let first = true;
    for (;;) {
      const d = this.declarator(spec.type);
      mergeAttrs(d.attrs, spec.attrs);
      if (!d.name || !d.nameTok) this.fail(d.nameTok ?? this.tok, 'expected a name in this declaration');
      if (spec.storage === 'typedef') {
        this.declareTypedef(d);
      } else if (d.type.kind === 'func') {
        const f = this.declareFunction(d, spec);
        if (first && this.is('{')) {
          this.functionBody(f, d);
          return;
        }
      } else {
        this.globalVar(d, spec);
      }
      first = false;
      if (this.consume(',')) continue;
      if (this.is('{') && d.type.kind !== 'func') this.fail(this.tok, `'${d.name}' is not a function, so it cannot have a body`);
      if (this.is('{')) this.fail(this.tok, 'a function body must follow the first declarator only');
      this.expect(';', 'after the declaration');
      void startTok;
      return;
    }
  }

  private staticAssert(): void {
    const t = this.next();
    this.expect('(');
    const v = this.constExpr();
    let msg = 'static assertion failed';
    if (this.consume(',')) msg = `static assertion failed: ${String.fromCharCode(...this.stringBytes())}`;
    this.expect(')');
    this.expect(';');
    if (v === 0n) this.diags.error(t, msg);
  }

  private declareTypedef(d: Declarator): void {
    const name = d.name as string;
    const t: Type = { ...d.type, typedefName: name };
    if (d.type.rec) t.rec = d.type.rec;
    const prev = this.scope.vars.get(name);
    if (prev && prev.kind === 'typedef' && !sameType(prev.type, d.type)) {
      this.diags.error(d.nameTok as Token, `typedef '${name}' redefined with a different type`);
    } else if (prev && prev.kind !== 'typedef') {
      this.diags.error(d.nameTok as Token, `'${name}' redeclared as a different kind of symbol`);
    }
    this.scope.vars.set(name, { kind: 'typedef', type: t });
  }

  private checkSymbolName(name: string, at: Token): void {
    void name;
    void at;
  }

  private newObj(name: string, type: Type, at: Token, isLocal: boolean): Obj {
    return {
      name,
      // the assembler reads register names as registers: rename such symbols
      asmName: !isLocal && REG_NAMES.has(name) ? `${name}$` : name,
      type,
      loc: at,
      isLocal,
      isFunction: type.kind === 'func',
      isStatic: false,
      isExtern: false,
      isInline: false,
      isDefinition: false,
      attrs: {},
      line: this.line(at),
    };
  }

  private declareFunction(d: Declarator, spec: DeclSpec): Obj {
    const name = d.name as string;
    const at = d.nameTok as Token;
    const existing = this.globalByName.get(name);
    if (existing) {
      if (!existing.isFunction) {
        this.diags.error(at, `'${name}' redeclared as a function (it was a variable)`);
      } else if (!sameType(existing.type, d.type)) {
        this.diags.error(at, `conflicting types for '${name}': was '${typeName(existing.type)}', now '${typeName(d.type)}'`);
      } else if (existing.type.oldStyle && !d.type.oldStyle) {
        existing.type = d.type;
      }
      if (spec.storage === 'static') existing.isStatic = true;
      mergeAttrs(existing.attrs, d.attrs);
      if (d.asmLabel) existing.asmName = d.asmLabel;
      this.bindGlobal(name, existing);
      return existing;
    }
    if (this.fn === undefined) this.checkSymbolName(name, at);
    const f = this.newObj(name, d.type, at, false);
    // C99: a plain `inline` definition is not an external definition; keep it
    // file-local so a header's inline function can be included many times.
    f.isStatic = spec.storage === 'static' || (spec.isInline && spec.storage !== 'extern');
    f.isInline = spec.isInline;
    f.attrs = { ...d.attrs };
    if (d.asmLabel) f.asmName = d.asmLabel;
    this.globalByName.set(name, f);
    this.functions.push(f);
    this.bindGlobal(name, f);
    return f;
  }

  /** Make a global visible: at file scope, or (for block-scope extern) in the current scope. */
  private bindGlobal(name: string, obj: Obj): void {
    this.scope.vars.set(name, { kind: 'var', obj });
  }

  private globalVar(d: Declarator, spec: DeclSpec): void {
    const name = d.name as string;
    const at = d.nameTok as Token;
    const isExtern = spec.storage === 'extern';
    let g = this.globalByName.get(name);
    if (g) {
      if (g.isFunction) {
        this.diags.error(at, `'${name}' redeclared as a variable (it was a function)`);
        g = undefined;
      } else if (!sameType(g.type, d.type)) {
        this.diags.error(at, `conflicting types for '${name}': was '${typeName(g.type)}', now '${typeName(d.type)}'`);
      } else if (g.type.kind === 'array' && (g.type.len ?? -1) < 0) g.type = d.type;
    }
    if (!g) {
      this.checkSymbolName(name, at);
      g = this.newObj(name, d.type, at, false);
      g.isExtern = isExtern;
      g.isStatic = spec.storage === 'static';
      this.globals.push(g);
      this.globalByName.set(name, g);
    }
    if (d.asmLabel) g.asmName = d.asmLabel;
    mergeAttrs(g.attrs, d.attrs);
    if (!isExtern) {
      g.isExtern = false;
      g.isDefinition = true;
    }
    if (spec.storage === 'static') g.isStatic = true;
    this.bindGlobal(name, g);
    if (this.consume('=')) {
      if (g.init) this.diags.error(at, `redefinition of '${name}'`);
      if (isExtern) {
        g.isExtern = false;
        g.isDefinition = true;
      }
      const init = this.newInit(g.type, true);
      this.initializer(init);
      if (init.flexible) g.type = arrayOf(g.type.base ?? ty.int, init.children?.length ?? 0);
      else if (g.type.kind === 'array' && init.type !== g.type) g.type = init.type;
      g.init = this.globalInitData(init, g);
    }
  }

  // ------------------------------------------------------------------ declaration specifiers

  private attributes(attrs: Attrs): void {
    while (this.is('__attribute__') || this.is('__attribute')) {
      this.next();
      this.expect('(');
      this.expect('(');
      while (!this.is(')')) {
        if (this.consume(',')) continue;
        const nameTok = this.next();
        const name = nameTok.text.replace(/^__(.*)__$/, '$1');
        const args: Token[][] = [];
        if (this.consume('(')) {
          let cur: Token[] = [];
          let depth = 0;
          while (!(depth === 0 && this.is(')'))) {
            if (this.tok.kind === 'eof') this.fail(nameTok, "missing ')' in __attribute__");
            const t = this.next();
            if (t.text === '(') depth++;
            if (t.text === ')') depth--;
            if (t.text === ',' && depth === 0) {
              args.push(cur);
              cur = [];
              continue;
            }
            cur.push(t);
          }
          args.push(cur);
          this.expect(')');
        }
        switch (name) {
          case 'aligned': {
            let n = 16;
            const a = args[0];
            if (a && a.length) {
              const sub = new Parser([...a, { ...this.tok, kind: 'eof', text: '' }], this.diags, this.opts);
              sub.scopes = this.scopes;
              const v = sub.constExpr();
              n = Number(v);
            }
            if (n <= 0 || (n & (n - 1)) !== 0) this.diags.error(nameTok, 'requested alignment is not a power of 2');
            else attrs.aligned = Math.max(attrs.aligned ?? 0, n);
            break;
          }
          case 'section': {
            const a = args[0]?.[0];
            if (a?.kind === 'str') attrs.section = a.text.slice(1, -1);
            else this.diags.error(nameTok, 'section attribute expects a "string"');
            break;
          }
          case 'packed': attrs.packed = true; break;
          case 'naked': attrs.naked = true; break;
          case 'interrupt': {
            const a = args[0]?.[0];
            const kind = a?.kind === 'str' ? a.text.slice(1, -1) : 'machine';
            attrs.interrupt = kind === 'supervisor' ? 'supervisor' : 'machine';
            break;
          }
          case 'noreturn': attrs.noreturn = true; break;
          case 'used': attrs.used = true; break;
          case 'weak': attrs.weak = true; break;
          default: break; // unused, noinline, always_inline, format, ...: accepted and ignored
        } // prettier-ignore
      }
      this.expect(')');
      this.expect(')');
    }
  }

  private declSpec(allowStorage: boolean): DeclSpec {
    const attrs: Attrs = {};
    let storage: DeclSpec['storage'];
    let isInline = false;
    let isConst = false;
    let isVolatile = false;
    let alignas = 0;
    let base: Type | undefined;
    let nVoid = 0, nBool = 0, nChar = 0, nShort = 0, nInt = 0, nLong = 0, nSigned = 0, nUnsigned = 0, nFloat = 0; // prettier-ignore
    const startTok = this.tok;
    let any = false;
    for (;;) {
      const t = this.tok;
      if (t.kind !== 'ident') break;
      const k = t.text;
      if (k === '__attribute__' || k === '__attribute') {
        this.attributes(attrs);
        continue;
      }
      if (k === 'typedef' || k === 'static' || k === 'extern' || k === 'register' || k === 'auto' || k === '_Thread_local') {
        this.next();
        if (!allowStorage) this.diags.error(t, `'${k}' is not allowed here`);
        else if (storage && k !== '_Thread_local') this.diags.error(t, `more than one storage class ('${storage}' and '${k}')`);
        else if (k !== '_Thread_local') storage = k;
        continue;
      }
      if (k === 'inline' || k === '_Noreturn') {
        this.next();
        if (k === 'inline') isInline = true;
        else attrs.noreturn = true;
        continue;
      }
      if (k === 'const') { this.next(); isConst = true; continue; } // prettier-ignore
      if (k === 'volatile') { this.next(); isVolatile = true; continue; } // prettier-ignore
      if (k === 'restrict' || k === '_Atomic' || k === '_Complex') { this.next(); continue; } // prettier-ignore
      if (k === '_Alignas') {
        this.next();
        this.expect('(');
        if (this.isTypeStart()) alignas = alignOf(this.typeName());
        else alignas = Number(this.constExpr());
        this.expect(')');
        continue;
      }
      // type specifiers
      if (base) break; // a typedef name after a full type is the declarator name
      if (k === 'struct' || k === 'union') {
        if (any) this.diags.error(t, 'two or more data types in declaration specifiers');
        base = this.recordDecl(k === 'union');
        any = true;
        continue;
      }
      if (k === 'enum') {
        if (any) this.diags.error(t, 'two or more data types in declaration specifiers');
        base = this.enumDecl();
        any = true;
        continue;
      }
      if (k === '__builtin_va_list') {
        this.next();
        base = VA_LIST;
        any = true;
        continue;
      }
      if (k === 'typeof' || k === '__typeof__' || k === '__typeof') {
        this.next();
        this.expect('(');
        if (this.isTypeStart()) base = this.typeName();
        else base = this.expr().type;
        this.expect(')');
        any = true;
        continue;
      }
      const counts: Record<string, () => void> = {
        void: () => nVoid++, _Bool: () => nBool++, char: () => nChar++, short: () => nShort++,
        int: () => nInt++, long: () => nLong++, signed: () => nSigned++, unsigned: () => nUnsigned++,
        float: () => nFloat++, double: () => nFloat++,
      }; // prettier-ignore
      const c = counts[k];
      if (c) {
        this.next();
        c();
        any = true;
        continue;
      }
      if (!any && this.isTypedefName(t)) {
        this.next();
        const e = this.lookup(k);
        if (e?.kind === 'typedef') base = e.type;
        any = true;
        continue;
      }
      break;
    }
    let type: Type;
    const loc = span(startTok, this.prev());
    if (base) {
      if (nVoid + nBool + nChar + nShort + nInt + nLong + nSigned + nUnsigned + nFloat > 0)
        this.diags.error(loc, 'two or more data types in declaration specifiers');
      type = base;
    } else if (nFloat) {
      this.diags.error(loc, 'floating-point types (float, double) are not supported by this compiler');
      type = ty.int;
    } else if (nVoid) {
      if (nVoid > 1 || nBool + nChar + nShort + nInt + nLong + nSigned + nUnsigned > 0)
        this.diags.error(loc, 'invalid combination of type specifiers with void');
      type = ty.void;
    } else if (nBool) {
      if (nChar + nShort + nInt + nLong + nSigned + nUnsigned > 0) this.diags.error(loc, 'invalid combination of type specifiers with _Bool');
      type = ty.bool;
    } else {
      if (nSigned && nUnsigned) this.diags.error(loc, "both 'signed' and 'unsigned' in declaration specifiers");
      if (nChar) {
        if (nShort || nLong || nInt) this.diags.error(loc, 'invalid combination of type specifiers with char');
        type = nUnsigned ? ty.uchar : nSigned ? ty.schar : ty.char;
      } else if (nShort) {
        if (nLong) this.diags.error(loc, "both 'short' and 'long' in declaration specifiers");
        type = nUnsigned ? ty.ushort : ty.short;
      } else if (nLong >= 2) {
        if (nLong > 2) this.diags.error(loc, "'long long long' is too long");
        type = nUnsigned ? ty.ullong : ty.llong;
      } else if (nLong === 1) {
        type = nUnsigned ? ty.ulong : ty.long;
      } else {
        type = nUnsigned ? ty.uint : ty.int;
      }
      if (nInt > 1) this.diags.error(loc, "duplicate 'int'");
    }
    const implicit = !any;
    if (implicit) {
      if (storage === undefined && !isConst && !isVolatile && !isInline) {
        const t = this.tok;
        this.fail(t, t.kind === 'ident' ? `unknown type name '${t.text}'` : `expected a type, found '${t.text || 'end of file'}'`);
      }
      this.diags.warn(this.tok, "type specifier missing, defaults to 'int'");
    }
    if (isConst || isVolatile) type = qualified(type, { isConst, isVolatile });
    if (alignas) attrs.aligned = Math.max(attrs.aligned ?? 0, alignas);
    return { type, ...(storage ? { storage } : {}), isInline, attrs, implicit };
  }

  private recordDecl(isUnion: boolean): Type {
    const kw = this.next();
    const attrs: Attrs = {};
    this.attributes(attrs);
    let tag: Token | undefined;
    if (this.tok.kind === 'ident' && !KEYWORDS.has(this.tok.text)) tag = this.next();
    if (tag && !this.is('{')) {
      const found = this.lookupTag(tag.text);
      if (found) {
        if ((found.kind === 'union') !== isUnion) this.diags.error(tag, `'${tag.text}' was declared as a ${found.kind}, not a ${isUnion ? 'union' : 'struct'}`);
        // `struct S;` alone re-declares in the current scope
        if (this.is(';') && !this.scope.tags.has(tag.text)) {
          const t = newRecord(isUnion, tag.text);
          this.scope.tags.set(tag.text, t);
          return t;
        }
        return found;
      }
      const t = newRecord(isUnion, tag.text);
      if (t.rec) t.rec.loc = tag;
      this.scopes[this.fn ? this.scopes.length - 1 : 0]?.tags.set(tag.text, t);
      return t;
    }
    if (!this.is('{')) this.fail(this.tok, `expected a name or '{' after '${kw.text}'`);
    let t: Type;
    const existing = tag ? this.scope.tags.get(tag.text) : undefined;
    if (existing && existing.rec && !existing.rec.complete && (existing.kind === 'union') === isUnion) t = existing;
    else {
      if (existing?.rec?.complete) this.diags.error(tag as Token, `redefinition of '${kw.text} ${tag?.text}'`);
      t = newRecord(isUnion, tag?.text);
      if (tag) this.scope.tags.set(tag.text, t);
    }
    const rec = t.rec as NonNullable<Type['rec']>;
    rec.loc = tag ?? kw;
    this.expect('{');
    const members: Member[] = [];
    const names = new Set<string>();
    while (!this.consume('}')) {
      if (this.tok.kind === 'eof') this.fail(kw, `missing '}' at the end of ${kw.text}`);
      if (this.consume(';')) continue;
      if (this.is('_Static_assert')) {
        this.staticAssert();
        continue;
      }
      const spec = this.declSpec(false);
      // anonymous struct/union member
      if (isRecord(spec.type) && this.is(';')) {
        this.next();
        members.push({ name: undefined, type: spec.type, offset: 0 });
        for (const m of spec.type.rec?.members ?? []) if (m.name) names.add(m.name);
        continue;
      }
      for (;;) {
        let d: Declarator;
        if (this.is(':')) d = { type: spec.type, attrs: {} };
        else d = this.declarator(spec.type);
        const m: Member = { name: d.name, type: d.type, offset: 0, ...(d.nameTok ? { loc: d.nameTok } : {}) };
        if (this.consume(':')) {
          const wt = this.tok;
          const w = Number(this.constExpr());
          if (!isInteger(d.type)) this.diags.error(wt, `bit-field '${d.name ?? ''}' must have an integer type`);
          else if (w < 0 || w > sizeOf(d.type) * 8) this.diags.error(wt, `bit-field width ${w} is out of range for '${typeName(d.type)}'`);
          else if (w === 0 && d.name) this.diags.error(wt, `named bit-field '${d.name}' has zero width`);
          m.bitWidth = w;
          if (d.type.kind === 'llong') this.diags.error(wt, 'long long bit-fields are not supported');
        }
        this.attributes(d.attrs);
        if (spec.attrs.aligned) d.attrs.aligned = Math.max(d.attrs.aligned ?? 0, spec.attrs.aligned);
        if (d.attrs.aligned) m.type = { ...m.type, align: Math.max(alignOf(m.type), d.attrs.aligned) };
        if (d.name) {
          if (names.has(d.name)) this.diags.error(d.nameTok as Token, `duplicate member '${d.name}'`);
          names.add(d.name);
        }
        if (d.type.kind === 'func') this.diags.error(d.nameTok ?? this.tok, `member '${d.name}' cannot be a function (use a function pointer)`);
        else if (d.type.kind === 'array' && (d.type.len ?? 0) < 0) {
          rec.flexible = true;
          m.type = arrayOf(d.type.base ?? ty.int, 0);
        } else if (!isComplete(d.type) && m.bitWidth === undefined) {
          this.diags.error(d.nameTok ?? this.tok, `member '${d.name}' has incomplete type '${typeName(d.type)}'`);
        }
        if (rec.flexible && members.length > 0 && members[members.length - 1]?.type.kind === 'array' && members[members.length - 1]?.type.len === 0 && m !== members[members.length - 1]) {
          // a member after a flexible array
        }
        members.push(m);
        if (this.consume(',')) continue;
        this.expect(';', 'after a struct member');
        break;
      }
    }
    this.attributes(attrs);
    if (attrs.packed) rec.packed = true;
    layoutRecord(rec, members, attrs.aligned ?? 0);
    return t;
  }

  private enumDecl(): Type {
    const kw = this.next();
    this.attributes({});
    let tag: Token | undefined;
    if (this.tok.kind === 'ident' && !KEYWORDS.has(this.tok.text)) tag = this.next();
    if (tag && !this.is('{')) {
      const found = this.lookupTag(tag.text);
      if (found) {
        if (found.kind !== 'enum') this.diags.error(tag, `'${tag.text}' is not an enum`);
        return found;
      }
      const t = enumType(tag.text);
      this.scope.tags.set(tag.text, t);
      return t;
    }
    if (!this.is('{')) this.fail(this.tok, "expected a name or '{' after 'enum'");
    const t = enumType(tag?.text);
    if (tag) this.scope.tags.set(tag.text, t);
    this.expect('{');
    let v = 0n;
    let allNonNeg = true;
    while (!this.consume('}')) {
      const id = this.next();
      if (id.kind !== 'ident') this.fail(id, `expected an enumerator name in enum, found '${id.text}'`);
      if (this.consume('=')) v = this.constExpr();
      if (v < 0n) allNonNeg = false;
      if (v > 0xffffffffn || v < -0x80000000n) this.diags.error(id, `enumerator value for '${id.text}' does not fit in an int`);
      if (this.scope.vars.has(id.text)) this.diags.error(id, `redefinition of '${id.text}'`);
      this.scope.vars.set(id.text, { kind: 'enumconst', value: BigInt.asIntN(32, v), type: ty.int });
      v++;
      if (!this.consume(',')) {
        this.expect('}', 'at the end of the enum');
        break;
      }
    }
    void allNonNeg;
    void kw;
    return t;
  }

  // ------------------------------------------------------------------ declarators

  private pointers(t: Type): Type {
    while (this.consume('*')) {
      t = pointerTo(t);
      let isConst = false;
      let isVolatile = false;
      for (;;) {
        if (this.consume('const')) isConst = true;
        else if (this.consume('volatile')) isVolatile = true;
        else if (this.consume('restrict') || this.consume('_Atomic')) continue;
        else if (this.is('__attribute__') || this.is('__attribute')) this.attributes({});
        else break;
      }
      t = qualified(t, { isConst, isVolatile });
    }
    return t;
  }

  /** Is the '(' at the cursor the start of a nested declarator (not a parameter list)? */
  private nestedDeclarator(): boolean {
    if (!this.is('(')) return false;
    const n = this.peek();
    if (n.text === '*' || n.text === '(' || n.text === '^') return true;
    if (n.text === '__attribute__') return true;
    if (n.kind === 'ident' && !this.isTypeStart(n)) return true;
    return false;
  }

  declarator(base: Type, abstract = false): Declarator {
    const attrs: Attrs = {};
    let t = this.pointers(base);
    this.attributes(attrs);
    if (this.nestedDeclarator()) {
      const start = this.pos;
      this.next();
      // skip the nested part with a dummy type to find what follows
      const quiet = this.diags.errors;
      this.declarator(ty.int, abstract);
      void quiet;
      this.expect(')');
      const suffix = this.typeSuffix(t);
      const end = this.pos;
      this.pos = start + 1;
      const inner = this.declarator(suffix.type, abstract);
      this.expect(')');
      this.pos = end;
      mergeAttrs(inner.attrs, attrs);
      this.declTail(inner);
      return inner;
    }
    let nameTok: Token | undefined;
    if (this.tok.kind === 'ident' && !KEYWORDS.has(this.tok.text)) {
      nameTok = this.next();
    } else if (!abstract && this.tok.kind === 'ident' && KEYWORDS.has(this.tok.text) && !TYPE_KEYWORDS.has(this.tok.text)) {
      this.fail(this.tok, `'${this.tok.text}' is a keyword and cannot be used as a name`);
    }
    const suffix = this.typeSuffix(t);
    t = suffix.type;
    const d: Declarator = { type: t, attrs, ...(suffix.paramNames ? { paramNames: suffix.paramNames } : {}) };
    if (nameTok) {
      d.name = nameTok.text;
      d.nameTok = nameTok;
    }
    this.declTail(d);
    return d;
  }

  /** `asm("name")` and attributes after a declarator. */
  private declTail(d: Declarator): void {
    for (;;) {
      if (this.is('__attribute__') || this.is('__attribute')) {
        this.attributes(d.attrs);
        continue;
      }
      if (this.is('asm') || this.is('__asm__') || this.is('__asm')) {
        this.next();
        this.expect('(');
        d.asmLabel = String.fromCharCode(...this.stringBytes());
        this.expect(')');
        continue;
      }
      break;
    }
  }

  private typeSuffix(t: Type): { type: Type; paramNames?: (Token | undefined)[] } {
    if (this.is('(')) {
      const open = this.next();
      return this.params(t, open);
    }
    if (this.is('[')) {
      const open = this.next();
      while (this.consume('static') || this.consume('const') || this.consume('volatile') || this.consume('restrict')) {
        /* qualifiers in array parameter declarators */
      }
      let len = -1;
      if (!this.is(']')) {
        const lt = this.tok;
        const e = this.assign();
        const v = this.evalConst(e);
        if (v === undefined) {
          this.diags.error(span(lt, this.prev()), 'array size must be a constant expression (variable-length arrays are not supported)');
          len = 1;
        } else if (v < 0n) {
          this.diags.error(span(lt, this.prev()), 'array size is negative');
          len = 1;
        } else len = Number(v);
      }
      this.expect(']', 'to close the array size');
      void open;
      const inner = this.typeSuffix(t);
      if (inner.type.kind === 'func') this.diags.error(open, 'arrays of functions are not allowed (use function pointers)');
      if (!isComplete(inner.type) && inner.type.kind !== 'void') {
        if (!(inner.type.rec && inner.type.rec.tag)) this.diags.error(open, `array has incomplete element type '${typeName(inner.type)}'`);
      }
      if (inner.type.kind === 'void') this.diags.error(open, "declaration of an array of 'void'");
      return { type: arrayOf(inner.type, len) };
    }
    return { type: t };
  }

  private params(ret: Type, open: Token): { type: Type; paramNames: (Token | undefined)[] } {
    if (ret.kind === 'func') this.diags.error(open, 'a function cannot return a function (return a function pointer)');
    if (ret.kind === 'array') this.diags.error(open, 'a function cannot return an array');
    if (this.consume(')')) return { type: funcType(ret, [], false, true), paramNames: [] };
    if (this.is('void') && this.peek().text === ')') {
      this.next();
      this.next();
      return { type: funcType(ret, [], false), paramNames: [] };
    }
    const params: Param[] = [];
    const names: (Token | undefined)[] = [];
    let variadic = false;
    for (;;) {
      if (this.consume('...')) {
        variadic = true;
        if (params.length === 0) this.diags.error(this.prev(), "a variadic function needs at least one named parameter before '...'");
        this.expect(')', "after '...'");
        break;
      }
      if (!this.isTypeStart()) {
        // K&R identifier list or a typo'd type
        const t = this.tok;
        if (t.kind === 'ident' && (this.peek().text === ',' || this.peek().text === ')'))
          this.fail(t, `unknown type name '${t.text}' (old-style parameter lists are not supported; write 'int ${t.text}')`);
        this.fail(t, t.kind === 'ident' ? `unknown type name '${t.text}'` : `expected a parameter type, found '${t.text}'`);
      }
      this.enter();
      const spec = this.declSpec(true);
      if (spec.storage && spec.storage !== 'register') this.diags.error(this.prev(), `invalid storage class for a parameter`);
      const d = this.declarator(spec.type, true);
      this.leave();
      let pt = d.type;
      if (pt.kind === 'array') pt = qualified(pointerTo(pt.base ?? ty.int), {});
      else if (pt.kind === 'func') pt = pointerTo(pt);
      if (pt.kind === 'void') this.diags.error(d.nameTok ?? this.prev(), "a parameter cannot have type 'void'");
      params.push({ name: d.name, type: pt, ...(d.nameTok ? { loc: d.nameTok } : {}) });
      names.push(d.nameTok);
      if (this.consume(',')) continue;
      this.expect(')', 'to close the parameter list');
      break;
    }
    return { type: funcType(ret, params, variadic), paramNames: names };
  }

  /** A type name (casts, sizeof, va_arg): specifiers plus an abstract declarator. */
  typeName(): Type {
    const spec = this.declSpec(false);
    const d = this.declarator(spec.type, true);
    if (d.name) this.diags.error(d.nameTok as Token, `unexpected name '${d.name}' in a type`);
    return d.type;
  }

  // ------------------------------------------------------------------ functions

  private functionBody(f: Obj, d: Declarator): void {
    if (f.isDefinition) this.diags.error(d.nameTok as Token, `redefinition of function '${f.name}'`);
    f.isDefinition = true;
    f.loc = d.nameTok as Token;
    f.line = this.line(d.nameTok);
    f.type = d.type;
    f.params = [];
    f.locals = [];
    f.refs = new Set();
    this.fn = f;
    this.fnLabels = new Map();
    this.enter();
    const ft = d.type;
    if (ft.ret && isRecord(ft.ret) && !isComplete(ft.ret)) this.diags.error(d.nameTok as Token, `return type '${typeName(ft.ret)}' is incomplete`);
    (ft.params ?? []).forEach((p, i) => {
      const nt = d.paramNames?.[i];
      if (!nt) {
        this.diags.error(p.loc ?? (d.nameTok as Token), `parameter ${i + 1} of '${f.name}' needs a name in a function definition`);
      }
      const o = this.newLocal(p.name ?? `__param${i}`, p.type, nt ?? (d.nameTok as Token));
      f.params?.push(o);
    });
    const body = this.compound();
    f.endLine = this.line(this.prev());
    this.leave();
    for (const [name, l] of this.fnLabels) if (!l.defined) this.diags.error(l.tok, `label '${name}' is used but never defined`);
    f.body = body;
    this.fn = undefined;
    if (ft.ret && ft.ret.kind !== 'void' && f.name !== 'main' && !f.attrs.naked && !endsWithReturn(body)) {
      // gcc only warns with -Wreturn-type; keep quiet unless the body is empty of returns
      if (!containsReturn(body)) this.diags.warn(this.prev(), `function '${f.name}' should return a value ('${typeName(ft.ret)}')`);
    }
  }

  private newLocal(name: string, type: Type, at: Token): Obj {
    const o = this.newObj(name, type, at, true);
    o.isDefinition = true;
    this.fn?.locals?.push(o);
    this.scope.vars.set(name, { kind: 'var', obj: o });
    return o;
  }

  private tempLocal(type: Type, at: Token): Obj {
    const o = this.newObj(`__tmp${this.uniq++}`, type, at, true);
    o.isDefinition = true;
    this.fn?.locals?.push(o);
    return o;
  }

  private newLabel(): number {
    return this.opts.labels.next++;
  }

  // ------------------------------------------------------------------ statements

  private compound(): Stmt {
    const open = this.expect('{');
    const stmts: Stmt[] = [];
    this.enter();
    while (!this.is('}')) {
      if (this.tok.kind === 'eof') {
        this.diags.error(open, "missing '}' to close this block");
        break;
      }
      const start = this.pos;
      try {
        stmts.push(this.blockItem());
      } catch (e) {
        if (!(e instanceof Bail)) throw e;
        this.syncStmt();
        if (this.pos === start) this.next();
      }
    }
    this.leave();
    this.consume('}');
    return { kind: 'block', stmts, loc: open, line: this.line(open) };
  }

  /** Skip to just after the next ';' (or before a '}') at the current nesting level. */
  private syncStmt(): void {
    let depth = 0;
    while (this.tok.kind !== 'eof') {
      const t = this.tok;
      if (t.text === '(' || t.text === '[' || t.text === '{') depth++;
      else if (t.text === ')' || t.text === ']') depth = Math.max(0, depth - 1);
      else if (t.text === '}') {
        if (depth === 0) return;
        depth--;
        if (depth === 0) {
          this.next();
          return;
        }
      } else if (t.text === ';' && depth === 0) {
        this.next();
        return;
      }
      this.next();
    }
  }

  private blockItem(): Stmt {
    if (this.is('_Static_assert')) {
      const t = this.tok;
      this.staticAssert();
      return { kind: 'null', loc: t, line: this.line(t) };
    }
    if (this.isTypeStart() && !(this.isTypedefName(this.tok) && this.peek().text === ':')) {
      return this.localDecl();
    }
    return this.stmt();
  }

  private localDecl(): Stmt {
    const startTok = this.tok;
    const spec = this.declSpec(true);
    const out: Stmt[] = [];
    if (this.consume(';')) return { kind: 'null', loc: startTok, line: this.line(startTok) };
    for (;;) {
      const d = this.declarator(spec.type);
      mergeAttrs(d.attrs, spec.attrs);
      if (!d.name || !d.nameTok) this.fail(d.nameTok ?? this.tok, 'expected a variable name in this declaration');
      const name = d.name;
      const at = d.nameTok;
      if (spec.storage === 'typedef') {
        this.declareTypedef(d);
      } else if (d.type.kind === 'func') {
        const f = this.declareFunction(d, { ...spec, storage: spec.storage === 'static' ? 'static' : 'extern' });
        this.scope.vars.set(name, { kind: 'var', obj: f });
      } else if (spec.storage === 'extern') {
        const prevFn = this.fn;
        this.fn = undefined;
        const g = this.globalByName.get(name);
        this.fn = prevFn;
        if (g) this.scope.vars.set(name, { kind: 'var', obj: g });
        else {
          const o = this.newObj(name, d.type, at, false);
          o.isExtern = true;
          this.globals.push(o);
          this.globalByName.set(name, o);
          this.scope.vars.set(name, { kind: 'var', obj: o });
        }
        if (this.is('=')) this.fail(this.tok, `'extern' variable '${name}' cannot have an initializer inside a function`);
      } else if (spec.storage === 'static') {
        // static local: a global with a unique symbol name
        const g = this.newObj(name, d.type, at, false);
        g.asmName = `${name}.${this.uniq++}`;
        g.isStatic = true;
        g.isDefinition = true;
        g.attrs = { ...d.attrs };
        this.globals.push(g);
        this.scope.vars.set(name, { kind: 'var', obj: g });
        this.fn?.refs?.add(g);
        if (this.consume('=')) {
          const init = this.newInit(g.type, true);
          this.initializer(init);
          if (init.flexible) g.type = arrayOf(g.type.base ?? ty.int, init.children?.length ?? 0);
          else if (init.type !== g.type && g.type.kind === 'array') g.type = init.type;
          g.init = this.globalInitData(init, g);
        }
        if (!isComplete(g.type)) this.diags.error(at, `variable '${name}' has incomplete type '${typeName(g.type)}'`);
      } else {
        if (this.scope.vars.has(name) && this.scope.vars.get(name)?.kind !== 'typedef')
          this.diags.error(at, `redefinition of '${name}' in the same block`);
        if (d.type.kind === 'void') this.diags.error(at, `variable '${name}' cannot have type 'void'`);
        const o = this.newLocal(name, d.type, at);
        o.attrs = { ...d.attrs };
        if (d.asmLabel) {
          if (spec.storage !== 'register') this.diags.error(at, "asm(\"reg\") on a local variable needs 'register'");
          o.asmReg = d.asmLabel;
        }
        if (this.consume('=')) {
          const init = this.newInit(o.type, true);
          this.initializer(init);
          if (init.flexible) o.type = arrayOf(o.type.base ?? ty.int, init.children?.length ?? 0);
          else if (init.type !== o.type && o.type.kind === 'array') o.type = init.type;
          out.push(...this.lowerLocalInit(init, o, at));
        } else if (!isComplete(o.type)) {
          this.diags.error(at, `variable '${name}' has incomplete type '${typeName(o.type)}'`);
        }
      }
      if (this.consume(',')) continue;
      this.expect(';', 'after the declaration');
      break;
    }
    if (out.length === 1) return out[0] as Stmt;
    return { kind: 'block', stmts: out, loc: startTok, line: this.line(startTok) };
  }

  private exprStmt(e: Expr): Stmt {
    return { kind: 'expr', expr: e, loc: e.loc, line: e.line };
  }

  private stmt(): Stmt {
    const t = this.tok;
    const line = this.line(t);
    const mk = (s: DistOmit<Stmt, 'loc' | 'line'>): Stmt => ({ ...s, loc: t, line }) as Stmt;
    if (t.kind === 'ident') {
      switch (t.text) {
        case 'if': {
          this.next();
          this.expect('(', "after 'if'");
          const cond = this.condExpr(this.expr());
          this.checkAssignCond(cond);
          this.expect(')', "to close the 'if' condition");
          const then = this.stmt();
          let els: Stmt | undefined;
          if (this.consume('else')) els = this.stmt();
          return mk({ kind: 'if', cond, then, ...(els ? { else: els } : {}) });
        }
        case 'while': {
          this.next();
          this.expect('(', "after 'while'");
          const cond = this.condExpr(this.expr());
          this.checkAssignCond(cond);
          this.expect(')', "to close the 'while' condition");
          const brk = this.newLabel();
          const cont = this.newLabel();
          const body = this.loopBody(brk, cont);
          return mk({ kind: 'loop', cond, body, doWhile: false, brk, cont });
        }
        case 'do': {
          this.next();
          const brk = this.newLabel();
          const cont = this.newLabel();
          const body = this.loopBody(brk, cont);
          if (!this.consume('while')) this.fail(this.tok, "expected 'while' after the body of 'do'");
          this.expect('(', "after 'while'");
          const cond = this.condExpr(this.expr());
          this.expect(')', "to close the 'while' condition");
          this.expect(';', "after 'do ... while (...)'");
          return mk({ kind: 'loop', cond, body, doWhile: true, brk, cont });
        }
        case 'for': {
          this.next();
          this.expect('(', "after 'for'");
          this.enter();
          let init: Stmt | undefined;
          if (this.isTypeStart()) init = this.localDecl();
          else if (!this.consume(';')) {
            init = this.exprStmt(this.expr());
            this.expect(';', "after the 'for' initializer");
          }
          let cond: Expr | undefined;
          if (!this.is(';')) {
            cond = this.condExpr(this.expr());
            this.checkAssignCond(cond);
          }
          this.expect(';', "after the 'for' condition");
          let inc: Expr | undefined;
          if (!this.is(')')) inc = this.expr();
          this.expect(')', "to close the 'for' header");
          const brk = this.newLabel();
          const cont = this.newLabel();
          const body = this.loopBody(brk, cont);
          this.leave();
          return mk({
            kind: 'loop',
            ...(init ? { init } : {}),
            ...(cond ? { cond } : {}),
            ...(inc ? { inc } : {}),
            body,
            doWhile: false,
            brk,
            cont,
          });
        }
        case 'switch': {
          this.next();
          this.expect('(', "after 'switch'");
          let cond = this.rv(this.expr());
          if (!isInteger(cond.type)) this.diags.error(cond.loc, `switch needs an integer, not '${typeName(cond.type)}'`);
          else cond = this.cast(cond, promote(cond.type));
          this.expect(')', "to close the 'switch' value");
          const brk = this.newLabel();
          const sw = { cases: [] as { lo: bigint; hi: bigint; label: number }[], tok: t } as {
            cases: { lo: bigint; hi: bigint; label: number }[];
            defaultLabel?: number;
            tok: Token;
            type?: Type;
          };
          sw.type = cond.type;
          this.switches.push(sw);
          this.brk.push(brk);
          let body: Stmt;
          try {
            body = this.stmt();
          } finally {
            this.switches.pop();
            this.brk.pop();
          }
          return mk({
            kind: 'switch',
            cond,
            body,
            cases: sw.cases,
            ...(sw.defaultLabel !== undefined ? { defaultLabel: sw.defaultLabel } : {}),
            brk,
          });
        }
        case 'case': {
          this.next();
          const sw = this.switches[this.switches.length - 1] as (typeof this.switches)[number] & { type?: Type };
          const lt = this.tok;
          let lo = this.constExpr();
          let hi = lo;
          if (this.consume('...')) hi = this.constExpr();
          this.expect(':', "after the 'case' value");
          if (!sw) this.fail(t, "'case' is only allowed inside a switch");
          const st = sw.type ?? ty.int;
          lo = wrap(lo, st);
          hi = wrap(hi, st);
          for (const c of sw.cases) {
            if (!(hi < c.lo || lo > c.hi)) {
              this.diags.error(span(lt, this.prev()), `duplicate case value ${lo}`);
              break;
            }
          }
          const label = this.newLabel();
          sw.cases.push({ lo, hi, label });
          const s = this.is('}') ? mk({ kind: 'null' }) : this.stmt();
          return mk({ kind: 'label', label, stmt: s });
        }
        case 'default': {
          this.next();
          this.expect(':', "after 'default'");
          const sw = this.switches[this.switches.length - 1];
          if (!sw) this.fail(t, "'default' is only allowed inside a switch");
          if (sw.defaultLabel !== undefined) this.diags.error(t, "multiple 'default' labels in one switch");
          const label = this.newLabel();
          sw.defaultLabel = label;
          const s = this.is('}') ? mk({ kind: 'null' }) : this.stmt();
          return mk({ kind: 'label', label, stmt: s });
        }
        case 'break': {
          this.next();
          const target = this.brk[this.brk.length - 1];
          this.expect(';', "after 'break'");
          if (target === undefined) this.fail(t, "'break' is only allowed inside a loop or switch");
          return mk({ kind: 'jump', label: target });
        }
        case 'continue': {
          this.next();
          const target = this.cont[this.cont.length - 1];
          this.expect(';', "after 'continue'");
          if (target === undefined) this.fail(t, "'continue' is only allowed inside a loop");
          return mk({ kind: 'jump', label: target });
        }
        case 'return': {
          this.next();
          const fn = this.fn as Obj;
          const ret = fn.type.ret ?? ty.int;
          if (this.consume(';')) {
            if (ret.kind !== 'void' && fn.name !== 'main') this.diags.warn(t, `'return' with no value in function '${fn.name}' that returns '${typeName(ret)}'`);
            return mk({ kind: 'return' });
          }
          let e = this.expr();
          this.expect(';', "after the 'return' value");
          if (ret.kind === 'void') {
            if (e.type.kind !== 'void') this.diags.error(e.loc, `function '${fn.name}' returns void, so 'return' cannot have a value`);
            return mk({ kind: 'return', expr: e });
          }
          e = this.convertAssign(ret, e, 'return');
          return mk({ kind: 'return', expr: e });
        }
        case 'goto': {
          this.next();
          if (this.is('*')) this.fail(this.tok, 'computed goto is not supported');
          const id = this.next();
          if (id.kind !== 'ident') this.fail(id, "expected a label name after 'goto'");
          this.expect(';', "after 'goto label'");
          return mk({ kind: 'jump', label: this.fnLabel(id).id });
        }
        case 'asm':
        case '__asm__':
        case '__asm':
          return this.asmStmt();
        case 'else':
          this.fail(t, "'else' without a matching 'if'");
      }
      if (this.peek().text === ':' && t.kind === 'ident' && !KEYWORDS.has(t.text)) {
        this.next();
        this.next();
        const l = this.fnLabel(t);
        if (l.defined) this.diags.error(t, `label '${t.text}' is defined twice`);
        l.defined = true;
        this.attributes({});
        const s = this.is('}') ? mk({ kind: 'null' }) : this.isTypeStart() ? this.localDecl() : this.stmt();
        return mk({ kind: 'label', label: l.id, stmt: s });
      }
    }
    if (this.is('{')) return this.compound();
    if (this.consume(';')) return mk({ kind: 'null' });
    if (this.is('}')) this.fail(t, "expected a statement before '}'");
    const e = this.expr();
    if (!this.is(';')) {
      const n = this.tok;
      if (n.line === this.prev().endLine && n.kind !== 'eof')
        this.fail(n, `expected ';' after expression, found '${n.text}'`);
      this.fail(this.afterPrev(), "expected ';' after expression");
    }
    this.next();
    return this.exprStmt(e);
  }

  private fnLabel(t: Token): LabelInfo {
    let l = this.fnLabels.get(t.text);
    if (!l) {
      l = { id: this.newLabel(), defined: false, tok: t };
      this.fnLabels.set(t.text, l);
    }
    return l;
  }

  private loopBody(brk: number, cont: number): Stmt {
    this.brk.push(brk);
    this.cont.push(cont);
    try {
      return this.stmt();
    } finally {
      this.brk.pop();
      this.cont.pop();
    }
  }

  private asmStmt(): Stmt {
    const t = this.next();
    for (;;) {
      if (this.consume('volatile') || this.consume('inline') || this.consume('goto')) continue;
      break;
    }
    this.expect('(', 'after asm');
    const template = String.fromCharCode(...this.stringBytes());
    const outputs: AsmOperand[] = [];
    const inputs: AsmOperand[] = [];
    const clobbers: string[] = [];
    const labels: string[] = [];
    const operands = (list: AsmOperand[], output: boolean): void => {
      if (this.is(':') || this.is(')')) return;
      for (;;) {
        let name: string | undefined;
        if (this.consume('[')) {
          name = this.next().text;
          this.expect(']');
        }
        const ct = this.tok;
        if (ct.kind !== 'str') this.fail(ct, 'expected an asm operand constraint string like "r"');
        const constraint = String.fromCharCode(...this.stringBytes());
        this.expect('(');
        let e = this.expr();
        this.expect(')');
        if (output) {
          if (!constraint.startsWith('=') && !constraint.startsWith('+'))
            this.diags.error(ct, `output operand constraint "${constraint}" must start with '=' or '+'`);
          this.checkLvalue(e, 'an asm output');
        } else e = this.rv(e);
        if (!/[rmiInKJ]/.test(constraint.replace(/^[=+&]+/, '')))
          this.diags.error(ct, `unsupported asm constraint "${constraint}" (use "r", "i" or "m")`);
        list.push({ constraint, ...(name ? { name } : {}), expr: e });
        if (!this.consume(',')) break;
      }
    };
    if (this.consume(':')) {
      operands(outputs, true);
      if (this.consume(':')) {
        operands(inputs, false);
        if (this.consume(':')) {
          while (this.tok.kind === 'str') {
            clobbers.push(String.fromCharCode(...this.stringBytes()));
            if (!this.consume(',')) break;
          }
          if (this.consume(':')) {
            while (this.tok.kind === 'ident') {
              const l = this.next();
              labels.push(String(this.fnLabel(l).id));
              if (!this.consume(',')) break;
            }
          }
        }
      }
    }
    this.expect(')', 'to close asm(...)');
    this.expect(';', 'after asm(...)');
    return { kind: 'asm', template, outputs, inputs, clobbers, labels, loc: t, line: this.line(t) };
  }

  /** Concatenated string-literal bytes (no terminator). */
  private stringBytes(): number[] {
    const t = this.tok;
    if (t.kind !== 'str') this.fail(t, 'expected a "string"');
    const out: number[] = [];
    while (this.tok.kind === 'str') {
      const s = this.next();
      const q = s.text.indexOf('"');
      out.push(...decodeLiteral(s.text.slice(q + 1, -1), (m) => this.diags.error(s, m)));
    }
    return out;
  }

  // ------------------------------------------------------------------ expressions: helpers

  private mkExpr(e: DistOmit<Expr, 'loc' | 'line'>, loc: Loc, line?: number): Expr {
    return { ...e, loc, line: line ?? this.lineOfLoc(loc) } as Expr;
  }

  private lineOfLoc(loc: Loc): number {
    return (loc as Token).mainLine ?? 0;
  }

  num(value: bigint, type: Type, loc: Loc): Expr {
    return { kind: 'num', value: wrap(value, type), type, loc, line: this.lineOfLoc(loc) };
  }

  /** Array and function designators decay to pointers. */
  rv(e: Expr): Expr {
    if (e.type.kind === 'array') {
      return { kind: 'addr', operand: e, type: pointerTo(e.type.base ?? ty.int), loc: e.loc, line: e.line };
    }
    if (e.type.kind === 'func') {
      return { kind: 'addr', operand: e, type: pointerTo(e.type), loc: e.loc, line: e.line };
    }
    return e;
  }

  /** Conversion to `t` (no checks). Folds constants. */
  cast(e: Expr, t: Type): Expr {
    if (t.kind === 'void') return { kind: 'cast', operand: e, type: t, loc: e.loc, line: e.line };
    const ut = unqualified(t);
    if (e.kind === 'num' && isScalar(t)) return { ...e, value: wrap(e.value, ut), type: ut };
    if (sameKind(e.type, ut)) {
      if (e.type === ut) return e;
      return { kind: 'cast', operand: e, type: ut, loc: e.loc, line: e.line };
    }
    return { kind: 'cast', operand: e, type: ut, loc: e.loc, line: e.line };
  }

  /** Condition of if/while/for/?:/&&/||: any scalar. */
  /** gcc -Wparentheses: `if (x = 5)` is usually a typo for `==`. */
  private checkAssignCond(e: Expr): void {
    if (e.kind === 'assign' && !e.paren)
      this.diags.warn(e.loc, "using the result of an assignment as a condition: did you mean '=='? (add parentheses to keep '=')");
  }

  private condExpr(e: Expr): Expr {
    e = this.rv(e);
    if (!isScalar(e.type)) this.diags.error(e.loc, `a condition needs a number or pointer, not '${typeName(e.type)}'`);
    return e;
  }

  private isNullConst(e: Expr): boolean {
    let x = e;
    while (x.kind === 'cast' && (x.type.kind === 'ptr' && x.type.base?.kind === 'void')) x = x.operand;
    if (!isInteger(x.type) && x.kind !== 'cast') return false;
    return this.evalConst(x) === 0n && (isInteger(x.type) || x.kind === 'num');
  }

  /** Convert for assignment/initialization/argument passing, with C's checks. */
  convertAssign(to: Type, e: Expr, ctx: string): Expr {
    e = this.rv(e);
    const from = e.type;
    const tn = (t: Type): string => `'${typeName(t)}'`;
    if (to.kind === 'void') return e;
    if (isRecord(to)) {
      if (!sameType(unqualified(to), unqualified(from)))
        this.diags.error(e.loc, `incompatible types in ${ctx}: ${tn(from)} cannot be converted to ${tn(to)}`);
      return e;
    }
    if (from.kind === 'void') {
      this.diags.error(e.loc, `a 'void' value cannot be used in ${ctx}`);
      return this.num(0n, to, e.loc);
    }
    if (isRecord(from)) {
      this.diags.error(e.loc, `incompatible types in ${ctx}: ${tn(from)} cannot be converted to ${tn(to)}`);
      return this.num(0n, to, e.loc);
    }
    if (to.kind === 'ptr') {
      if (from.kind === 'ptr') {
        const a = to.base ?? ty.void;
        const b = from.base ?? ty.void;
        if (a.kind !== 'void' && b.kind !== 'void' && !sameType(unqualified(a), unqualified(b))) {
          // char * vs unsigned char * etc. are warnings in gcc too
          this.diags.warn(e.loc, `incompatible pointer types in ${ctx}: ${tn(from)} to ${tn(to)}`);
        } else if ((b.isConst && !a.isConst) || (b.isVolatile && !a.isVolatile)) {
          this.diags.warn(e.loc, `${ctx} discards the '${b.isConst ? 'const' : 'volatile'}' qualifier of the pointed-to type`);
        }
      } else if (isInteger(from) && !this.isNullConst(e)) {
        this.diags.warn(e.loc, `${ctx} makes a pointer from an integer without a cast`);
      }
      return this.cast(e, to);
    }
    if (isInteger(to) && from.kind === 'ptr' && to.kind !== 'bool') {
      this.diags.warn(e.loc, `${ctx} makes an integer from a pointer without a cast`);
    }
    if (to.kind === 'bool' && from.kind === 'ptr') return this.toBool(e);
    return this.cast(e, to);
  }

  private toBool(e: Expr): Expr {
    // (_Bool)p == (p != 0)
    const z = this.num(0n, e.type.kind === 'ptr' ? e.type : promote(e.type), e.loc);
    const ne = this.mkExpr({ kind: 'binary', op: '!=', lhs: e, rhs: e.type.kind === 'ptr' ? { ...z, type: e.type } : z, type: ty.int }, e.loc, e.line);
    return this.cast(ne, ty.bool);
  }

  private checkLvalue(e: Expr, what: string): void {
    const ok = e.kind === 'var' || e.kind === 'deref' || (e.kind === 'member' && this.isLvalue(e.base));
    if (!ok || e.type.kind === 'func' || e.type.kind === 'array') {
      this.diags.error(e.loc, `${what} must be a variable, array element, struct member or *pointer`);
      throw new Bail();
    }
    if (e.type.isConst || (e.kind === 'member' && this.constBase(e))) {
      const name = e.kind === 'var' ? ` '${e.obj.name}'` : e.kind === 'member' && e.member.name ? ` '${e.member.name}'` : '';
      this.diags.error(e.loc, `cannot modify${name}: it is const`);
    }
    if (e.kind === 'var' && e.obj.isLiteral) this.diags.error(e.loc, 'cannot modify a string literal');
  }

  private constBase(e: Expr): boolean {
    if (e.kind !== 'member') return false;
    if (e.base.type.isConst) return true;
    return this.constBase(e.base);
  }

  private isLvalue(e: Expr): boolean {
    return e.kind === 'var' || e.kind === 'deref' || (e.kind === 'member' && this.isLvalue(e.base)) ||
      e.kind === 'initvar' || e.kind === 'call' || e.kind === 'cond' || e.kind === 'comma' || e.kind === 'assign' || e.kind === 'stmtexpr';
  } // prettier-ignore

  // ------------------------------------------------------------------ expressions: parsing

  expr(): Expr {
    let e = this.assign();
    while (this.is(',')) {
      const op = this.next();
      const r = this.assign();
      const rr = this.rv(r);
      e = this.mkExpr({ kind: 'comma', lhs: e, rhs: rr, type: rr.type }, span(e.loc, r.loc), this.line(op));
    }
    return e;
  }

  private static ASSIGN_OPS: Record<string, BinOp> = {
    '+=': '+', '-=': '-', '*=': '*', '/=': '/', '%=': '%', '&=': '&', '|=': '|', '^=': '^', '<<=': '<<', '>>=': '>>',
  }; // prettier-ignore

  assign(): Expr {
    const lhs = this.conditional();
    const t = this.tok;
    if (t.kind !== 'punct') return lhs;
    if (t.text === '=') {
      this.next();
      const rhs = this.assign();
      this.checkLvalue(lhs, 'the left side of =');
      const r = this.convertAssign(lhs.type, rhs, 'assignment');
      return this.mkExpr({ kind: 'assign', lhs, rhs: r, type: unqualified(lhs.type) }, span(lhs.loc, rhs.loc), this.line(t));
    }
    const op = Parser.ASSIGN_OPS[t.text];
    if (!op) return lhs;
    this.next();
    const rhs0 = this.assign();
    this.checkLvalue(lhs, `the left side of ${t.text}`);
    const rhs = this.rv(rhs0);
    const lt = unqualified(lhs.type);
    const loc = span(lhs.loc, rhs.loc);
    if (lt.kind === 'ptr' && (op === '+' || op === '-')) {
      if (!isInteger(rhs.type)) this.fail(rhs.loc, `cannot ${op === '+' ? 'add' : 'subtract'} '${typeName(rhs.type)}' to a pointer`);
      const scale = this.elemSize(lt, t);
      return this.mkExpr({ kind: 'opassign', op, lhs, rhs: this.cast(rhs, ty.int), opType: lt, scale, type: lt }, loc, this.line(t));
    }
    if (!isInteger(lt) || !isInteger(rhs.type)) {
      this.fail(loc, `invalid operands to ${t.text} ('${typeName(lhs.type)}' and '${typeName(rhs.type)}')`);
    }
    if (op === '<<' || op === '>>') {
      const opType = promote(lt);
      return this.mkExpr({ kind: 'opassign', op, lhs, rhs: this.cast(rhs, ty.int), opType, scale: 1, type: lt }, loc, this.line(t));
    }
    const opType = commonType(lt, rhs.type);
    if ((op === '/' || op === '%') && this.evalConst(rhs) === 0n) this.diags.warn(rhs.loc, 'division by zero');
    return this.mkExpr({ kind: 'opassign', op, lhs, rhs: this.cast(rhs, opType), opType, scale: 1, type: lt }, loc, this.line(t));
  }

  private conditional(): Expr {
    const c = this.logor();
    if (!this.is('?')) return c;
    const q = this.next();
    const cond = this.condExpr(c);
    let a: Expr;
    let cnd = cond;
    if (this.is(':')) {
      // GNU a ?: b: evaluate a once
      if (cond.kind === 'var' || cond.kind === 'num' || !this.fn) a = cond;
      else {
        const tmp = this.tempLocal(unqualified(cond.type), q);
        const tv = this.varExpr(tmp, q);
        const set = this.mkExpr({ kind: 'assign', lhs: tv, rhs: cond, type: tv.type }, cond.loc, cond.line);
        cnd = this.mkExpr({ kind: 'comma', lhs: set, rhs: tv, type: tv.type }, cond.loc, cond.line);
        a = tv;
      }
    } else a = this.rv(this.expr());
    this.expect(':', "in the '?:' expression");
    const b = this.rv(this.conditional());
    const loc = span(c.loc, b.loc);
    let t: Type;
    if (isInteger(a.type) && isInteger(b.type)) {
      t = commonType(a.type, b.type);
      a = this.cast(a, t);
      return this.foldCond(cnd, a, this.cast(b, t), t, loc, q);
    }
    if (a.type.kind === 'void' || b.type.kind === 'void') {
      t = ty.void;
    } else if (a.type.kind === 'ptr' && b.type.kind === 'ptr') {
      const av = (a.type.base ?? ty.void).kind === 'void';
      const bv = (b.type.base ?? ty.void).kind === 'void';
      t = av ? a.type : bv ? b.type : a.type;
      if (!sameType(a.type, b.type) && a.type.base?.kind !== 'void' && b.type.base?.kind !== 'void')
        this.diags.warn(loc, `pointer type mismatch in '?:' ('${typeName(a.type)}' and '${typeName(b.type)}')`);
    } else if (a.type.kind === 'ptr' && isInteger(b.type)) {
      if (!this.isNullConst(b)) this.diags.warn(b.loc, "pointer/integer type mismatch in '?:'");
      t = a.type;
    } else if (b.type.kind === 'ptr' && isInteger(a.type)) {
      if (!this.isNullConst(a)) this.diags.warn(a.loc, "pointer/integer type mismatch in '?:'");
      t = b.type;
    } else if (isRecord(a.type) && sameType(unqualified(a.type), unqualified(b.type))) {
      t = unqualified(a.type);
      return this.mkExpr({ kind: 'cond', cond: cnd, then: a, else: b, type: t }, loc, this.line(q));
    } else {
      this.fail(loc, `incompatible operand types in '?:' ('${typeName(a.type)}' and '${typeName(b.type)}')`);
    }
    return this.foldCond(cnd, t.kind === 'void' ? a : this.cast(a, t), t.kind === 'void' ? b : this.cast(b, t), t, loc, q);
  }

  private foldCond(cond: Expr, a: Expr, b: Expr, t: Type, loc: Loc, q: Token): Expr {
    const c = cond.kind === 'num' ? cond.value : undefined;
    if (c !== undefined && a.kind === 'num' && b.kind === 'num') return c !== 0n ? { ...a, loc } : { ...b, loc };
    return this.mkExpr({ kind: 'cond', cond, then: a, else: b, type: t }, loc, this.line(q));
  }

  private logor(): Expr {
    let e = this.logand();
    while (this.is('||')) {
      const op = this.next();
      const l = this.condExpr(e);
      const r = this.condExpr(this.logand());
      e = this.foldLogic('logor', l, r, op);
    }
    return e;
  }

  private logand(): Expr {
    let e = this.bitor();
    while (this.is('&&')) {
      const op = this.next();
      const l = this.condExpr(e);
      const r = this.condExpr(this.bitor());
      e = this.foldLogic('logand', l, r, op);
    }
    return e;
  }

  private foldLogic(kind: 'logand' | 'logor', l: Expr, r: Expr, op: Token): Expr {
    const loc = span(l.loc, r.loc);
    const lv = this.evalConst(l);
    const rv = this.evalConst(r);
    if (lv !== undefined && rv !== undefined) {
      const v = kind === 'logand' ? lv !== 0n && rv !== 0n : lv !== 0n || rv !== 0n;
      return this.num(v ? 1n : 0n, ty.int, loc);
    }
    return this.mkExpr({ kind, lhs: l, rhs: r, type: ty.int }, loc, this.line(op));
  }

  private binLevel(ops: string[], sub: () => Expr): Expr {
    let e = sub();
    for (;;) {
      const t = this.tok;
      if (t.kind !== 'punct' || !ops.includes(t.text)) return e;
      this.next();
      const r = sub();
      e = this.binary(t.text as BinOp, e, r, t);
    }
  }

  private bitor(): Expr {
    return this.binLevel(['|'], () => this.bitxor());
  }
  private bitxor(): Expr {
    return this.binLevel(['^'], () => this.bitand());
  }
  private bitand(): Expr {
    return this.binLevel(['&'], () => this.equality());
  }
  private equality(): Expr {
    return this.binLevel(['==', '!='], () => this.relational());
  }
  private relational(): Expr {
    return this.binLevel(['<', '<=', '>', '>='], () => this.shift());
  }
  private shift(): Expr {
    return this.binLevel(['<<', '>>'], () => this.additive());
  }
  private additive(): Expr {
    return this.binLevel(['+', '-'], () => this.multiplicative());
  }
  private multiplicative(): Expr {
    return this.binLevel(['*', '/', '%'], () => this.castExpr());
  }

  private elemSize(pt: Type, at: Loc): number {
    const b = pt.base ?? ty.void;
    if (b.kind === 'void') return 1; // GNU: void * arithmetic in bytes
    if (b.kind === 'func') return 1;
    if (!isComplete(b)) this.diags.error(at, `arithmetic on a pointer to an incomplete type '${typeName(b)}'`);
    return sizeOf(b) || 1;
  }

  /** Build a typed binary expression (also used for compound assignment checks). */
  binary(op: BinOp, l0: Expr, r0: Expr, at: Token): Expr {
    const l = this.rv(l0);
    const r = this.rv(r0);
    const loc = span(l.loc, r.loc);
    const line = this.line(at);
    const bad = (): never =>
      this.fail(loc, `invalid operands to '${op}' ('${typeName(l.type)}' and '${typeName(r.type)}')`);
    if (l.type.kind === 'void' || r.type.kind === 'void') this.fail(loc, `a 'void' value cannot be used with '${op}'`);
    // pointer arithmetic
    if (op === '+' || op === '-') {
      if (l.type.kind === 'ptr' && isInteger(r.type)) {
        return this.mkExpr({ kind: 'padd', ptr: l, idx: this.cast(r, ty.int), scale: this.elemSize(l.type, at), neg: op === '-', type: l.type }, loc, line);
      }
      if (op === '+' && isInteger(l.type) && r.type.kind === 'ptr') {
        return this.mkExpr({ kind: 'padd', ptr: r, idx: this.cast(l, ty.int), scale: this.elemSize(r.type, at), neg: false, type: r.type }, loc, line);
      }
      if (op === '-' && l.type.kind === 'ptr' && r.type.kind === 'ptr') {
        if (!sameType(unqualified(l.type.base ?? ty.void), unqualified(r.type.base ?? ty.void)))
          this.diags.error(loc, `cannot subtract pointers to different types ('${typeName(l.type)}' and '${typeName(r.type)}')`);
        return this.mkExpr({ kind: 'pdiff', lhs: l, rhs: r, scale: this.elemSize(l.type, at), type: ty.int }, loc, line);
      }
    }
    if (op === '==' || op === '!=' || op === '<' || op === '<=' || op === '>' || op === '>=') {
      if (l.type.kind === 'ptr' || r.type.kind === 'ptr') {
        if (l.type.kind === 'ptr' && r.type.kind === 'ptr') {
          const a = l.type.base ?? ty.void;
          const b = r.type.base ?? ty.void;
          if (a.kind !== 'void' && b.kind !== 'void' && !sameType(unqualified(a), unqualified(b)))
            this.diags.warn(loc, `comparison of different pointer types ('${typeName(l.type)}' and '${typeName(r.type)}')`);
        } else if (isInteger(l.type) || isInteger(r.type)) {
          const other = l.type.kind === 'ptr' ? r : l;
          if (!this.isNullConst(other)) this.diags.warn(loc, 'comparison between a pointer and an integer');
        } else bad();
        const pt = l.type.kind === 'ptr' ? l.type : r.type;
        return this.mkExpr({ kind: 'binary', op, lhs: this.cast(l, pt), rhs: this.cast(r, pt), type: ty.int }, loc, line);
      }
      if (!isInteger(l.type) || !isInteger(r.type)) bad();
      const t = commonType(l.type, r.type);
      return this.fold(this.mkExpr({ kind: 'binary', op, lhs: this.cast(l, t), rhs: this.cast(r, t), type: ty.int }, loc, line));
    }
    if (!isInteger(l.type) || !isInteger(r.type)) bad();
    if (op === '<<' || op === '>>') {
      const t = promote(l.type);
      return this.fold(this.mkExpr({ kind: 'binary', op, lhs: this.cast(l, t), rhs: this.cast(r, ty.int), type: t }, loc, line));
    }
    const t = commonType(l.type, r.type);
    if ((op === '/' || op === '%') && this.evalConst(r) === 0n) this.diags.warn(r.loc, 'division by zero');
    return this.fold(this.mkExpr({ kind: 'binary', op, lhs: this.cast(l, t), rhs: this.cast(r, t), type: t }, loc, line));
  }

  private fold(e: Expr): Expr {
    if (e.kind === 'binary' && e.lhs.kind === 'num' && e.rhs.kind === 'num') {
      if ((e.op === '/' || e.op === '%') && e.rhs.value === 0n) return e;
      const v = this.evalConst(e);
      if (v !== undefined) return { kind: 'num', value: v, type: e.type, loc: e.loc, line: e.line };
    }
    return e;
  }

  private castExpr(): Expr {
    if (this.is('(') && this.isTypeStart(this.peek())) {
      const open = this.tok;
      const save = this.pos;
      this.next();
      const t = this.typeName();
      this.expect(')', 'to close the cast');
      if (this.is('{')) {
        // compound literal
        this.pos = save;
        return this.postfixOps(this.unary());
      }
      const e0 = this.castExpr();
      const e = this.rv(e0);
      const loc = span(open, e0.loc);
      if (t.kind === 'void') return this.mkExpr({ kind: 'cast', operand: e, type: ty.void }, loc, this.line(open));
      if (!isScalar(t)) this.fail(loc, `cannot cast to '${typeName(t)}' (only numbers and pointers can be cast)`);
      if (!isScalar(e.type)) this.fail(loc, `cannot cast '${typeName(e.type)}' to '${typeName(t)}'`);
      if (t.kind === 'bool' && e.type.kind === 'ptr') return this.toBool(e);
      const c = this.cast(e, t);
      if (c === e) return { kind: 'cast', operand: e, type: unqualified(t), loc, line: this.line(open) };
      return { ...c, loc };
    }
    return this.unary();
  }

  private unary(): Expr {
    const t = this.tok;
    const line = this.line(t);
    if (t.kind === 'punct') {
      switch (t.text) {
        case '+': {
          this.next();
          const e = this.rv(this.castExpr());
          if (!isInteger(e.type)) this.fail(e.loc, `invalid operand to unary '+' ('${typeName(e.type)}')`);
          return this.cast(e, promote(e.type));
        }
        case '-': {
          this.next();
          const e0 = this.castExpr();
          const e = this.rv(e0);
          if (!isInteger(e.type)) this.fail(e.loc, `invalid operand to unary '-' ('${typeName(e.type)}')`);
          const pt = promote(e.type);
          const c = this.cast(e, pt);
          if (c.kind === 'num') return this.num(-c.value, pt, span(t, e0.loc));
          return this.mkExpr({ kind: 'neg', operand: c, type: pt }, span(t, e0.loc), line);
        }
        case '~': {
          this.next();
          const e0 = this.castExpr();
          const e = this.rv(e0);
          if (!isInteger(e.type)) this.fail(e.loc, `invalid operand to '~' ('${typeName(e.type)}')`);
          const pt = promote(e.type);
          const c = this.cast(e, pt);
          if (c.kind === 'num') return this.num(~c.value, pt, span(t, e0.loc));
          return this.mkExpr({ kind: 'bitnot', operand: c, type: pt }, span(t, e0.loc), line);
        }
        case '!': {
          this.next();
          const e0 = this.castExpr();
          const e = this.condExpr(e0);
          if (e.kind === 'num') return this.num(e.value === 0n ? 1n : 0n, ty.int, span(t, e0.loc));
          return this.mkExpr({ kind: 'lognot', operand: e, type: ty.int }, span(t, e0.loc), line);
        }
        case '&': {
          this.next();
          const e = this.castExpr();
          const loc = span(t, e.loc);
          if (e.kind === 'member' && e.member.bitWidth !== undefined) this.fail(loc, `cannot take the address of bit-field '${e.member.name}'`);
          if (!this.isLvalue(e) && e.type.kind !== 'func') this.fail(loc, "'&' needs a variable, array element, struct member or function");
          if (e.kind === 'var' && e.obj.asmReg) this.diags.error(loc, `cannot take the address of register variable '${e.obj.name}'`);
          return this.mkExpr({ kind: 'addr', operand: e, type: pointerTo(e.type) }, loc, line);
        }
        case '*': {
          this.next();
          const e0 = this.castExpr();
          return this.deref(e0, span(t, e0.loc), line);
        }
        case '++':
        case '--': {
          this.next();
          const e = this.unary();
          return this.incdec(e, t.text === '++' ? 1 : -1, true, span(t, e.loc), line);
        }
      }
    }
    if (t.kind === 'ident') {
      if (t.text === 'sizeof') {
        this.next();
        let st: Type;
        let end: Loc;
        if (this.is('(') && this.isTypeStart(this.peek())) {
          this.next();
          st = this.typeName();
          end = this.expect(')', "to close 'sizeof('");
          if (this.is('{')) {
            // sizeof (type){...}: compound literal
            this.pos -= 1;
            while (!this.is('(')) this.pos--;
            const e = this.postfixOps(this.unary());
            st = e.type;
            end = e.loc;
          }
        } else {
          const e = this.unary();
          st = e.type;
          end = e.loc;
          if (e.kind === 'member' && e.member.bitWidth !== undefined) this.diags.error(e.loc, 'sizeof cannot be applied to a bit-field');
        }
        const loc = span(t, end);
        if (st.kind === 'func') this.diags.error(loc, 'sizeof cannot be applied to a function');
        else if (st.kind === 'void') return this.num(1n, ty.uint, loc);
        else if (!isComplete(st)) this.diags.error(loc, `sizeof cannot be applied to incomplete type '${typeName(st)}'`);
        return this.num(BigInt(sizeOf(st)), ty.uint, loc);
      }
      if (t.text === '_Alignof') {
        this.next();
        let at: Type;
        if (this.is('(') && this.isTypeStart(this.peek())) {
          this.next();
          at = this.typeName();
          this.expect(')');
        } else at = this.unary().type;
        return this.num(BigInt(alignOf(at)), ty.uint, span(t, this.prev()));
      }
    }
    return this.postfix();
  }

  deref(e0: Expr, loc: Loc, line: number): Expr {
    const e = this.rv(e0);
    if (e.type.kind !== 'ptr') this.fail(loc, `cannot dereference '${typeName(e.type)}': it is not a pointer`);
    const b = e.type.base ?? ty.void;
    if (b.kind === 'func') return e; // *fp is fp
    if (b.kind === 'void') this.diags.error(loc, "cannot dereference a 'void *' pointer (cast it to a pointer type first)");
    return this.mkExpr({ kind: 'deref', operand: e, type: b }, loc, line);
  }

  private incdec(e: Expr, dir: number, pre: boolean, loc: Loc, line: number): Expr {
    this.checkLvalue(e, dir > 0 ? "'++'" : "'--'");
    const t = unqualified(e.type);
    let delta = dir;
    if (t.kind === 'ptr') delta = dir * this.elemSize(t, loc);
    else if (!isInteger(t)) this.fail(loc, `cannot ${dir > 0 ? 'increment' : 'decrement'} '${typeName(t)}'`);
    return this.mkExpr({ kind: 'incdec', lhs: e, delta, pre, type: t }, loc, line);
  }

  private postfix(): Expr {
    // compound literal
    if (this.is('(') && this.isTypeStart(this.peek())) {
      const open = this.next();
      const t = this.typeName();
      this.expect(')');
      if (!this.is('{')) this.fail(this.tok, "expected '{' for a compound literal");
      const init = this.newInit(t, true);
      this.initializer(init);
      let vt = t;
      if (init.flexible) vt = arrayOf(t.base ?? ty.int, init.children?.length ?? 0);
      else if (init.type !== t) vt = init.type;
      if (!this.fn) {
        const g = this.newObj(`__compound.${this.uniq++}`, vt, open, false);
        g.isStatic = true;
        g.isDefinition = true;
        g.isLiteral = false;
        g.asmName = `.Lcompound${this.uniq++}`;
        this.globals.push(g);
        g.init = this.globalInitData({ ...init, type: vt }, g);
        return this.postfixOps(this.varExpr(g, open));
      }
      const o = this.tempLocal(vt, open);
      const stmts = this.lowerLocalInit({ ...init, type: vt }, o, open);
      return this.postfixOps(this.mkExpr({ kind: 'initvar', obj: o, init: stmts, type: vt }, span(open, this.prev()), this.line(open)));
    }
    return this.postfixOps(this.primary());
  }

  private postfixOps(e: Expr): Expr {
    for (;;) {
      const t = this.tok;
      if (t.kind !== 'punct') return e;
      if (t.text === '[') {
        this.next();
        const idx = this.expr();
        const close = this.expect(']', 'to close the array index');
        const loc = span(e.loc, close);
        const a = this.rv(e);
        const b = this.rv(idx);
        let sum: Expr;
        if (a.type.kind === 'ptr' && isInteger(b.type)) sum = this.binary('+', a, b, t);
        else if (b.type.kind === 'ptr' && isInteger(a.type)) sum = this.binary('+', b, a, t);
        else if (a.type.kind !== 'ptr' && b.type.kind !== 'ptr')
          this.fail(loc, `cannot index '${typeName(e.type)}': it is not an array or pointer`);
        else this.fail(idx.loc, `array index must be an integer, not '${typeName(b.type)}'`);
        e = this.deref(sum, loc, this.line(t));
        if (e.kind === 'deref') e = { ...e, loc };
        continue;
      }
      if (t.text === '.' || t.text === '->') {
        this.next();
        const nameTok = this.next();
        if (nameTok.kind !== 'ident') this.fail(nameTok, `expected a member name after '${t.text}'`);
        let base = e;
        if (t.text === '->') {
          const p = this.rv(e);
          if (p.type.kind !== 'ptr' || !isRecord(p.type.base ?? ty.void)) {
            if (isRecord(e.type)) this.fail(t, `'${typeName(e.type)}' is a struct, not a pointer: use '.' instead of '->'`);
            this.fail(span(e.loc, nameTok), `'->' needs a pointer to a struct or union, not '${typeName(e.type)}'`);
          }
          base = this.deref(p, e.loc, e.line);
        } else if (!isRecord(e.type)) {
          if (e.type.kind === 'ptr' && isRecord(e.type.base ?? ty.void))
            this.fail(t, `'${typeName(e.type)}' is a pointer: use '->' instead of '.'`);
          this.fail(span(e.loc, nameTok), `'.' needs a struct or union, not '${typeName(e.type)}'`);
        }
        e = this.memberAccess(base, nameTok, span(e.loc, nameTok));
        continue;
      }
      if (t.text === '++' || t.text === '--') {
        this.next();
        e = this.incdec(e, t.text === '++' ? 1 : -1, false, span(e.loc, t), this.line(t));
        continue;
      }
      if (t.text === '(') {
        e = this.call(e);
        continue;
      }
      return e;
    }
  }

  private memberAccess(base: Expr, nameTok: Token, loc: Loc): Expr {
    const rec = base.type.rec;
    if (!rec || !rec.complete) this.fail(loc, `'${typeName(base.type)}' is incomplete, so its members are unknown`);
    const path = findMember(rec, nameTok.text);
    if (!path) this.fail(nameTok, `'${typeName(base.type)}' has no member named '${nameTok.text}'`);
    let e = base;
    for (const m of path) {
      let mt = m.type;
      if (m.bitWidth !== undefined) mt = { ...mt, bitWidth: m.bitWidth };
      if (e.type.isConst || e.type.isVolatile) mt = qualified(mt, { ...(e.type.isConst ? { isConst: true } : {}), ...(e.type.isVolatile ? { isVolatile: true } : {}) });
      e = this.mkExpr({ kind: 'member', base: e, member: m, type: mt }, loc, this.line(nameTok));
    }
    return e;
  }

  private call(callee0: Expr): Expr {
    const open = this.next();
    // builtins that look like functions
    if (callee0.kind === 'var' && callee0.obj.name.startsWith('__builtin_') && callee0.obj.isFunction && callee0.obj.attrs.used === undefined && this.builtinNames.has(callee0.obj.name)) {
      return this.builtinCall(callee0.obj.name, callee0, open);
    }
    const callee = this.rv(callee0);
    let ft: Type | undefined;
    if (callee.type.kind === 'ptr' && callee.type.base?.kind === 'func') ft = callee.type.base;
    if (!ft) this.fail(callee0.loc, `called object is not a function or function pointer (it has type '${typeName(callee0.type)}')`);
    const args: Expr[] = [];
    if (!this.is(')')) {
      for (;;) {
        args.push(this.assign());
        if (!this.consume(',')) break;
      }
    }
    const close = this.expect(')', 'to close the argument list');
    const loc = span(callee0.loc, close);
    const params = ft.params ?? [];
    const fname = callee0.kind === 'var' ? `'${callee0.obj.name}'` : 'function';
    if (!ft.oldStyle) {
      if (args.length < params.length)
        this.diags.error(loc, `too few arguments to ${fname} (expected ${params.length}${ft.variadic ? ' or more' : ''}, have ${args.length})`);
      else if (args.length > params.length && !ft.variadic)
        this.diags.error(args[params.length]?.loc ?? loc, `too many arguments to ${fname} (expected ${params.length}, have ${args.length})`);
    }
    const conv = args.map((a, i) => {
      const p = params[i];
      if (p) return this.convertAssign(p.type, a, `argument ${i + 1} of ${fname}`);
      // default argument promotions
      const r = this.rv(a);
      if (r.type.kind === 'void') this.diags.error(r.loc, `a 'void' value cannot be passed to ${fname}`);
      if (isInteger(r.type)) return this.cast(r, promote(r.type));
      return r;
    });
    const ret = ft.ret ?? ty.int;
    if (isRecord(ret) && !isComplete(ret)) this.diags.error(loc, `calling ${fname} with incomplete return type '${typeName(ret)}'`);
    if (callee0.kind === 'var' && ft.variadic) this.checkFormat(callee0.obj.name, args);
    const direct = callee0.kind === 'var' && callee0.obj.isFunction ? callee0.obj : undefined;
    return this.mkExpr({ kind: 'call', callee, args: conv, fnType: ft, ...(direct ? { direct } : {}), type: unqualified(ret) }, loc, this.line(open));
  }

  /** gcc -Wformat for the printf family: argument count and types. */
  private checkFormat(name: string, args: Expr[]): void {
    const fi = ({ printf: 0, sprintf: 1, snprintf: 2, fprintf: 1, dprintf: 1 } as Record<string, number>)[name];
    if (fi === undefined) return;
    let f = args[fi];
    while (f && f.kind === 'cast') f = f.operand;
    if (!f || f.kind !== 'var' || !f.obj.isLiteral || !f.obj.init) return;
    const fmt = String.fromCharCode(...f.obj.init.bytes.subarray(0, -1));
    let ai = fi + 1;
    const at = (i: number): Loc => args[i]?.loc ?? f.loc;
    const argType = (i: number): Type | undefined => {
      const a = args[i];
      return a ? this.rv(a).type : undefined;
    };
    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] !== '%') continue;
      let j = i + 1;
      while ('-+ #0'.includes(fmt[j] ?? 'x') && j < fmt.length) j++;
      const star = (): void => {
        if (fmt[j] === '*') {
          const t = argType(ai);
          if (!t) this.diags.warn(f.loc, `'*' in format '${fmt.slice(i, j + 1)}' needs an int argument`);
          else if (!isInteger(t)) this.diags.warn(at(ai), `'*' in the format expects an int, but argument ${ai + 1} has type '${typeName(t)}'`);
          ai++;
          j++;
        } else while (/[0-9]/.test(fmt[j] ?? '')) j++;
      };
      star();
      if (fmt[j] === '.') {
        j++;
        star();
      }
      let len = '';
      while (/[hlzjt]/.test(fmt[j] ?? '')) len += fmt[j++];
      const conv = fmt[j] ?? '';
      const spec = fmt.slice(i, j + 1);
      i = j;
      if (conv === '%') continue;
      if ('fFeEgGaA'.includes(conv) && conv) {
        this.diags.warn(f.loc, `format '${spec}' needs floating point, which this compiler does not support`);
        ai++;
        continue;
      }
      const t = argType(ai);
      if (!t) {
        this.diags.warn(f.loc, `too few arguments for format: '${spec}' has no matching argument`);
        return;
      }
      const tn = typeName(t);
      const bad = (want: string): void =>
        this.diags.warn(at(ai), `format '${spec}' expects ${want}, but argument ${ai + 1} has type '${tn}'`);
      if ('diuxXoc'.includes(conv) && conv) {
        const wantLL = len === 'll' || len === 'j';
        if (!isInteger(t)) bad(conv === 'c' ? "a character ('int')" : wantLL ? "'long long'" : len === 'l' ? "'long'" : "'int'");
        else if (wantLL !== (t.kind === 'llong')) bad(wantLL ? "'long long'" : len === 'l' ? "'long'" : "'int'");
      } else if (conv === 's') {
        if (t.kind !== 'ptr' || !isInteger(t.base ?? ty.void) || sizeOf(t.base ?? ty.void) !== 1) bad("a string ('char *')");
      } else if (conv === 'p' || conv === 'n') {
        if (t.kind !== 'ptr') bad("a pointer ('void *')");
      } else {
        this.diags.warn(f.loc, `unknown conversion '${spec}' in format`);
      }
      ai++;
    }
    if (ai < args.length) this.diags.warn(at(ai), 'too many arguments for format');
  }

  private builtinNames = new Set([
    '__builtin_va_start', '__builtin_va_end', '__builtin_va_arg', '__builtin_va_copy', '__builtin_offsetof',
    '__builtin_expect', '__builtin_unreachable', '__builtin_trap', '__builtin_constant_p', '__builtin_types_compatible_p',
  ]); // prettier-ignore

  private builtinCall(name: string, callee: Expr, open: Token): Expr {
    const loc = (): Loc => span(callee.loc, this.prev());
    switch (name) {
      case '__builtin_va_start': {
        const ap = this.assign();
        if (this.consume(',')) this.assign();
        this.expect(')');
        const fn = this.fn;
        if (!fn || !fn.type.variadic) this.diags.error(loc(), "va_start can only be used in a function with '...' parameters");
        if (fn) fn.usesVarargs = true;
        this.checkLvalue(ap, 'the va_list argument of va_start');
        return this.mkExpr({ kind: 'vastart', ap, type: ty.void }, loc(), this.line(open));
      }
      case '__builtin_va_end': {
        this.assign();
        this.expect(')');
        return this.mkExpr({ kind: 'nop', type: ty.void }, loc(), this.line(open));
      }
      case '__builtin_va_copy': {
        const dst = this.assign();
        this.expect(',');
        const src = this.rv(this.assign());
        this.expect(')');
        this.checkLvalue(dst, 'the destination of va_copy');
        return this.mkExpr({ kind: 'vacopy', dst, src, type: ty.void }, loc(), this.line(open));
      }
      case '__builtin_va_arg': {
        const ap = this.assign();
        this.expect(',');
        const t = this.typeName();
        this.expect(')');
        this.checkLvalue(ap, 'the va_list argument of va_arg');
        if (isInteger(t) && sizeOf(t) < 4)
          this.diags.warn(loc(), `'${typeName(t)}' is promoted to 'int' when passed through '...'; use va_arg(ap, int)`);
        return this.mkExpr({ kind: 'vaarg', ap, type: unqualified(t) }, loc(), this.line(open));
      }
      case '__builtin_offsetof': {
        const t = this.typeName();
        this.expect(',');
        let off = 0;
        let cur = t;
        for (;;) {
          const id = this.next();
          if (id.kind !== 'ident' || !cur.rec) this.fail(id, 'offsetof expects a member name');
          const path = findMember(cur.rec, id.text);
          if (!path) this.fail(id, `'${typeName(cur)}' has no member named '${id.text}'`);
          for (const m of path) {
            off += m.offset;
            cur = m.type;
          }
          while (this.consume('[')) {
            const i = Number(this.constExpr());
            this.expect(']');
            if (cur.kind !== 'array') this.fail(this.prev(), 'offsetof: subscript of a non-array member');
            off += i * sizeOf(cur.base ?? ty.int);
            cur = cur.base ?? ty.int;
          }
          if (!this.consume('.')) break;
        }
        this.expect(')');
        return this.num(BigInt(off), ty.uint, loc());
      }
      case '__builtin_expect': {
        const e = this.assign();
        this.expect(',');
        this.assign();
        this.expect(')');
        return this.rv(e);
      }
      case '__builtin_constant_p': {
        const e = this.assign();
        this.expect(')');
        return this.num(this.evalConst(e) !== undefined ? 1n : 0n, ty.int, loc());
      }
      case '__builtin_types_compatible_p': {
        const a = this.typeName();
        this.expect(',');
        const b = this.typeName();
        this.expect(')');
        return this.num(sameType(unqualified(a), unqualified(b)) ? 1n : 0n, ty.int, loc());
      }
      case '__builtin_unreachable':
        this.expect(')');
        return this.mkExpr({ kind: 'nop', type: ty.void }, loc(), this.line(open));
      case '__builtin_trap':
        this.expect(')');
        return this.mkExpr({ kind: 'stmtexpr', body: [{ kind: 'asm', template: 'ebreak', outputs: [], inputs: [], clobbers: [], labels: [], loc: open, line: this.line(open) }], type: ty.void }, loc(), this.line(open));
    }
    this.fail(open, `unknown builtin '${name}'`);
  }

  private varExpr(obj: Obj, t: Token): Expr {
    if (this.fn && !obj.isLocal) this.fn.refs?.add(obj);
    return { kind: 'var', obj, type: obj.type, loc: t, line: this.line(t) };
  }

  private builtinFn(name: string): Obj {
    let o = this.globalByName.get(name);
    if (!o) {
      o = this.newObj(name, funcType(ty.int, [], true, true), this.tok, false);
      this.globalByName.set(name, o);
    }
    return o;
  }

  private primary(): Expr {
    const t = this.tok;
    const line = this.line(t);
    if (t.kind === 'punct' && t.text === '(') {
      this.next();
      if (this.is('{')) {
        if (!this.fn) this.fail(t, 'statement expressions are only allowed inside functions');
        const body = this.compound();
        this.expect(')', "to close '({ ... })'");
        const stmts = body.kind === 'block' ? body.stmts : [body];
        const last = stmts[stmts.length - 1];
        let result: Expr | undefined;
        if (last && last.kind === 'expr') {
          stmts.pop();
          result = this.rv(last.expr);
        }
        return this.mkExpr({ kind: 'stmtexpr', body: stmts, ...(result ? { result } : {}), type: result?.type ?? ty.void }, span(t, this.prev()), line);
      }
      const e = this.expr();
      const close = this.expect(')', "to close '('");
      return { ...e, loc: span(t, close), paren: true };
    }
    if (t.kind === 'num') {
      this.next();
      return this.numberLiteral(t);
    }
    if (t.kind === 'char') {
      this.next();
      const q = t.text.indexOf("'");
      const prefix = t.text.slice(0, q);
      const bytes = decodeLiteral(t.text.slice(q + 1, -1), (m) => this.diags.error(t, m));
      if (bytes.length === 0) this.fail(t, "empty character constant ''");
      if (prefix) {
        const cp = [...new TextDecoder().decode(new Uint8Array(bytes))][0]?.codePointAt(0) ?? 0;
        return this.num(BigInt(cp), ty.int, t);
      }
      if (bytes.length > 1) {
        if (bytes.length > 4) this.diags.error(t, 'character constant too long');
        else this.diags.warn(t, 'multi-character character constant');
        let v = 0n;
        for (const b of bytes) v = (v << 8n) | BigInt(b);
        return this.num(v, ty.int, t);
      }
      const b = bytes[0] ?? 0;
      return this.num(BigInt(ty.char.unsigned ? b : b >= 128 ? b - 256 : b), ty.int, t);
    }
    if (t.kind === 'str') {
      const first = this.tok;
      const prefix = first.text.slice(0, first.text.indexOf('"'));
      const bytes = this.stringBytes();
      const end = this.prev();
      if (prefix === 'L' || prefix === 'U' || prefix === 'u') {
        const chars = [...new TextDecoder().decode(new Uint8Array(bytes))].map((c) => c.codePointAt(0) ?? 0);
        const et = prefix === 'u' ? ty.ushort : ty.int;
        return this.varExpr(this.stringLiteral(chars, first, et), first) && { ...this.varExpr(this.stringLiteral(chars, first, et), first), loc: span(first, end) };
      }
      const g = this.stringLiteral(bytes, first, ty.char);
      return { ...this.varExpr(g, first), loc: span(first, end) };
    }
    if (t.kind === 'ident') {
      if (KEYWORDS.has(t.text)) {
        this.fail(t, `expected an expression, found '${t.text}'`);
      }
      this.next();
      const e = this.lookup(t.text);
      if (!e && this.fn && (t.text === '__func__' || t.text === '__FUNCTION__')) {
        const g = this.stringLiteral([...this.fn.name].map((c) => c.charCodeAt(0)), t, ty.char);
        return this.varExpr(g, t);
      }
      if (e?.kind === 'enumconst') return this.num(e.value, e.type, t);
      if (e?.kind === 'var') return this.varExpr(e.obj, t);
      if (e?.kind === 'typedef') this.fail(t, `'${t.text}' is a type name, not a value`);
      if (this.builtinNames.has(t.text)) {
        return this.varExpr(this.builtinFn(t.text), t);
      }
      if (this.is('(')) {
        if (t.text.startsWith('__builtin_')) {
          const real = t.text.slice('__builtin_'.length);
          const f = this.lookup(real);
          if (f?.kind === 'var') return this.varExpr(f.obj, t);
        }
        this.diags.error(t, `call to undeclared function '${t.text}'; declare it first or #include the header that declares it`);
        // declare it implicitly as int f() to keep going
        const f = this.newObj(t.text, funcType(ty.int, [], false, true), t, false);
        this.functions.push(f);
        this.globalByName.set(t.text, f);
        this.scopes[0]?.vars.set(t.text, { kind: 'var', obj: f });
        return this.varExpr(f, t);
      }
      this.diags.error(t, `undeclared identifier '${t.text}'`);
      // declare a dummy so the same name is reported once
      const dummy = this.newObj(t.text, ty.int, t, true);
      this.scope.vars.set(t.text, { kind: 'var', obj: dummy });
      if (this.fn) this.fn.locals?.push(dummy);
      else throw new Bail();
      return this.varExpr(dummy, t);
    }
    if (t.kind === 'eof') this.fail(t, 'expected an expression, but the file ended');
    this.fail(t, `expected an expression, found '${t.text}'`);
  }

  private numberLiteral(t: Token): Expr {
    const text = t.text;
    const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|0[0-7]*|[1-9][0-9]*)([uU]?(?:ll|LL|l|L)?|(?:ll|LL|l|L)[uU]?)$/.exec(text);
    if (!m) {
      if (/[.eEpP]/.test(text) && !/^0[xX]/.test(text)) {
        this.diags.error(t, 'floating-point numbers are not supported by this compiler');
        return this.num(0n, ty.int, t);
      }
      if (/^0[0-7]*[89]/.test(text)) this.diags.error(t, `invalid digit in octal constant '${text}'`);
      else this.diags.error(t, `invalid number '${text}'`);
      return this.num(0n, ty.int, t);
    }
    const digits = m[1] as string;
    const suffix = (m[2] ?? '').toLowerCase();
    let v: bigint;
    if (/^0[0-7]+$/.test(digits)) v = BigInt('0o' + digits.slice(1));
    else v = BigInt(digits);
    const dec = /^[1-9]/.test(digits) || digits === '0';
    const u = suffix.includes('u');
    const ll = suffix.includes('ll');
    const l = !ll && suffix.includes('l');
    let cands: Type[];
    if (ll) cands = u ? [ty.ullong] : dec ? [ty.llong] : [ty.llong, ty.ullong];
    else if (l) cands = u ? [ty.ulong, ty.ullong] : dec ? [ty.long, ty.llong] : [ty.long, ty.ulong, ty.llong, ty.ullong];
    else cands = u ? [ty.uint, ty.ullong] : dec ? [ty.int, ty.long, ty.llong] : [ty.int, ty.uint, ty.long, ty.ulong, ty.llong, ty.ullong];
    for (const c of cands) {
      const max = c.size === 8 ? (c.unsigned ? 0xffffffffffffffffn : 0x7fffffffffffffffn) : c.unsigned ? 0xffffffffn : 0x7fffffffn;
      if (v <= max) return this.num(v, c, t);
    }
    this.diags.error(t, `integer constant '${text}' is too large`);
    return this.num(v, ty.ullong, t);
  }

  /** Pool a string literal as an anonymous read-only global. */
  stringLiteral(chars: number[], at: Token, elem: Type): Obj {
    const key = `${elem.size}:${chars.join(',')}`;
    let g = this.strings.get(key);
    if (g) {
      if (this.fn) this.fn.refs?.add(g);
      return g;
    }
    const t = arrayOf(qualified(elem, {}), chars.length + 1);
    g = this.newObj(`.LC${this.strings.size}`, t, at, false);
    g.asmName = `.LC${this.strings.size}`;
    g.isStatic = true;
    g.isDefinition = true;
    g.isLiteral = true;
    const bytes = new Uint8Array((chars.length + 1) * elem.size);
    chars.forEach((c, i) => {
      for (let k = 0; k < elem.size; k++) bytes[i * elem.size + k] = (c >> (8 * k)) & 0xff;
    });
    g.init = { bytes, relocs: [] };
    this.strings.set(key, g);
    this.globals.push(g);
    if (this.fn) this.fn.refs?.add(g);
    return g;
  }

  // ------------------------------------------------------------------ constants

  constExpr(): bigint {
    const t = this.tok;
    const e = this.conditional();
    const v = this.evalConst(e);
    if (v === undefined) {
      this.diags.error(span(t, this.prev()), 'expected a constant expression (a value known at compile time)');
      return 0n;
    }
    return v;
  }

  /** Integer value of a constant expression, or undefined. */
  evalConst(e: Expr): bigint | undefined {
    switch (e.kind) {
      case 'num':
        return e.value;
      case 'cast': {
        if (e.type.kind === 'void') return undefined;
        const v = this.evalConst(e.operand);
        if (v === undefined) return undefined;
        if (e.type.kind === 'bool') return v !== 0n ? 1n : 0n;
        return wrap(v, e.type);
      }
      case 'neg': {
        const v = this.evalConst(e.operand);
        return v === undefined ? undefined : wrap(-v, e.type);
      }
      case 'bitnot': {
        const v = this.evalConst(e.operand);
        return v === undefined ? undefined : wrap(~v, e.type);
      }
      case 'lognot': {
        const v = this.evalConst(e.operand);
        return v === undefined ? undefined : v === 0n ? 1n : 0n;
      }
      case 'logand': {
        const a = this.evalConst(e.lhs);
        if (a === 0n) return 0n;
        const b = this.evalConst(e.rhs);
        if (a === undefined || b === undefined) return undefined;
        return b !== 0n ? 1n : 0n;
      }
      case 'logor': {
        const a = this.evalConst(e.lhs);
        if (a !== undefined && a !== 0n) return 1n;
        const b = this.evalConst(e.rhs);
        if (a === undefined || b === undefined) return undefined;
        return b !== 0n ? 1n : 0n;
      }
      case 'cond': {
        const c = this.evalConst(e.cond);
        if (c === undefined) return undefined;
        return this.evalConst(c !== 0n ? e.then : e.else);
      }
      case 'comma':
        return undefined;
      case 'binary': {
        const a = this.evalConst(e.lhs);
        const b = this.evalConst(e.rhs);
        if (a === undefined || b === undefined) return undefined;
        return evalBinary(e.op, a, b, e.lhs.type, e.type);
      }
      case 'padd': {
        const p = this.evalConst(e.ptr);
        const i = this.evalConst(e.idx);
        if (p === undefined || i === undefined) return undefined;
        return wrap(p + (e.neg ? -i : i) * BigInt(e.scale), ty.uint);
      }
      case 'pdiff': {
        const a = this.evalConst(e.lhs);
        const b = this.evalConst(e.rhs);
        if (a === undefined || b === undefined) return undefined;
        return wrap((a - b) / BigInt(e.scale), ty.int);
      }
      case 'addr': {
        // &((T *)0)->member: an offset
        const r = this.evalAddr(e.operand);
        if (r && r.label === undefined) return wrap(r.addend, ty.uint);
        return undefined;
      }
      default:
        return undefined;
    }
  }

  /** Address of an lvalue as label + constant, for &((T*)0)->m and global initializers. */
  private evalAddr(e: Expr): { label?: string; obj?: Obj; addend: bigint } | undefined {
    switch (e.kind) {
      case 'var':
        if (e.obj.isLocal) return undefined;
        return { label: e.obj.asmName, obj: e.obj, addend: 0n };
      case 'deref':
        return this.evalReloc(e.operand);
      case 'member': {
        const b = this.evalAddr(e.base);
        return b ? { ...b, addend: b.addend + BigInt(e.member.offset) } : undefined;
      }
      case 'initvar':
        return undefined;
      default:
        return undefined;
    }
  }

  /** Constant value possibly relative to a symbol (global initializers). */
  evalReloc(e: Expr): { label?: string; obj?: Obj; addend: bigint } | undefined {
    switch (e.kind) {
      case 'addr':
        return this.evalAddr(e.operand);
      case 'cast': {
        if (e.type.size < 4 && e.type.kind !== 'ptr') {
          const v = this.evalConst(e);
          return v === undefined ? undefined : { addend: v };
        }
        return this.evalReloc(e.operand);
      }
      case 'padd': {
        const p = this.evalReloc(e.ptr);
        const i = this.evalConst(e.idx);
        if (!p || i === undefined) return undefined;
        return { ...p, addend: p.addend + (e.neg ? -i : i) * BigInt(e.scale) };
      }
      case 'binary': {
        if (e.op !== '+' && e.op !== '-') break;
        const a = this.evalReloc(e.lhs);
        const b = this.evalConst(e.rhs);
        if (a && b !== undefined) return { ...a, addend: a.addend + (e.op === '+' ? b : -b) };
        if (e.op === '+') {
          const a2 = this.evalConst(e.lhs);
          const b2 = this.evalReloc(e.rhs);
          if (a2 !== undefined && b2) return { ...b2, addend: b2.addend + a2 };
        }
        break;
      }
      case 'var':
        if (e.obj.isFunction || e.type.kind === 'array') return this.evalAddr(e);
        break;
      default:
        break;
    }
    const v = this.evalConst(e);
    return v === undefined ? undefined : { addend: v };
  }

  // ------------------------------------------------------------------ initializers

  private newInit(type: Type, allowFlexible: boolean): Init {
    const init: Init = { type };
    if (type.kind === 'array') {
      if ((type.len ?? -1) < 0) {
        if (!allowFlexible) this.diags.error(this.tok, 'array of unknown size cannot be initialized here');
        init.flexible = true;
      }
      init.children = [];
    } else if (isRecord(type)) {
      init.children = [];
    }
    return init;
  }

  private child(init: Init, i: number): Init {
    const ch = init.children as (Init | undefined)[];
    let c = ch[i];
    if (!c) {
      const t = init.type;
      const ct = t.kind === 'array' ? (t.base ?? ty.int) : (t.rec?.members[i]?.type ?? ty.int);
      c = this.newInit(ct, false);
      ch[i] = c;
    }
    return c;
  }

  private arrayLen(init: Init): number {
    return init.flexible ? Infinity : (init.type.len ?? 0);
  }

  /** Members that take initializers (unnamed bit-fields are skipped). */
  private initMembers(t: Type): number[] {
    const out: number[] = [];
    (t.rec?.members ?? []).forEach((m, i) => {
      if (m.name === undefined && m.bitWidth !== undefined) return;
      out.push(i);
    });
    return out;
  }

  initializer(init: Init): void {
    const t = init.type;
    init.loc = this.tok;
    if (t.kind === 'array') {
      const b = t.base ?? ty.int;
      if (isInteger(b) && (this.tok.kind === 'str' || (this.is('{') && this.peek().kind === 'str' && (this.peek(2).text === '}' || this.peek(2).kind === 'str')))) {
        const braced = this.consume('{');
        this.stringInit(init);
        if (braced) {
          this.consume(',');
          this.expect('}');
        }
        return;
      }
      if (this.is('{')) this.arrayBraced(init);
      else this.arrayUnbraced(init);
      return;
    }
    if (isRecord(t)) {
      if (this.is('{')) {
        this.recordBraced(init);
        return;
      }
      const save = this.pos;
      const e = this.rv(this.assign());
      if (isRecord(e.type)) {
        init.expr = this.convertAssign(t, e, 'initialization');
        return;
      }
      this.pos = save;
      this.recordUnbraced(init);
      return;
    }
    if (this.is('{')) {
      const open = this.next();
      if (this.is('}')) {
        this.next();
        init.expr = this.num(0n, unqualified(t), open);
        return;
      }
      this.initializer(init);
      while (this.consume(',')) {
        if (this.is('}')) break;
        this.diags.warn(this.tok, 'excess elements in scalar initializer');
        this.skipInitializer();
      }
      this.expect('}', 'to close the initializer');
      return;
    }
    const e = this.assign();
    init.expr = this.convertAssign(unqualified(t), e, 'initialization');
  }

  private skipInitializer(): void {
    if (this.is('{')) {
      let depth = 0;
      do {
        const t = this.next();
        if (t.text === '{') depth++;
        if (t.text === '}') depth--;
      } while (depth > 0 && this.tok.kind !== 'eof');
      return;
    }
    this.assign();
  }

  private stringInit(init: Init): void {
    const first = this.tok;
    const prefix = first.text.slice(0, first.text.indexOf('"'));
    let bytes = this.stringBytes();
    const elem = init.type.base ?? ty.char;
    if (prefix && elem.size > 1) bytes = [...new TextDecoder().decode(new Uint8Array(bytes))].map((c) => c.codePointAt(0) ?? 0);
    if (elem.size > 1 && !prefix) this.diags.warn(first, `initializing '${typeName(init.type)}' from a plain string`);
    const vals = [...bytes, 0];
    let n = vals.length;
    if (init.flexible) init.type = arrayOf(elem, n);
    else {
      const len = init.type.len ?? 0;
      if (n - 1 > len) this.diags.warn(first, `initializer string is too long for the array (${n - 1} characters for ${len})`);
      n = Math.min(n, len);
    }
    init.flexible = false;
    init.children = [];
    for (let i = 0; i < n; i++) {
      const c = this.newInit(elem, false);
      c.expr = this.num(BigInt(vals[i] ?? 0), unqualified(elem), first);
      init.children[i] = c;
    }
  }

  private finishFlexible(init: Init, count: number): void {
    if (init.flexible) {
      init.type = arrayOf(init.type.base ?? ty.int, count);
      init.flexible = false;
      if (init.children) init.children.length = Math.max(init.children.length, count);
    }
  }

  private arrayBraced(init: Init): void {
    const open = this.expect('{');
    let i = 0;
    let max = 0;
    let first = true;
    while (!this.consume('}')) {
      if (!first) {
        this.expect(',', 'between initializer elements');
        if (this.consume('}')) break;
      }
      first = false;
      if (this.tok.kind === 'eof') this.fail(open, "missing '}' at the end of the initializer");
      if (this.is('[')) {
        i = this.designated(init);
        max = Math.max(max, i);
        continue;
      }
      if (this.is('.')) this.fail(this.tok, `a '.member' designator cannot initialize an array`);
      if (i >= this.arrayLen(init)) {
        this.diags.warn(this.tok, 'excess elements in array initializer');
        this.skipInitializer();
        continue;
      }
      this.initializer(this.child(init, i));
      i++;
      max = Math.max(max, i);
    }
    this.finishFlexible(init, max);
  }

  private arrayUnbraced(init: Init): void {
    const len = this.arrayLen(init);
    let i = 0;
    for (; i < len; i++) {
      if (i > 0) {
        if (!this.is(',') || this.peek().text === '}' || this.peek().text === '[' || this.peek().text === '.') break;
        this.next();
      }
      this.initializer(this.child(init, i));
    }
    this.finishFlexible(init, i);
  }

  private recordBraced(init: Init): void {
    const open = this.expect('{');
    const members = this.initMembers(init.type);
    const isUnion = init.type.kind === 'union';
    let mi = 0;
    let first = true;
    while (!this.consume('}')) {
      if (!first) {
        this.expect(',', 'between initializer elements');
        if (this.consume('}')) break;
      }
      first = false;
      if (this.tok.kind === 'eof') this.fail(open, "missing '}' at the end of the initializer");
      if (this.is('.')) {
        const idx = this.designated(init);
        mi = members.indexOf(idx) + 1;
        continue;
      }
      if (this.is('[')) this.fail(this.tok, `an '[index]' designator cannot initialize a ${init.type.kind}`);
      const idx = members[mi];
      if (idx === undefined || (isUnion && mi > 0)) {
        this.diags.warn(this.tok, `excess elements in ${init.type.kind} initializer`);
        this.skipInitializer();
        continue;
      }
      if (isUnion) init.unionIdx = idx;
      this.initializer(this.child(init, idx));
      mi++;
    }
  }

  private recordUnbraced(init: Init): void {
    const members = this.initMembers(init.type);
    const isUnion = init.type.kind === 'union';
    for (let k = 0; k < members.length; k++) {
      if (k > 0) {
        if (isUnion) break;
        if (!this.is(',') || this.peek().text === '}' || this.peek().text === '[' || this.peek().text === '.') break;
        this.next();
      }
      const idx = members[k] as number;
      if (isUnion) init.unionIdx = idx;
      this.initializer(this.child(init, idx));
    }
  }

  /** Parse `[i]...` or `.m...` designators then `= init`; returns the index at this level. */
  private designated(init: Init): number {
    const t = this.tok;
    let idx: number;
    let target: Init;
    let rangeEnd = -1;
    if (this.consume('[')) {
      if (init.type.kind !== 'array') this.fail(t, `an '[index]' designator cannot initialize '${typeName(init.type)}'`);
      idx = Number(this.constExpr());
      if (this.consume('...')) rangeEnd = Number(this.constExpr());
      this.expect(']');
      if (idx < 0 || idx >= this.arrayLen(init)) this.fail(t, `array index ${idx} in initializer is out of bounds`);
      target = this.child(init, idx);
    } else {
      this.expect('.');
      const name = this.next();
      if (!init.type.rec) this.fail(name, `a '.member' designator cannot initialize '${typeName(init.type)}'`);
      const path = findMember(init.type.rec, name.text);
      if (!path) this.fail(name, `'${typeName(init.type)}' has no member named '${name.text}'`);
      const first = path[0] as Member;
      idx = init.type.rec.members.indexOf(first);
      if (init.type.kind === 'union') init.unionIdx = idx;
      target = this.child(init, idx);
      // anonymous member path: descend
      for (const m of path.slice(1)) {
        const rec = target.type.rec;
        if (!rec) break;
        const k = rec.members.indexOf(m);
        if (target.type.kind === 'union') target.unionIdx = k;
        target = this.child(target, k);
      }
    }
    if (this.is('[') || this.is('.')) {
      this.designatedRest(target);
    } else {
      if (!this.consume('=')) {
        if (!this.consume(':')) this.expect('=', 'after the designator');
      }
      this.initializer(target);
    }
    if (rangeEnd > idx) {
      for (let k = idx + 1; k <= rangeEnd && k < this.arrayLen(init); k++) (init.children as (Init | undefined)[])[k] = target;
      return rangeEnd + 1;
    }
    return init.type.kind === 'array' ? idx + 1 : idx;
  }

  private designatedRest(init: Init): void {
    this.designated(init);
  }

  /** Statements that initialize local `obj`. */
  private lowerLocalInit(init: Init, obj: Obj, at: Token): Stmt[] {
    const out: Stmt[] = [];
    const v = this.varExpr(obj, at);
    v.type = init.type;
    obj.type = init.type;
    if (init.expr && !isRecord(init.type)) {
      out.push(this.exprStmt(this.mkExpr({ kind: 'assign', lhs: v, rhs: init.expr, type: unqualified(init.type) }, at)));
      return out;
    }
    if (init.expr) {
      out.push(this.exprStmt(this.mkExpr({ kind: 'assign', lhs: v, rhs: init.expr, type: unqualified(init.type) }, at)));
      return out;
    }
    out.push(this.exprStmt(this.mkExpr({ kind: 'memzero', obj, type: ty.void }, at)));
    this.leaves(init, v, out, at);
    return out;
  }

  private leaves(init: Init, lv: Expr, out: Stmt[], at: Token): void {
    if (init.expr) {
      if (init.expr.kind === 'num' && init.expr.value === 0n) return; // already zeroed
      out.push(this.exprStmt(this.mkExpr({ kind: 'assign', lhs: lv, rhs: init.expr, type: unqualified(lv.type) }, init.expr.loc, init.expr.line)));
      return;
    }
    const ch = init.children;
    if (!ch) return;
    if (init.type.kind === 'array') {
      const base = init.type.base ?? ty.int;
      const ptr = this.rv(lv);
      ch.forEach((c, i) => {
        if (!c) return;
        const p = this.mkExpr({ kind: 'padd', ptr, idx: this.num(BigInt(i), ty.int, at), scale: sizeOf(base), neg: false, type: ptr.type }, at);
        const el = this.mkExpr({ kind: 'deref', operand: p, type: base }, at);
        this.leaves(c, el, out, at);
      });
      return;
    }
    const rec = init.type.rec;
    if (!rec) return;
    ch.forEach((c, i) => {
      if (!c) return;
      if (init.type.kind === 'union' && init.unionIdx !== undefined && i !== init.unionIdx) return;
      const m = rec.members[i] as Member;
      const el = this.mkExpr({ kind: 'member', base: lv, member: m, type: m.type }, at);
      this.leaves(c, el, out, at);
    });
  }

  /** Bytes + relocations for a global's initializer. */
  private globalInitData(init: Init, g: Obj): InitData {
    const size = sizeOf(init.type);
    const data: InitData = { bytes: new Uint8Array(size), relocs: [] };
    this.writeInit(init, data, 0, g);
    return data;
  }

  private writeInit(init: Init, data: InitData, off: number, g: Obj, member?: Member): void {
    if (init.expr) {
      const e = init.expr;
      const t = init.type;
      if (isRecord(t)) {
        // struct copy from a constant compound literal or another global: not constant
        const r = e.kind === 'var' && e.obj.init && !e.obj.isLocal ? e.obj.init : undefined;
        if (r) {
          data.bytes.set(r.bytes.subarray(0, sizeOf(t)), off);
          for (const rl of r.relocs) data.relocs.push({ ...rl, offset: rl.offset + off });
          return;
        }
        this.diags.error(e.loc, 'initializer element is not a compile-time constant');
        return;
      }
      const r = this.evalReloc(e);
      if (!r) {
        this.diags.error(e.loc, 'initializer element is not a compile-time constant');
        return;
      }
      if (r.label !== undefined) {
        if (sizeOf(t) !== 4) {
          this.diags.error(e.loc, 'an address can only initialize a pointer-sized object');
          return;
        }
        if (r.obj) {
          g.refs ??= new Set();
          g.refs.add(r.obj);
        }
        data.relocs.push({ offset: off, label: r.label, addend: Number(BigInt.asIntN(32, r.addend)) });
        return;
      }
      let v = r.addend;
      if (member?.bitWidth !== undefined) {
        const w = member.bitWidth;
        const bo = member.bitOffset ?? 0;
        const sz = sizeOf(t);
        let cur = 0n;
        for (let k = 0; k < sz; k++) cur |= BigInt(data.bytes[off + k] ?? 0) << BigInt(8 * k);
        const mask = ((1n << BigInt(w)) - 1n) << BigInt(bo);
        cur = (cur & ~mask) | ((BigInt.asUintN(w, v) << BigInt(bo)) & mask);
        v = cur;
      }
      const sz = sizeOf(t);
      v = BigInt.asUintN(sz * 8, v);
      for (let k = 0; k < sz; k++) data.bytes[off + k] = Number((v >> BigInt(8 * k)) & 0xffn);
      return;
    }
    const ch = init.children;
    if (!ch) return;
    if (init.type.kind === 'array') {
      const es = sizeOf(init.type.base ?? ty.int);
      ch.forEach((c, i) => c && this.writeInit(c, data, off + i * es, g));
      return;
    }
    const rec = init.type.rec;
    if (!rec) return;
    ch.forEach((c, i) => {
      if (!c) return;
      if (init.type.kind === 'union' && init.unionIdx !== undefined && i !== init.unionIdx) return;
      const m = rec.members[i] as Member;
      this.writeInit(c, data, off + m.offset, g, m);
    });
  }
}

function mergeAttrs(into: Attrs, from: Attrs): void {
  for (const [k, v] of Object.entries(from)) {
    if (v === undefined) continue;
    if (k === 'aligned') into.aligned = Math.max(into.aligned ?? 0, v as number);
    else (into as Record<string, unknown>)[k] = v;
  }
}

function sameKind(a: Type, b: Type): boolean {
  if (a.kind === 'ptr' && b.kind === 'ptr') return true;
  if (isInteger(a) && isInteger(b)) {
    if (a.kind === 'bool' || b.kind === 'bool') return a.kind === b.kind;
    return a.size === b.size && a.unsigned === b.unsigned;
  }
  return false;
}

/** Wrap a value to the width and signedness of an integer or pointer type. */
export function wrap(v: bigint, t: Type): bigint {
  if (t.kind === 'bool') return v !== 0n ? 1n : 0n;
  if (t.kind === 'ptr' || t.kind === 'array' || t.kind === 'func') return BigInt.asUintN(32, v);
  const bits = (t.size || 4) * 8;
  if (bits > 64) return v;
  return t.unsigned ? BigInt.asUintN(bits, v) : BigInt.asIntN(bits, v);
}

/** Evaluate a binary operator on constants; operands have type `opType`, result `rt`. */
export function evalBinary(op: BinOp, a: bigint, b: bigint, opType: Type, rt: Type): bigint | undefined {
  const B = (x: boolean): bigint => (x ? 1n : 0n);
  switch (op) {
    case '+': return wrap(a + b, rt);
    case '-': return wrap(a - b, rt);
    case '*': return wrap(a * b, rt);
    case '/': if (b === 0n) return undefined; return wrap(a / b, rt);
    case '%': if (b === 0n) return undefined; return wrap(a % b, rt);
    case '&': return wrap(a & b, rt);
    case '|': return wrap(a | b, rt);
    case '^': return wrap(a ^ b, rt);
    case '<<': return wrap(a << (b & BigInt(rt.size * 8 - 1)), rt);
    case '>>': return wrap(a >> (b & BigInt(rt.size * 8 - 1)), rt);
    case '==': return B(a === b);
    case '!=': return B(a !== b);
    case '<': return B(a < b);
    case '<=': return B(a <= b);
    case '>': return B(a > b);
    case '>=': return B(a >= b);
  } // prettier-ignore
  void opType;
  return undefined;
}

function endsWithReturn(s: Stmt): boolean {
  if (s.kind === 'return') return true;
  if (s.kind === 'block') {
    const last = s.stmts[s.stmts.length - 1];
    return !!last && endsWithReturn(last);
  }
  return false;
}

function containsReturn(s: Stmt): boolean {
  switch (s.kind) {
    case 'return': return true;
    case 'block': return s.stmts.some(containsReturn);
    case 'if': return containsReturn(s.then) || (!!s.else && containsReturn(s.else));
    case 'loop': return containsReturn(s.body);
    case 'switch': return containsReturn(s.body);
    case 'label': return containsReturn(s.stmt);
    case 'asm': return true;
    case 'expr': return s.expr.kind === 'call';
    default: return false;
  } // prettier-ignore
}

export { isPtr };
