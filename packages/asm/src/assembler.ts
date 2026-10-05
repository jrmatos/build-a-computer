/**
 * ASM-01: the assembler. Source text in, a relocatable object out (sections,
 * symbols, fixups and a line table). `link` turns objects into a flat image.
 *
 * Output is byte-for-byte what GNU as 2.40 produces with
 * `-march=rv32ima_zicsr_zifencei -mabi=ilp32 -mno-relax` for the same source,
 * including pseudo-instruction expansions and code-alignment padding
 * (checked against the golden corpus in `corpus/`).
 *
 * Deliberate differences from GNU as (none change the bytes of a valid program):
 * - Values that do not fit their field (`.byte 300`, `.word 1 << 40`,
 *   `li a0, 1 << 40`) are errors; GNU warns and truncates or silently wraps.
 * - `//` line comments are accepted (GNU as for RISC-V only has `#`).
 * - `.set` cannot redefine a symbol (it behaves like `.equ`).
 * - Only .text*, .rodata*, .data*, .bss* (and dropped .note*, .comment)
 *   sections exist, because the flat linker must know where each one goes.
 */

import {
  AsmError,
  type Diagnostic,
  type Span,
  diagnostic,
  spanJoin,
  spanOf,
  spanOfTokens,
} from './diagnostics';
import {
  CSR_NAMES,
  type Instr,
  OPS_BY_NAME,
  type OpSpec,
  encode,
  instr,
  registerNumber,
} from './encoding';
import { type Expr, type Value, UnknownSymbol, evaluate, parseExpr } from './expr';
import {
  type Fixup,
  type FixupKind,
  applyFixup,
  hi20,
  isPcRelative,
  lo12,
  writeLE,
} from './fixups';
import { type Token, tokenize } from './lexer';

/** Where a section goes in the flat image. `discard` sections (.note.*, .comment) are dropped. */
export type SectionGroup = 'text' | 'rodata' | 'data' | 'bss' | 'discard';

/** One section of an object file. */
export interface ObjSection {
  readonly name: string;
  readonly group: SectionGroup;
  /** Alignment in bytes (a power of two). */
  readonly align: number;
  readonly size: number;
  /** Contents; empty for bss. */
  readonly bytes: Uint8Array;
}

/** A symbol defined (or declared global) in an object. */
export interface ObjSymbol {
  readonly name: string;
  /** 'label' has section + offset; 'equ' has expr; 'extern' is only declared .globl. */
  readonly kind: 'label' | 'equ' | 'extern';
  readonly section: string | null;
  readonly offset: number;
  readonly expr?: Expr;
  readonly global: boolean;
  /** Numeric local labels and `.L` labels: resolvable, but not shown in symbol maps (like GNU). */
  readonly hidden: boolean;
  readonly span: Span;
}

/** One source line's bytes: used for the address-to-line source map. */
export interface LineEntry {
  readonly section: string;
  readonly offset: number;
  readonly size: number;
  readonly line: number;
  readonly col: number;
  readonly kind: 'code' | 'data';
}

/** A relocatable object: the assembler's output and the linker's input. */
export interface AsmObject {
  readonly file: string;
  readonly sections: readonly ObjSection[];
  readonly symbols: readonly ObjSymbol[];
  readonly fixups: readonly Fixup[];
  readonly lines: readonly LineEntry[];
}

/** Result of `assemble`. `object` is always present; it is only usable when `ok`. */
export interface AssembleResult {
  readonly ok: boolean;
  readonly object: AsmObject;
  readonly diagnostics: readonly Diagnostic[];
}

/** Options for `assemble`. */
export interface AssembleOptions {
  /** File name used in diagnostics and the source map. Default "main.s". */
  readonly file?: string;
}

// --------------------------------------------------------------------------

const NOP = 0x00000013;
const C_NOP = 0x0001;

class SectionBuilder {
  bytes: number[] = [];
  size = 0;
  align: number;
  constructor(
    readonly name: string,
    readonly group: SectionGroup,
  ) {
    this.align = group === 'text' ? 4 : 1;
  }
  get code(): boolean {
    return this.group === 'text';
  }
}

function groupOf(name: string): SectionGroup | null {
  if (/^\.text(\.|$)/.test(name) || name === '.init' || name === '.fini') return 'text';
  if (/^\.s?rodata(\.|$)/.test(name)) return 'rodata';
  if (/^\.s?data(\.|$)/.test(name)) return 'data';
  if (/^\.s?bss(\.|$)/.test(name)) return 'bss';
  if (/^\.(note|comment|riscv\.attributes|debug)/.test(name)) return 'discard';
  return null;
}

/** Directives accepted and ignored (compiler output often contains them). */
const IGNORED = new Set([
  '.type',
  '.size',
  '.file',
  '.ident',
  '.option',
  '.attribute',
  '.loc',
  '.addrsig',
  '.addrsig_sym',
  '.cfi_startproc',
  '.cfi_endproc',
  '.cfi_def_cfa_offset',
  '.cfi_offset',
  '.cfi_restore',
  '.cfi_def_cfa',
  '.cfi_sections',
]);

const DATA_SIZES: Record<string, number> = {
  '.byte': 1,
  '.1byte': 1,
  '.half': 2,
  '.short': 2,
  '.2byte': 2,
  '.word': 4,
  '.long': 4,
  '.int': 4,
  '.4byte': 4,
  '.dword': 8,
  '.quad': 8,
  '.8byte': 8,
};
const ABS_KIND: Record<number, FixupKind> = { 1: 'ABS8', 2: 'ABS16', 4: 'ABS32', 8: 'ABS64' };

const USAGE: Record<string, string> = {
  R: 'rd, rs1, rs2',
  I: 'rd, rs1, imm',
  SHIFT: 'rd, rs1, shamt',
  LOAD: 'rd, offset(rs1)',
  STORE: 'rs2, offset(rs1)',
  BRANCH: 'rs1, rs2, label',
  U: 'rd, imm',
  JAL: '[rd,] label',
  JALR: 'rd, offset(rs1)',
  CSR: 'rd, csr, rs1',
  CSRI: 'rd, csr, imm',
  FENCE: '[pred, succ]',
  FIXED: '(no operands)',
  SFENCE: '[rs1[, rs2]]',
  LR: 'rd, (rs1)',
  AMO: 'rd, rs2, (rs1)',
};

/** Pseudo-instructions and their operand usage, for messages and suggestions. */
const PSEUDO_USAGE: Record<string, string> = {
  nop: '',
  li: 'rd, imm',
  la: 'rd, symbol',
  lla: 'rd, symbol',
  mv: 'rd, rs',
  not: 'rd, rs',
  neg: 'rd, rs',
  seqz: 'rd, rs',
  snez: 'rd, rs',
  sltz: 'rd, rs',
  sgtz: 'rd, rs',
  j: 'label',
  jr: 'rs',
  ret: '',
  call: 'symbol',
  tail: 'symbol',
  beqz: 'rs, label',
  bnez: 'rs, label',
  blez: 'rs, label',
  bgez: 'rs, label',
  bltz: 'rs, label',
  bgtz: 'rs, label',
  bgt: 'rs1, rs2, label',
  ble: 'rs1, rs2, label',
  bgtu: 'rs1, rs2, label',
  bleu: 'rs1, rs2, label',
  csrr: 'rd, csr',
  csrw: 'csr, rs',
  csrs: 'csr, rs',
  csrc: 'csr, rs',
  csrwi: 'csr, imm',
  csrsi: 'csr, imm',
  csrci: 'csr, imm',
  rdcycle: 'rd',
  rdcycleh: 'rd',
  rdtime: 'rd',
  rdtimeh: 'rd',
  rdinstret: 'rd',
  rdinstreth: 'rd',
};

/** All mnemonics the assembler accepts (base and pseudo). */
export const MNEMONICS: readonly string[] = [...OPS_BY_NAME.keys(), ...Object.keys(PSEUDO_USAGE)];

/** All directives the assembler accepts. */
export const DIRECTIVES: readonly string[] = [
  '.text', '.data', '.rodata', '.bss', '.section', '.globl', '.global', '.local', '.weak',
  ...Object.keys(DATA_SIZES), '.ascii', '.asciz', '.string', '.align', '.p2align', '.balign',
  '.zero', '.space', '.skip', '.fill', '.equ', '.set', '.equiv', '.end', ...IGNORED,
]; // prettier-ignore

function editDistance(a: string, b: string): number {
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0] ?? 0;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j] ?? 0;
      d[j] = Math.min((d[j] ?? 0) + 1, (d[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length] ?? 0;
}

function suggest(word: string, options: readonly string[]): string {
  let best = '';
  let bestD = 3;
  for (const o of options) {
    const dist = editDistance(word, o);
    if (dist < bestD) {
      bestD = dist;
      best = o;
    }
  }
  return best ? ` (did you mean '${best}'?)` : '';
}

interface MemOperand {
  offset: Token[];
  base: number;
  baseTok: Token;
}

/** Assembles one source file. Never throws; problems are returned as diagnostics. */
export function assemble(source: string, options: AssembleOptions = {}): AssembleResult {
  return new Assembler(source, options.file ?? 'main.s').run();
}

class Assembler {
  private readonly diags: Diagnostic[] = [];
  private readonly sections = new Map<string, SectionBuilder>();
  private cur: SectionBuilder;
  private readonly symbols = new Map<string, ObjSymbol>();
  private readonly globals = new Map<string, Span>();
  private readonly fixups: Fixup[] = [];
  private readonly lines: LineEntry[] = [];
  private readonly localCount = new Map<bigint, number>();
  private readonly forwardRefs: { name: string; span: Span; text: string }[] = [];
  /** Offset where the current statement started (the value of `.`). */
  private stmtStart = 0;
  private stmtSpan: Span = { from: 0, to: 0, line: 1, col: 1 };

  constructor(
    private readonly source: string,
    private readonly file: string,
  ) {
    this.cur = this.section('.text', 'text');
  }

  private section(name: string, group: SectionGroup): SectionBuilder {
    let s = this.sections.get(name);
    if (!s) {
      s = new SectionBuilder(name, group);
      this.sections.set(name, s);
    }
    return s;
  }

  run(): AssembleResult {
    const tokens = tokenize(this.source).filter((t) => t.kind !== 'comment');
    let start = 0;
    let ended = false;
    while (start <= tokens.length && !ended) {
      let end = start;
      while (end < tokens.length && tokens[end]?.kind !== 'newline') end++;
      const stmt = tokens.slice(start, end);
      if (stmt.length > 0) {
        try {
          ended = this.statement(stmt);
        } catch (e) {
          if (e instanceof AsmError) this.error(e.span, e.message);
          else if (e instanceof UnknownSymbol) this.error(e.span, e.message);
          else throw e;
        }
      }
      start = end + 1;
    }
    for (const r of this.forwardRefs) {
      if (!this.symbols.has(r.name)) {
        this.error(
          r.span,
          `local label '${r.text}' has no matching '${r.text.slice(0, -1)}:' after it`,
        );
      }
    }
    return this.finish();
  }

  private error(span: Span, message: string): void {
    this.diags.push(diagnostic(this.file, span, message));
  }

  // ---- symbols and expressions ----

  private defineLabel(name: string, span: Span, hidden = false): void {
    if (this.cur.group === 'discard') return;
    const prev = this.symbols.get(name);
    if (prev) throw new AsmError(`'${name}' is already defined on line ${prev.span.line}`, span);
    this.symbols.set(name, {
      name,
      kind: 'label',
      section: this.cur.name,
      offset: this.cur.size,
      global: false,
      hidden,
      span,
    });
  }

  private readonly exprCtx = {
    localRef: (n: bigint, dir: 'f' | 'b', tok: Token): string => {
      const count = this.localCount.get(n) ?? 0;
      if (dir === 'b') {
        if (count === 0)
          throw new AsmError(
            `'${tok.text}' refers back to a '${n}:' label, but there is none before it`,
            spanOf(tok),
          );
        return `${n}\u0002${count}`;
      }
      const name = `${n}\u0002${count + 1}`;
      this.forwardRefs.push({ name, span: spanOf(tok), text: tok.text });
      return name;
    },
    dot: () => ({ section: this.cur.name, offset: this.stmtStart }),
  };

  private expr(tokens: readonly Token[], whole?: Span): Expr {
    return parseExpr(tokens, this.exprCtx, whole ?? this.stmtSpan);
  }

  private readonly resolving = new Set<string>();

  /** Assembly-time resolver: labels so far are section-relative; equs are evaluated. */
  private readonly resolve = (name: string, span: Span): Value | undefined => {
    const s = this.symbols.get(name);
    if (!s || s.kind === 'extern') return undefined;
    if (s.kind === 'label') return { section: s.section, off: BigInt(s.offset) };
    if (!s.expr) return undefined;
    if (this.resolving.has(name))
      throw new AsmError(`'${name}' is defined in terms of itself`, span);
    this.resolving.add(name);
    try {
      return evaluate(s.expr, this.resolve);
    } finally {
      this.resolving.delete(name);
    }
  };

  /** Value now, or null when it depends on something not yet known. */
  private tryEval(e: Expr): Value | null {
    try {
      return evaluate(e, this.resolve);
    } catch (err) {
      if (err instanceof UnknownSymbol) return null;
      throw err;
    }
  }

  /** A constant needed right now (sizes, counts, alignments). */
  private constant(e: Expr, what: string): bigint {
    let v: Value;
    try {
      v = evaluate(e, this.resolve);
    } catch (err) {
      if (err instanceof UnknownSymbol) {
        throw new AsmError(
          `${what} must be a constant known at this point; '${err.symbol}' is not`,
          err.span,
        );
      }
      throw err;
    }
    if (v.section !== null)
      throw new AsmError(`${what} must be a constant, not an address`, e.span);
    return v.off;
  }

  // ---- emission ----

  private emitBytes(bs: readonly number[]): number {
    const s = this.cur;
    if (s.group === 'bss') {
      if (bs.some((b) => b !== 0))
        throw new AsmError(
          `${s.name} holds only zeros; put initialised data in .data`,
          this.stmtSpan,
        );
    } else if (s.group !== 'discard') {
      for (const b of bs) s.bytes.push(b & 0xff);
    }
    const at = s.size;
    s.size += bs.length;
    return at;
  }

  private emitWord(w: number): number {
    return this.emitBytes([w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff, (w >>> 24) & 0xff]);
  }

  /** Adds a fixup at `offset` in the current section, resolving it now when possible. */
  private fix(
    kind: FixupKind,
    offset: number,
    expr: Expr,
    span: Span,
    hi?: { section: string; offset: number },
  ): void {
    if (this.cur.group === 'discard') return;
    if (!isPcRelative(kind) && !kind.startsWith('PCREL')) {
      const v = this.tryEval(expr);
      if (v && v.section === null && this.cur.group === 'bss' && v.off === 0n) return;
      if (v && v.section === null && this.cur.group !== 'bss') {
        const buf = new Uint8Array(this.cur.bytes.slice(offset, offset + 8));
        applyFixup(buf, 0, kind, v.off, 0n, span);
        for (let i = 0; i < buf.length; i++) this.cur.bytes[offset + i] = buf[i] ?? 0;
        return;
      }
    }
    if (this.cur.group === 'bss')
      throw new AsmError(`${this.cur.name} holds only zeros; put initialised data in .data`, span);
    this.fixups.push({ kind, section: this.cur.name, offset, expr, span, ...(hi ? { hi } : {}) });
  }

  private emitInstr(i: Instr): number {
    return this.emitWord(encode(i));
  }

  private padTo(alignBytes: number, fill: number | null, max: number | null): void {
    const s = this.cur;
    if (alignBytes > s.align) s.align = alignBytes;
    const pad = (alignBytes - (s.size % alignBytes)) % alignBytes;
    if (pad === 0 || (max !== null && pad > max)) return;
    if (s.code && fill === null) {
      if (alignBytes <= 4) return; // GNU as: code alignment up to the instruction size is a no-op
      this.emitBytes(codeFill(s.size, pad));
      return;
    }
    this.emitBytes(new Array<number>(pad).fill(fill ?? 0));
  }

  // ---- statements ----

  /** Returns true on `.end`. */
  private statement(stmt: Token[]): boolean {
    this.stmtSpan = spanOfTokens(stmt, this.stmtSpan);
    const bad = stmt.find((t) => t.kind === 'error');
    if (bad) throw new AsmError(bad.message ?? 'unreadable input', spanOf(bad));
    let k = 0;
    for (;;) {
      const a = stmt[k];
      if (!a || stmt[k + 1]?.kind !== 'colon') break;
      this.stmtStart = this.cur.size;
      if (a.kind === 'label') this.defineLabel(a.text, spanOf(a), a.text.startsWith('.L'));
      else if (a.kind === 'localLabel') {
        const n = a.value ?? 0n;
        const c = (this.localCount.get(n) ?? 0) + 1;
        this.localCount.set(n, c);
        this.defineLabel(`${n}\u0002${c}`, spanOf(a), true);
      } else throw new AsmError(`'${a.text}' cannot be a label`, spanOf(a));
      k += 2;
    }
    const head = stmt[k];
    if (!head) return false;
    this.stmtStart = this.cur.size;
    const rest = stmt.slice(k + 1);
    this.stmtSpan = spanOfTokens(stmt.slice(k), this.stmtSpan);
    if (head.kind === 'label' && rest[0]?.kind === 'equals') {
      this.defineEqu(head, rest.slice(1), false);
      return false;
    }
    if (head.kind === 'directive') return this.directive(head, splitOperands(rest, head));
    if (head.kind === 'mnemonic') {
      const startOffset = this.cur.size;
      this.instruction(head, splitOperands(rest, head));
      const size = this.cur.size - startOffset;
      if (size > 0 && this.cur.group !== 'discard') {
        this.lines.push({
          section: this.cur.name,
          offset: startOffset,
          size,
          line: head.line,
          col: head.col,
          kind: 'code',
        });
      }
      return false;
    }
    throw new AsmError(`expected an instruction or directive, found '${head.text}'`, spanOf(head));
  }

  private defineEqu(nameTok: Token, exprToks: Token[], equiv: boolean): void {
    if (nameTok.kind === 'register')
      throw new AsmError(`'${nameTok.text}' is a register name`, spanOf(nameTok));
    const name = nameTok.text;
    const prev = this.symbols.get(name);
    if (prev && prev.kind !== 'extern') {
      throw new AsmError(
        `'${name}' is already defined on line ${prev.span.line}` +
          (equiv ? '' : '; constants cannot be redefined'),
        spanOf(nameTok),
      );
    }
    const expr = this.expr(exprToks, spanOf(nameTok));
    this.symbols.set(name, {
      name,
      kind: 'equ',
      section: null,
      offset: 0,
      expr,
      global: false,
      hidden: false,
      span: spanOf(nameTok),
    });
    // Catch cycles and constant errors early when everything is known.
    this.tryEval(expr);
  }

  private directive(head: Token, ops: Token[][]): boolean {
    const d = head.text.toLowerCase();
    const span = spanOf(head);
    const want = (n: number, usage: string): void => {
      if (ops.length !== n) throw new AsmError(`${d} expects ${usage}`, span);
    };
    const dataStart = this.cur.size;
    const recordData = (): void => {
      const size = this.cur.size - dataStart;
      if (size > 0 && this.cur.group !== 'discard') {
        this.lines.push({
          section: this.cur.name,
          offset: dataStart,
          size,
          line: head.line,
          col: head.col,
          kind: 'data',
        });
      }
    };
    if (IGNORED.has(d) || d.startsWith('.cfi_')) return false;
    switch (d) {
      case '.text':
      case '.data':
      case '.bss':
      case '.rodata':
        if (ops.length > 0)
          throw new AsmError(`${d} takes no operands (use .section for subsections)`, span);
        this.cur = this.section(d, groupOf(d) ?? 'text');
        return false;
      case '.section': {
        const nameToks = ops[0];
        if (!nameToks || nameToks.length === 0)
          throw new AsmError('.section expects a section name', span);
        const name = nameToks.map((t) => t.text).join('');
        const g = groupOf(name);
        if (!g) {
          throw new AsmError(
            `unknown section '${name}': use .text, .rodata, .data or .bss, optionally with a suffix like .text.boot`,
            spanOfTokens(nameToks, span),
          );
        }
        this.cur = this.section(name, g);
        return false;
      }
      case '.globl':
      case '.global':
      case '.weak':
        if (ops.length === 0) throw new AsmError(`${d} expects one or more symbol names`, span);
        for (const op of ops) {
          const t = op[0];
          if (op.length !== 1 || !t || (t.kind !== 'symbol' && t.kind !== 'csr')) {
            throw new AsmError(`${d} expects symbol names`, spanOfTokens(op, span));
          }
          this.globals.set(t.text, spanOf(t));
        }
        return false;
      case '.local':
        for (const op of ops) {
          const t = op[0];
          if (t) this.globals.delete(t.text);
        }
        return false;
      case '.equ':
      case '.set':
      case '.equiv': {
        want(2, 'a name and a value: .equ NAME, value');
        const nameTok = ops[0]?.[0];
        if (!nameTok || ops[0]?.length !== 1)
          throw new AsmError(`${d} expects a symbol name first`, span);
        this.defineEqu(nameTok, ops[1] ?? [], d === '.equiv');
        return false;
      }
      case '.ascii':
      case '.asciz':
      case '.string': {
        if (ops.length === 0) throw new AsmError(`${d} expects one or more "strings"`, span);
        for (const op of ops) {
          const t = op[0];
          if (op.length !== 1 || !t || t.kind !== 'string') {
            throw new AsmError(`${d} expects "quoted strings"`, spanOfTokens(op, span));
          }
          this.emitBytes([...(t.bytes ?? []), ...(d === '.ascii' ? [] : [0])]);
        }
        recordData();
        return false;
      }
      case '.align':
      case '.p2align':
      case '.balign': {
        if (ops.length < 1 || ops.length > 3)
          throw new AsmError(`${d} expects an alignment[, fill[, max]]`, span);
        const n = this.constant(this.expr(ops[0] ?? []), 'alignment');
        let bytes: bigint;
        if (d === '.balign') {
          if (n <= 0n || (n & (n - 1n)) !== 0n)
            throw new AsmError('.balign needs a power of two', span);
          bytes = n;
        } else {
          if (n < 0n || n > 16n)
            throw new AsmError(
              `${d} takes a power-of-two exponent 0..16 (e.g. .align 2 is 4 bytes)`,
              span,
            );
          bytes = 1n << n;
        }
        const fillToks = ops[1] ?? [];
        const fill =
          fillToks.length > 0 ? Number(this.constant(this.expr(fillToks), 'fill') & 0xffn) : null;
        const max = ops[2] ? Number(this.constant(this.expr(ops[2]), 'max')) : null;
        this.padTo(Number(bytes), fill, max);
        return false;
      }
      case '.zero':
      case '.space':
      case '.skip': {
        if (ops.length < 1 || ops.length > 2)
          throw new AsmError(`${d} expects a size[, fill]`, span);
        const n = this.constant(this.expr(ops[0] ?? []), 'size');
        if (n < 0n || n > 0x1000000n)
          throw new AsmError(`${d} size ${n} is out of range 0..16 MiB`, span);
        if (d === '.zero' && ops.length > 1)
          throw new AsmError('.zero takes only a size (use .space size, fill)', span);
        const fill = ops[1] ? Number(this.constant(this.expr(ops[1]), 'fill') & 0xffn) : 0;
        this.emitBytes(new Array<number>(Number(n)).fill(fill));
        recordData();
        return false;
      }
      case '.fill': {
        if (ops.length < 1 || ops.length > 3)
          throw new AsmError('.fill expects repeat[, size[, value]]', span);
        const repeat = this.constant(this.expr(ops[0] ?? []), 'repeat count');
        const size = ops[1] ? this.constant(this.expr(ops[1]), 'size') : 1n;
        const value = ops[2] ? this.constant(this.expr(ops[2]), 'value') : 0n;
        if (repeat < 0n || repeat > 0x1000000n)
          throw new AsmError(`.fill repeat ${repeat} is out of range`, span);
        if (size < 0n || size > 8n) throw new AsmError('.fill size must be 0..8', span);
        const one = new Uint8Array(Number(size));
        writeLE(one, 0, value, Number(size));
        for (let i = 0n; i < repeat; i++) this.emitBytes([...one]);
        recordData();
        return false;
      }
      case '.end':
        return true;
      default:
        break;
    }
    const width = DATA_SIZES[d];
    if (width !== undefined) {
      if (ops.length === 0) throw new AsmError(`${d} expects one or more values`, span);
      for (const op of ops) {
        const opSpan = spanOfTokens(op, span);
        if (op.length === 1 && op[0]?.kind === 'string') {
          throw new AsmError(`${d} takes numbers; use .ascii or .string for text`, opSpan);
        }
        const e = this.expr(op, opSpan);
        const at = this.emitBytes(new Array<number>(width).fill(0));
        this.fix(ABS_KIND[width] ?? 'ABS32', at, e, opSpan);
      }
      recordData();
      return false;
    }
    throw new AsmError(`unknown directive '${head.text}'${suggest(d, DIRECTIVES)}`, span);
  }

  // ---- operands ----

  private reg(op: Token[] | undefined, what = 'register'): number {
    const t = op?.[0];
    if (!op || op.length === 0 || !t) throw new AsmError(`missing ${what}`, this.stmtSpan);
    const n = registerNumber(t.text);
    if (op.length !== 1 || n === undefined) {
      const hint =
        t.kind === 'symbol' && registerNumber(t.text.toLowerCase()) !== undefined
          ? ` (registers are lower case: ${t.text.toLowerCase()})`
          : '';
      throw new AsmError(
        `expected a ${what} (x0-x31 or an ABI name like a0), found '${op.map((x) => x.text).join(' ')}'${hint}`,
        spanOfTokens(op, this.stmtSpan),
      );
    }
    return n;
  }

  private isReg(op: Token[] | undefined): boolean {
    return !!op && op.length === 1 && op[0]?.kind === 'register';
  }

  /** `offset(reg)` or `(reg)`; null when the operand has no `(reg)` suffix. */
  private mem(op: Token[] | undefined): MemOperand | null {
    if (!op || op.length < 3) return null;
    const close = op[op.length - 1];
    const regTok = op[op.length - 2];
    const open = op[op.length - 3];
    if (close?.kind !== 'rparen' || open?.kind !== 'lparen' || regTok?.kind !== 'register')
      return null;
    const base = registerNumber(regTok.text);
    if (base === undefined) return null;
    return { offset: op.slice(0, -3), base, baseTok: regTok };
  }

  /** Splits `%hi(expr)` style operands. */
  private relocOperand(op: Token[]): { reloc: string | null; expr: Expr; span: Span } {
    const span = spanOfTokens(op, this.stmtSpan);
    const first = op[0];
    if (first?.kind === 'reloc') {
      const name = first.text;
      if (!['%hi', '%lo', '%pcrel_hi', '%pcrel_lo'].includes(name)) {
        throw new AsmError(
          `unknown relocation '${name}' (use %hi, %lo, %pcrel_hi or %pcrel_lo)`,
          spanOf(first),
        );
      }
      const open = op[1];
      const close = op[op.length - 1];
      if (open?.kind !== 'lparen' || close?.kind !== 'rparen' || op.length < 4) {
        throw new AsmError(`${name} needs parentheses: ${name}(symbol)`, span);
      }
      return { reloc: name, expr: this.expr(op.slice(2, -1), span), span };
    }
    return { reloc: null, expr: this.expr(op, span), span };
  }

  private immField(op: Token[] | undefined, field: 'I' | 'S' | 'U', at: number): void {
    if (!op || op.length === 0) throw new AsmError('missing immediate', this.stmtSpan);
    const { reloc, expr, span } = this.relocOperand(op);
    const allowed: Record<'I' | 'S' | 'U', Record<string, FixupKind>> = {
      I: { '': 'I12', '%lo': 'LO12_I', '%pcrel_lo': 'PCREL_LO12_I' },
      S: { '': 'S12', '%lo': 'LO12_S', '%pcrel_lo': 'PCREL_LO12_S' },
      U: { '': 'U20', '%hi': 'HI20', '%pcrel_hi': 'PCREL_HI20' },
    };
    const kind = allowed[field][reloc ?? ''];
    if (!kind) {
      const ok = Object.keys(allowed[field]).filter(Boolean).join(' or ');
      throw new AsmError(
        `${reloc} cannot be used here; this field takes a plain value or ${ok}`,
        span,
      );
    }
    this.fix(kind, at, expr, span);
  }

  private plainExpr(op: Token[] | undefined, what: string): { expr: Expr; span: Span } {
    if (!op || op.length === 0) throw new AsmError(`missing ${what}`, this.stmtSpan);
    const span = spanOfTokens(op, this.stmtSpan);
    if (op[0]?.kind === 'reloc')
      throw new AsmError(`${op[0].text} cannot be used for a ${what}`, span);
    if (op.length === 1 && op[0]?.kind === 'register') {
      throw new AsmError(`expected a ${what}, found register '${op[0].text}'`, span);
    }
    return { expr: this.expr(op, span), span };
  }

  private csrField(op: Token[] | undefined, at: number): void {
    if (!op || op.length === 0) throw new AsmError('missing CSR', this.stmtSpan);
    const t = op[0];
    if (op.length === 1 && t && CSR_NAMES.has(t.text) && !this.symbols.has(t.text)) {
      this.patchCsr(at, CSR_NAMES.get(t.text) ?? 0);
      return;
    }
    const { expr, span } = this.plainExpr(op, 'CSR name or number');
    this.fix('CSR12', at, expr, span);
  }

  private patchCsr(at: number, csr: number): void {
    const b = this.cur.bytes;
    b[at + 2] = ((b[at + 2] ?? 0) & 0x0f) | ((csr & 0xf) << 4);
    b[at + 3] = (csr >>> 4) & 0xff;
  }

  // ---- instructions ----

  private arity(head: Token, ops: Token[][], counts: number[], usage: string): void {
    if (!counts.includes(ops.length)) {
      const name = head.text.toLowerCase();
      const n = counts.length === 1 ? `${counts[0]}` : counts.join(' or ');
      throw new AsmError(
        `${name} expects ${n} operand${counts[0] === 1 && counts.length === 1 ? '' : 's'}${usage ? `: ${name} ${usage}` : ''}, found ${ops.length}`,
        spanOf(head),
      );
    }
  }

  private op(name: string): OpSpec {
    const o = OPS_BY_NAME.get(name);
    if (!o) throw new Error(`internal: no op ${name}`);
    return o;
  }

  private instruction(head: Token, ops: Token[][]): void {
    const name = head.text.toLowerCase();
    if (this.cur.group === 'bss')
      throw new AsmError(`instructions cannot go in ${this.cur.name}`, spanOf(head));
    if (this.pseudo(name, head, ops)) return;
    let opName = name;
    let aq = false;
    let rl = false;
    const amo = /^(.*\.w)\.(aq|rl|aqrl)$/.exec(name);
    if (amo && OPS_BY_NAME.get(amo[1] ?? '')?.opcode === 0x2f) {
      opName = amo[1] ?? name;
      aq = amo[2] !== 'rl';
      rl = amo[2] !== 'aq';
    }
    const spec = OPS_BY_NAME.get(opName);
    if (!spec)
      throw new AsmError(
        `unknown instruction '${head.text}'${suggest(name, MNEMONICS)}`,
        spanOf(head),
      );
    const usage = USAGE[spec.format] ?? '';
    const at = this.cur.size;
    switch (spec.format) {
      case 'R':
        this.arity(head, ops, [3], usage);
        this.emitInstr(
          instr(spec, {
            rd: this.reg(ops[0], 'destination register'),
            rs1: this.reg(ops[1]),
            rs2: this.reg(ops[2]),
          }),
        );
        return;
      case 'I':
        this.arity(head, ops, [3], usage);
        this.emitInstr(
          instr(spec, { rd: this.reg(ops[0], 'destination register'), rs1: this.reg(ops[1]) }),
        );
        this.immField(ops[2], 'I', at);
        return;
      case 'SHIFT': {
        this.arity(head, ops, [3], usage);
        this.emitInstr(
          instr(spec, { rd: this.reg(ops[0], 'destination register'), rs1: this.reg(ops[1]) }),
        );
        const { expr, span } = this.plainExpr(ops[2], 'shift amount');
        this.fix('SHAMT', at, expr, span);
        return;
      }
      case 'LOAD': {
        this.arity(head, ops, [2], usage);
        const rd = this.reg(ops[0], 'destination register');
        const m = this.mem(ops[1]);
        if (!m) {
          // lw rd, symbol  ->  auipc rd, %pcrel_hi(symbol); lw rd, %pcrel_lo(.)(rd)
          const { expr, span } = this.plainExpr(ops[1], 'address');
          this.pcrelPair(rd, expr, span, instr(spec, { rd, rs1: rd }), 'PCREL_LO12_I');
          return;
        }
        this.emitInstr(instr(spec, { rd, rs1: m.base }));
        this.memOffset(m, 'I', at);
        return;
      }
      case 'STORE': {
        this.arity(head, ops, [2, 3], usage);
        const rs2 = this.reg(ops[0], 'source register');
        const m = this.mem(ops[1]);
        if (!m) {
          if (ops.length !== 3)
            throw new AsmError(
              `${name} to a symbol needs a scratch register: ${name} rs2, symbol, rt`,
              spanOf(head),
            );
          const rt = this.reg(ops[2], 'scratch register');
          const { expr, span } = this.plainExpr(ops[1], 'address');
          this.pcrelPair(rt, expr, span, instr(spec, { rs2, rs1: rt }), 'PCREL_LO12_S');
          return;
        }
        if (ops.length !== 2)
          throw new AsmError(`${name} expects 2 operands: ${name} ${usage}`, spanOf(head));
        this.emitInstr(instr(spec, { rs2, rs1: m.base }));
        this.memOffset(m, 'S', at);
        return;
      }
      case 'BRANCH':
        this.arity(head, ops, [3], usage);
        this.branch(spec, this.reg(ops[0]), this.reg(ops[1]), ops[2]);
        return;
      case 'U':
        this.arity(head, ops, [2], usage);
        this.emitInstr(instr(spec, { rd: this.reg(ops[0], 'destination register') }));
        this.immField(ops[1], 'U', at);
        return;
      case 'JAL':
        this.arity(head, ops, [1, 2], usage);
        if (ops.length === 1) this.jal(1, ops[0]);
        else this.jal(this.reg(ops[0], 'destination register'), ops[1]);
        return;
      case 'JALR':
        this.arity(head, ops, [1, 2, 3], usage);
        this.jalr(ops);
        return;
      case 'CSR':
        this.arity(head, ops, [3], usage);
        this.emitInstr(
          instr(spec, { rd: this.reg(ops[0], 'destination register'), rs1: this.reg(ops[2]) }),
        );
        this.csrField(ops[1], at);
        return;
      case 'CSRI': {
        this.arity(head, ops, [3], usage);
        this.emitInstr(instr(spec, { rd: this.reg(ops[0], 'destination register') }));
        this.csrField(ops[1], at);
        const { expr, span } = this.plainExpr(ops[2], 'immediate');
        this.fix('ZIMM5', at, expr, span);
        return;
      }
      case 'FENCE': {
        this.arity(head, ops, [0, 2], usage);
        const pred = ops.length === 0 ? 15 : fenceSet(ops[0], this.stmtSpan);
        const succ = ops.length === 0 ? 15 : fenceSet(ops[1], this.stmtSpan);
        this.emitInstr(instr(spec, { pred, succ }));
        return;
      }
      case 'FIXED':
        this.arity(head, ops, [0], '');
        this.emitInstr(instr(spec));
        return;
      case 'SFENCE':
        this.arity(head, ops, [0, 1, 2], usage);
        this.emitInstr(
          instr(spec, { rs1: ops[0] ? this.reg(ops[0]) : 0, rs2: ops[1] ? this.reg(ops[1]) : 0 }),
        );
        return;
      case 'LR':
      case 'AMO': {
        const n = spec.format === 'LR' ? 2 : 3;
        this.arity(head, ops, [n], usage);
        const rd = this.reg(ops[0], 'destination register');
        const rs2 = n === 3 ? this.reg(ops[1]) : 0;
        const addrOp = ops[n - 1];
        const m = this.mem(addrOp);
        if (
          !m ||
          !(m.offset.length === 0 || (m.offset.length === 1 && m.offset[0]?.value === 0n))
        ) {
          throw new AsmError(
            `${name} takes its address as (rs1) with no offset`,
            spanOfTokens(addrOp ?? [], this.stmtSpan),
          );
        }
        this.emitInstr(instr(spec, { rd, rs1: m.base, rs2, aq, rl }));
        return;
      }
    }
  }

  private memOffset(m: MemOperand, field: 'I' | 'S', at: number): void {
    if (m.offset.length === 0) return;
    this.immField(m.offset, field, at);
  }

  private branch(spec: OpSpec, rs1: number, rs2: number, target: Token[] | undefined): void {
    const at = this.cur.size;
    this.emitInstr(instr(spec, { rs1, rs2 }));
    const { expr, span } = this.plainExpr(target, 'branch target');
    this.fix('BRANCH', at, expr, span);
  }

  private jal(rd: number, target: Token[] | undefined): void {
    const at = this.cur.size;
    this.emitInstr(instr(this.op('jal'), { rd }));
    const { expr, span } = this.plainExpr(target, 'jump target');
    this.fix('JAL', at, expr, span);
  }

  private jalr(ops: Token[][]): void {
    const spec = this.op('jalr');
    const at = this.cur.size;
    if (ops.length === 1) {
      const m = this.mem(ops[0]);
      if (m) {
        this.emitInstr(instr(spec, { rd: 1, rs1: m.base }));
        this.memOffset(m, 'I', at);
      } else this.emitInstr(instr(spec, { rd: 1, rs1: this.reg(ops[0]) }));
      return;
    }
    const rd = this.reg(ops[0], 'destination register');
    if (ops.length === 2) {
      const m = this.mem(ops[1]);
      if (m) {
        this.emitInstr(instr(spec, { rd, rs1: m.base }));
        this.memOffset(m, 'I', at);
      } else this.emitInstr(instr(spec, { rd, rs1: this.reg(ops[1]) }));
      return;
    }
    this.emitInstr(instr(spec, { rd, rs1: this.reg(ops[1]) }));
    this.immField(ops[2], 'I', at);
  }

  /** auipc rt, %pcrel_hi(expr) followed by `second` with %pcrel_lo of that auipc. */
  private pcrelPair(rt: number, expr: Expr, span: Span, second: Instr, lo: FixupKind): void {
    const hiAt = this.cur.size;
    this.emitInstr(instr(this.op('auipc'), { rd: rt }));
    this.fix('PCREL_HI20', hiAt, expr, span);
    const loAt = this.emitInstr(second);
    this.fix(lo, loAt, expr, span, { section: this.cur.name, offset: hiAt });
  }

  /** Expands a pseudo-instruction; returns false when `name` is not one. */
  private pseudo(name: string, head: Token, ops: Token[][]): boolean {
    const usage = PSEUDO_USAGE[name];
    if (usage === undefined) return false;
    const want = (n: number[]): void => this.arity(head, ops, n, usage);
    const I = (op: string, f: Partial<Omit<Instr, 'op'>>): number =>
      this.emitInstr(instr(this.op(op), f));
    const rd = (i = 0): number => this.reg(ops[i], 'destination register');
    const rs = (i: number): number => this.reg(ops[i]);
    switch (name) {
      case 'nop':
        want([0]);
        I('addi', {});
        return true;
      case 'mv':
        want([2]);
        I('addi', { rd: rd(), rs1: rs(1) });
        return true;
      case 'not':
        want([2]);
        I('xori', { rd: rd(), rs1: rs(1), imm: -1 });
        return true;
      case 'neg':
        want([2]);
        I('sub', { rd: rd(), rs2: rs(1) });
        return true;
      case 'seqz':
        want([2]);
        I('sltiu', { rd: rd(), rs1: rs(1), imm: 1 });
        return true;
      case 'snez':
        want([2]);
        I('sltu', { rd: rd(), rs2: rs(1) });
        return true;
      case 'sltz':
        want([2]);
        I('slt', { rd: rd(), rs1: rs(1) });
        return true;
      case 'sgtz':
        want([2]);
        I('slt', { rd: rd(), rs2: rs(1) });
        return true;
      case 'li':
        want([2]);
        this.li(rd(), ops[1]);
        return true;
      case 'la':
      case 'lla': {
        want([2]);
        const r = rd();
        const { expr, span } = this.plainExpr(ops[1], 'symbol');
        this.pcrelPair(r, expr, span, instr(this.op('addi'), { rd: r, rs1: r }), 'PCREL_LO12_I');
        return true;
      }
      case 'call':
      case 'tail': {
        want([1]);
        const link = name === 'call' ? 1 : 0;
        const rt = name === 'call' ? 1 : 6;
        const { expr, span } = this.plainExpr(ops[0], 'function name');
        this.pcrelPair(
          rt,
          expr,
          span,
          instr(this.op('jalr'), { rd: link, rs1: rt }),
          'PCREL_LO12_I',
        );
        return true;
      }
      case 'j':
        want([1]);
        this.jal(0, ops[0]);
        return true;
      case 'jr': {
        want([1]);
        const m = this.mem(ops[0]);
        const at = this.cur.size;
        if (m) {
          I('jalr', { rs1: m.base });
          this.memOffset(m, 'I', at);
        } else I('jalr', { rs1: rs(0) });
        return true;
      }
      case 'ret':
        want([0]);
        I('jalr', { rs1: 1 });
        return true;
      case 'beqz':
      case 'bnez':
      case 'blez':
      case 'bgez':
      case 'bltz':
      case 'bgtz': {
        want([2]);
        const r = rs(0);
        const table: Record<string, [string, number, number]> = {
          beqz: ['beq', r, 0],
          bnez: ['bne', r, 0],
          blez: ['bge', 0, r],
          bgez: ['bge', r, 0],
          bltz: ['blt', r, 0],
          bgtz: ['blt', 0, r],
        };
        const [op, a, b] = table[name] ?? ['beq', 0, 0];
        this.branch(this.op(op), a, b, ops[1]);
        return true;
      }
      case 'bgt':
      case 'ble':
      case 'bgtu':
      case 'bleu': {
        want([3]);
        const a = rs(0);
        const b = rs(1);
        const op = { bgt: 'blt', ble: 'bge', bgtu: 'bltu', bleu: 'bgeu' }[name];
        this.branch(this.op(op), b, a, ops[2]);
        return true;
      }
      case 'csrr': {
        want([2]);
        const at = I('csrrs', { rd: rd() });
        this.csrField(ops[1], at);
        return true;
      }
      case 'csrw':
      case 'csrs':
      case 'csrc': {
        want([2]);
        const op = { csrw: 'csrrw', csrs: 'csrrs', csrc: 'csrrc' }[name];
        const at = I(op, { rs1: rs(1) });
        this.csrField(ops[0], at);
        return true;
      }
      case 'csrwi':
      case 'csrsi':
      case 'csrci': {
        want([2]);
        const op = { csrwi: 'csrrwi', csrsi: 'csrrsi', csrci: 'csrrci' }[name];
        const at = I(op, {});
        this.csrField(ops[0], at);
        const { expr, span } = this.plainExpr(ops[1], 'immediate');
        this.fix('ZIMM5', at, expr, span);
        return true;
      }
      default: {
        // rdcycle, rdtime, rdinstret and their h variants
        want([1]);
        const csr = CSR_NAMES.get(name.slice(2)) ?? 0;
        I('csrrs', { rd: rd(), csr });
        return true;
      }
    }
  }

  private li(rd: number, op: Token[] | undefined): void {
    const { expr, span } = this.plainExpr(op, 'immediate');
    const v = this.tryEval(expr);
    if (v && v.section === null) {
      if (v.off < -0x80000000n || v.off > 0xffffffffn) {
        throw new AsmError(`li value ${v.off} does not fit in 32 bits`, span);
      }
      const n = Number(BigInt.asIntN(32, v.off));
      if (n >= -2048 && n <= 2047) {
        this.emitInstr(instr(this.op('addi'), { rd, imm: n }));
        return;
      }
      this.emitInstr(instr(this.op('lui'), { rd, imm: hi20(n) }));
      const lo = lo12(n);
      if (lo !== 0) this.emitInstr(instr(this.op('addi'), { rd, rs1: rd, imm: lo }));
      return;
    }
    // Not constant yet (an address or a later symbol): lui + addi with %hi/%lo.
    const at = this.emitInstr(instr(this.op('lui'), { rd }));
    this.fix('HI20', at, expr, span);
    const at2 = this.emitInstr(instr(this.op('addi'), { rd, rs1: rd }));
    this.fix('LO12_I', at2, expr, span);
  }

  // ---- output ----

  private finish(): AssembleResult {
    const sections: ObjSection[] = [];
    for (const s of this.sections.values()) {
      if (s.code && s.size % s.align !== 0) {
        // GNU as pads code sections to their alignment with nops.
        this.cur = s;
        this.emitBytes(codeFill(s.size, s.align - (s.size % s.align)));
      }
      if (s.size === 0 && s.name !== '.text') continue;
      sections.push({
        name: s.name,
        group: s.group,
        align: s.align,
        size: s.size,
        bytes:
          s.group === 'bss' || s.group === 'discard' ? new Uint8Array(0) : Uint8Array.from(s.bytes),
      });
    }
    const symbols: ObjSymbol[] = [];
    for (const sym of this.symbols.values()) {
      symbols.push({ ...sym, global: this.globals.has(sym.name) });
    }
    for (const [name, span] of this.globals) {
      if (!this.symbols.has(name)) {
        symbols.push({
          name,
          kind: 'extern',
          section: null,
          offset: 0,
          global: true,
          hidden: false,
          span,
        });
      }
    }
    const object: AsmObject = {
      file: this.file,
      sections,
      symbols,
      fixups: this.fixups,
      lines: this.lines,
    };
    return { ok: this.diags.length === 0, object, diagnostics: this.diags };
  }
}

/** GNU as code padding: zeros to 2-byte alignment, a c.nop to 4, then nops. */
function codeFill(at: number, pad: number): number[] {
  const out: number[] = [];
  let p = at;
  let left = pad;
  while (left > 0 && p % 2 !== 0) {
    out.push(0);
    p++;
    left--;
  }
  if (left >= 2 && p % 4 !== 0) {
    out.push(C_NOP & 0xff, C_NOP >>> 8);
    left -= 2;
  }
  while (left >= 4) {
    out.push(NOP & 0xff, (NOP >>> 8) & 0xff, (NOP >>> 16) & 0xff, NOP >>> 24);
    left -= 4;
  }
  while (left-- > 0) out.push(0);
  return out;
}

function fenceSet(op: Token[] | undefined, fallback: Span): number {
  const t = op?.[0];
  if (!op || op.length !== 1 || !t)
    throw new AsmError(
      'fence expects two sets like rw, w (letters from i, o, r, w)',
      spanOfTokens(op ?? [], fallback),
    );
  if (t.kind === 'number' && t.value !== undefined && t.value >= 0n && t.value <= 15n)
    return Number(t.value);
  let v = 0;
  let last = -1;
  const order = 'iorw';
  for (const ch of t.text) {
    const idx = order.indexOf(ch);
    if (idx < 0 || idx <= last)
      throw new AsmError(
        `bad fence set '${t.text}': use letters i, o, r, w in that order`,
        spanOf(t),
      );
    last = idx;
    v |= 8 >> idx;
  }
  return v;
}

/** Splits operand tokens at top-level commas. */
function splitOperands(tokens: Token[], head: Token): Token[][] {
  if (tokens.length === 0) return [];
  const out: Token[][] = [[]];
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === 'lparen') depth++;
    if (t.kind === 'rparen') depth--;
    if (t.kind === 'comma' && depth === 0) {
      out.push([]);
      continue;
    }
    out[out.length - 1]?.push(t);
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i]?.length === 0) {
      const comma = tokens.filter((t) => t.kind === 'comma')[Math.max(0, i - 1)];
      throw new AsmError(
        'empty operand (two commas in a row, or a trailing comma?)',
        comma ? spanOf(comma) : spanJoin(spanOf(head), spanOf(head)),
      );
    }
  }
  return out;
}
