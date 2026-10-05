/**
 * Code generation (CC-05): typed AST -> RV32IM assembly, ilp32 calling
 * convention (GCC compatible). A tree-walking generator: every local lives in
 * the stack frame (addressed from s0), expression temporaries live in
 * registers (t0-t4, then callee-saved s1-s11), and live t-registers are saved
 * around calls. Values narrower than 32 bits are kept sign/zero-extended;
 * 64-bit values use a register pair.
 */

import type { AsmOperand, BinOp, Expr, InitData, Obj, Program, Stmt } from './ast';
import type { Diags, Loc } from './diag';
import {
  type Type,
  alignOf,
  alignUp,
  is64,
  isInteger,
  isRecord,
  sizeOf,
  ty,
  typeName,
} from './types';

const NAMES = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
  's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11',
  't3', 't4', 't5', 't6',
]; // prettier-ignore

const T_POOL = [5, 6, 7, 28, 29];
const S_POOL = [9, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
const POOL = [...T_POOL, ...S_POOL];
const ZERO = 0;
const FP = 8;
const A0 = 10;
const T5 = 30;
const T6 = 31;

const R = (r: number): string => NAMES[r] ?? `x${r}`;
const fits12 = (v: number): boolean => v >= -2048 && v <= 2047;

class CodegenError extends Error {
  constructor(
    readonly loc: Loc,
    message: string,
    readonly outOfRegisters = false,
  ) {
    super(message);
  }
}

/** A value in registers: `r` (and `hi` for 64-bit). Aggregates: `r` holds the address. */
interface Val {
  r: number;
  hi?: number;
  /** `r` is a register variable's home: read it, never write or free it. */
  b?: boolean;
}

type Addr = { k: 'reg'; r: number; off: number; own: boolean } | { k: 'sym'; sym: string; off: number };

interface LV {
  addr: Addr;
  type: Type;
  bit?: { w: number; bo: number };
  /** Register variable. */
  reg?: number;
  /** Member of a packed struct: access byte by byte. */
  unaligned?: boolean;
}

/** Where an argument goes under the ilp32 convention. */
interface ArgLoc {
  /** a-register numbers (0-7) holding the words, in order. */
  regs: number[];
  /** Stack offset of the words not in registers (from the outgoing sp / incoming s0). */
  stack?: number;
  /** Number of words on the stack. */
  stackWords: number;
  /** Large struct passed by reference. */
  byRef: boolean;
}

export interface AsmLine {
  text: string;
  line: number;
  /** Inline asm text: the peephole leaves it alone. */
  raw?: boolean;
}

export interface FnDebug {
  name: string;
  asmName: string;
  line: number;
  endLine: number;
  /**
   * Locals and parameters: `offset` from s0 (the frame pointer) when in
   * memory, or `reg` (an ABI register name such as "s1") when kept in a register.
   */
  locals: { name: string; type: string; offset: number; size: number; line: number; reg?: string }[];
}

export interface CodegenResult {
  lines: AsmLine[];
  debug: FnDebug[];
  helpers: Set<string>;
}

/** Classify call arguments (shared by caller and callee). */
export function classifyArgs(types: Type[], firstReg: number, nNamed: number): { locs: ArgLoc[]; stackBytes: number; gpUsed: number } {
  let next = firstReg;
  let stack = 0;
  let forceStack = false;
  const locs: ArgLoc[] = [];
  types.forEach((t, i) => {
    const variadic = i >= nNamed;
    const size = sizeOf(t);
    const byRef = isRecord(t) && size > 8;
    const words = byRef ? 1 : Math.max(1, Math.ceil(size / 4));
    const align8 = !byRef && alignOf(t) === 8 && size <= 8;
    if (words === 1) {
      if (next < 8 && !forceStack) locs.push({ regs: [next++], stackWords: 0, byRef });
      else {
        locs.push({ regs: [], stack, stackWords: 1, byRef });
        stack += 4;
      }
      return;
    }
    if (variadic && align8 && next % 2 === 1 && next < 8) next++;
    if (next <= 6 && !forceStack) {
      locs.push({ regs: [next, next + 1], stackWords: 0, byRef });
      next += 2;
    } else if (next === 7 && !forceStack && !(variadic && align8)) {
      locs.push({ regs: [7], stack, stackWords: 1, byRef });
      next = 8;
      stack += 4;
    } else {
      if (align8) stack = alignUp(stack, 8);
      locs.push({ regs: [], stack, stackWords: 2, byRef });
      stack += 8;
      next = 8;
      if (variadic) forceStack = true;
    }
  });
  return { locs, stackBytes: stack, gpUsed: Math.min(next, 8) };
}

export class Codegen {
  private out: AsmLine[] = [];
  private curLine = 0;
  private helpers = new Set<string>();
  private debug: FnDebug[] = [];

  // per function
  private fn!: Obj;
  private body: AsmLine[] = [];
  private used = new Set<number>();
  private usedS = new Set<number>();
  private cursor = 0; // bytes of frame used below s0
  private outArgs = 0;
  private vaSize = 0;
  private gpUsed = 0;
  private namedStack = 0;
  private tSlots = new Map<number, number>();
  private retLabel = '';
  private retPtrOff = 0;
  private readonly labels: { next: number };

  constructor(
    private prog: Program,
    private diags: Diags,
    labels: { next: number },
    private mainFile: string,
    private labelPrefix = '',
    private regVarsOn = true,
  ) {
    this.labels = labels;
  }

  // ------------------------------------------------------------------ output

  private emit(s: string): void {
    this.body.push({ text: `\t${s}`, line: this.curLine });
  }

  /** Mark that no temporary register is live here (for the peephole). */
  private kill(): void {
    if (this.nested === 0) this.body.push({ text: KILL, line: this.curLine });
  }

  /** > 0 while generating statements inside an expression (statement expressions, compound literals). */
  private nested = 0;

  private emitRaw(lines: string[]): void {
    for (const l of lines) {
      const isLabel = /^[A-Za-z0-9_.$]+:$/.test(l);
      this.body.push({ text: isLabel ? l : `\t${l}`, line: this.curLine, raw: true });
    }
  }

  private label(l: string): void {
    this.body.push({ text: `${l}:`, line: this.curLine });
  }

  private newLabel(): string {
    return `.L${this.labelPrefix}${this.labels.next++}`;
  }

  private plabel(n: number): string {
    return `.L${this.labelPrefix}${n}`;
  }

  /** rd = s0 + off */
  private frameAddrInto(rd: number, off: number): void {
    if (fits12(off)) this.emit(`addi ${R(rd)}, s0, ${off}`);
    else {
      this.emit(`li ${R(rd)}, ${off}`);
      this.emit(`add ${R(rd)}, ${R(rd)}, s0`);
    }
  }

  private at(line: number): void {
    if (line) this.curLine = line;
  }

  private fail(loc: Loc, msg: string): never {
    throw new CodegenError(loc, msg);
  }

  // ------------------------------------------------------------------ registers

  /** Registers available for temporaries in this function. */
  private pool: number[] = POOL;

  private alloc(loc?: Loc): number {
    for (const r of this.pool) {
      if (!this.used.has(r)) {
        this.used.add(r);
        if (S_POOL.includes(r)) this.usedS.add(r);
        return r;
      }
    }
    throw new CodegenError(loc ?? this.fn.loc, 'this expression is too complex (ran out of registers); split it into smaller statements', true);
  }

  private free(v: Val | number | undefined): void {
    if (v === undefined) return;
    if (typeof v === 'number') {
      this.used.delete(v);
      return;
    }
    if (!v.b) this.used.delete(v.r);
    if (v.hi !== undefined) this.used.delete(v.hi);
  }

  /** A value whose register may be overwritten (copies register variables). */
  private mut(v: Val): Val {
    if (!v.b) return v;
    const r = this.alloc();
    this.emit(`mv ${R(r)}, ${R(v.r)}`);
    return v.hi !== undefined ? { r, hi: v.hi } : { r };
  }

  /** Destination register for an operation on `v`: in place, or a fresh one for register variables. */
  private dst(v: Val): number {
    return v.b ? this.alloc() : v.r;
  }

  private freeAddr(a: Addr): void {
    if (a.k === 'reg' && a.own) this.free(a.r);
  }

  /** Reserve frame bytes; returns the s0-relative offset. */
  private slot(size: number, align: number): number {
    this.cursor = alignUp(this.cursor + Math.max(size, 1), Math.max(align, 1));
    return -this.cursor;
  }

  // ------------------------------------------------------------------ memory access helpers

  private symText(sym: string, off: number): string {
    return off === 0 ? sym : off > 0 ? `${sym}+${off}` : `${sym}${off}`;
  }

  /** Emit `op rt, addr+extra`. Loads use rt as scratch; stores use t6. */
  private mem(op: string, rt: number, a: Addr, extra: number, isStore: boolean): void {
    if (a.k === 'sym') {
      const base = isStore ? T6 : rt;
      const s = this.symText(a.sym, a.off + extra);
      this.emit(`lui ${R(base)}, %hi(${s})`);
      this.emit(`${op} ${R(rt)}, %lo(${s})(${R(base)})`);
      return;
    }
    const off = a.off + extra;
    if (fits12(off)) {
      this.emit(`${op} ${R(rt)}, ${off}(${R(a.r)})`);
      return;
    }
    const s = isStore || rt === a.r ? T6 : rt;
    this.emit(`li ${R(s)}, ${off}`);
    this.emit(`add ${R(s)}, ${R(s)}, ${R(a.r)}`);
    this.emit(`${op} ${R(rt)}, 0(${R(s)})`);
  }

  private loadOp(t: Type): string {
    const size = sizeOf(t);
    if (t.kind === 'bool') return 'lbu';
    if (size === 1) return t.unsigned ? 'lbu' : 'lb';
    if (size === 2) return t.unsigned ? 'lhu' : 'lh';
    return 'lw';
  }

  private storeOp(t: Type): string {
    const size = sizeOf(t);
    return size === 1 ? 'sb' : size === 2 ? 'sh' : 'sw';
  }

  /** Put an address in a register. */
  private addrReg(a: Addr): number {
    if (a.k === 'sym') {
      const r = this.alloc();
      this.emit(`la ${R(r)}, ${this.symText(a.sym, a.off)}`);
      return r;
    }
    if (a.off === 0 && a.own) return a.r;
    const r = a.own ? a.r : this.alloc();
    if (fits12(a.off)) this.emit(`addi ${R(r)}, ${R(a.r)}, ${a.off}`);
    else {
      this.emit(`li ${R(T6)}, ${a.off}`);
      this.emit(`add ${R(r)}, ${R(a.r)}, ${R(T6)}`);
    }
    return r;
  }

  private frameAddr(off: number): Addr {
    return { k: 'reg', r: FP, off, own: false };
  }

  // ------------------------------------------------------------------ program

  run(): CodegenResult {
    const emitted = this.reachable();
    for (const f of this.prog.functions) {
      if (!f.body || !emitted.has(f)) continue;
      try {
        this.genFunction(f);
      } catch (e) {
        if (e instanceof CodegenError) this.diags.error(e.loc, e.message);
        else throw e;
      }
    }
    for (const t of this.prog.toplevelAsm) {
      this.out.push({ text: '\t.text', line: t.line });
      for (const l of t.text.split('\n')) this.out.push({ text: l, line: t.line });
    }
    this.genData(emitted);
    return { lines: this.out, debug: this.debug, helpers: this.helpers };
  }

  /** Drop static functions and data nobody references. */
  private reachable(): Set<Obj> {
    const seen = new Set<Obj>();
    const work: Obj[] = [];
    const add = (o: Obj): void => {
      if (seen.has(o)) return;
      seen.add(o);
      work.push(o);
    };
    for (const f of this.prog.functions) if (f.body && (!f.isStatic || f.attrs.used)) add(f);
    for (const g of this.prog.globals) if (g.isDefinition && !g.isExtern && (!g.isStatic || g.attrs.used)) add(g);
    while (work.length) {
      const o = work.pop() as Obj;
      for (const r of o.refs ?? []) add(r);
    }
    return seen;
  }

  // ------------------------------------------------------------------ data

  private genData(emitted: Set<Obj>): void {
    for (const g of this.prog.globals) {
      if (!g.isDefinition || g.isExtern || g.isFunction || !emitted.has(g)) continue;
      const size = sizeOf(g.type);
      const align = Math.max(alignOf(g.type), g.attrs.aligned ?? 0, size >= 8 && g.type.kind === 'array' ? 4 : 1);
      const line = g.line;
      const push = (text: string): void => {
        this.out.push({ text, line });
      };
      const zero = !g.init || (g.init.bytes.every((b) => b === 0) && g.init.relocs.length === 0);
      const ro = g.isLiteral || (g.type.isConst || (g.type.kind === 'array' && g.type.base?.isConst)) && !zero;
      let section = g.attrs.section ? `.section ${g.attrs.section}` : zero ? '.bss' : ro ? '.section .rodata' : '.data';
      if (section === '.bss' && g.type.isConst && !g.attrs.section) section = '.section .rodata';
      push(`\t${section}`);
      if (!g.isStatic) push(`\t${g.attrs.weak ? '.weak' : '.globl'} ${g.asmName}`);
      if (align > 1) push(`\t.align ${Math.log2(align)}`);
      push(`${g.asmName}:`);
      if (zero && !(g.attrs.section && !/bss/.test(g.attrs.section))) {
        push(`\t.zero ${Math.max(size, 1)}`);
        continue;
      }
      if (zero) {
        push(`\t.zero ${Math.max(size, 1)}`);
        continue;
      }
      for (const l of dataLines(g.init as InitData, g.isLiteral === true && g.type.base?.size === 1)) push(`\t${l}`);
    }
  }

  // ------------------------------------------------------------------ functions

  private genFunction(f: Obj): void {
    this.fn = f;
    this.body = [];
    this.used = new Set();
    this.usedS = new Set();
    this.tSlots = new Map();
    this.outArgs = 0;
    this.curLine = f.line;
    const ft = f.type;
    const variadic = !!ft.variadic;
    this.vaSize = variadic ? 32 : 0;
    this.cursor = this.vaSize + 8;
    this.retLabel = this.newLabel();
    const naked = !!f.attrs.naked;
    const ret = ft.ret ?? ty.void;
    const bigRet = isRecord(ret) && sizeOf(ret) > 8;

    // register variables
    const leaf = !variadic && !f.attrs.interrupt && !hasNode(f.body, (n) => n.kind === 'asm' || containsCallNode(n));
    const regVars = naked || !this.regVarsOn ? new Map<Obj, number>() : allocateRegisters(f, leaf);
    this.pool = POOL.filter((r) => ![...regVars.values()].includes(r));
    for (const [o, r] of regVars) {
      o.reg = r;
      if (S_POOL.includes(r)) this.usedS.add(r);
    }

    // locals (params first)
    const debugLocals: FnDebug['locals'] = [];
    const params = f.params ?? [];
    const cls = classifyArgs(params.map((p) => p.type), bigRet ? 1 : 0, params.length);
    this.gpUsed = cls.gpUsed;
    this.namedStack = cls.stackBytes;
    if (bigRet) this.retPtrOff = this.slot(4, 4);
    for (const o of f.locals ?? []) {
      const pi = params.indexOf(o);
      const loc = pi >= 0 ? cls.locs[pi] : undefined;
      if (o.reg !== undefined) {
        o.offset = 0;
      } else if (loc && loc.regs.length === 0 && !loc.byRef) {
        o.offset = loc.stack ?? 0; // in the caller's frame, above s0
      } else {
        const a = Math.min(Math.max(alignOf(o.type), o.attrs.aligned ?? 0), 16);
        o.offset = this.slot(alignUp(sizeOf(o.type), 4), Math.max(a, 4));
      }
      debugLocals.push({
        name: o.name,
        type: typeName(o.type),
        offset: o.offset,
        size: sizeOf(o.type),
        line: o.line,
        ...(o.reg !== undefined ? { reg: R(o.reg) } : {}),
      });
    }

    // body
    if (!naked) {
      // store incoming params
      if (bigRet) this.mem('sw', A0, this.frameAddr(this.retPtrOff), 0, true);
      params.forEach((p, i) => {
        const loc = cls.locs[i];
        if (!loc) return;
        const off = p.offset ?? 0;
        if (loc.byRef) {
          // pointer to the caller's copy: copy into our slot
          const pr = this.alloc();
          if (loc.regs.length) this.emit(`mv ${R(pr)}, ${R(A0 + (loc.regs[0] ?? 0))}`);
          else this.mem('lw', pr, this.frameAddr(loc.stack ?? 0), 0, false);
          const dst = this.addrReg(this.frameAddr(off));
          this.copyMem(dst, pr, sizeOf(p.type), alignOf(p.type));
          this.free(dst);
          this.free(pr);
          return;
        }
        if (p.reg !== undefined) {
          if (loc.regs.length) {
            if (p.reg !== A0 + (loc.regs[0] ?? 0)) this.emit(`mv ${R(p.reg)}, ${R(A0 + (loc.regs[0] ?? 0))}`);
          }
          else this.mem(this.loadOp(p.type), p.reg, this.frameAddr(loc.stack ?? 0), 0, false);
          return;
        }
        if (loc.regs.length === 0) return;
        const size = sizeOf(p.type);
        if (isRecord(p.type) || size === 8) {
          loc.regs.forEach((r, k) => this.mem('sw', A0 + r, this.frameAddr(off), 4 * k, true));
          if (loc.stackWords) {
            this.mem('lw', T5, this.frameAddr(loc.stack ?? 0), 0, false);
            this.mem('sw', T5, this.frameAddr(off), 4, true);
          }
        } else this.mem(this.storeOp(p.type), A0 + (loc.regs[0] ?? 0), this.frameAddr(off), 0, true);
      });
      if (variadic) for (let i = 0; i < 8; i++) this.emit(`sw ${R(A0 + i)}, ${-32 + 4 * i}(s0)`);
    }
    if (f.body) this.genStmt(f.body);
    // falling off the end of main returns 0
    if (!naked) {
      if (f.name === 'main' && ret.kind !== 'void') this.emit('li a0, 0');
      this.curLine = f.endLine ?? this.curLine;
    }

    this.curLine = f.endLine ?? this.curLine;
    this.label(this.retLabel);
    const bodyLines = peephole(this.body, new Set([...regVars.values()].map((r) => R(r))));

    // prologue / epilogue
    const interrupt = f.attrs.interrupt;
    const saved = [...this.usedS].sort((a, b) => a - b);
    if (interrupt) {
      for (const r of [5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 28, 29, 30, 31]) if (!saved.includes(r)) saved.push(r);
    }
    const va = this.vaSize;
    // The frame pointer is needed when anything lives in the frame.
    const needFP = !!interrupt || variadic || this.cursor > va + 8 || bodyLines.some((l) => /\bs0\b/.test(l.text));
    const makesCalls = bodyLines.some((l) => /^\t(call|tail|jalr)\b/.test(l.text) || (l.raw === true && /\b(call|jal|jalr)\b/.test(l.text)));
    const pro: AsmLine[] = [];
    const epi: AsmLine[] = [];
    const P = (s: string): void => {
      pro.push({ text: `\t${s}`, line: f.line });
    };
    const E = (s: string): void => {
      epi.push({ text: `\t${s}`, line: f.endLine ?? f.line });
    };
    const savedOff = (i: number): number => this.outArgs + 4 * i;
    if (!naked && !needFP) {
      // no frame pointer: save ra (if calls) and callee-saved registers only
      const saveRA = makesCalls;
      const frame = alignUp(4 * saved.length + (saveRA ? 4 : 0) + this.outArgs, 16);
      if (frame) {
        P(`addi sp, sp, -${frame}`);
        if (saveRA) P(`sw ra, ${frame - 4}(sp)`);
        saved.forEach((r, i) => P(`sw ${R(r)}, ${savedOff(i)}(sp)`));
        saved.forEach((r, i) => E(`lw ${R(r)}, ${savedOff(i)}(sp)`));
        if (saveRA) E(`lw ra, ${frame - 4}(sp)`);
        E(`addi sp, sp, ${frame}`);
      }
      E('ret');
    } else if (!naked) {
      const frame = alignUp(this.cursor + 4 * saved.length + this.outArgs, 16);
      if (frame <= 2032) {
        P(`addi sp, sp, -${frame}`);
        P(`sw ra, ${frame - va - 4}(sp)`);
        P(`sw s0, ${frame - va - 8}(sp)`);
        P(`addi s0, sp, ${frame}`);
      } else {
        const first = va + 16;
        P(`addi sp, sp, -${first}`);
        P(`sw ra, ${first - va - 4}(sp)`);
        P(`sw s0, ${first - va - 8}(sp)`);
        P(`addi s0, sp, ${first}`);
        let rest = frame - first;
        if (interrupt) {
          while (rest > 0) {
            const step = Math.min(rest, 2048);
            P(`addi sp, sp, -${step}`);
            rest -= step;
          }
        } else {
          P(`li t6, ${rest}`);
          P('sub sp, sp, t6');
        }
      }
      saved.forEach((r, i) => P(`sw ${R(r)}, ${savedOff(i)}(sp)`));
      saved.forEach((r, i) => E(`lw ${R(r)}, ${savedOff(i)}(sp)`));
      if (frame <= 2032) {
        E(`lw ra, ${frame - va - 4}(sp)`);
        E(`lw s0, ${frame - va - 8}(sp)`);
        E(`addi sp, sp, ${frame}`);
      } else {
        E(`lw ra, ${-va - 4}(s0)`);
        E(`addi sp, s0, ${-va - 8}`);
        E('lw s0, 0(sp)');
        E(`addi sp, sp, ${va + 8}`);
      }
      E(interrupt === 'supervisor' ? 'sret' : interrupt ? 'mret' : 'ret');
    }

    const header: AsmLine[] = [];
    const H = (text: string): void => {
      header.push({ text, line: f.line });
    };
    H(`\t${f.attrs.section ? `.section ${f.attrs.section}` : '.text'}`);
    if (!f.isStatic) H(`\t${f.attrs.weak ? '.weak' : '.globl'} ${f.asmName}`);
    H(`\t.align ${Math.max(2, Math.log2(f.attrs.aligned ?? 4))}`);
    H(`${f.asmName}:`);
    // a return label right before the epilogue that only `ret`s: jumps to it become ret
    const all = [...header, ...pro, ...bodyLines, ...epi];
    this.out.push(...relaxBranches(all));
    this.debug.push({ name: f.name, asmName: f.asmName, line: f.line, endLine: f.endLine ?? f.line, locals: debugLocals });
  }

  // ------------------------------------------------------------------ statements

  /** Spill held values and call arguments eagerly (retry after running out of registers). */
  private conservative = false;

  private genStmt(s: Stmt): void {
    if (this.conservative || s.kind === 'block' || s.kind === 'label') {
      this.genStmt1(s);
      return;
    }
    const mark = { body: this.body.length, used: new Set(this.used), usedS: new Set(this.usedS), labels: this.labels.next };
    try {
      this.genStmt1(s);
    } catch (e) {
      if (!(e instanceof CodegenError) || !e.outOfRegisters) throw e;
      this.body.length = mark.body;
      this.used = mark.used;
      this.usedS = mark.usedS;
      this.conservative = true;
      try {
        this.genStmt1(s);
      } finally {
        this.conservative = false;
      }
    }
  }

  private genStmt1(s: Stmt): void {
    this.at(s.line);
    switch (s.kind) {
      case 'block':
        for (const x of s.stmts) this.genStmt(x);
        return;
      case 'null':
        return;
      case 'expr':
        this.free(this.genExpr(discarded(s.expr)));
        this.checkLeak(s.loc);
        this.kill();
        return;
      case 'if': {
        const els = this.newLabel();
        this.branch(s.cond, els, false);
        this.kill();
        this.genStmt(s.then);
        if (s.else) {
          const end = this.newLabel();
          this.emit(`j ${end}`);
          this.label(els);
          this.genStmt(s.else);
          this.label(end);
        } else this.label(els);
        return;
      }
      case 'loop': {
        if (s.init) this.genStmt(s.init);
        const top = this.newLabel();
        const brk = this.plabel(s.brk);
        const cont = this.plabel(s.cont);
        if (s.doWhile) {
          this.label(top);
          this.genStmt(s.body);
          this.label(cont);
          this.at(s.line);
          if (s.cond) this.branch(s.cond, top, true);
          this.label(brk);
          return;
        }
        // for / while: test at the bottom, enter through the test
        const test = this.newLabel();
        if (s.cond && !(s.cond.kind === 'num' && s.cond.value !== 0n)) this.emit(`j ${test}`);
        this.label(top);
        this.genStmt(s.body);
        this.label(cont);
        this.at(s.line);
        if (s.inc) {
          this.free(this.genExpr(discarded(s.inc)));
          this.kill();
        }
        this.label(test);
        this.at(s.line);
        if (s.cond && !(s.cond.kind === 'num' && s.cond.value !== 0n)) this.branch(s.cond, top, true);
        else this.emit(`j ${top}`);
        this.kill();
        this.label(brk);
        return;
      }
      case 'switch': {
        const v = this.genExpr(s.cond);
        if (v.hi !== undefined) {
          for (const c of s.cases) {
            if (c.lo !== c.hi) this.fail(s.loc, 'case ranges are not supported when switching on a long long');
            const u = BigInt.asUintN(64, c.lo);
            const skip = this.newLabel();
            this.emit(`li t6, ${Number(BigInt.asIntN(32, u))}`);
            this.emit(`bne ${R(v.r)}, t6, ${skip}`);
            this.emit(`li t6, ${Number(BigInt.asIntN(32, u >> 32n))}`);
            this.emit(`beq ${R(v.hi)}, t6, ${this.plabel(c.label)}`);
            this.label(skip);
          }
          this.free(v);
          this.emit(`j ${this.plabel(s.defaultLabel ?? s.brk)}`);
          this.genStmt(s.body);
          this.label(this.plabel(s.brk));
          return;
        }
        const r = R(v.r);
        for (const c of s.cases) {
          const l = this.plabel(c.label);
          if (c.lo === c.hi) {
            const n = Number(BigInt.asIntN(32, c.lo));
            if (n === 0) this.emit(`beqz ${r}, ${l}`);
            else {
              this.emit(`li t6, ${n}`);
              this.emit(`beq ${r}, t6, ${l}`);
            }
          } else {
            this.emit(`li t6, ${Number(BigInt.asIntN(32, c.lo))}`);
            this.emit(`sub t6, ${r}, t6`);
            this.emit(`li t5, ${Number(BigInt.asUintN(32, c.hi - c.lo))}`);
            this.emit(`bleu t6, t5, ${l}`);
          }
        }
        this.free(v);
        this.emit(`j ${this.plabel(s.defaultLabel ?? s.brk)}`);
        this.genStmt(s.body);
        this.label(this.plabel(s.brk));
        return;
      }
      case 'label':
        this.label(this.plabel(s.label));
        this.genStmt(s.stmt);
        return;
      case 'jump':
        this.emit(`j ${this.plabel(s.label)}`);
        return;
      case 'return':
        this.genReturn(s.expr, s.loc);
        return;
      case 'asm':
        this.genAsm(s);
        return;
    }
  }

  private checkLeak(loc: Loc): void {
    if (this.used.size && this.nested === 0) {
      this.used.clear();
      void loc;
    }
  }

  private genReturn(e: Expr | undefined, loc: Loc): void {
    if (e) {
      const t = e.type;
      const v = this.genExpr(e);
      if (t.kind === 'void' || (this.fn.type.ret ?? ty.void).kind === 'void') {
        this.free(v);
      } else if (isRecord(t)) {
        const size = sizeOf(t);
        if (size > 8) {
          const p = this.alloc(loc);
          this.mem('lw', p, this.frameAddr(this.retPtrOff), 0, false);
          this.copyMem(p, v.r, size, alignOf(t));
          this.emit(`mv a0, ${R(p)}`);
          this.free(p);
        } else {
          const src = this.alignedCopy(v.r, t);
          this.emit(`lw a0, 0(${R(src)})`);
          if (size > 4) this.emit(`lw a1, 4(${R(src)})`);
          if (src !== v.r) this.free(src);
        }
        this.free(v);
      } else {
        this.emit(`mv a0, ${R(v.r)}`);
        if (v.hi !== undefined) this.emit(`mv a1, ${R(v.hi)}`);
        this.free(v);
      }
    }
    this.emit(`j ${this.retLabel}`);
    this.kill();
  }

  /** For records with alignment < 4, copy to an aligned temporary so lw works. */
  private alignedCopy(addr: number, t: Type): number {
    if (alignOf(t) >= 4) return addr;
    const off = this.slot(8, 8);
    const d = this.addrReg(this.frameAddr(off));
    this.copyMem(d, addr, sizeOf(t), alignOf(t));
    return d;
  }

  // ------------------------------------------------------------------ inline asm

  private genAsm(s: Extract<Stmt, { kind: 'asm' }>): void {
    const all: AsmOperand[] = [...s.outputs, ...s.inputs];
    if (all.length === 0 && s.clobbers.length === 0 && s.outputs.length === 0) {
      this.emitRaw(splitAsm(s.template));
      return;
    }
    // registers named in clobbers are not available for operands
    const clob = new Set<number>();
    for (const c of s.clobbers) {
      const i = NAMES.indexOf(c.replace(/^%/, ''));
      const j = /^x(\d+)$/.exec(c) ? Number(c.slice(1)) : -1;
      const r = i >= 0 ? i : j;
      if (r > 0) {
        clob.add(r);
        if (S_POOL.includes(r)) this.usedS.add(r);
      }
    }
    const blocked = [...clob].filter((r) => !this.used.has(r));
    for (const r of blocked) this.used.add(r);
    const text: string[] = [];
    const zeros = new Set<number>();
    const vals: (Val | undefined)[] = [];
    const binds: { phys: number; v: number }[] = [];
    const regOf = (e: Expr): number | undefined => {
      if (e.kind === 'var' && e.obj.asmReg) {
        const n = NAMES.indexOf(e.obj.asmReg);
        const m = /^x(\d+)$/.exec(e.obj.asmReg);
        return n >= 0 ? n : m ? Number(m[1]) : undefined;
      }
      return undefined;
    };
    // outputs
    s.outputs.forEach((o, i) => {
      const c = o.constraint.replace(/^[=+&]+/, '');
      if (c.includes('m') && !c.includes('r')) {
        const lv = this.lvalue(o.expr);
        const r = this.addrReg(lv.addr);
        text[i] = `0(${R(r)})`;
        vals[i] = { r };
        return;
      }
      const phys = regOf(o.expr);
      const r = this.alloc(o.expr.loc);
      if (o.constraint.startsWith('+')) {
        const lv = this.lvalue(o.expr);
        const v = this.loadLV(lv);
        this.freeAddr(lv.addr);
        this.emit(`mv ${R(r)}, ${R(v.r)}`);
        this.free(v);
      }
      vals[i] = { r };
      if (phys !== undefined) {
        binds.push({ phys, v: r });
        text[i] = R(phys);
      } else text[i] = R(r);
    });
    // inputs
    s.inputs.forEach((o, k) => {
      const i = s.outputs.length + k;
      const c = o.constraint;
      const cv = this.constValue(o.expr);
      if (/^\d+$/.test(c)) {
        // tied to an output: put the value in that output's register
        const ti = Number(c);
        const target = vals[ti];
        const v = this.genExpr(o.expr);
        if (target) this.emit(`mv ${R(target.r)}, ${R(v.r)}`);
        this.free(v);
        text[i] = text[ti] ?? '';
        return;
      }
      if (cv !== undefined && (/[inIK]/.test(c) || (c.includes('J') && cv === 0n))) {
        if (!c.includes('r') || (c.includes('K') && cv >= 0n && cv < 32n) || (c.includes('I') && cv >= -2048n && cv < 2048n) || /^[in]+$/.test(c)) {
          text[i] = String(Number(BigInt.asIntN(32, cv)));
          return;
        }
      }
      if (c.includes('m') && !c.includes('r')) {
        const lv = this.lvalue(o.expr);
        const r = this.addrReg(lv.addr);
        text[i] = `0(${R(r)})`;
        vals[i] = { r };
        return;
      }
      if (cv === 0n && c.includes('J')) {
        text[i] = 'zero';
        return;
      }
      const phys = regOf(o.expr);
      const v = this.genExpr(o.expr);
      vals[i] = v;
      if (phys !== undefined) {
        binds.push({ phys, v: v.r });
        text[i] = R(phys);
      } else text[i] = R(v.r);
      if (cv === 0n) zeros.add(i);
    });
    // move bound operands into their fixed registers
    for (const b of binds) {
      if (S_POOL.includes(b.phys)) this.usedS.add(b.phys);
      this.emit(`mv ${R(b.phys)}, ${R(b.v)}`);
    }
    const names = all.map((o) => o.name);
    const tmpl = s.template.replace(/%(%|z?\d+|z?\[[A-Za-z_]\w*\])/g, (m, g: string) => {
      if (g === '%') return '%';
      const z = g.startsWith('z');
      const ref = z ? g.slice(1) : g;
      const idx = ref.startsWith('[') ? names.indexOf(ref.slice(1, -1)) : Number(ref);
      if (idx < 0 || idx >= all.length) {
        this.diags.error(s.loc, `asm operand '${m}' does not exist`);
        return m;
      }
      if (z) {
        if (zeros.has(idx)) return 'zero';
      }
      return text[idx] ?? m;
    });
    this.emitRaw(splitAsm(tmpl));
    for (const r of blocked) this.used.delete(r);
    // outputs back to their lvalues
    s.outputs.forEach((o, i) => {
      const v = vals[i];
      if (!v) return;
      const c = o.constraint.replace(/^[=+&]+/, '');
      if (c.includes('m') && !c.includes('r')) {
        this.free(v);
        return;
      }
      const phys = regOf(o.expr);
      if (phys !== undefined) this.emit(`mv ${R(v.r)}, ${R(phys)}`);
      const lv = this.lvalue(o.expr);
      const nv = this.normalize(v, o.expr.type);
      this.storeLV(lv, nv);
      this.freeAddr(lv.addr);
      this.free(nv);
    });
    s.inputs.forEach((_, k) => this.free(vals[s.outputs.length + k]));
  }

  private constValue(e: Expr): bigint | undefined {
    if (e.kind === 'num') return e.value;
    if (e.kind === 'cast') return this.constValue(e.operand);
    return undefined;
  }

  // ------------------------------------------------------------------ lvalues

  private lvalue(e: Expr): LV {
    switch (e.kind) {
      case 'var': {
        const o = e.obj;
        if (o.reg !== undefined) return { addr: this.frameAddr(0), type: e.type, reg: o.reg };
        if (o.isLocal) return { addr: this.frameAddr(o.offset ?? 0), type: e.type };
        return { addr: { k: 'sym', sym: o.asmName, off: 0 }, type: e.type };
      }
      case 'deref': {
        const p = e.operand;
        // fold constant offsets: *(p + c)
        if (p.kind === 'padd' && p.idx.kind === 'num') {
          const off = Number(p.idx.value) * p.scale * (p.neg ? -1 : 1);
          if (fits12(off) && fits12(off + 8)) {
            const base = this.ptrBase(p.ptr);
            if (base.k === 'reg') return { addr: { ...base, off: base.off + off }, type: e.type };
            return { addr: { ...base, off: base.off + off }, type: e.type };
          }
        }
        return { addr: this.ptrBase(p), type: e.type };
      }
      case 'member': {
        const b = this.lvalue(e.base);
        const m = e.member;
        const unaligned = !!e.base.type.rec?.packed && sizeOf(e.type) > 1 && m.bitWidth === undefined;
        const addr: Addr = { ...b.addr, off: b.addr.off + m.offset } as Addr;
        if (addr.k === 'reg' && !fits12(addr.off + 8)) {
          const r = this.addrReg(addr);
          return { addr: { k: 'reg', r, off: 0, own: true }, type: e.type, ...(m.bitWidth !== undefined ? { bit: { w: m.bitWidth, bo: m.bitOffset ?? 0 } } : {}) };
        }
        return {
          addr,
          type: e.type,
          ...(m.bitWidth !== undefined ? { bit: { w: m.bitWidth, bo: m.bitOffset ?? 0 } } : {}),
          ...(unaligned || b.unaligned ? { unaligned: true } : {}),
        };
      }
      default: {
        // rvalue aggregates (call results, ?:, initvar, ...): their value is an address
        const v = this.genExpr(e);
        return { addr: { k: 'reg', r: v.r, off: 0, own: true }, type: e.type };
      }
    }
  }

  /** Address held by a pointer-valued expression; globals' addresses stay symbolic. */
  private ptrBase(p: Expr): Addr {
    if (p.kind === 'addr') {
      const lv = this.lvalue(p.operand);
      if (lv.addr.k === 'sym' || (lv.addr.k === 'reg' && !lv.addr.own)) return lv.addr;
      return lv.addr;
    }
    const v = this.genExpr(p);
    return { k: 'reg', r: v.r, off: 0, own: !v.b };
  }

  private loadLV(lv: LV): Val {
    const t = lv.type;
    if (lv.reg !== undefined) return { r: lv.reg, b: true };
    if (lv.unaligned && !isRecord(t) && t.kind !== 'array') {
      const a = this.addrReg(lv.addr.k === 'reg' ? { ...lv.addr, own: false } : lv.addr);
      const word = (off: number, n: number): number => {
        const r = this.alloc();
        this.emit(`lbu ${R(r)}, ${off + n - 1}(${R(a)})`);
        for (let k = n - 2; k >= 0; k--) {
          this.emit(`slli ${R(r)}, ${R(r)}, 8`);
          this.emit(`lbu t6, ${off + k}(${R(a)})`);
          this.emit(`or ${R(r)}, ${R(r)}, t6`);
        }
        return r;
      };
      const size = sizeOf(t);
      const v: Val = size === 8 ? { r: word(0, 4), hi: word(4, 4) } : { r: word(0, size) };
      this.free(a);
      return size < 4 ? this.normalize(v, t) : v;
    }
    if (is64(t)) {
      const lo = this.alloc();
      const hi = this.alloc();
      if (lv.addr.k === 'sym') {
        const a = this.addrReg(lv.addr);
        this.emit(`lw ${R(lo)}, 0(${R(a)})`);
        this.emit(`lw ${R(hi)}, 4(${R(a)})`);
        this.free(a);
      } else {
        this.mem('lw', lo, lv.addr, 0, false);
        this.mem('lw', hi, lv.addr, 4, false);
      }
      return { r: lo, hi };
    }
    const r = this.alloc();
    this.mem(this.loadOp(t), r, lv.addr, 0, false);
    if (lv.bit) {
      const bits = sizeOf(t) * 8;
      const { w, bo } = lv.bit;
      const left = 32 - bo - w;
      if (t.unsigned || t.kind === 'bool') {
        if (left) this.emit(`slli ${R(r)}, ${R(r)}, ${left}`);
        if (left + bo) this.emit(`srli ${R(r)}, ${R(r)}, ${left + bo}`);
      } else {
        if (left) this.emit(`slli ${R(r)}, ${R(r)}, ${left}`);
        if (left + bo) this.emit(`srai ${R(r)}, ${R(r)}, ${left + bo}`);
      }
      void bits;
    }
    return { r };
  }

  /** Store `v` (already converted to lv.type) into the lvalue. */
  private storeLV(lv: LV, v: Val): void {
    const t = lv.type;
    if (lv.reg !== undefined) {
      if (v.r !== lv.reg) this.emit(`mv ${R(lv.reg)}, ${R(v.r)}`);
      return;
    }
    if (lv.unaligned && !isRecord(t) && t.kind !== 'array') {
      const a = this.addrReg(lv.addr.k === 'reg' ? { ...lv.addr, own: false } : lv.addr);
      const size = sizeOf(t);
      for (let k = 0; k < size; k++) {
        const src = k < 4 ? v.r : (v.hi ?? ZERO);
        const sh = 8 * (k % 4);
        if (sh) this.emit(`srli t6, ${R(src)}, ${sh}`);
        this.emit(`sb ${sh ? 't6' : R(src)}, ${k}(${R(a)})`);
      }
      this.free(a);
      return;
    }
    if (isRecord(t) || t.kind === 'array') {
      const d = this.addrReg(lv.addr.k === 'reg' ? { ...lv.addr, own: false } : lv.addr);
      this.copyMem(d, v.r, sizeOf(t), alignOf(t));
      if (!(lv.addr.k === 'reg' && d === lv.addr.r)) this.free(d);
      return;
    }
    if (is64(t)) {
      if (lv.addr.k === 'sym') {
        const a = this.addrReg(lv.addr);
        this.emit(`sw ${R(v.r)}, 0(${R(a)})`);
        this.emit(`sw ${R(v.hi ?? ZERO)}, 4(${R(a)})`);
        this.free(a);
      } else {
        this.mem('sw', v.r, lv.addr, 0, true);
        this.mem('sw', v.hi ?? ZERO, lv.addr, 4, true);
      }
      return;
    }
    if (lv.bit) {
      const { w, bo } = lv.bit;
      const cur = this.alloc();
      const op = this.loadOp({ ...t, unsigned: true });
      this.mem(op, cur, lv.addr, 0, false);
      const mask = w >= 32 ? -1 : ((1 << w) - 1) << bo;
      const tmp = this.alloc();
      this.emit(`li t6, ${mask | 0}`);
      if (bo) this.emit(`slli ${R(tmp)}, ${R(v.r)}, ${bo}`);
      else this.emit(`mv ${R(tmp)}, ${R(v.r)}`);
      this.emit(`and ${R(tmp)}, ${R(tmp)}, t6`);
      this.emit('not t6, t6');
      this.emit(`and ${R(cur)}, ${R(cur)}, t6`);
      this.emit(`or ${R(cur)}, ${R(cur)}, ${R(tmp)}`);
      this.mem(this.storeOp(t), cur, lv.addr, 0, true);
      this.free(cur);
      this.free(tmp);
      return;
    }
    this.mem(this.storeOp(t), v.r, lv.addr, 0, true);
  }

  /** Value of a bit-field after assigning `v`: truncate and extend like a load. */
  private bitValue(lv: LV, v: Val): Val {
    if (!lv.bit) return v;
    const { w } = lv.bit;
    const sh = 32 - w;
    if (sh <= 0) return v;
    v = this.mut(v);
    this.emit(`slli ${R(v.r)}, ${R(v.r)}, ${sh}`);
    this.emit(`${lv.type.unsigned || lv.type.kind === 'bool' ? 'srli' : 'srai'} ${R(v.r)}, ${R(v.r)}, ${sh}`);
    return v;
  }

  // ------------------------------------------------------------------ copying

  /** Copy `size` bytes from [src] to [dst] (registers are preserved). */
  private copyMem(dst: number, src: number, size: number, align: number): void {
    const unit = align >= 4 ? 4 : align >= 2 ? 2 : 1;
    const [ld, st] = unit === 4 ? ['lw', 'sw'] : unit === 2 ? ['lhu', 'sh'] : ['lbu', 'sb'];
    const n = Math.floor(size / unit);
    if (n <= 16) {
      for (let i = 0; i < n; i++) {
        this.emit(`${ld} t5, ${i * unit}(${R(src)})`);
        this.emit(`${st} t5, ${i * unit}(${R(dst)})`);
      }
    } else {
      const d = this.alloc();
      const s = this.alloc();
      const end = this.alloc();
      this.emit(`mv ${R(d)}, ${R(dst)}`);
      this.emit(`mv ${R(s)}, ${R(src)}`);
      this.emit(`li t6, ${n * unit}`);
      this.emit(`add ${R(end)}, ${R(s)}, t6`);
      const top = this.newLabel();
      this.label(top);
      this.emit(`${ld} t5, 0(${R(s)})`);
      this.emit(`${st} t5, 0(${R(d)})`);
      this.emit(`addi ${R(s)}, ${R(s)}, ${unit}`);
      this.emit(`addi ${R(d)}, ${R(d)}, ${unit}`);
      this.emit(`bne ${R(s)}, ${R(end)}, ${top}`);
      this.free(d);
      this.free(s);
      this.free(end);
    }
    for (let i = n * unit; i < size; i++) {
      this.emit(`lbu t5, ${i}(${R(src)})`);
      this.emit(`sb t5, ${i}(${R(dst)})`);
    }
  }

  private zeroMem(dst: Addr, size: number, align: number): void {
    const unit = align >= 4 ? 4 : align >= 2 ? 2 : 1;
    const st = unit === 4 ? 'sw' : unit === 2 ? 'sh' : 'sb';
    const n = Math.floor(size / unit);
    if (n <= 16 && dst.k === 'reg') {
      for (let i = 0; i < n; i++) this.mem(st, ZERO, dst, i * unit, true);
      for (let i = n * unit; i < size; i++) this.mem('sb', ZERO, dst, i, true);
      return;
    }
    const d = this.addrReg(dst);
    const end = this.alloc();
    this.emit(`li t6, ${n * unit}`);
    this.emit(`add ${R(end)}, ${R(d)}, t6`);
    const top = this.newLabel();
    const own = dst.k === 'reg' && d === dst.r;
    let p = d;
    if (!own && dst.k !== 'sym') {
      p = this.alloc();
      this.emit(`mv ${R(p)}, ${R(d)}`);
    }
    if (n > 0) {
      this.label(top);
      this.emit(`${st} zero, 0(${R(p)})`);
      this.emit(`addi ${R(p)}, ${R(p)}, ${unit}`);
      this.emit(`bne ${R(p)}, ${R(end)}, ${top}`);
    }
    for (let i = 0; i < size - n * unit; i++) this.emit(`sb zero, ${i}(${R(end)})`);
    if (p !== d) this.free(p);
    this.free(end);
    if (!own) this.free(d);
  }

  // ------------------------------------------------------------------ conversions

  /** Re-extend a value so it is canonical for type `t`. */
  private normalize(v: Val, t: Type): Val {
    if (v.b && (t.kind === 'bool' || (isInteger(t) && sizeOf(t) < 4))) v = this.mut(v);
    if (t.kind === 'bool') {
      if (v.hi !== undefined) {
        this.emit(`or ${R(v.r)}, ${R(v.r)}, ${R(v.hi)}`);
        this.free(v.hi);
      }
      this.emit(`snez ${R(v.r)}, ${R(v.r)}`);
      return { r: v.r };
    }
    if (is64(t)) {
      if (v.hi === undefined) {
        const hi = this.alloc();
        this.emit(`srai ${R(hi)}, ${R(v.r)}, 31`);
        return { r: v.r, hi };
      }
      return v;
    }
    if (v.hi !== undefined) {
      this.free(v.hi);
      v = { r: v.r };
    }
    if (!isInteger(t)) return v;
    const size = sizeOf(t);
    if (size === 1) {
      if (t.unsigned) this.emit(`andi ${R(v.r)}, ${R(v.r)}, 255`);
      else {
        this.emit(`slli ${R(v.r)}, ${R(v.r)}, 24`);
        this.emit(`srai ${R(v.r)}, ${R(v.r)}, 24`);
      }
    } else if (size === 2) {
      this.emit(`slli ${R(v.r)}, ${R(v.r)}, 16`);
      this.emit(`${t.unsigned ? 'srli' : 'srai'} ${R(v.r)}, ${R(v.r)}, 16`);
    }
    return v;
  }

  private convert(v: Val, from: Type, to: Type): Val {
    if (to.kind === 'void') return v;
    if (isRecord(to) || to.kind === 'array') return v;
    const fs = from.kind === 'ptr' || from.kind === 'array' || from.kind === 'func' ? 4 : sizeOf(from);
    if (to.kind === 'bool') return this.normalize(v, to);
    if (is64(to)) {
      if (v.hi !== undefined) return v;
      v = this.mut(v);
      const hi = this.alloc();
      if (from.unsigned || from.kind === 'ptr' || from.kind === 'bool') this.emit(`li ${R(hi)}, 0`);
      else this.emit(`srai ${R(hi)}, ${R(v.r)}, 31`);
      return { r: v.r, hi };
    }
    if (v.hi !== undefined) {
      this.free(v.hi);
      v = { r: v.r };
    }
    if (to.kind === 'ptr') return v;
    const ts = sizeOf(to);
    if (ts >= 4) return v;
    // narrowing or changing signedness at the same small size
    if (fs > ts || from.unsigned !== to.unsigned || from.kind === 'bool') return this.normalize(v, to);
    return v;
  }

  // ------------------------------------------------------------------ expressions

  private genExpr(e: Expr): Val {
    this.at(e.line);
    switch (e.kind) {
      case 'num': {
        if (is64(e.type)) {
          const lo = this.alloc(e.loc);
          const hi = this.alloc(e.loc);
          const u = BigInt.asUintN(64, e.value);
          this.emit(`li ${R(lo)}, ${Number(BigInt.asIntN(32, u))}`);
          this.emit(`li ${R(hi)}, ${Number(BigInt.asIntN(32, u >> 32n))}`);
          return { r: lo, hi };
        }
        const r = this.alloc(e.loc);
        this.emit(`li ${R(r)}, ${Number(BigInt.asIntN(32, e.value))}`);
        return { r };
      }
      case 'var':
      case 'deref':
      case 'member': {
        const t = e.type;
        if (t.kind === 'func') {
          if (e.kind === 'var') {
            const r = this.alloc(e.loc);
            this.emit(`la ${R(r)}, ${e.obj.asmName}`);
            return { r };
          }
        }
        const lv = this.lvalue(e);
        if (isRecord(t) || t.kind === 'array' || t.kind === 'func') {
          const r = this.addrReg(lv.addr);
          return { r };
        }
        const v = this.loadLV(lv);
        this.freeAddr(lv.addr);
        return v;
      }
      case 'addr': {
        const op = e.operand;
        if (op.kind === 'var' && op.obj.isFunction) {
          const r = this.alloc(e.loc);
          this.emit(`la ${R(r)}, ${op.obj.asmName}`);
          return { r };
        }
        if (op.kind === 'deref' && op.type.kind === 'func') return this.genExpr(op.operand);
        const lv = this.lvalue(op);
        return { r: this.addrReg(lv.addr) };
      }
      case 'cast': {
        const v = this.genExpr(e.operand);
        if (e.type.kind === 'void') {
          this.free(v);
          return { r: ZERO };
        }
        return this.convert(v, e.operand.type, e.type);
      }
      case 'binary':
        return this.genBinary(e);
      case 'padd': {
        if (e.idx.kind !== 'num') {
          const [p, i0] = this.genPair(e.ptr, e.idx);
          const i = this.scaled(i0, e.scale);
          const d = this.dst(p);
          this.emit(`${e.neg ? 'sub' : 'add'} ${R(d)}, ${R(p.r)}, ${R(i.r)}`);
          this.free(i);
          return { r: d };
        }
        const p = this.genExpr(e.ptr);
        {
          const off = Number(BigInt.asIntN(32, e.idx.value)) * e.scale * (e.neg ? -1 : 1);
          if (off === 0) return p;
          const d = this.dst(p);
          if (fits12(off)) this.emit(`addi ${R(d)}, ${R(p.r)}, ${off}`);
          else {
            this.emit(`li t6, ${off | 0}`);
            this.emit(`add ${R(d)}, ${R(p.r)}, t6`);
          }
          return { r: d };
        }
      }
      case 'pdiff': {
        const [a0, b] = this.genPair(e.lhs, e.rhs);
        const a = { r: this.dst(a0) };
        this.emit(`sub ${R(a.r)}, ${R(a0.r)}, ${R(b.r)}`);
        this.free(b);
        if (e.scale > 1) {
          if ((e.scale & (e.scale - 1)) === 0) this.emit(`srai ${R(a.r)}, ${R(a.r)}, ${Math.log2(e.scale)}`);
          else {
            this.emit(`li t6, ${e.scale}`);
            this.emit(`div ${R(a.r)}, ${R(a.r)}, t6`);
          }
        }
        return a;
      }
      case 'logand':
      case 'logor': {
        const f = this.newLabel();
        const end = this.newLabel();
        this.branch(e, f, false);
        const r = this.alloc(e.loc);
        this.emit(`li ${R(r)}, 1`);
        this.emit(`j ${end}`);
        this.label(f);
        this.emit(`li ${R(r)}, 0`);
        this.label(end);
        return { r };
      }
      case 'lognot': {
        const v = this.mut(this.genExpr(e.operand));
        if (v.hi !== undefined) {
          this.emit(`or ${R(v.r)}, ${R(v.r)}, ${R(v.hi)}`);
          this.free(v.hi);
        }
        this.emit(`seqz ${R(v.r)}, ${R(v.r)}`);
        return { r: v.r };
      }
      case 'neg': {
        const v = this.mut(this.genExpr(e.operand));
        if (v.hi !== undefined) {
          // -(hi:lo) = ~(hi:lo) + 1
          this.emit(`snez t6, ${R(v.r)}`);
          this.emit(`neg ${R(v.r)}, ${R(v.r)}`);
          this.emit(`neg ${R(v.hi)}, ${R(v.hi)}`);
          this.emit(`sub ${R(v.hi)}, ${R(v.hi)}, t6`);
          return v;
        }
        this.emit(`neg ${R(v.r)}, ${R(v.r)}`);
        return v;
      }
      case 'bitnot': {
        const v = this.mut(this.genExpr(e.operand));
        this.emit(`not ${R(v.r)}, ${R(v.r)}`);
        if (v.hi !== undefined) this.emit(`not ${R(v.hi)}, ${R(v.hi)}`);
        return v;
      }
      case 'assign': {
        const t = e.lhs.type;
        const v = this.genExpr(e.rhs);
        const lv = this.lvalue(e.lhs);
        this.storeLV(lv, v);
        this.freeAddr(lv.addr);
        if (isRecord(t)) {
          // value of the assignment: the destination
          this.free(v);
          const lv2 = this.lvalue(e.lhs);
          return { r: this.addrReg(lv2.addr) };
        }
        return this.bitValue(lv, v);
      }
      case 'opassign':
        return this.genOpAssign(e);
      case 'incdec': {
        const lv = this.lvalue(e.lhs);
        let cur = this.loadLV(lv);
        const t = e.type;
        if (lv.reg !== undefined && sizeOf(t) === 4) {
          // register variable: update in place
          if (!e.pre) cur = this.mut(cur);
          if (fits12(e.delta)) this.emit(`addi ${R(lv.reg)}, ${R(lv.reg)}, ${e.delta}`);
          else {
            this.emit(`li t6, ${e.delta}`);
            this.emit(`add ${R(lv.reg)}, ${R(lv.reg)}, t6`);
          }
          return e.pre ? { r: lv.reg, b: true } : cur;
        }
        if (!e.pre) cur = this.mut(cur);
        let nv: Val;
        if (is64(t)) {
          const lo = this.alloc(e.loc);
          const hi = this.alloc(e.loc);
          this.emit(`addi ${R(lo)}, ${R(cur.r)}, ${e.delta}`);
          if (e.delta > 0) this.emit(`sltu t6, ${R(lo)}, ${R(cur.r)}`);
          else this.emit(`sltu t6, ${R(cur.r)}, ${R(lo)}`);
          this.emit(`${e.delta > 0 ? 'add' : 'sub'} ${R(hi)}, ${R(cur.hi ?? ZERO)}, t6`);
          nv = { r: lo, hi };
        } else {
          const r = this.alloc(e.loc);
          if (fits12(e.delta)) this.emit(`addi ${R(r)}, ${R(cur.r)}, ${e.delta}`);
          else {
            this.emit(`li t6, ${e.delta}`);
            this.emit(`add ${R(r)}, ${R(cur.r)}, t6`);
          }
          nv = this.normalize({ r }, t);
        }
        this.storeLV(lv, nv);
        if (lv.bit) nv = this.bitValue(lv, nv);
        this.freeAddr(lv.addr);
        if (e.pre) {
          this.free(cur);
          return nv;
        }
        this.free(nv);
        return cur;
      }
      case 'cond': {
        const els = this.newLabel();
        const end = this.newLabel();
        this.branch(e.cond, els, false);
        const a = this.mut(this.genExpr(e.then));
        if (e.type.kind === 'void') {
          this.free(a);
          this.emit(`j ${end}`);
          this.label(els);
          this.free(this.genExpr(e.else));
          this.label(end);
          return { r: ZERO };
        }
        this.emit(`j ${end}`);
        this.label(els);
        // the else value must land in the same registers as the then value
        this.free(a);
        const b = this.genExpr(e.else);
        if (a.hi !== undefined) {
          this.emit(`mv t6, ${R(b.hi ?? ZERO)}`);
          if (b.r !== a.r) this.emit(`mv ${R(a.r)}, ${R(b.r)}`);
          this.emit(`mv ${R(a.hi)}, t6`);
        } else if (b.r !== a.r) this.emit(`mv ${R(a.r)}, ${R(b.r)}`);
        this.free(b);
        this.used.add(a.r);
        if (a.hi !== undefined) this.used.add(a.hi);
        this.label(end);
        return a;
      }
      case 'comma':
        this.free(this.genExpr(discarded(e.lhs)));
        return this.genExpr(e.rhs);
      case 'call':
        return this.genCall(e);
      case 'vastart': {
        const lv = this.lvalue(e.ap);
        const r = this.alloc(e.loc);
        this.frameAddrInto(r, this.gpUsed < 8 ? -32 + 4 * this.gpUsed : this.namedStack);
        this.storeLV(lv, { r });
        this.freeAddr(lv.addr);
        this.free(r);
        return { r: ZERO };
      }
      case 'vacopy': {
        const v = this.genExpr(e.src);
        const lv = this.lvalue(e.dst);
        this.storeLV(lv, v);
        this.freeAddr(lv.addr);
        this.free(v);
        return { r: ZERO };
      }
      case 'vaarg':
        return this.genVaArg(e);
      case 'stmtexpr': {
        this.nested++;
        try {
          for (const s of e.body) this.genStmt(s);
        } finally {
          this.nested--;
        }
        if (e.result) return this.genExpr(e.result);
        return { r: ZERO };
      }
      case 'memzero': {
        const o = e.obj;
        this.zeroMem(this.frameAddr(o.offset ?? 0), sizeOf(o.type), alignOf(o.type));
        return { r: ZERO };
      }
      case 'initvar': {
        this.nested++;
        try {
          for (const s of e.init) this.genStmt(s);
        } finally {
          this.nested--;
        }
        const lv: LV = { addr: this.frameAddr(e.obj.offset ?? 0), type: e.type };
        if (isRecord(e.type) || e.type.kind === 'array') return { r: this.addrReg(lv.addr) };
        return this.loadLV(lv);
      }
      case 'nop':
        return { r: ZERO };
    }
  }

  /** v * s into an owned register. */
  private scaled(v: Val, s: number): Val {
    if (s === 1) return v;
    const d = this.dst(v);
    if ((s & (s - 1)) === 0) this.emit(`slli ${R(d)}, ${R(v.r)}, ${Math.log2(s)}`);
    else {
      this.emit(`li t6, ${s}`);
      this.emit(`mul ${R(d)}, ${R(v.r)}, t6`);
    }
    return { r: d };
  }

  private genVaArg(e: Extract<Expr, { kind: 'vaarg' }>): Val {
    const t = e.type;
    const lv = this.lvalue(e.ap);
    const p = this.mut(this.loadLV(lv));
    const size = sizeOf(t);
    const byRef = isRecord(t) && size > 8;
    if (!byRef && alignOf(t) === 8) {
      this.emit(`addi ${R(p.r)}, ${R(p.r)}, 7`);
      this.emit(`andi ${R(p.r)}, ${R(p.r)}, -8`);
    }
    let v: Val;
    const at: Addr = { k: 'reg', r: p.r, off: 0, own: false };
    if (byRef) {
      const r = this.alloc(e.loc);
      this.emit(`lw ${R(r)}, 0(${R(p.r)})`);
      v = { r };
    } else if (isRecord(t)) {
      const off = this.slot(alignUp(size, 4), Math.max(alignOf(t), 4));
      const d = this.addrReg(this.frameAddr(off));
      this.copyMem(d, p.r, size, 4);
      v = { r: d };
    } else v = this.loadLV({ addr: at, type: t });
    const step = byRef ? 4 : alignUp(size, 4);
    this.emit(`addi ${R(p.r)}, ${R(p.r)}, ${step}`);
    this.storeLV(lv, p);
    this.freeAddr(lv.addr);
    this.free(p);
    return v;
  }

  private genOpAssign(e: Extract<Expr, { kind: 'opassign' }>): Val {
    const lt = e.lhs.type;
    const rhs = this.genExpr(e.rhs);
    const lv = this.lvalue(e.lhs);
    let cur = this.loadLV(lv);
    if (lt.kind === 'ptr') {
      const i = this.scaled(rhs, e.scale);
      this.emit(`${e.op === '-' ? 'sub' : 'add'} ${R(cur.r)}, ${R(cur.r)}, ${R(i.r)}`);
      this.free(i);
      this.storeLV(lv, cur);
      this.freeAddr(lv.addr);
      return cur;
    }
    cur = this.convert(cur, lt, e.opType);
    const res = this.arith(e.op, cur, rhs, e.opType, e.opType, e.loc);
    const nv = this.convert(res, e.opType, lt);
    const fin = lt.kind === 'bool' ? nv : this.normalize(nv, lt);
    this.storeLV(lv, fin);
    this.freeAddr(lv.addr);
    return this.bitValue(lv, fin);
  }

  private genBinary(e: Extract<Expr, { kind: 'binary' }>): Val {
    const op = e.op;
    const ot = e.lhs.type;
    // immediate forms
    if (!is64(ot) && e.rhs.kind === 'num') {
      const c = Number(BigInt.asIntN(32, e.rhs.value));
      const imm = this.immOp(op, c, ot);
      if (imm) {
        const a = this.genExpr(e.lhs);
        const d = this.dst(a);
        for (const ins of imm(R(d), R(a.r))) this.emit(ins);
        return { r: d };
      }
    }
    const [a, b] = this.genPair(e.lhs, e.rhs);
    return this.arith(op, a, b, ot, e.type, e.loc);
  }

  /** Evaluate two operands; the one needing more registers goes first. */
  private genPair(l: Expr, r: Expr): [Val, Val] {
    if (need(r) > need(l) && !hasSideEffects(l)) {
      const b = this.genExpr(r);
      const a = this.genHolding(b, l);
      return [a.v, a.held];
    }
    const a = this.genExpr(l);
    const b = this.genHolding(a, r);
    return [b.held, b.v];
  }

  private freeCount(): number {
    return this.pool.length - this.used.size;
  }

  /**
   * Evaluate `e` while `held` stays live; when `e` needs more registers than
   * are free, `held` is parked in the frame meanwhile.
   */
  private genHolding(held: Val, e: Expr): { held: Val; v: Val } {
    if (held.r === ZERO || held.b) return { held, v: this.genExpr(e) };
    if (this.conservative ? need(e) <= 1 && !containsCall(e) : need(e) + 1 <= this.freeCount()) return { held, v: this.genExpr(e) };
    const words = held.hi !== undefined ? 2 : 1;
    const off = this.slot(4 * words, 4);
    this.mem('sw', held.r, this.frameAddr(off), 0, true);
    if (held.hi !== undefined) this.mem('sw', held.hi, this.frameAddr(off), 4, true);
    this.free(held);
    const v = this.genExpr(e);
    const r = this.alloc(e.loc);
    this.mem('lw', r, this.frameAddr(off), 0, false);
    if (words === 2) {
      const hi = this.alloc(e.loc);
      this.mem('lw', hi, this.frameAddr(off), 4, false);
      return { held: { r, hi }, v };
    }
    return { held: { r }, v };
  }

  /** Instruction sequence for `a op const` in place, or undefined. */
  private immOp(op: BinOp, c: number, t: Type): ((d: string, r: string) => string[]) | undefined {
    const u = t.unsigned || t.kind === 'ptr';
    switch (op) {
      case '+': if (fits12(c)) return (d, r) => (c === 0 ? (d === r ? [] : [`mv ${d}, ${r}`]) : [`addi ${d}, ${r}, ${c}`]); break;
      case '-': if (fits12(-c)) return (d, r) => (c === 0 ? (d === r ? [] : [`mv ${d}, ${r}`]) : [`addi ${d}, ${r}, ${-c}`]); break;
      case '&': if (fits12(c)) return (d, r) => [`andi ${d}, ${r}, ${c}`]; break;
      case '|': if (fits12(c)) return (d, r) => [`ori ${d}, ${r}, ${c}`]; break;
      case '^': if (fits12(c)) return (d, r) => [`xori ${d}, ${r}, ${c}`]; break;
      case '<<': return (d, r) => [`slli ${d}, ${r}, ${c & 31}`];
      case '>>': return (d, r) => [`${u ? 'srli' : 'srai'} ${d}, ${r}, ${c & 31}`];
      case '*':
        if (c > 0 && (c & (c - 1)) === 0) return (d, r) => [`slli ${d}, ${r}, ${Math.log2(c)}`];
        break;
      case '/':
        if (u && c > 0 && (c & (c - 1)) === 0) return (d, r) => [`srli ${d}, ${r}, ${Math.log2(c)}`];
        break;
      case '%':
        if (u && c > 0 && (c & (c - 1)) === 0 && c - 1 <= 2047) return (d, r) => [`andi ${d}, ${r}, ${c - 1}`];
        break;
      case '==': if (fits12(-c)) return (d, r) => (c === 0 ? [`seqz ${d}, ${r}`] : [`addi ${d}, ${r}, ${-c}`, `seqz ${d}, ${d}`]); break;
      case '!=': if (fits12(-c)) return (d, r) => (c === 0 ? [`snez ${d}, ${r}`] : [`addi ${d}, ${r}, ${-c}`, `snez ${d}, ${d}`]); break;
      case '<': if (fits12(c)) return (d, r) => [`${u ? 'sltiu' : 'slti'} ${d}, ${r}, ${c}`]; break;
      case '<=': if (fits12(c + 1) && !(u && c === -1)) return (d, r) => [`${u ? 'sltiu' : 'slti'} ${d}, ${r}, ${c + 1}`]; break;
      case '>=': if (fits12(c)) return (d, r) => [`${u ? 'sltiu' : 'slti'} ${d}, ${r}, ${c}`, `xori ${d}, ${d}, 1`]; break;
      case '>': if (fits12(c + 1) && !(u && c === -1)) return (d, r) => [`${u ? 'sltiu' : 'slti'} ${d}, ${r}, ${c + 1}`, `xori ${d}, ${d}, 1`]; break;
    } // prettier-ignore
    return undefined;
  }

  /** a op b with operands of type `ot`; frees b, result in a's registers (or new). */
  private arith(op: BinOp, a: Val, b: Val, ot: Type, rt: Type, loc: Loc): Val {
    if (is64(ot)) return this.arith64(op, a, b, ot, rt, loc);
    const u = ot.unsigned || ot.kind === 'ptr';
    // destination: a's register, else b's, else a fresh one (register variables are read-only)
    const d = !a.b ? a.r : !b.b ? b.r : this.alloc(loc);
    const rd = R(d);
    const ra = R(a.r);
    const rb = R(b.r);
    const ins = (s: string): void => this.emit(s);
    switch (op) {
      case '+': ins(`add ${rd}, ${ra}, ${rb}`); break;
      case '-': ins(`sub ${rd}, ${ra}, ${rb}`); break;
      case '*': ins(`mul ${rd}, ${ra}, ${rb}`); break;
      case '/': ins(`${u ? 'divu' : 'div'} ${rd}, ${ra}, ${rb}`); break;
      case '%': ins(`${u ? 'remu' : 'rem'} ${rd}, ${ra}, ${rb}`); break;
      case '&': ins(`and ${rd}, ${ra}, ${rb}`); break;
      case '|': ins(`or ${rd}, ${ra}, ${rb}`); break;
      case '^': ins(`xor ${rd}, ${ra}, ${rb}`); break;
      case '<<': ins(`sll ${rd}, ${ra}, ${rb}`); break;
      case '>>': ins(`${u ? 'srl' : 'sra'} ${rd}, ${ra}, ${rb}`); break;
      case '==': ins(`xor ${rd}, ${ra}, ${rb}`); ins(`seqz ${rd}, ${rd}`); break;
      case '!=': ins(`xor ${rd}, ${ra}, ${rb}`); ins(`snez ${rd}, ${rd}`); break;
      case '<': ins(`${u ? 'sltu' : 'slt'} ${rd}, ${ra}, ${rb}`); break;
      case '>': ins(`${u ? 'sltu' : 'slt'} ${rd}, ${rb}, ${ra}`); break;
      case '<=': ins(`${u ? 'sltu' : 'slt'} ${rd}, ${rb}, ${ra}`); ins(`xori ${rd}, ${rd}, 1`); break;
      case '>=': ins(`${u ? 'sltu' : 'slt'} ${rd}, ${ra}, ${rb}`); ins(`xori ${rd}, ${rd}, 1`); break;
    } // prettier-ignore
    if (d !== a.r) this.free(a);
    if (d !== b.r) this.free(b);
    void rt;
    return { r: d };
  }

  private arith64(op: BinOp, a: Val, b: Val, ot: Type, rt: Type, loc: Loc): Val {
    const u = ot.unsigned;
    const al = R(a.r);
    const ah = R(a.hi ?? ZERO);
    if (op === '<<' || op === '>>') {
      // b is an int shift count
      const n = R(b.r);
      const big = this.newLabel();
      const end = this.newLabel();
      if (a.hi === undefined) this.fail(loc, 'internal: 64-bit value without high word');
      this.emit(`andi t6, ${n}, 32`);
      this.emit(`bnez t6, ${big}`);
      this.emit(`beqz ${n}, ${end}`);
      if (op === '<<') {
        this.emit(`not t6, ${n}`);
        this.emit(`srli t5, ${al}, 1`);
        this.emit(`srl t5, t5, t6`);
        this.emit(`sll ${ah}, ${ah}, ${n}`);
        this.emit(`or ${ah}, ${ah}, t5`);
        this.emit(`sll ${al}, ${al}, ${n}`);
        this.emit(`j ${end}`);
        this.label(big);
        this.emit(`sll ${ah}, ${al}, ${n}`);
        this.emit(`li ${al}, 0`);
      } else {
        this.emit(`not t6, ${n}`);
        this.emit(`slli t5, ${ah}, 1`);
        this.emit(`sll t5, t5, t6`);
        this.emit(`srl ${al}, ${al}, ${n}`);
        this.emit(`or ${al}, ${al}, t5`);
        this.emit(`${u ? 'srl' : 'sra'} ${ah}, ${ah}, ${n}`);
        this.emit(`j ${end}`);
        this.label(big);
        this.emit(`${u ? 'srl' : 'sra'} ${al}, ${ah}, ${n}`);
        if (u) this.emit(`li ${ah}, 0`);
        else this.emit(`srai ${ah}, ${ah}, 31`);
      }
      this.label(end);
      this.free(b);
      return a;
    }
    const bl = R(b.r);
    const bh = R(b.hi ?? ZERO);
    const ins = (s: string): void => this.emit(s);
    switch (op) {
      case '+':
        ins(`add ${al}, ${al}, ${bl}`);
        ins(`sltu t6, ${al}, ${bl}`);
        ins(`add ${ah}, ${ah}, ${bh}`);
        ins(`add ${ah}, ${ah}, t6`);
        break;
      case '-':
        ins(`sltu t6, ${al}, ${bl}`);
        ins(`sub ${al}, ${al}, ${bl}`);
        ins(`sub ${ah}, ${ah}, ${bh}`);
        ins(`sub ${ah}, ${ah}, t6`);
        break;
      case '*':
        ins(`mul t6, ${al}, ${bh}`);
        ins(`mul t5, ${ah}, ${bl}`);
        ins(`add t6, t6, t5`);
        ins(`mulhu t5, ${al}, ${bl}`);
        ins(`add ${ah}, t6, t5`);
        ins(`mul ${al}, ${al}, ${bl}`);
        break;
      case '&': ins(`and ${al}, ${al}, ${bl}`); ins(`and ${ah}, ${ah}, ${bh}`); break; // prettier-ignore
      case '|': ins(`or ${al}, ${al}, ${bl}`); ins(`or ${ah}, ${ah}, ${bh}`); break; // prettier-ignore
      case '^': ins(`xor ${al}, ${al}, ${bl}`); ins(`xor ${ah}, ${ah}, ${bh}`); break; // prettier-ignore
      case '/':
      case '%': {
        const name = `__cc_${u ? 'u' : ''}${op === '/' ? 'div' : 'mod'}di3`;
        this.helpers.add(name);
        return this.callHelper(name, [a, b], true);
      }
      case '==':
      case '!=':
        ins(`xor ${al}, ${al}, ${bl}`);
        ins(`xor ${ah}, ${ah}, ${bh}`);
        ins(`or ${al}, ${al}, ${ah}`);
        ins(`${op === '==' ? 'seqz' : 'snez'} ${al}, ${al}`);
        this.free(a.hi);
        this.free(b);
        return { r: a.r };
      case '<':
      case '>':
      case '<=':
      case '>=': {
        // lt(x, y) = hi(x) < hi(y) || (hi(x) == hi(y) && lo(x) <u lo(y))
        const swap = op === '>' || op === '<=';
        const [xl, xh, yl, yh] = swap ? [bl, bh, al, ah] : [al, ah, bl, bh];
        ins(`${u ? 'sltu' : 'slt'} t5, ${xh}, ${yh}`);
        ins(`xor t6, ${xh}, ${yh}`);
        ins(`seqz t6, t6`);
        ins(`sltu ${xl === al ? al : al}, ${xl}, ${yl}`);
        ins(`and ${al}, ${al}, t6`);
        ins(`or ${al}, ${al}, t5`);
        if (op === '<=' || op === '>=') ins(`xori ${al}, ${al}, 1`);
        this.free(a.hi);
        this.free(b);
        return { r: a.r };
      }
    }
    this.free(b);
    void rt;
    return a;
  }

  // ------------------------------------------------------------------ branches

  /** Jump to `label` when `e` is true (`when` = true) or false (`when` = false). */
  private branch(e: Expr, label: string, when: boolean): void {
    this.at(e.line);
    if (e.kind === 'num') {
      if ((e.value !== 0n) === when) this.emit(`j ${label}`);
      return;
    }
    if (e.kind === 'lognot') {
      this.branch(e.operand, label, !when);
      return;
    }
    if (e.kind === 'logand' || e.kind === 'logor') {
      const isAnd = e.kind === 'logand';
      if (isAnd !== when) {
        // and/false: either false -> label ; or/true: either true -> label
        this.branch(e.lhs, label, when);
        this.branch(e.rhs, label, when);
      } else {
        const skip = this.newLabel();
        this.branch(e.lhs, skip, !when);
        this.branch(e.rhs, label, when);
        this.label(skip);
      }
      return;
    }
    if (e.kind === 'binary' && !is64(e.lhs.type) && ['==', '!=', '<', '<=', '>', '>='].includes(e.op)) {
      const u = e.lhs.type.unsigned || e.lhs.type.kind === 'ptr';
      const zero = e.rhs.kind === 'num' && e.rhs.value === 0n;
      const [a, b] = zero ? [this.genExpr(e.lhs), { r: ZERO }] : this.genPair(e.lhs, e.rhs);
      let op = e.op as string;
      if (!when) op = { '==': '!=', '!=': '==', '<': '>=', '>=': '<', '>': '<=', '<=': '>' }[op] as string;
      let x = R(a.r);
      let y = R(b.r);
      let ins: string;
      switch (op) {
        case '==': ins = 'beq'; break;
        case '!=': ins = 'bne'; break;
        case '<': ins = u ? 'bltu' : 'blt'; break;
        case '>=': ins = u ? 'bgeu' : 'bge'; break;
        case '>': ins = u ? 'bltu' : 'blt'; [x, y] = [y, x]; break;
        default: ins = u ? 'bgeu' : 'bge'; [x, y] = [y, x]; break;
      } // prettier-ignore
      this.emit(`${ins} ${x}, ${y}, ${label}`);
      this.free(a);
      this.free(b);
      return;
    }
    const v = this.genExpr(e);
    if (v.hi !== undefined) {
      this.emit(`or t6, ${R(v.r)}, ${R(v.hi)}`);
      this.emit(`${when ? 'bnez' : 'beqz'} t6, ${label}`);
    } else this.emit(`${when ? 'bnez' : 'beqz'} ${R(v.r)}, ${label}`);
    this.free(v);
  }

  // ------------------------------------------------------------------ calls

  private saveTemps(except: Set<number>): number[] {
    const live = T_POOL.filter((r) => this.used.has(r) && !except.has(r));
    for (const r of live) {
      let off = this.tSlots.get(r);
      if (off === undefined) {
        off = this.slot(4, 4);
        this.tSlots.set(r, off);
      }
      this.mem('sw', r, this.frameAddr(off), 0, true);
    }
    return live;
  }

  private restoreTemps(live: number[]): void {
    for (const r of live) this.mem('lw', r, this.frameAddr(this.tSlots.get(r) ?? 0), 0, false);
  }

  private callHelper(name: string, args: Val[], ret64: boolean): Val {
    let n = 0;
    for (const a of args) {
      this.emit(`mv ${R(A0 + n++)}, ${R(a.r)}`);
      if (a.hi !== undefined) this.emit(`mv ${R(A0 + n++)}, ${R(a.hi)}`);
    }
    for (const a of args) this.free(a);
    const live = this.saveTemps(new Set());
    this.emit(`call ${name}`);
    const r = this.alloc();
    this.emit(`mv ${R(r)}, a0`);
    let hi: number | undefined;
    if (ret64) {
      hi = this.alloc();
      this.emit(`mv ${R(hi)}, a1`);
    }
    this.restoreTemps(live);
    return hi === undefined ? { r } : { r, hi };
  }

  private genCall(e: Extract<Expr, { kind: 'call' }>): Val {
    const ft = e.fnType;
    const ret = ft.ret ?? ty.void;
    const bigRet = isRecord(ret) && sizeOf(ret) > 8;
    let fnReg: number | undefined;
    if (!e.direct) fnReg = this.genExpr(e.callee).r;
    const types = e.args.map((a) => a.type);
    const nNamed = ft.oldStyle ? e.args.length : (ft.params ?? []).length;
    const { locs, stackBytes } = classifyArgs(types, bigRet ? 1 : 0, nNamed);
    // Simple arguments (constants, variables: no calls, no side effects) are
    // loaded straight into their argument registers at the end. The others
    // are evaluated first, in order; one evaluated before a later argument
    // that makes a call is parked in the frame, so nested calls cannot run
    // out of registers.
    const simple = e.args.map((a) => !isRecord(a.type) && !hasSideEffects(a) && !containsCall(a) && need(a) <= 2);
    const later = e.args.map((_, i) => e.args.slice(i + 1).some((a, k) => !simple[i + 1 + k] && containsCall(a)));
    type Arg = Val | { spill: number; words: number } | { simple: Expr };
    const vals: Arg[] = [];
    e.args.forEach((a, i) => {
      if (simple[i]) {
        vals.push({ simple: a });
        return;
      }
      let v = this.genExpr(a);
      const t = a.type;
      const loc = locs[i] as ArgLoc;
      if (isRecord(t)) {
        const size = sizeOf(t);
        if (loc.byRef) {
          // pass a pointer to a private copy
          const off = this.slot(alignUp(size, 4), Math.max(alignOf(t), 4));
          const d = this.addrReg(this.frameAddr(off));
          this.copyMem(d, v.r, size, alignOf(t));
          this.free(v);
          v = { r: d };
        } else {
          const src = this.alignedCopy(v.r, t);
          const lo = this.alloc(a.loc);
          this.emit(`lw ${R(lo)}, 0(${R(src)})`);
          let hi: number | undefined;
          if (size > 4) {
            hi = this.alloc(a.loc);
            this.emit(`lw ${R(hi)}, 4(${R(src)})`);
          }
          if (src !== v.r) this.free(src);
          this.free(v);
          v = hi === undefined ? { r: lo } : { r: lo, hi };
        }
      }
      const next = e.args.findIndex((_, k) => k > i && !simple[k]);
      const pressure = next >= 0 && (this.conservative || need(e.args[next] as Expr) + 3 > this.freeCount());
      if (!v.b && (later[i] || pressure)) {
        const words = v.hi !== undefined ? 2 : 1;
        const off = this.slot(4 * words, 4);
        this.mem('sw', v.r, this.frameAddr(off), 0, true);
        if (v.hi !== undefined) this.mem('sw', v.hi, this.frameAddr(off), 4, true);
        this.free(v);
        vals.push({ spill: off, words });
      } else vals.push(v);
    });
    this.outArgs = Math.max(this.outArgs, stackBytes);
    /** Register holding word k of an argument (loads spilled/simple ones into `into`). */
    const word = (v: Arg, k: number, into: number): string => {
      if ('spill' in v) {
        if (k >= v.words) return 'zero';
        this.mem('lw', into, this.frameAddr(v.spill), 4 * k, false);
        return R(into);
      }
      if ('simple' in v) throw new Error('internal: simple argument not evaluated');
      return R(k === 0 ? v.r : (v.hi ?? ZERO));
    };
    // stack arguments
    vals.forEach((v0, i) => {
      const loc = locs[i] as ArgLoc;
      if (loc.stackWords === 0) return;
      const v = 'simple' in v0 ? this.genExpr(v0.simple) : v0;
      const first = loc.regs.length; // split: first word in a7
      for (let k = 0; k < loc.stackWords; k++) {
        this.emit(`sw ${word(v, first + k, T5)}, ${(loc.stack ?? 0) + 4 * k}(sp)`);
      }
      if ('simple' in v0) {
        if (loc.regs.length) vals[i] = v as Val;
        else this.free(v as Val);
      }
    });
    // register arguments
    vals.forEach((v0, i) => {
      const loc = locs[i] as ArgLoc;
      if (loc.regs.length === 0) return;
      if ('simple' in v0) {
        const a = v0.simple;
        if (a.kind === 'num' && !is64(a.type)) {
          this.emit(`li ${R(A0 + (loc.regs[0] ?? 0))}, ${Number(BigInt.asIntN(32, a.value))}`);
          return;
        }
        const v = this.genExpr(a);
        loc.regs.forEach((r, k) => this.emit(`mv ${R(A0 + r)}, ${R(k === 0 ? v.r : (v.hi ?? ZERO))}`));
        this.free(v);
        return;
      }
      const v = v0;
      loc.regs.forEach((r, k) => {
        if ('spill' in v) {
          if (k < v.words) this.mem('lw', A0 + r, this.frameAddr(v.spill), 4 * k, false);
          else this.emit(`li ${R(A0 + r)}, 0`);
        } else this.emit(`mv ${R(A0 + r)}, ${word(v, k, T5)}`);
      });
    });
    let retOff = 0;
    if (bigRet || isRecord(ret)) retOff = this.slot(alignUp(Math.max(sizeOf(ret), 8), 4), Math.max(alignOf(ret), 4));
    if (bigRet) this.frameAddrInto(A0, retOff);
    for (const v of vals) if (!('spill' in v) && !('simple' in v)) this.free(v);
    if (fnReg !== undefined) this.free(fnReg);
    const live = this.saveTemps(new Set());
    if (fnReg !== undefined) this.emit(`jalr ra, 0(${R(fnReg)})`);
    else this.emit(`call ${(e.direct as Obj).asmName}`);
    let result: Val = { r: ZERO };
    if (isRecord(ret)) {
      if (!bigRet) {
        this.mem('sw', A0, this.frameAddr(retOff), 0, true);
        if (sizeOf(ret) > 4) this.mem('sw', A0 + 1, this.frameAddr(retOff), 4, true);
      }
      result = { r: this.addrReg(this.frameAddr(retOff)) };
    } else if (ret.kind !== 'void') {
      const r = this.alloc(e.loc);
      this.emit(`mv ${R(r)}, a0`);
      if (is64(ret)) {
        const hi = this.alloc(e.loc);
        this.emit(`mv ${R(hi)}, a1`);
        result = { r, hi };
      } else result = this.normalizeRet({ r }, ret);
    }
    this.restoreTemps(live);
    return result;
  }

  /** Callees may leave junk above narrow return values (gcc extends; be safe). */
  private normalizeRet(v: Val, t: Type): Val {
    if (isInteger(t) && sizeOf(t) < 4) return this.normalize(v, t);
    return v;
  }
}

/** Peephole marker: no temporary is live here. Removed before output. */
const KILL = '\u0000kill';

/** In a context where the value is unused: x++ becomes ++x (cheaper). */
function discarded(e: Expr): Expr {
  if (e.kind === 'incdec' && !e.pre) return { ...e, pre: true };
  if (e.kind === 'comma') return { ...e, rhs: discarded(e.rhs) };
  if (e.kind === 'cast' && e.type.kind === 'void') return { ...e, operand: discarded(e.operand) };
  return e;
}

/** Is there a node matching `pred` in the tree? */
function hasNode(n: unknown, pred: (x: { kind: string }) => boolean): boolean {
  if (!n || typeof n !== 'object') return false;
  const x = n as { kind?: string };
  if (typeof x.kind === 'string' && pred(x as { kind: string })) return true;
  for (const [k, v] of Object.entries(n)) {
    if (k === 'type' || k === 'loc' || k === 'obj' || k === 'member' || k === 'fnType' || k === 'direct') continue;
    if (Array.isArray(v)) {
      if (v.some((c) => hasNode(c, pred))) return true;
    } else if (v && typeof v === 'object' && hasNode(v, pred)) return true;
  }
  return false;
}

/** A node that makes a call (including 64-bit division helpers). */
function containsCallNode(n: { kind: string }): boolean {
  if (n.kind === 'call') return true;
  if (n.kind === 'binary' || n.kind === 'opassign') {
    const b = n as unknown as { lhs: { type: Type }; op: string; opType?: Type };
    const t = n.kind === 'opassign' ? (b.opType ?? b.lhs.type) : b.lhs.type;
    if (is64(t) && (b.op === '/' || b.op === '%')) return true;
  }
  return false;
}

/** Argument registers a0-a7 (variable homes in leaf functions). */
const ARG_REGS = [10, 11, 12, 13, 14, 15, 16, 17];

/** Callee-saved registers that may hold variables (s10, s11 stay temporaries). */
const VAR_REGS = [9, 18, 19, 20, 21, 22, 23, 24, 25];

/**
 * Pick locals to keep in callee-saved registers: scalars of at most 32 bits
 * whose address is never taken and that are not volatile, weighted by use
 * (uses inside loops count more).
 */
export function allocateRegisters(f: Obj, leaf = false): Map<Obj, number> {
  const out = new Map<Obj, number>();
  const locals = f.locals ?? [];
  const ok = new Set(
    locals.filter((o) => {
      const t = o.type;
      if (o.asmReg || t.isVolatile || o.attrs.aligned) return false;
      if (!(isInteger(t) || t.kind === 'ptr')) return false;
      return sizeOf(t) <= 4;
    }),
  );
  if (ok.size === 0 || !f.body) return out;
  const weight = new Map<Obj, number>();
  const walk = (n: unknown, depth: number): void => {
    if (!n || typeof n !== 'object') return;
    const x = n as { kind?: string };
    switch (x.kind) {
      case 'var': {
        const o = (n as { obj: Obj }).obj;
        if (ok.has(o)) weight.set(o, (weight.get(o) ?? 0) + 8 ** Math.min(depth, 4));
        return;
      }
      case 'addr': {
        // &x keeps x in memory
        let op = (n as { operand: Expr }).operand;
        while (op.kind === 'member') op = op.base;
        if (op.kind === 'var') ok.delete(op.obj);
        walk(op, depth);
        return;
      }
      case 'initvar':
        ok.delete((n as { obj: Obj }).obj);
        break;
      case 'asm': {
        const a = n as Extract<Stmt, { kind: 'asm' }>;
        for (const o of [...a.outputs, ...a.inputs]) {
          if (/m/.test(o.constraint) && !/r/.test(o.constraint) && o.expr.kind === 'var') ok.delete(o.expr.obj);
        }
        break;
      }
      case 'loop':
        for (const [k, v] of Object.entries(n)) {
          if (k === 'loc' || k === 'type') continue;
          if (v && typeof v === 'object') walk(v, k === 'init' ? depth : depth + 1);
        }
        return;
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'type' || k === 'loc' || k === 'obj' || k === 'member' || k === 'fnType' || k === 'direct') continue;
      if (Array.isArray(v)) for (const c of v) walk(c, depth);
      else if (v && typeof v === 'object') walk(v, depth);
    }
  };
  walk(f.body, 0);
  // parameters are used at least once (the prologue)
  for (const p of f.params ?? []) if (ok.has(p)) weight.set(p, (weight.get(p) ?? 0) + 1);
  const ranked = [...ok].filter((o) => (weight.get(o) ?? 0) > 1).sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0));
  // registers named in asm clobber lists or bound to register variables are off limits
  const banned = new Set<number>();
  const ban = (name: string): void => {
    const n = name.replace(/^%/, '');
    const i = NAMES.indexOf(n === 'fp' ? 's0' : n);
    const m = /^x(\d+)$/.exec(n);
    if (i >= 0) banned.add(i);
    else if (m) banned.add(Number(m[1]));
  };
  hasNode(f.body, (n) => {
    if (n.kind === 'asm') for (const c of (n as unknown as { clobbers: string[] }).clobbers) ban(c);
    return false;
  });
  for (const o of locals) if (o.asmReg) ban(o.asmReg);
  const free = VAR_REGS.filter((r) => !banned.has(r));
  if (leaf) {
    // Leaf functions keep variables in argument registers: no saves needed.
    // A parameter stays in the register it arrived in.
    const params = f.params ?? [];
    const ret = f.type.ret;
    const first = ret && (ret.kind === 'struct' || ret.kind === 'union') && sizeOf(ret) > 8 ? 1 : 0;
    const locs = classifyArgs(params.map((p) => p.type), first, params.length).locs;
    const avail = new Set(ARG_REGS.filter((r) => !banned.has(r)));
    if (first) avail.delete(ARG_REGS[0] as number);
    params.forEach((p, i) => {
      const l = locs[i];
      if (l && l.regs.length) avail.delete(A0 + (l.regs[0] ?? 0));
    });
    params.forEach((p, i) => {
      const l = locs[i];
      if (ranked.includes(p) && l && l.regs.length === 1 && !l.stackWords && !l.byRef) out.set(p, A0 + (l.regs[0] ?? 0));
    });
    for (const o of ranked) {
      if (out.has(o)) continue;
      const r = [...avail][0];
      if (r === undefined) break;
      avail.delete(r);
      out.set(o, r);
    }
  }
  for (const o of ranked) {
    if (out.has(o)) continue;
    const r = free.shift();
    if (r === undefined) break;
    out.set(o, r);
  }
  return out;
}

const needCache = new WeakMap<Expr, number>();

/** Registers needed to evaluate `e` (Sethi-Ullman estimate). */
function need(e: Expr): number {
  const c = needCache.get(e);
  if (c !== undefined) return c;
  const w = is64(e.type) ? 2 : 1;
  let n: number;
  switch (e.kind) {
    case 'binary':
    case 'pdiff': {
      const l = need(e.lhs);
      const r = need(e.rhs);
      n = l === r ? l + (is64(e.lhs.type) ? 2 : 1) : Math.max(l, r);
      break;
    }
    case 'call':
      n = Math.max(1, ...e.args.map((a, i) => need(a) + i));
      break;
    case 'padd': {
      const l = need(e.ptr);
      const r = need(e.idx);
      n = l === r ? l + 1 : Math.max(l, r);
      break;
    }
    case 'cast':
    case 'neg':
    case 'bitnot':
    case 'lognot':
      n = need(e.operand);
      break;
    case 'deref':
      n = need(e.operand);
      break;
    case 'member':
      n = need(e.base);
      break;
    case 'addr':
      n = need(e.operand);
      break;
    case 'assign':
    case 'opassign':
      n = Math.max(need(e.rhs), 2);
      break;
    case 'cond':
      n = Math.max(need(e.cond), need(e.then), need(e.else));
      break;
    case 'comma':
      n = Math.max(need(e.lhs), need(e.rhs));
      break;
    default:
      n = w;
  }
  n = Math.max(n, w);
  needCache.set(e, n);
  return n;
}

const effCache = new WeakMap<Expr, boolean>();

/** Calls, assignments, ++/--: anything whose order is observable. */
function hasSideEffects(e: Expr): boolean {
  const c = effCache.get(e);
  if (c !== undefined) return c;
  const r = sideEffects(e);
  effCache.set(e, r);
  return r;
}

function sideEffects(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const x = e as { kind?: string; type?: Type };
  if (['call', 'stmtexpr', 'initvar', 'assign', 'opassign', 'incdec', 'vaarg', 'vastart', 'vacopy'].includes(x.kind ?? '')) return true;
  if ((x.kind === 'var' || x.kind === 'deref' || x.kind === 'member') && x.type?.isVolatile) return true;
  for (const [k, v] of Object.entries(e)) {
    if (k === 'type' || k === 'loc' || k === 'obj' || k === 'member' || k === 'fnType' || k === 'direct') continue;
    if (Array.isArray(v)) {
      if (v.some(sideEffects)) return true;
    } else if (v && typeof v === 'object' && 'kind' in v && sideEffects(v)) return true;
  }
  return false;
}

/** Does evaluating `e` make a function call? */
function containsCall(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const x = e as { kind?: string };
  if (x.kind === 'call' || x.kind === 'stmtexpr' || x.kind === 'initvar') return true;
  if (x.kind === 'binary' || x.kind === 'opassign') {
    const b = e as { lhs: { type: Type }; op: string };
    if (is64(b.lhs.type) && (b.op === '/' || b.op === '%')) return true;
  }
  for (const [k, v] of Object.entries(e)) {
    if (k === 'type' || k === 'loc' || k === 'obj' || k === 'member' || k === 'fnType' || k === 'direct') continue;
    if (Array.isArray(v)) {
      if (v.some(containsCall)) return true;
    } else if (v && typeof v === 'object' && 'kind' in v && containsCall(v)) return true;
  }
  return false;
}

/** Split an asm template into lines/statements. */
function splitAsm(t: string): string[] {
  return t
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Data directives for initialized bytes with relocations. */
function dataLines(d: InitData, asString: boolean): string[] {
  const out: string[] = [];
  const bytes = d.bytes;
  if (asString && d.relocs.length === 0 && bytes.length > 0 && bytes[bytes.length - 1] === 0) {
    const body = bytes.subarray(0, bytes.length - 1);
    if (!body.includes(0)) {
      let s = '';
      for (const b of body) {
        if (b === 34) s += '\\"';
        else if (b === 92) s += '\\\\';
        else if (b === 10) s += '\\n';
        else if (b === 9) s += '\\t';
        else if (b === 13) s += '\\r';
        else if (b >= 32 && b < 127) s += String.fromCharCode(b);
        else s += '\\' + b.toString(8).padStart(3, '0');
      }
      return [`.string "${s}"`];
    }
  }
  const relocAt = new Map(d.relocs.map((r) => [r.offset, r]));
  let i = 0;
  let pending: number[] = [];
  const flush = (): void => {
    for (let k = 0; k < pending.length; k += 16) out.push(`.byte ${pending.slice(k, k + 16).join(', ')}`);
    pending = [];
  };
  while (i < bytes.length) {
    const r = relocAt.get(i);
    if (r) {
      flush();
      out.push(`.word ${r.addend === 0 ? r.label : r.addend > 0 ? `${r.label}+${r.addend}` : `${r.label}${r.addend}`}`);
      i += 4;
      continue;
    }
    // zero runs
    let z = i;
    while (z < bytes.length && bytes[z] === 0 && !relocAt.has(z)) z++;
    if (z - i >= 8) {
      flush();
      out.push(`.zero ${z - i}`);
      i = z;
      continue;
    }
    // aligned words
    if (i % 4 === 0 && i + 4 <= bytes.length && ![1, 2, 3].some((k) => relocAt.has(i + k)) && pending.length === 0) {
      const w = ((bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8) | ((bytes[i + 2] ?? 0) << 16) | ((bytes[i + 3] ?? 0) << 24)) | 0;
      out.push(`.word ${w}`);
      i += 4;
      continue;
    }
    pending.push(bytes[i] ?? 0);
    i++;
    if (i % 4 === 0) flush();
  }
  flush();
  return out;
}

// ------------------------------------------------------------------ peephole

const INSTR = /^\t([a-z.]+)\s*(.*)$/;

/** Ops whose first operand is the only register written. */
const DEST_OPS = new Set([
  'add', 'addi', 'sub', 'and', 'andi', 'or', 'ori', 'xor', 'xori', 'sll', 'slli', 'srl', 'srli', 'sra', 'srai',
  'slt', 'slti', 'sltu', 'sltiu', 'mul', 'mulh', 'mulhu', 'mulhsu', 'div', 'divu', 'rem', 'remu',
  'lb', 'lbu', 'lh', 'lhu', 'lw', 'li', 'la', 'lui', 'auipc', 'mv', 'not', 'neg', 'seqz', 'snez', 'sltz', 'sgtz',
]); // prettier-ignore

const isLabel = (t: string): boolean => /^[^\t\0].*:$/.test(t);

function parseIns(l: AsmLine): { op: string; ops: string[] } | undefined {
  if (l.raw) return undefined;
  const m = INSTR.exec(l.text);
  if (!m) return undefined;
  const ops = (m[2] ?? '').length ? (m[2] as string).split(/,\s*/) : [];
  return { op: m[1] as string, ops };
}

const mentions = (text: string, reg: string): boolean => new RegExp(`(^|[^\\w.])${reg}($|[^\\w])`).test(text);

/** Registers read by an instruction, as operand text. */
function readsReg(ins: { op: string; ops: string[] }, reg: string): boolean {
  const from = DEST_OPS.has(ins.op) ? 1 : 0;
  return ins.ops.slice(from).some((o) => mentions(o, reg));
}

/** Is `reg` (a temporary) dead after line i? Conservative: unknown means live. */
function deadAfter(lines: AsmLine[], i: number, reg: string): boolean {
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j] as AsmLine;
    if (l.text === KILL) return true;
    if (l.raw) return false;
    if (isLabel(l.text)) return false;
    const ins = parseIns(l);
    if (!ins) continue;
    if (readsReg(ins, reg)) return false;
    if (ins.op === 'call') return !/^a\d$/.test(reg);
    if (ins.op === 'ret' || ins.op === 'mret' || ins.op === 'sret') return reg !== 'a0' && reg !== 'a1';
    if (DEST_OPS.has(ins.op) && ins.ops[0] === reg) return true;
    if (/^(j|jr|jalr|tail|b[a-z]+)$/.test(ins.op)) return false;
  }
  return false;
}

const TEMP = /^(t[0-6]|a[0-7]|s1[01])$/;

/** Light peephole: copy propagation for temporaries, redundant moves, jumps to the next label. */
export function peephole(lines: AsmLine[], vars: ReadonlySet<string> = new Set()): AsmLine[] {
  let out = lines;
  const temp = (r: string | undefined): boolean => r !== undefined && TEMP.test(r) && !vars.has(r);
  for (let pass = 0; pass < 4; pass++) {
    const res: AsmLine[] = [];
    let changed = false;
    for (let i = 0; i < out.length; i++) {
      const l = out[i] as AsmLine;
      const ins = parseIns(l);
      if (ins) {
        const { op, ops } = ins;
        if (op === 'mv' && ops[0] === ops[1]) {
          changed = true;
          continue;
        }
        // a computation into a temporary nobody reads (loads stay: they may be MMIO)
        if (DEST_OPS.has(op) && !/^l[bhw]u?$/.test(op) && temp(ops[0]) && !/^a\d$/.test(ops[0] ?? '') && deadAfter(out, i, ops[0] ?? '')) {
          changed = true;
          continue;
        }
        // op tX, ... ; mv Y, tX  ->  op Y, ...   (tX dead afterwards)
        const next = out[i + 1];
        const nins = next ? parseIns(next) : undefined;
        if (
          DEST_OPS.has(op) && nins && nins.op === 'mv' && nins.ops[1] === ops[0] && temp(ops[0]) &&
          nins.ops[0] !== undefined && deadAfter(out, i + 1, ops[0] ?? '')
        ) {
          res.push({ ...l, text: `\t${op} ${[nins.ops[0], ...ops.slice(1)].join(', ')}` });
          i++;
          changed = true;
          continue;
        } // prettier-ignore
        // mv tX, Y ; op ..., tX, ...  ->  op ..., Y, ...   (tX dead afterwards)
        if (
          op === 'mv' && nins && next && temp(ops[0]) && ops[1] !== undefined && readsReg(nins, ops[0] ?? '') &&
          ((DEST_OPS.has(nins.op) && nins.ops[0] === ops[0]) || deadAfter(out, i + 1, ops[0] ?? ''))
        ) {
          const x = ops[0] as string;
          const y = ops[1];
          const from = DEST_OPS.has(nins.op) ? 1 : 0;
          const nops = nins.ops.map((o, k) => (k < from ? o : o.replace(new RegExp(`(^|[^\\w.])${x}($|[^\\w])`, 'g'), `$1${y}$2`)));
          res.push({ ...next, text: `\t${nins.op} ${nops.join(', ')}` });
          i++;
          changed = true;
          continue;
        } // prettier-ignore
        if (op === 'j') {
          // jump to a label that immediately follows (possibly after other labels)
          let k = i + 1;
          let hit = false;
          while (k < out.length && (isLabel((out[k] as AsmLine).text) || (out[k] as AsmLine).text === KILL)) {
            if ((out[k] as AsmLine).text === `${ops[0]}:`) hit = true;
            k++;
          }
          if (hit) {
            changed = true;
            continue;
          }
          // unreachable code after j until the next label
          res.push(l);
          while (i + 1 < out.length) {
            const n = out[i + 1] as AsmLine;
            if (n.raw || isLabel(n.text) || n.text === KILL || /^\t\./.test(n.text)) break;
            i++;
            changed = true;
          }
          continue;
        }
        // sw rX, off(s0) ; lw rY, off(s0)  ->  sw ; mv rY, rX
        if (op === 'lw') {
          const prev = res[res.length - 1];
          const pins = prev ? parseIns(prev) : undefined;
          if (pins && pins.op === 'sw' && pins.ops[1] === ops[1] && /\((s0|sp)\)$/.test(ops[1] ?? '') && ops[0] !== undefined && pins.ops[0] !== undefined) {
            if (ops[0] !== pins.ops[0]) res.push({ ...l, text: `\tmv ${ops[0]}, ${pins.ops[0]}` });
            changed = true;
            continue;
          }
        }
      }
      res.push(l);
    }
    out = res;
    if (!changed) break;
  }
  return out.filter((l) => l.text !== KILL);
}

/** Instruction-count upper bound for a line (pseudo-instructions may expand). */
function sizeBound(text: string): number {
  const m = INSTR.exec(text);
  if (!m) return 0;
  const op = m[1] as string;
  if (op.startsWith('.')) return 0;
  if (op === 'li' || op === 'la' || op === 'lla' || op === 'call' || op === 'tail') return 8;
  if (/%lo\(/.test(m[2] ?? '')) return 4;
  return 4;
}

const BRANCH_INV: Record<string, string> = {
  beq: 'bne', bne: 'beq', blt: 'bge', bge: 'blt', bltu: 'bgeu', bgeu: 'bltu',
  beqz: 'bnez', bnez: 'beqz', blez: 'bgtz', bgtz: 'blez', bltz: 'bgez', bgez: 'bltz',
  bgt: 'ble', ble: 'bgt', bgtu: 'bleu', bleu: 'bgtu',
}; // prettier-ignore

/** Rewrite conditional branches whose target may be out of range (±4 KiB) as branch-over-jump. */
export function relaxBranches(lines: AsmLine[]): AsmLine[] {
  let cur = lines;
  for (let iter = 0; iter < 4; iter++) {
    const pos: number[] = [];
    const labels = new Map<string, number>();
    let p = 0;
    for (const l of cur) {
      pos.push(p);
      const lm = /^([^\t\s].*):$/.exec(l.text);
      if (lm) labels.set(lm[1] as string, p);
      p += sizeBound(l.text);
    }
    let changed = false;
    const out: AsmLine[] = [];
    cur.forEach((l, i) => {
      const m = INSTR.exec(l.text);
      const inv = m ? BRANCH_INV[m[1] as string] : undefined;
      if (m && inv) {
        const parts = (m[2] as string).split(/,\s*/);
        const target = parts[parts.length - 1] as string;
        const tp = labels.get(target);
        if (tp !== undefined && Math.abs(tp - (pos[i] ?? 0)) > 3000) {
          const skip = `${target}_far${i}`;
          out.push({ text: `\t${inv} ${parts.slice(0, -1).join(', ')}, ${skip}`, line: l.line });
          out.push({ text: `\tj ${target}`, line: l.line });
          out.push({ text: `${skip}:`, line: l.line });
          changed = true;
          return;
        }
      }
      out.push(l);
    });
    cur = out;
    if (!changed) break;
  }
  return cur;
}

export { CodegenError };
