/**
 * ASM-02: disassembler. objdump-like syntax with ABI register names. Every
 * line it prints assembles back to the same word at the same address
 * (branch and jump targets are printed as absolute addresses).
 */

import { ABI_NAMES, type Instr, csrName, decode } from './encoding';

/** Options for disassembly. */
export interface DisasmOptions {
  /** Print pseudo-instructions (li, mv, ret, j, beqz, csrr, ...). Default true. */
  readonly pseudo?: boolean;
  /** Address to name lookup, used for `<label>` comments on targets. */
  readonly symbols?: ReadonlyMap<number, string>;
}

/** One disassembled word. */
export interface DisasmLine {
  readonly address: number;
  readonly word: number;
  /** Mnemonic, or `.word` when the word is not a valid instruction. */
  readonly mnemonic: string;
  readonly operands: string;
  /** `mnemonic operands`, ready to reassemble at `address`. */
  readonly text: string;
  /** Absolute target for branches and jal. */
  readonly target?: number;
  /** Symbol defined at this address, if any. */
  readonly label?: string;
}

const reg = (n: number): string => ABI_NAMES[n] ?? `x${n}`;
const hex = (n: number): string => `0x${(n >>> 0).toString(16)}`;
const csr = (n: number): string => csrName(n) ?? hex(n);
const fenceSet = (s: number): string =>
  s === 0 ? '0' : ['i', 'o', 'r', 'w'].filter((_, i) => s & (8 >> i)).join('');

/** Mnemonic and operands for one decoded instruction at `pc`. */
export function formatInstr(
  i: Instr,
  pc: number,
  pseudo = true,
): { mnemonic: string; operands: string; target?: number } {
  const n = i.op.name;
  const out = (mnemonic: string, ...ops: string[]): { mnemonic: string; operands: string } => ({
    mnemonic,
    operands: ops.join(', '),
  });
  switch (i.op.format) {
    case 'R':
      if (pseudo) {
        if (n === 'sub' && i.rs1 === 0) return out('neg', reg(i.rd), reg(i.rs2));
        if (n === 'sltu' && i.rs1 === 0) return out('snez', reg(i.rd), reg(i.rs2));
        if (n === 'slt' && i.rs2 === 0) return out('sltz', reg(i.rd), reg(i.rs1));
        if (n === 'slt' && i.rs1 === 0) return out('sgtz', reg(i.rd), reg(i.rs2));
      }
      return out(n, reg(i.rd), reg(i.rs1), reg(i.rs2));
    case 'I':
      if (pseudo) {
        if (n === 'addi' && i.rd === 0 && i.rs1 === 0 && i.imm === 0) return out('nop');
        if (n === 'addi' && i.rs1 === 0) return out('li', reg(i.rd), String(i.imm));
        if (n === 'addi' && i.imm === 0) return out('mv', reg(i.rd), reg(i.rs1));
        if (n === 'xori' && i.imm === -1) return out('not', reg(i.rd), reg(i.rs1));
        if (n === 'sltiu' && i.imm === 1) return out('seqz', reg(i.rd), reg(i.rs1));
      }
      return out(n, reg(i.rd), reg(i.rs1), String(i.imm));
    case 'SHIFT':
      return out(n, reg(i.rd), reg(i.rs1), String(i.imm));
    case 'LOAD':
      return out(n, reg(i.rd), `${i.imm}(${reg(i.rs1)})`);
    case 'STORE':
      return out(n, reg(i.rs2), `${i.imm}(${reg(i.rs1)})`);
    case 'BRANCH': {
      const target = (pc + i.imm) >>> 0;
      const t = hex(target);
      if (pseudo) {
        const z = (a: number, b: number): number | null => (b === 0 ? a : null);
        if (n === 'beq' && z(i.rs1, i.rs2) !== null)
          return { ...out('beqz', reg(i.rs1), t), target };
        if (n === 'bne' && i.rs2 === 0) return { ...out('bnez', reg(i.rs1), t), target };
        if (n === 'bge' && i.rs1 === 0) return { ...out('blez', reg(i.rs2), t), target };
        if (n === 'bge' && i.rs2 === 0) return { ...out('bgez', reg(i.rs1), t), target };
        if (n === 'blt' && i.rs2 === 0) return { ...out('bltz', reg(i.rs1), t), target };
        if (n === 'blt' && i.rs1 === 0) return { ...out('bgtz', reg(i.rs2), t), target };
      }
      return { ...out(n, reg(i.rs1), reg(i.rs2), t), target };
    }
    case 'U':
      return out(n, reg(i.rd), hex(i.imm));
    case 'JAL': {
      const target = (pc + i.imm) >>> 0;
      if (pseudo && i.rd === 0) return { ...out('j', hex(target)), target };
      if (pseudo && i.rd === 1) return { ...out('jal', hex(target)), target };
      return { ...out(n, reg(i.rd), hex(target)), target };
    }
    case 'JALR':
      if (pseudo && i.imm === 0) {
        if (i.rd === 0 && i.rs1 === 1) return out('ret');
        if (i.rd === 0) return out('jr', reg(i.rs1));
        if (i.rd === 1) return out('jalr', reg(i.rs1));
      }
      return out(n, reg(i.rd), `${i.imm}(${reg(i.rs1)})`);
    case 'CSR':
      if (pseudo) {
        if (n === 'csrrs' && i.rs1 === 0) return out('csrr', reg(i.rd), csr(i.csr));
        if (i.rd === 0)
          return out(
            n === 'csrrw' ? 'csrw' : n === 'csrrs' ? 'csrs' : 'csrc',
            csr(i.csr),
            reg(i.rs1),
          );
      }
      return out(n, reg(i.rd), csr(i.csr), reg(i.rs1));
    case 'CSRI':
      if (pseudo && i.rd === 0) return out(n.replace('csrr', 'csr'), csr(i.csr), String(i.imm));
      return out(n, reg(i.rd), csr(i.csr), String(i.imm));
    case 'FENCE':
      if (pseudo && i.pred === 15 && i.succ === 15) return out('fence');
      return out(n, fenceSet(i.pred), fenceSet(i.succ));
    case 'FIXED':
      return out(n);
    case 'SFENCE':
      return out(n, reg(i.rs1), reg(i.rs2));
    case 'LR':
    case 'AMO': {
      const suffix = i.aq && i.rl ? '.aqrl' : i.aq ? '.aq' : i.rl ? '.rl' : '';
      if (i.op.format === 'LR') return out(n + suffix, reg(i.rd), `(${reg(i.rs1)})`);
      return out(n + suffix, reg(i.rd), reg(i.rs2), `(${reg(i.rs1)})`);
    }
  }
}

/** Disassembles one word at `pc`. Invalid words become `.word 0x...`. */
export function disassembleWord(word: number, pc = 0, options: DisasmOptions = {}): DisasmLine {
  const w = word >>> 0;
  const d = decode(w);
  const address = pc >>> 0;
  const label = options.symbols?.get(address);
  if (!d) {
    return {
      address,
      word: w,
      mnemonic: '.word',
      operands: hex(w),
      text: `.word ${hex(w)}`,
      ...(label ? { label } : {}),
    };
  }
  const f = formatInstr(d, address, options.pseudo ?? true);
  const text = f.operands ? `${f.mnemonic} ${f.operands}` : f.mnemonic;
  return {
    address,
    word: w,
    mnemonic: f.mnemonic,
    operands: f.operands,
    text,
    ...(f.target !== undefined ? { target: f.target } : {}),
    ...(label ? { label } : {}),
  };
}

/** Disassembles `bytes` loaded at `base`, one line per 4 bytes (a short tail becomes `.byte`). */
export function disassemble(
  bytes: Uint8Array,
  base: number,
  options: DisasmOptions = {},
): DisasmLine[] {
  const lines: DisasmLine[] = [];
  let o = 0;
  for (; o + 4 <= bytes.length; o += 4) {
    const w =
      ((bytes[o] ?? 0) |
        ((bytes[o + 1] ?? 0) << 8) |
        ((bytes[o + 2] ?? 0) << 16) |
        ((bytes[o + 3] ?? 0) << 24)) >>>
      0;
    lines.push(disassembleWord(w, base + o, options));
  }
  for (; o < bytes.length; o++) {
    const b = bytes[o] ?? 0;
    const address = (base + o) >>> 0;
    const label = options.symbols?.get(address);
    lines.push({
      address,
      word: b,
      mnemonic: '.byte',
      operands: hex(b),
      text: `.byte ${hex(b)}`,
      ...(label ? { label } : {}),
    });
  }
  return lines;
}

const IDENT = /^[A-Za-z_.$][A-Za-z0-9_.$]*$/;

/**
 * Turns disassembly into source that reassembles (at the same base) to the same
 * bytes: labels for named addresses, and `# <symbol>` comments on targets.
 */
export function toSource(lines: readonly DisasmLine[], options: DisasmOptions = {}): string {
  const out: string[] = ['.text'];
  const used = new Set<string>();
  let inData = false;
  for (const l of lines) {
    if (l.mnemonic === '.byte' && !inData) {
      // A short tail goes in a data section: GNU-style code sections are padded
      // to 4 bytes, which would add bytes that were not in the image.
      out.push('.section .rodata');
      inData = true;
    }
    if (l.label && IDENT.test(l.label) && !used.has(l.label)) {
      used.add(l.label);
      out.push(`${l.label}:`);
    }
    const name = l.target !== undefined ? options.symbols?.get(l.target) : undefined;
    out.push(`    ${l.text}${name ? `  # <${name}>` : ''}`);
  }
  return out.join('\n') + '\n';
}

/** objdump-style listing: `80000000:  00500513   li a0, 5`. */
export function formatListing(lines: readonly DisasmLine[], options: DisasmOptions = {}): string {
  const out: string[] = [];
  for (const l of lines) {
    if (l.label) out.push(`\n${hex(l.address).slice(2).padStart(8, '0')} <${l.label}>:`);
    const name = l.target !== undefined ? options.symbols?.get(l.target) : undefined;
    const wordHex =
      l.mnemonic === '.byte'
        ? l.word.toString(16).padStart(2, '0')
        : l.word.toString(16).padStart(8, '0');
    out.push(
      `${l.address.toString(16).padStart(8, '0')}:  ${wordHex.padEnd(8)}   ${l.text}${name ? ` <${name}>` : ''}`,
    );
  }
  return out.join('\n').trimStart() + '\n';
}
