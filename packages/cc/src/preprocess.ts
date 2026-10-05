/**
 * C preprocessor (CC-02): #include from a header map, object- and
 * function-like #define (with #, ## and __VA_ARGS__), #undef, conditionals
 * with constant expressions, #pragma once, #error/#warning, __LINE__/__FILE__.
 * Macro expansion follows Prosser's hideset algorithm.
 */

import { Bail, type Diags, type Loc } from './diag';
import { type Token, tokenize } from './lexer';
import { BUILTIN_HEADERS } from './headers';

interface Macro {
  name: string;
  objLike: boolean;
  params: string[];
  variadic: boolean;
  /** Name of the variadic parameter (`__VA_ARGS__`, or `args` for GNU `args...`). */
  vaName?: string;
  body: Token[];
  builtin?: (tok: Token) => Token[];
  /** Where it was defined (for redefinition notes). */
  loc?: Loc;
}

interface CondFrame {
  /** Some branch of this #if chain was already taken. */
  taken: boolean;
  /** Currently in an active branch. */
  active: boolean;
  /** Seen #else. */
  sawElse: boolean;
  /** The enclosing frame was active. */
  parentActive: boolean;
  tok: Token;
  file: string;
}

export interface PreprocessOptions {
  file: string;
  headers: Record<string, string>;
  charSigned: boolean;
  /** Extra predefined macros (name -> body text). */
  defines?: Record<string, string>;
}

const MAX_INCLUDE_DEPTH = 64;

function addHide(set: ReadonlySet<string> | undefined, name: string): Set<string> {
  const s = new Set(set ?? []);
  s.add(name);
  return s;
}

function intersect(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): Set<string> {
  const s = new Set<string>();
  if (!a || !b) return s;
  for (const x of a) if (b.has(x)) s.add(x);
  return s;
}

export class Preprocessor {
  private macros = new Map<string, Macro>();
  /** Reversed stack of pending input tokens. */
  private stack: Token[] = [];
  private conds: CondFrame[] = [];
  private includeDepth = 0;
  private fileStack: string[] = [];
  private onceFiles = new Set<string>();
  private guardMacro = new Map<string, string>();
  readonly mainFile: string;

  constructor(
    private diags: Diags,
    private opts: PreprocessOptions,
  ) {
    this.mainFile = opts.file;
    this.defineBuiltins();
  }

  private defineText(name: string, text: string): void {
    const toks = tokenize(text, '<built-in>', this.diags);
    toks.pop();
    this.macros.set(name, { name, objLike: true, params: [], variadic: false, body: toks });
  }

  private defineBuiltins(): void {
    const defs: Record<string, string> = {
      __STDC__: '1',
      __STDC_VERSION__: '199901L',
      __STDC_HOSTED__: '0',
      __riscv: '1',
      __riscv_xlen: '32',
      __riscv_mul: '1',
      __riscv_div: '1',
      __riscv_muldiv: '1',
      __ILP32__: '1',
      __ilp32__: '1',
      __CHAR_BIT__: '8',
      __SIZEOF_SHORT__: '2',
      __SIZEOF_INT__: '4',
      __SIZEOF_LONG__: '4',
      __SIZEOF_LONG_LONG__: '8',
      __SIZEOF_POINTER__: '4',
      __SIZEOF_SIZE_T__: '4',
      __INT_MAX__: '0x7fffffff',
      __LONG_MAX__: '0x7fffffffL',
      __SCHAR_MAX__: '0x7f',
      __SHRT_MAX__: '0x7fff',
      __SIZE_TYPE__: 'unsigned int',
      __PTRDIFF_TYPE__: 'int',
      __WCHAR_TYPE__: 'int',
      __INTPTR_TYPE__: 'int',
      __UINTPTR_TYPE__: 'unsigned int',
      __ORDER_LITTLE_ENDIAN__: '1234',
      __ORDER_BIG_ENDIAN__: '4321',
      __BYTE_ORDER__: '1234',
      __BUILD_A_COMPUTER_CC__: '1',
      __inline: 'inline',
      __inline__: 'inline',
      __signed__: 'signed',
      __restrict: 'restrict',
      __restrict__: 'restrict',
      __const: 'const',
      __volatile: 'volatile',
      __volatile__: 'volatile',
      __alignof__: '_Alignof',
      __extension__: '',
    };
    if (!this.opts.charSigned) defs.__CHAR_UNSIGNED__ = '1';
    for (const [k, v] of Object.entries(defs)) this.defineText(k, v);
    for (const [k, v] of Object.entries(this.opts.defines ?? {})) this.defineText(k, v);
    const builtin = (name: string, fn: (tok: Token) => Token[]): void => {
      this.macros.set(name, { name, objLike: true, params: [], variadic: false, body: [], builtin: fn });
    };
    builtin('__LINE__', (t) => [{ ...t, kind: 'num', text: String(t.line), hideset: undefined }]);
    builtin('__FILE__', (t) => [
      { ...t, kind: 'str', text: JSON.stringify(t.file), hideset: undefined },
    ]);
    builtin('__COUNTER__', (() => {
      let c = 0;
      return (t: Token) => [{ ...t, kind: 'num' as const, text: String(c++), hideset: undefined }];
    })());
  }

  /** Run the preprocessor over the main file's source. */
  run(source: string): Token[] {
    const toks = tokenize(source, this.opts.file, this.diags);
    for (const t of toks) if (t.kind !== 'eof') t.mainLine = t.line;
    this.fileStack.push(this.opts.file);
    this.pushTokens(toks);
    const out: Token[] = [];
    for (;;) {
      let t: Token;
      try {
        const r = this.nextExpanded();
        if (!r) continue;
        t = r;
      } catch (e) {
        if (e instanceof Bail) continue;
        throw e;
      }
      if (t.kind === 'eof') {
        out.push(t);
        break;
      }
      out.push(t);
    }
    return out;
  }

  private pushTokens(toks: Token[]): void {
    for (let i = toks.length - 1; i >= 0; i--) {
      const t = toks[i];
      if (t) this.stack.push(t);
    }
  }

  private raw(): Token {
    const t = this.stack.pop();
    if (!t) throw new Error('preprocessor: token stack underflow');
    return t;
  }

  private peekRaw(): Token | undefined {
    return this.stack[this.stack.length - 1];
  }

  private get active(): boolean {
    const top = this.conds[this.conds.length - 1];
    return top ? top.active : true;
  }

  /**
   * Next fully processed token, or undefined when a directive or an expansion
   * was handled (caller loops).
   */
  private nextExpanded(): Token | undefined {
    const t = this.raw();
    if (t.kind === 'eof') {
      // end of an included file (or of the main file)
      const file = this.fileStack.pop() ?? t.file;
      while (this.conds.length && this.conds[this.conds.length - 1]?.file === file) {
        const c = this.conds.pop();
        if (c) this.diags.error(c.tok, `unterminated #${c.tok.text === '#' ? 'if' : c.tok.text}: add a matching #endif`);
      }
      if (this.fileStack.length > 0) {
        this.includeDepth--;
        return undefined;
      }
      return t;
    }
    if (t.bol && t.text === '#' && t.kind === 'punct' && !t.hideset) {
      this.directive(t);
      return undefined;
    }
    if (!this.active) return undefined;
    if (t.kind === 'ident' && this.expand(t)) return undefined;
    return t;
  }

  /** Read the rest of the directive line. */
  private lineTokens(): Token[] {
    const out: Token[] = [];
    for (;;) {
      const p = this.peekRaw();
      if (!p || p.bol || p.kind === 'eof') break;
      out.push(this.raw());
    }
    return out;
  }

  private directive(hash: Token): void {
    const nameTok = this.peekRaw();
    if (!nameTok || nameTok.bol || nameTok.kind === 'eof') return; // null directive
    this.raw();
    const name = nameTok.text;
    const rest = this.lineTokens();
    const active = this.active;
    switch (name) {
      case 'if':
      case 'ifdef':
      case 'ifndef': {
        let val = false;
        if (active) {
          if (name === 'if') val = this.evalIf(rest, nameTok);
          else {
            const id = rest[0];
            if (!id || id.kind !== 'ident') {
              this.diags.error(nameTok, `#${name} expects a macro name`);
            } else {
              val = this.macros.has(id.text) === (name === 'ifdef');
              if (rest.length > 1) this.diags.warn(rest[1] ?? id, `extra tokens after #${name} ${id.text}`);
            }
          }
        }
        this.conds.push({
          taken: val,
          active: active && val,
          sawElse: false,
          parentActive: active,
          tok: nameTok,
          file: nameTok.file,
        });
        return;
      }
      case 'elif': {
        const top = this.conds[this.conds.length - 1];
        if (!top) {
          this.diags.error(nameTok, '#elif without a matching #if');
          return;
        }
        if (top.sawElse) this.diags.error(nameTok, '#elif after #else');
        if (top.taken || !top.parentActive) {
          top.active = false;
          return;
        }
        const v = this.evalIf(rest, nameTok);
        top.active = v;
        top.taken = v;
        return;
      }
      case 'else': {
        const top = this.conds[this.conds.length - 1];
        if (!top) {
          this.diags.error(nameTok, '#else without a matching #if');
          return;
        }
        if (top.sawElse) this.diags.error(nameTok, 'a second #else in the same #if');
        top.sawElse = true;
        top.active = top.parentActive && !top.taken;
        top.taken = true;
        return;
      }
      case 'endif': {
        if (!this.conds.pop()) this.diags.error(nameTok, '#endif without a matching #if');
        return;
      }
    }
    if (!active) return;
    switch (name) {
      case 'define':
        this.define(rest, nameTok);
        return;
      case 'undef': {
        const id = rest[0];
        if (!id || id.kind !== 'ident') this.diags.error(nameTok, '#undef expects a macro name');
        else this.macros.delete(id.text);
        return;
      }
      case 'include':
        this.include(rest, nameTok);
        return;
      case 'pragma':
        if (rest[0]?.text === 'once') this.onceFiles.add(nameTok.file);
        return;
      case 'error':
        this.diags.error(nameTok, `#error ${joinText(rest)}`);
        return;
      case 'warning':
        this.diags.warn(nameTok, `#warning ${joinText(rest)}`);
        return;
      case 'line':
      case 'ident':
      case 'sccs':
        return;
      default:
        if (nameTok.kind === 'num') return; // GNU line marker
        this.diags.error(nameTok, `unknown preprocessor directive #${name}`);
        void hash;
    }
  }

  private define(rest: Token[], at: Token): void {
    const id = rest[0];
    if (!id || id.kind !== 'ident') {
      this.diags.error(at, '#define expects a macro name');
      return;
    }
    if (id.text === 'defined') {
      this.diags.error(id, "'defined' cannot be used as a macro name");
      return;
    }
    let i = 1;
    const params: string[] = [];
    let variadic = false;
    let vaName: string | undefined;
    let objLike = true;
    const lp = rest[1];
    if (lp && lp.text === '(' && !lp.space) {
      objLike = false;
      i = 2;
      if (rest[i]?.text === ')') i++;
      else
        for (;;) {
          const p = rest[i];
          if (!p) {
            this.diags.error(id, `missing ')' in the parameter list of macro '${id.text}'`);
            return;
          }
          if (p.text === '...') {
            variadic = true;
            vaName = '__VA_ARGS__';
            i++;
            if (rest[i]?.text !== ')') {
              this.diags.error(p, "'...' must be the last macro parameter");
              return;
            }
            i++;
            break;
          }
          if (p.kind !== 'ident') {
            this.diags.error(p, `expected a parameter name in macro '${id.text}'`);
            return;
          }
          params.push(p.text);
          i++;
          const sep = rest[i];
          if (sep?.text === '...') {
            // GNU named variadic: args...
            variadic = true;
            params.pop();
            vaName = p.text;
            i++;
          }
          const s2 = rest[i];
          if (s2?.text === ',') {
            i++;
            continue;
          }
          if (s2?.text === ')') {
            i++;
            break;
          }
          this.diags.error(s2 ?? p, `expected ',' or ')' in the parameter list of macro '${id.text}'`);
          return;
        }
    }
    const body = rest.slice(i);
    if (body[0]) body[0] = { ...body[0], space: false };
    this.macros.set(id.text, { name: id.text, objLike, params, variadic, ...(vaName ? { vaName } : {}), body, loc: id });
  }

  private include(rest: Token[], at: Token): void {
    let toks = rest;
    if (toks[0] && toks[0].kind !== 'str' && toks[0].text !== '<') toks = this.expandList(toks);
    const first = toks[0];
    let name: string | undefined;
    if (first?.kind === 'str') name = first.text.slice(1, -1);
    else if (first?.text === '<') {
      const end = toks.findIndex((t) => t.text === '>');
      if (end > 0) name = toks.slice(1, end).map((t) => (t.space ? ' ' : '') + t.text).join('').trim();
    }
    if (!name) {
      this.diags.error(at, '#include expects "file.h" or <file.h>');
      return;
    }
    const clean = name.replace(/^\.\//, '');
    const text = this.opts.headers[clean] ?? this.opts.headers[name] ?? BUILTIN_HEADERS[clean];
    if (text === undefined) {
      this.diags.error(
        first ? { ...first, endCol: (toks[toks.length - 1] ?? first).endCol } : at,
        `cannot find header '${name}'`,
      );
      return;
    }
    if (this.onceFiles.has(clean)) return;
    const guard = this.guardMacro.get(clean);
    if (guard && this.macros.has(guard)) return;
    if (this.includeDepth >= MAX_INCLUDE_DEPTH) {
      this.diags.error(at, `#include nested too deeply (is '${name}' including itself?)`);
      return;
    }
    const toksIn = tokenize(text, clean, this.diags);
    this.detectGuard(clean, toksIn);
    this.includeDepth++;
    this.fileStack.push(clean);
    this.pushTokens(toksIn);
  }

  /** Remember `#ifndef X / #define X ... #endif` guards to skip re-reading headers. */
  private detectGuard(file: string, toks: Token[]): void {
    const [h, ifn, id, h2, def, id2] = toks;
    if (
      h?.text === '#' && ifn?.text === 'ifndef' && id?.kind === 'ident' &&
      h2?.text === '#' && def?.text === 'define' && id2?.text === id.text
    ) {
      // the last directive must be the matching #endif
      let depth = 0;
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t?.text === '#' && t.bol) {
          const d = toks[i + 1]?.text;
          if (d === 'if' || d === 'ifdef' || d === 'ifndef') depth++;
          else if (d === 'endif') {
            depth--;
            if (depth === 0) {
              // anything after?
              let j = i + 2;
              while (toks[j] && !toks[j]?.bol && toks[j]?.kind !== 'eof') j++;
              if (toks[j]?.kind === 'eof') this.guardMacro.set(file, id.text);
              return;
            }
          }
        }
      }
    } // prettier-ignore
  }

  // ---------------------------------------------------------------- #if

  private evalIf(rest: Token[], at: Token): boolean {
    // replace defined(X) / defined X
    const pre: Token[] = [];
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i];
      if (!t) continue;
      if (t.kind === 'ident' && t.text === 'defined') {
        let j = i + 1;
        const paren = rest[j]?.text === '(';
        if (paren) j++;
        const id = rest[j];
        if (!id || id.kind !== 'ident') {
          this.diags.error(t, "'defined' expects a macro name");
          return false;
        }
        if (paren) {
          if (rest[j + 1]?.text !== ')') {
            this.diags.error(id, "missing ')' after 'defined(name'");
            return false;
          }
          j++;
        }
        pre.push({ ...t, kind: 'num', text: this.macros.has(id.text) ? '1' : '0' });
        i = j;
        continue;
      }
      pre.push(t);
    }
    const toks = this.expandList(pre).map((t) =>
      t.kind === 'ident' ? { ...t, kind: 'num' as const, text: t.text === 'true' ? '1' : '0' } : t,
    );
    if (toks.length === 0) {
      this.diags.error(at, `#${at.text} with no expression`);
      return false;
    }
    try {
      const ev = new IfEval(toks, this.diags, at);
      const v = ev.expr();
      if (ev.pos < toks.length) {
        this.diags.error(toks[ev.pos] ?? at, `unexpected '${toks[ev.pos]?.text}' in #${at.text} expression`);
      }
      return v !== 0n;
    } catch (e) {
      if (e instanceof Bail) return false;
      throw e;
    }
  }

  // ---------------------------------------------------------------- expansion

  /** Fully expand a token list in isolation (macro arguments, #if, #include). */
  private expandList(toks: Token[]): Token[] {
    const saved = this.stack;
    const eof: Token = { ...(toks[toks.length - 1] ?? { file: '', line: 0, col: 0, endLine: 0, endCol: 0, text: '', bol: false, space: false, kind: 'eof' }), kind: 'eof', text: '' }; // prettier-ignore
    this.stack = [];
    this.pushTokens([...toks, eof]);
    const out: Token[] = [];
    try {
      for (;;) {
        const t = this.raw();
        if (t.kind === 'eof') break;
        if (t.kind === 'ident' && this.expand(t)) continue;
        out.push(t);
      }
    } finally {
      this.stack = saved;
    }
    return out;
  }

  /** Try to expand macro `t`; on success the expansion is pushed back and true returned. */
  private expand(t: Token): boolean {
    const m = this.macros.get(t.text);
    if (!m) return false;
    if (t.hideset?.has(t.text)) return false;
    if (m.builtin) {
      this.pushTokens(m.builtin(t).map((x) => ({ ...x, mainLine: t.mainLine })));
      return true;
    }
    if (m.objLike) {
      const hs = addHide(t.hideset, m.name);
      const body = this.subst(m, [], hs, t);
      this.pushTokens(body);
      return true;
    }
    // function-like: needs '('
    const p = this.peekRaw();
    if (!p || p.text !== '(' || p.kind === 'eof') return false;
    this.raw();
    const args = this.collectArgs(m, t);
    if (!args) return true;
    const { list, rparen } = args;
    const hs = addHide(intersect(t.hideset ?? new Set(), rparen.hideset ?? new Set()), m.name);
    const body = this.subst(m, list, hs, t);
    this.pushTokens(body);
    return true;
  }

  private collectArgs(m: Macro, at: Token): { list: Token[][]; rparen: Token } | undefined {
    const list: Token[][] = [];
    let cur: Token[] = [];
    let depth = 0;
    for (;;) {
      const t = this.peekRaw();
      if (!t || t.kind === 'eof') {
        this.diags.error(at, `unterminated call to macro '${m.name}': missing ')'`);
        return undefined;
      }
      this.raw();
      if (t.bol && t.text === '#' && !t.hideset) {
        // directive inside macro args: process it
        this.directive(t);
        continue;
      }
      if (t.text === '(' && t.kind === 'punct') depth++;
      else if (t.text === ')' && t.kind === 'punct') {
        if (depth === 0) {
          list.push(cur);
          // check count
          const np = m.params.length;
          if (np === 0 && !m.variadic && list.length === 1 && list[0]?.length === 0) list.pop();
          if (m.variadic) {
            // merge extra args into the variadic one
            if (list.length > np) {
              const extra = list.splice(np);
              const merged: Token[] = [];
              extra.forEach((a, k) => {
                if (k > 0) merged.push({ ...t, text: ',', kind: 'punct', space: false });
                merged.push(...a);
              });
              list.push(merged);
            } else if (list.length === np) list.push([]);
            if (list.length !== np + 1) {
              this.diags.error(at, `macro '${m.name}' needs at least ${np} argument${np === 1 ? '' : 's'}`);
              return undefined;
            }
          } else if (list.length !== np) {
            this.diags.error(
              at,
              `macro '${m.name}' takes ${np} argument${np === 1 ? '' : 's'} but got ${list.length}`,
            );
            return undefined;
          }
          return { list, rparen: t };
        }
        depth--;
      } else if (t.text === ',' && depth === 0 && t.kind === 'punct') {
        list.push(cur);
        cur = [];
        continue;
      }
      cur.push(t);
    }
  }

  private subst(m: Macro, args: Token[][], hs: Set<string>, at: Token): Token[] {
    const np = m.params.length;
    const argIndex = (t: Token | undefined): number => {
      if (!t || t.kind !== 'ident') return -1;
      const i = m.params.indexOf(t.text);
      if (i >= 0) return i;
      if (m.vaName !== undefined && t.text === m.vaName) return np;
      return -1;
    };
    const slot = (i: number): Token[] => args[i] ?? [];
    const expandedCache = new Map<number, Token[]>();
    const expandedArg = (i: number): Token[] => {
      let e = expandedCache.get(i);
      if (!e) {
        e = this.expandList(slot(i));
        expandedCache.set(i, e);
      }
      return e;
    };
    const body = m.body;
    const out: Token[] = [];
    for (let k = 0; k < body.length; k++) {
      const t = body[k];
      if (!t) continue;
      // # param
      if (!m.objLike && t.text === '#' && t.kind === 'punct') {
        const i = argIndex(body[k + 1]);
        if (i < 0) {
          this.diags.error(at, `'#' in macro '${m.name}' must be followed by a parameter name`);
          continue;
        }
        out.push({ ...stringize(slot(i), at), space: t.space });
        k++;
        continue;
      }
      // , ## __VA_ARGS__ (GNU): drop the comma when the variadic arg is empty
      if (
        t.text === ',' && body[k + 1]?.text === '##' && m.variadic &&
        argIndex(body[k + 2]) === np
      ) {
        const va = slot(argIndex(body[k + 2]));
        if (va.length === 0) {
          k += 2;
          continue;
        }
        out.push(t);
        out.push(...expandedArg(argIndex(body[k + 2])).map((x) => x));
        k += 2;
        continue;
      } // prettier-ignore
      // x ## y
      if (body[k + 1]?.text === '##') {
        let lhs: Token[];
        const li = argIndex(t);
        lhs = li >= 0 ? [...slot(li)] : [t];
        while (body[k + 1]?.text === '##') {
          const r = body[k + 2];
          k += 2;
          if (!r) {
            this.diags.error(at, `'##' cannot appear at the end of macro '${m.name}'`);
            break;
          }
          const ri = argIndex(r);
          const rhs = ri >= 0 ? [...slot(ri)] : [r];
          if (lhs.length === 0) lhs = rhs;
          else if (rhs.length > 0) {
            const a = lhs[lhs.length - 1] as Token;
            const b = rhs[0] as Token;
            const pasted = this.paste(a, b, at);
            lhs = [...lhs.slice(0, -1), ...pasted, ...rhs.slice(1)];
          }
        }
        out.push(...lhs);
        continue;
      }
      const i = argIndex(t);
      if (i >= 0) {
        const e = expandedArg(i);
        e.forEach((x, n) => out.push(n === 0 ? { ...x, space: t.space } : x));
        continue;
      }
      out.push(t);
    }
    return out.map((x) => ({
      ...x,
      file: at.file,
      line: at.line,
      col: at.col,
      endLine: at.endLine,
      endCol: at.endCol,
      bol: false,
      mainLine: at.mainLine,
      hideset: unionHide(x.hideset, hs),
    }));
  }

  private paste(a: Token, b: Token, at: Token): Token[] {
    const text = a.text + b.text;
    const toks = tokenize(text, at.file, this.diags);
    toks.pop();
    if (toks.length !== 1) {
      this.diags.error(at, `pasting '${a.text}' and '${b.text}' does not give a valid token`);
      return [a, b];
    }
    const t = toks[0] as Token;
    return [{ ...a, kind: t.kind, text: t.text }];
  }
}

function unionHide(a: ReadonlySet<string> | undefined, b: Set<string>): Set<string> {
  if (!a || a.size === 0) return b;
  const s = new Set(b);
  for (const x of a) s.add(x);
  return s;
}

function joinText(toks: Token[]): string {
  return toks.map((t, i) => (i > 0 && t.space ? ' ' : '') + t.text).join('');
}

function stringize(toks: Token[], at: Token): Token {
  let s = '';
  toks.forEach((t, i) => {
    if (i > 0 && t.space) s += ' ';
    s += t.kind === 'str' || t.kind === 'char' ? t.text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') : t.text;
  });
  return { ...at, kind: 'str', text: `"${s}"`, hideset: undefined };
}

/** #if expression evaluator over integer tokens (64-bit, like intmax_t). */
class IfEval {
  pos = 0;
  constructor(
    private toks: Token[],
    private diags: Diags,
    private at: Token,
  ) {}

  private peek(): string | undefined {
    return this.toks[this.pos]?.text;
  }

  private fail(msg: string): never {
    this.diags.error(this.toks[this.pos] ?? this.toks[this.toks.length - 1] ?? this.at, msg);
    throw new Bail();
  }

  expr(): bigint {
    const c = this.binary(0);
    if (this.peek() === '?') {
      this.pos++;
      const a = this.expr();
      if (this.peek() !== ':') this.fail("expected ':' in #if conditional expression");
      this.pos++;
      const b = this.expr();
      return c !== 0n ? a : b;
    }
    return c;
  }

  private static PREC: Record<string, number> = {
    '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6,
    '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
  }; // prettier-ignore

  private binary(min: number): bigint {
    let l = this.unary();
    for (;;) {
      const op = this.peek();
      const p = op === undefined ? undefined : IfEval.PREC[op];
      if (p === undefined || p <= min) return l;
      this.pos++;
      const r = this.binary(p);
      l = BigInt.asIntN(64, this.apply(op as string, l, r));
    }
  }

  private apply(op: string, l: bigint, r: bigint): bigint {
    const b = (x: boolean): bigint => (x ? 1n : 0n);
    switch (op) {
      case '||': return b(l !== 0n || r !== 0n);
      case '&&': return b(l !== 0n && r !== 0n);
      case '|': return l | r;
      case '^': return l ^ r;
      case '&': return l & r;
      case '==': return b(l === r);
      case '!=': return b(l !== r);
      case '<': return b(l < r);
      case '>': return b(l > r);
      case '<=': return b(l <= r);
      case '>=': return b(l >= r);
      case '<<': return l << (r & 63n);
      case '>>': return l >> (r & 63n);
      case '+': return l + r;
      case '-': return l - r;
      case '*': return l * r;
      case '/': if (r === 0n) this.fail('division by zero in #if'); return l / r;
      case '%': if (r === 0n) this.fail('division by zero in #if'); return l % r;
    } // prettier-ignore
    return 0n;
  }

  private unary(): bigint {
    const t = this.toks[this.pos];
    if (!t) this.fail(`#${this.at.text} expression ends too early`);
    this.pos++;
    switch (t.text) {
      case '+': return this.unary();
      case '-': return BigInt.asIntN(64, -this.unary());
      case '~': return ~this.unary();
      case '!': return this.unary() === 0n ? 1n : 0n;
      case '(': {
        const v = this.expr();
        if (this.peek() !== ')') this.fail("expected ')' in #if expression");
        this.pos++;
        return v;
      }
    } // prettier-ignore
    if (t.kind === 'num') {
      const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)([uUlL]*)$/.exec(t.text);
      if (!m) this.fail(`'${t.text}' is not an integer`);
      let s = m[1] as string;
      if (/^0[0-7]+$/.test(s)) s = '0o' + s.slice(1);
      return BigInt.asIntN(64, BigInt(s));
    }
    if (t.kind === 'char') {
      const body = t.text.slice(t.text.indexOf("'") + 1, -1);
      const c = body.startsWith('\\') ? decodeEsc(body) : body.charCodeAt(0);
      return BigInt(c);
    }
    this.pos--;
    this.fail(`unexpected '${t.text}' in #${this.at.text} expression`);
  }
}

function decodeEsc(body: string): number {
  const map: Record<string, number> = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11 };
  const e = body[1] ?? '';
  if (e === 'x') return parseInt(body.slice(2), 16) & 0xff;
  if (/[0-7]/.test(e)) return parseInt(body.slice(1), 8) & 0xff;
  return map[e] ?? e.charCodeAt(0);
}
