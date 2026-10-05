/**
 * Toy-8: the 8-bit teaching CPU of Phase 4 (TOY-01). Spec: docs/toy8.md
 * (DRAFT, owner approval needed).
 *
 * - Every instruction is 2 bytes: `A ccc dd ss` then `imm`.
 * - A = 1: ALU instruction, ccc = ALU op (ALU_OPS order). A = 0: system op.
 * - 2 clock cycles per instruction: fetch (IR ← ROM[PC], PC++), then execute.
 *
 * This module has the opcode table, a two-pass assembler, a disassembler for
 * the mnemonic preview, and the reference model `Toy8`.
 */

export interface Toy8Instruction {
  mnemonic: string;
  /** Instruction length in bytes. Always 2 for Toy-8. */
  size: number;
}

/** Operand shapes: what follows the mnemonic in assembly. */
export type Toy8Operands = 'none' | 'rd' | 'rd,rs' | 'rd,imm' | 'rd,[rs]' | 'imm';

export interface Toy8OpInfo {
  mnemonic: string;
  /** Instruction byte with rd = rs = 0. */
  byte: number;
  operands: Toy8Operands;
  /** One-line description for the editor and docs. */
  description: string;
}

/** Bytes per instruction. */
export const TOY8_INSTRUCTION_SIZE = 2;

/** Branch conditions, in `ss` order. */
export const TOY8_CONDITIONS = ['JZ', 'JNZ', 'JC', 'JN'] as const;

/**
 * Every mnemonic. The 16 opcodes are the upper nibble; Jcc (0x7_) has four
 * mnemonics that differ in the `ss` (condition) field.
 */
export const TOY8_OPS: readonly Toy8OpInfo[] = [
  { mnemonic: 'HALT', byte: 0x00, operands: 'none', description: 'Stop; the HALT lamp turns on' },
  { mnemonic: 'LDI', byte: 0x10, operands: 'rd,imm', description: 'rd ← imm' },
  { mnemonic: 'MOV', byte: 0x20, operands: 'rd,rs', description: 'rd ← rs' },
  { mnemonic: 'LD', byte: 0x30, operands: 'rd,[rs]', description: 'rd ← mem[rs]' },
  { mnemonic: 'ST', byte: 0x40, operands: 'rd,[rs]', description: 'mem[rs] ← rd' },
  { mnemonic: 'OUT', byte: 0x50, operands: 'rd', description: 'OUT ← rd' },
  { mnemonic: 'JMP', byte: 0x60, operands: 'imm', description: 'pc ← imm' },
  { mnemonic: 'JZ', byte: 0x70, operands: 'imm', description: 'if Z: pc ← imm' },
  { mnemonic: 'JNZ', byte: 0x71, operands: 'imm', description: 'if not Z: pc ← imm' },
  { mnemonic: 'JC', byte: 0x72, operands: 'imm', description: 'if C: pc ← imm' },
  { mnemonic: 'JN', byte: 0x73, operands: 'imm', description: 'if N: pc ← imm' },
  { mnemonic: 'ADD', byte: 0x80, operands: 'rd,rs', description: 'rd ← rd + rs (Z N C)' },
  { mnemonic: 'SUB', byte: 0x90, operands: 'rd,rs', description: 'rd ← rd - rs, C = rd ≥ rs (Z N C)' },
  { mnemonic: 'AND', byte: 0xa0, operands: 'rd,rs', description: 'rd ← rd AND rs (Z N, C = 0)' },
  { mnemonic: 'OR', byte: 0xb0, operands: 'rd,rs', description: 'rd ← rd OR rs (Z N, C = 0)' },
  { mnemonic: 'XOR', byte: 0xc0, operands: 'rd,rs', description: 'rd ← rd XOR rs (Z N, C = 0)' },
  { mnemonic: 'NOT', byte: 0xd0, operands: 'rd', description: 'rd ← NOT rd (Z N, C = 0)' },
  { mnemonic: 'SHL', byte: 0xe0, operands: 'rd,rs', description: 'rd ← rd << (rs & 7) (Z N, C = 0)' },
  { mnemonic: 'SHR', byte: 0xf0, operands: 'rd,rs', description: 'rd ← rd >> (rs & 7) (Z N, C = 0)' },
];

const BY_MNEMONIC = new Map(TOY8_OPS.map((o) => [o.mnemonic, o]));

/** Error from the assembler, with a 1-based source line when known. */
export class Toy8AsmError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = 'Toy8AsmError';
  }
}

// ------------------------------------------------------------------ helpers

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

/** Bytes as the ROM `data` prop and `program` test format: "10 05 20 00". */
export function toHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => hex2(b & 0xff)).join(' ');
}

/** Parse "10 05 2A" (whitespace-separated hex bytes) back into bytes. */
export function fromHex(text: string): number[] {
  const t = text.trim();
  if (!t) return [];
  return t.split(/\s+/).map((tok) => {
    if (!/^(0x)?[0-9a-fA-F]{1,2}$/.test(tok)) throw new Toy8AsmError(`'${tok}' is not a hex byte`);
    return parseInt(tok.replace(/^0x/, ''), 16);
  });
}

function parseNumber(tok: string): number | undefined {
  const t = tok.trim();
  let v: number;
  if (/^'.'$/.test(t)) v = t.charCodeAt(1);
  else if (/^-?0x[0-9a-f]+$/i.test(t)) v = parseInt(t.replace(/0x/i, ''), 16) * (t.startsWith('-') ? -1 : 1);
  else if (/^-?0b[01]+$/i.test(t)) v = parseInt(t.replace(/-?0b/i, ''), 2) * (t.startsWith('-') ? -1 : 1);
  else if (/^-?\d+$/.test(t)) v = parseInt(t, 10);
  else return undefined;
  return v;
}

function parseByte(tok: string, labels: Record<string, number> | undefined, what: string): number {
  const t = tok.trim();
  const n = parseNumber(t);
  if (n !== undefined) {
    if (n < -128 || n > 255) throw new Toy8AsmError(`${what} ${t} does not fit in a byte (-128..255)`);
    return n & 0xff;
  }
  if (/^[A-Za-z_][\w]*$/.test(t)) {
    const v = labels?.[t] ?? labels?.[t.toLowerCase()];
    if (v === undefined) throw new Toy8AsmError(`unknown label '${t}'`);
    return v & 0xff;
  }
  throw new Toy8AsmError(`expected a number or label for ${what}, got '${t}'`);
}

function parseReg(tok: string): number {
  const m = /^r([0-3])$/i.exec(tok.trim());
  if (!m) throw new Toy8AsmError(`expected a register R0..R3, got '${tok.trim()}'`);
  return Number(m[1]);
}

function parseMemReg(tok: string): number {
  const m = /^\[\s*(r[0-3])\s*\]$/i.exec(tok.trim());
  if (!m) throw new Toy8AsmError(`expected a memory operand like [R1], got '${tok.trim()}'`);
  return parseReg(m[1]!);
}

/** Strip a comment (`;` or `#`, outside a character literal). */
function stripComment(line: string): string {
  let inChar = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'") inChar = !inChar;
    else if (!inChar && (c === ';' || c === '#')) return line.slice(0, i);
  }
  return line;
}

interface ParsedLine {
  labels: string[];
  mnemonic?: string;
  args: string[];
}

function splitLine(raw: string): ParsedLine {
  let rest = stripComment(raw).trim();
  const labels: string[] = [];
  for (;;) {
    const m = /^([A-Za-z_]\w*)\s*:/.exec(rest);
    if (!m) break;
    labels.push(m[1]!);
    rest = rest.slice(m[0].length).trim();
  }
  if (!rest) return { labels, args: [] };
  const m = /^(\S+)\s*(.*)$/.exec(rest)!;
  const argText = m[2]!.trim();
  return { labels, mnemonic: m[1]!.toUpperCase(), args: argText ? argText.split(',').map((a) => a.trim()) : [] };
}

function sizeOf(p: ParsedLine): number {
  if (!p.mnemonic) return 0;
  if (p.mnemonic === '.BYTE' || p.mnemonic === 'DB') return p.args.length;
  return TOY8_INSTRUCTION_SIZE;
}

function encode(p: ParsedLine, labels: Record<string, number> | undefined): number[] {
  const mn = p.mnemonic;
  if (!mn) return [];
  if (mn === '.BYTE' || mn === 'DB') {
    if (p.args.length === 0) throw new Toy8AsmError(`${mn} needs at least one value`);
    return p.args.map((a) => parseByte(a, labels, 'value'));
  }
  const op = BY_MNEMONIC.get(mn);
  if (!op) throw new Toy8AsmError(`unknown instruction '${p.mnemonic}'`);
  const want: Record<Toy8Operands, number> = { none: 0, rd: 1, 'rd,rs': 2, 'rd,imm': 2, 'rd,[rs]': 2, imm: 1 };
  if (p.args.length !== want[op.operands]) {
    const shape = op.operands === 'none' ? 'no operands' : op.operands.replace('imm', 'value');
    throw new Toy8AsmError(`${op.mnemonic} takes ${shape}`);
  }
  const a = p.args;
  switch (op.operands) {
    case 'none':
      return [op.byte, 0];
    case 'rd':
      return [op.byte | (parseReg(a[0]!) << 2), 0];
    case 'rd,rs':
      return [op.byte | (parseReg(a[0]!) << 2) | parseReg(a[1]!), 0];
    case 'rd,[rs]':
      return [op.byte | (parseReg(a[0]!) << 2) | parseMemReg(a[1]!), 0];
    case 'rd,imm':
      return [op.byte | (parseReg(a[0]!) << 2), parseByte(a[1]!, labels, 'value')];
    case 'imm':
      return [op.byte, parseByte(a[0]!, labels, 'target')];
  }
}

/**
 * Assemble one line of Toy-8 assembly into bytes, or throw a Toy8AsmError.
 * Label definitions on the line are ignored; label operands resolve through
 * `labels` (from `assemble`) and are an error without it.
 */
export function assembleLine(line: string, labels?: Record<string, number>): number[] {
  return encode(splitLine(line), labels);
}

export interface Toy8Program {
  bytes: number[];
  /** Label → byte address. */
  labels: Record<string, number>;
  /** Byte address of each instruction → 1-based source line. */
  addrToLine: Record<number, number>;
}

/** Assemble a whole program (two passes, labels allowed). Throws Toy8AsmError with the line number. */
export function assemble(text: string): Toy8Program {
  const lines = text.split(/\r?\n/);
  const parsed: ParsedLine[] = [];
  const labels: Record<string, number> = {};
  let addr = 0;
  lines.forEach((raw, i) => {
    let p: ParsedLine;
    try {
      p = splitLine(raw);
    } catch (e) {
      throw new Toy8AsmError((e as Error).message, i + 1);
    }
    for (const l of p.labels) {
      if (/^r[0-3]$/i.test(l) || BY_MNEMONIC.has(l.toUpperCase())) throw new Toy8AsmError(`'${l}' is reserved and cannot be a label`, i + 1);
      if (l in labels) throw new Toy8AsmError(`label '${l}' is defined twice`, i + 1);
      labels[l] = addr;
    }
    parsed.push(p);
    addr += sizeOf(p);
  });
  if (addr > 256) throw new Toy8AsmError(`program is ${addr} bytes; the ROM holds 256`);
  const bytes: number[] = [];
  const addrToLine: Record<number, number> = {};
  parsed.forEach((p, i) => {
    if (!p.mnemonic) return;
    addrToLine[bytes.length] = i + 1;
    try {
      bytes.push(...encode(p, labels));
    } catch (e) {
      throw new Toy8AsmError(e instanceof Toy8AsmError ? e.message.replace(/^line \d+: /, '') : String(e), i + 1);
    }
  });
  return { bytes, labels, addrToLine };
}

/** Shorthand: assemble and return the program as the hex string the `program` test and ROM use. */
export const assembleHex = (text: string): string => toHex(assemble(text).bytes);

/**
 * Decode the instruction at `bytes[0..]` for the mnemonic preview. With only
 * one byte available, an immediate operand shows as `?`.
 */
export function disassemble(bytes: ArrayLike<number>): Toy8Instruction & { text: string } {
  if (bytes.length === 0) return { mnemonic: '?', size: 1, text: '?' };
  const b0 = bytes[0]! & 0xff;
  const imm = bytes.length > 1 ? `0x${hex2(bytes[1]! & 0xff)}` : '?';
  const hi = b0 & 0xf0;
  const rd = (b0 >> 2) & 3;
  const rs = b0 & 3;
  const op = hi === 0x70 ? TOY8_OPS.find((o) => o.byte === (0x70 | rs))! : TOY8_OPS.find((o) => o.byte === hi)!;
  let args: string;
  switch (op.operands) {
    case 'none':
      args = '';
      break;
    case 'rd':
      args = `R${rd}`;
      break;
    case 'rd,rs':
      args = `R${rd}, R${rs}`;
      break;
    case 'rd,[rs]':
      args = `R${rd}, [R${rs}]`;
      break;
    case 'rd,imm':
      args = `R${rd}, ${imm}`;
      break;
    case 'imm':
      args = imm;
      break;
  }
  return { mnemonic: op.mnemonic, size: TOY8_INSTRUCTION_SIZE, text: args ? `${op.mnemonic} ${args}` : op.mnemonic };
}

/** Disassemble a whole byte string into "addr: text" lines. */
export function disassembleAll(bytes: ArrayLike<number>): { addr: number; text: string }[] {
  const out: { addr: number; text: string }[] = [];
  for (let a = 0; a < bytes.length; a += TOY8_INSTRUCTION_SIZE) {
    out.push({ addr: a, text: disassemble(Array.from({ length: Math.min(2, bytes.length - a) }, (_, k) => bytes[a + k]!)).text });
  }
  return out;
}

// ------------------------------------------------------------ reference model

/** ALU result and flags, identical to the `alu` block (ALU_OPS order). */
export function toy8Alu(op: number, a: number, b: number): { y: number; z: number; n: number; c: number } {
  a &= 0xff;
  b &= 0xff;
  let y: number;
  let c = 0;
  switch (op & 7) {
    case 0:
      y = a + b;
      c = y > 0xff ? 1 : 0;
      break;
    case 1:
      y = a - b;
      c = a >= b ? 1 : 0;
      break;
    case 2:
      y = a & b;
      break;
    case 3:
      y = a | b;
      break;
    case 4:
      y = a ^ b;
      break;
    case 5:
      y = ~a;
      break;
    case 6:
      y = a << (b & 7);
      break;
    default:
      y = a >>> (b & 7);
  }
  y &= 0xff;
  return { y, z: y === 0 ? 1 : 0, n: y >> 7, c };
}

export interface Toy8Snapshot {
  pc: number;
  r: [number, number, number, number];
  z: number;
  n: number;
  c: number;
  out: number;
  halted: boolean;
  cycles: number;
}

/**
 * Cycle-accurate reference model of Toy-8. Power on = reset: everything 0,
 * the ROM keeps `program`. `cycle()` is one full clock cycle; `step()` is one
 * instruction (2 cycles); `run(maxCycles)` stops at HALT.
 */
export class Toy8 {
  /** Program ROM, 256 bytes. */
  readonly rom = new Uint8Array(256);
  /** Data RAM, 256 bytes. */
  readonly mem = new Uint8Array(256);
  /** R0..R3. */
  readonly r = new Uint8Array(4);
  pc = 0;
  ir = 0;
  /** 0 = fetch, 1 = execute. */
  phase: 0 | 1 = 0;
  z = 0;
  n = 0;
  c = 0;
  out = 0;
  halted = false;
  /** Full clock cycles since power on (frozen once halted). */
  cycles = 0;

  constructor(program: ArrayLike<number> | string = []) {
    const bytes = typeof program === 'string' ? fromHex(program) : Array.from(program);
    if (bytes.length > 256) throw new Error('Toy-8 programs are at most 256 bytes');
    this.rom.set(bytes.map((b) => b & 0xff));
  }

  /** R0..R3 as a plain array. */
  get registers(): [number, number, number, number] {
    return [this.r[0]!, this.r[1]!, this.r[2]!, this.r[3]!];
  }

  /** Power cycle: volatile state back to 0, ROM kept (E-SIM-08). */
  reset(): void {
    this.mem.fill(0);
    this.r.fill(0);
    this.pc = this.ir = this.z = this.n = this.c = this.out = this.cycles = 0;
    this.phase = 0;
    this.halted = false;
  }

  snapshot(): Toy8Snapshot {
    return { pc: this.pc, r: this.registers, z: this.z, n: this.n, c: this.c, out: this.out, halted: this.halted, cycles: this.cycles };
  }

  /** One full clock cycle. Does nothing once halted. */
  cycle(): void {
    if (this.halted) return;
    this.cycles++;
    if (this.phase === 0) {
      this.ir = this.rom[this.pc]!;
      this.pc = (this.pc + 1) & 0xff;
      this.phase = 1;
      return;
    }
    const imm = this.rom[this.pc]!;
    const next = this.execute(this.ir, imm);
    this.pc = next ?? (this.pc + 1) & 0xff;
    this.phase = 0;
  }

  /**
   * Execute one instruction byte with its operand: the execute cycle without
   * the PC update. Returns the jump target when the instruction jumps.
   * Also used to compute expectations for the datapath levels.
   */
  execute(ir: number, imm: number): number | undefined {
    const rd = (ir >> 2) & 3;
    const rs = ir & 3;
    const a = this.r[rd]!;
    const b = this.r[rs]!;
    if (ir & 0x80) {
      const res = toy8Alu((ir >> 4) & 7, a, b);
      this.r[rd] = res.y;
      this.z = res.z;
      this.n = res.n;
      this.c = res.c;
      return undefined;
    }
    switch ((ir >> 4) & 7) {
      case 0:
        this.halted = true;
        return undefined;
      case 1:
        this.r[rd] = imm;
        return undefined;
      case 2:
        this.r[rd] = b;
        return undefined;
      case 3:
        this.r[rd] = this.mem[b]!;
        return undefined;
      case 4:
        this.mem[b] = a;
        return undefined;
      case 5:
        this.out = a;
        return undefined;
      case 6:
        return imm;
      default: {
        const cond = [this.z === 1, this.z === 0, this.c === 1, this.n === 1][rs]!;
        return cond ? imm : undefined;
      }
    }
  }

  /** One instruction: cycles until the next fetch (2, or 0 when halted). */
  step(): void {
    if (this.halted) return;
    do this.cycle();
    while (this.phase !== 0 && !this.halted);
  }

  /** Run until HALT or `maxCycles` full cycles from now. Returns the cycles run. */
  run(maxCycles: number): number {
    const start = this.cycles;
    while (!this.halted && this.cycles - start < maxCycles) this.cycle();
    return this.cycles - start;
  }
}
