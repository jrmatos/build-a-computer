import { allX, sig, type Signal } from '../values';
import type { BlockModel } from './types';
import { bit, bitSig, input, numProp, randomWord } from './bits';

/**
 * RV-06: RISC-V (RV32I) datapath blocks as canonical models: register file,
 * immediate generator, ALU, branch comparator and load/store unit. Pin order
 * and meaning follow `pinsOf` in parts-spec.ts; semantics match the RISC-V
 * unprivileged spec and `packages/rv32` bit for bit (property tests run the
 * emulator as the reference).
 *
 * X rules: conservative. Any X bit in an input that the output depends on
 * makes that whole output X. Inputs that cannot affect an output are ignored
 * (x0 reads 0 whatever is stored, `branchcmp` with funct3 2 or 3 is 0, `lsu`
 * with load = store = 0 never flags `misaligned` or `mwe`). Address wiring
 * (`lsu` maddr) keeps per-bit X, like a splitter would.
 */

const W = 32;
const M32 = 0xffffffff;
const stateless = { init: () => null } as const;
const X32 = (): Signal => allX(W);
const word = (v: number): Signal => sig(W, v >>> 0);

// ----------------------------------------------------------------- regfile

export interface RegFileState {
  /** Known bits of x0..x31 (x0 is always 0). */
  v: Uint32Array;
  /** Unknown bits of x0..x31; null until an X write (most runs never have one). */
  x: Uint32Array | null;
}

function readReg(s: RegFileState, idx: Signal): Signal {
  if (idx.x !== 0) return X32();
  if (idx.v === 0) return word(0);
  return sig(W, s.v[idx.v]!, s.x ? s.x[idx.v]! : 0);
}

/**
 * Pins: rs1, rs2, rd, wd, we, clk → r1, r2. 32 x 32-bit registers.
 * Asynchronous reads r1 = x[rs1], r2 = x[rs2]; x0 always reads 0. On a rising
 * edge with we = 1, x[rd] = wd (writes to x0 are ignored, E-CPU-01). An X rd
 * or we = X makes every register the write could reach (x0 excluded) all-X.
 * Power on: x1..x31 are 0 ('zero') or seeded random words ('random').
 */
export const regfileModel: BlockModel<RegFileState> = {
  init(_part, mode, rng) {
    const v = new Uint32Array(32);
    if (mode === 'random') for (let i = 1; i < 32; i++) v[i] = randomWord(rng, W);
    return { v, x: null };
  },
  outputs(inputs, s) {
    return [readReg(s, input(inputs, 0, 5)), readReg(s, input(inputs, 1, 5))];
  },
  clock(inputs, s) {
    const we = bit(inputs, 4);
    if (we === 0) return s;
    const rd = input(inputs, 2, 5);
    const wd = input(inputs, 3, W);
    const v = s.v.slice();
    let x = s.x ? s.x.slice() : null;
    if (we === 1 && rd.x === 0) {
      if (rd.v === 0) return s;
      v[rd.v] = wd.v;
      if (wd.x !== 0 || x) {
        x ??= new Uint32Array(32);
        x[rd.v] = wd.x;
      }
      return { v, x };
    }
    // Unknown write enable or destination: every candidate register (not x0) becomes all-X.
    x ??= new Uint32Array(32);
    for (let r = 1; r < 32; r++) {
      if ((r & ~rd.x & 31) !== (rd.v & ~rd.x & 31)) continue;
      v[r] = 0;
      x[r] = M32;
    }
    return { v, x };
  },
  inspect: (s) => s.v,
};

// ------------------------------------------------------------------ immgen

/** Instruction format of an opcode (inst[6:0]) for the immediate generator; null = no immediate. */
export function immFormat(opcode: number): 'I' | 'S' | 'B' | 'U' | 'J' | null {
  switch (opcode & 0x7f) {
    case 0x03: // loads
    case 0x13: // OP-IMM (shifts: imm[4:0] is shamt)
    case 0x67: // jalr
    case 0x73: // SYSTEM (ecall 0, ebreak 1, CSR number)
      return 'I';
    case 0x23:
      return 'S';
    case 0x63:
      return 'B';
    case 0x37: // lui
    case 0x17: // auipc
      return 'U';
    case 0x6f:
      return 'J';
    default:
      return null;
  }
}

/** The sign-extended immediate of instruction `w` (unsigned 32-bit). Unknown opcodes give 0. */
export function immOf(w: number): number {
  w |= 0;
  switch (immFormat(w)) {
    case 'I':
      return (w >> 20) >>> 0;
    case 'S':
      return (((w >> 25) << 5) | ((w >>> 7) & 0x1f)) >>> 0;
    case 'B':
      return (((w >> 31) << 12) | (((w >>> 7) & 1) << 11) | (((w >>> 25) & 0x3f) << 5) | (((w >>> 8) & 0xf) << 1)) >>> 0;
    case 'U':
      return (w & 0xfffff000) >>> 0;
    case 'J':
      return (((w >> 31) << 20) | (((w >>> 12) & 0xff) << 12) | (((w >>> 20) & 1) << 11) | (((w >>> 21) & 0x3ff) << 1)) >>> 0;
    default:
      return 0;
  }
}

/** Pins: inst → imm. Format chosen by the opcode; any X in inst gives an all-X imm. */
export const immgenModel: BlockModel<null> = {
  ...stateless,
  outputs(inputs) {
    const inst = input(inputs, 0, W);
    if (inst.x !== 0) return [X32()];
    return [word(immOf(inst.v))];
  },
};

// ------------------------------------------------------------------- rvalu

/** RV ALU op codes ({funct7 bit 5, funct3}). */
export const RV_ALU_OPS = { add: 0, sub: 8, sll: 1, slt: 2, sltu: 3, xor: 4, srl: 5, sra: 13, or: 6, and: 7 } as const;

/** RV32I ALU on known operands (unsigned 32-bit in and out). Unused op codes give 0. */
export function rvAluOp(a: number, b: number, op: number): number {
  const sh = b & 31;
  switch (op & 15) {
    case 0:
      return (a + b) >>> 0;
    case 8:
      return (a - b) >>> 0;
    case 1:
      return (a << sh) >>> 0;
    case 2:
      return (a | 0) < (b | 0) ? 1 : 0;
    case 3:
      return a >>> 0 < b >>> 0 ? 1 : 0;
    case 4:
      return (a ^ b) >>> 0;
    case 5:
      return a >>> sh;
    case 13:
      return (a >> sh) >>> 0;
    case 6:
      return (a | b) >>> 0;
    case 7:
      return (a & b) >>> 0;
    default:
      return 0;
  }
}

const isShift = (op: number): boolean => op === 1 || op === 5 || op === 13;
const isAluOp = (op: number): boolean => op === 0 || op === 8 || (op >= 1 && op <= 7) || op === 13;

/**
 * Pins: a, b, op (4 bits) → out, zero. zero = (out == 0). Shifts use b[4:0]
 * only. X: op X, or an X bit in a or in the used bits of b, makes both outputs X.
 */
export const rvaluModel: BlockModel<null> = {
  ...stateless,
  outputs(inputs) {
    const a = input(inputs, 0, W);
    const b = input(inputs, 1, W);
    const op = input(inputs, 2, 4);
    if (op.x !== 0) return [X32(), allX(1)];
    if (isAluOp(op.v)) {
      const bx = isShift(op.v) ? b.x & 31 : b.x;
      if (a.x !== 0 || bx !== 0) return [X32(), allX(1)];
    }
    const out = rvAluOp(a.v, b.v, op.v);
    return [word(out), sig(1, out === 0 ? 1 : 0)];
  },
};

// --------------------------------------------------------------- branchcmp

/** Branch condition for funct3 on known operands: 0 beq, 1 bne, 4 blt, 5 bge, 6 bltu, 7 bgeu; 2, 3 → false. */
export function branchTaken(a: number, b: number, funct3: number): boolean {
  switch (funct3 & 7) {
    case 0:
      return a >>> 0 === b >>> 0;
    case 1:
      return a >>> 0 !== b >>> 0;
    case 4:
      return (a | 0) < (b | 0);
    case 5:
      return (a | 0) >= (b | 0);
    case 6:
      return a >>> 0 < b >>> 0;
    case 7:
      return a >>> 0 >= b >>> 0;
    default:
      return false;
  }
}

/** Pins: a, b, funct3 → take. X: funct3 X, or (for a real branch funct3) any X in a or b. */
export const branchcmpModel: BlockModel<null> = {
  ...stateless,
  outputs(inputs) {
    const a = input(inputs, 0, W);
    const b = input(inputs, 1, W);
    const f3 = input(inputs, 2, 3);
    if (f3.x !== 0) return [allX(1)];
    if (f3.v === 2 || f3.v === 3) return [sig(1, 0)];
    if (a.x !== 0 || b.x !== 0) return [allX(1)];
    return [sig(1, branchTaken(a.v, b.v, f3.v) ? 1 : 0)];
  },
};

// --------------------------------------------------------------------- lsu

/** Access size in bytes for a load funct3 (0 lb, 1 lh, 2 lw, 4 lbu, 5 lhu); 0 = not a load. */
const loadSize = (f3: number): 0 | 1 | 2 | 4 => ([1, 2, 4, 0, 1, 2, 0, 0] as const)[f3 & 7]!;
/** Access size in bytes for a store funct3 (0 sb, 1 sh, 2 sw); 0 = not a store. */
const storeSize = (f3: number): 0 | 1 | 2 | 4 => ([1, 2, 4, 0, 0, 0, 0, 0] as const)[f3 & 7]!;

/** Value loaded by `funct3` from word `rdata` at byte address `addr` (sign/zero extended). 0 when misaligned or not a load. */
export function lsuLoad(addr: number, rdata: number, funct3: number): number {
  const size = loadSize(funct3);
  const off = addr & 3;
  if (size === 0 || off % size !== 0) return 0;
  const raw = rdata >>> (8 * off);
  const unsigned = (funct3 & 4) !== 0;
  if (size === 1) return unsigned ? raw & 0xff : ((raw << 24) >> 24) >>> 0;
  if (size === 2) return unsigned ? raw & 0xffff : ((raw << 16) >> 16) >>> 0;
  return rdata >>> 0;
}

/** Word written back by a store of `wdata` at byte address `addr` into word `rdata`. `rdata` when misaligned or not a store. */
export function lsuStore(addr: number, wdata: number, rdata: number, funct3: number): number {
  const size = storeSize(funct3);
  const off = addr & 3;
  if (size === 0 || off % size !== 0) return rdata >>> 0;
  if (size === 4) return wdata >>> 0;
  const lane = (size === 1 ? 0xff : 0xffff) << (8 * off);
  return ((rdata & ~lane) | ((wdata << (8 * off)) & lane)) >>> 0;
}

/** True when `addr` is not aligned to the access size of `funct3` (as a load when `isLoad`, else as a store). */
export function lsuMisaligned(addr: number, funct3: number, isLoad: boolean): boolean {
  const size = isLoad ? loadSize(funct3) : storeSize(funct3);
  return size !== 0 && (addr & 3) % size !== 0;
}

/**
 * Pins: addr, wdata, funct3, load, store, rdata → maddr, mwdata, mwe, result, misaligned.
 *
 * - maddr = addr[addrWidth + 1 : 2] (word address into a 32-bit word RAM).
 * - result = the byte, half or word of rdata at addr[1:0] chosen by funct3
 *   (lb, lh, lw sign-extended; lbu, lhu zero-extended). Computed whatever
 *   `load` is (it only gates `misaligned`); 0 when the address is misaligned
 *   for the size or funct3 is not a load (3, 6, 7).
 * - mwdata = rdata with wdata's low byte/half/word merged in at addr[1:0]
 *   (sb, sh, sw: read-modify-write); rdata unchanged when misaligned or funct3
 *   is not a store (3..7).
 * - mwe = store && funct3 is a store && aligned.
 * - misaligned = (load || store) && addr is not aligned for the access size
 *   (a load funct3 when load = 1, else a store funct3). Never set for invalid
 *   funct3 values (those just do nothing).
 */
export const lsuModel: BlockModel<null> = {
  ...stateless,
  outputs(inputs, _s, part) {
    const aw = numProp(part, 'addrWidth');
    const addr = input(inputs, 0, W);
    const wdata = input(inputs, 1, W);
    const f3 = input(inputs, 2, 3);
    const load = bit(inputs, 3);
    const store = bit(inputs, 4);
    const rdata = input(inputs, 5, W);

    const maddr = sig(aw, addr.v >>> 2, addr.x >>> 2);
    const ctlX = f3.x !== 0 || (addr.x & 3) !== 0;

    const result = ctlX || rdata.x !== 0 ? X32() : word(lsuLoad(addr.v, rdata.v, f3.v));
    const mwdata = ctlX || rdata.x !== 0 || wdata.x !== 0 ? X32() : word(lsuStore(addr.v, wdata.v, rdata.v, f3.v));

    let mwe: Signal;
    if (store === 0) mwe = sig(1, 0);
    else if (store === 2 || ctlX) mwe = allX(1);
    else mwe = sig(1, storeSize(f3.v) !== 0 && !lsuMisaligned(addr.v, f3.v, false) ? 1 : 0);

    let mis: 0 | 1 | 2;
    if (load === 0 && store === 0) mis = 0;
    else if (load === 2 || store === 2 || ctlX) mis = 2;
    else mis = lsuMisaligned(addr.v, f3.v, load === 1) ? 1 : 0;

    return [maddr, mwdata, mwe, result, bitSig(mis)];
  },
};
