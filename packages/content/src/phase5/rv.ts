/**
 * RV32I semantics for the Phase 5 level tests: instruction encoders, field
 * extraction and the behavior of each datapath block (docs/rv32-datapath.md).
 * Content may only depend on the schema at runtime, so these are small pure
 * functions; phase5.test.ts checks them against packages/rv32 (the golden
 * emulator) and the sim-logic block models bit for bit.
 */

/** Opcodes (inst[6:0]) of RV32I. */
export const OPC = {
  LOAD: 0x03,
  OP_IMM: 0x13,
  AUIPC: 0x17,
  STORE: 0x23,
  OP: 0x33,
  LUI: 0x37,
  BRANCH: 0x63,
  JALR: 0x67,
  JAL: 0x6f,
  SYSTEM: 0x73,
} as const;

/** `ebreak`: the halt instruction of the Phase 5 CPU. */
export const EBREAK = 0x00100073;

const u = (x: number): number => x >>> 0;

// ------------------------------------------------------------------ encoders

export const encR = (f7: number, rs2: number, rs1: number, f3: number, rd: number, op = OPC.OP): number =>
  u((f7 << 25) | ((rs2 & 31) << 20) | ((rs1 & 31) << 15) | ((f3 & 7) << 12) | ((rd & 31) << 7) | op);
export const encI = (imm: number, rs1: number, f3: number, rd: number, op: number): number =>
  u(((imm & 0xfff) << 20) | ((rs1 & 31) << 15) | ((f3 & 7) << 12) | ((rd & 31) << 7) | op);
export const encS = (imm: number, rs2: number, rs1: number, f3: number): number =>
  u((((imm >> 5) & 0x7f) << 25) | ((rs2 & 31) << 20) | ((rs1 & 31) << 15) | ((f3 & 7) << 12) | ((imm & 31) << 7) | OPC.STORE);
export const encB = (imm: number, rs2: number, rs1: number, f3: number): number =>
  u(
    (((imm >> 12) & 1) << 31) |
      (((imm >> 5) & 0x3f) << 25) |
      ((rs2 & 31) << 20) |
      ((rs1 & 31) << 15) |
      ((f3 & 7) << 12) |
      (((imm >> 1) & 0xf) << 8) |
      (((imm >> 11) & 1) << 7) |
      OPC.BRANCH,
  );
export const encU = (imm: number, rd: number, op: number): number => u((imm & 0xfffff000) | ((rd & 31) << 7) | op);
export const encJ = (imm: number, rd: number): number =>
  u((((imm >> 20) & 1) << 31) | (((imm >> 1) & 0x3ff) << 21) | (((imm >> 11) & 1) << 20) | (((imm >> 12) & 0xff) << 12) | ((rd & 31) << 7) | OPC.JAL);

// -------------------------------------------------------------------- fields

export const opcodeOf = (w: number): number => w & 0x7f;
export const rdOf = (w: number): number => (w >>> 7) & 31;
export const funct3Of = (w: number): number => (w >>> 12) & 7;
export const rs1Of = (w: number): number => (w >>> 15) & 31;
export const rs2Of = (w: number): number => (w >>> 20) & 31;

// ---------------------------------------------------------- immediate (immgen)

/** Sign-extended immediate of `w` by its opcode's format; 0 for opcodes without one (R-type). */
export function immOf(w: number): number {
  w |= 0;
  switch (opcodeOf(w)) {
    case OPC.LOAD:
    case OPC.OP_IMM:
    case OPC.JALR:
    case OPC.SYSTEM:
      return u(w >> 20);
    case OPC.STORE:
      return u(((w >> 25) << 5) | ((w >>> 7) & 31));
    case OPC.BRANCH:
      return u(((w >> 31) << 12) | (((w >>> 7) & 1) << 11) | (((w >>> 25) & 0x3f) << 5) | (((w >>> 8) & 0xf) << 1));
    case OPC.LUI:
    case OPC.AUIPC:
      return u(w & 0xfffff000);
    case OPC.JAL:
      return u(((w >> 31) << 20) | (((w >>> 12) & 0xff) << 12) | (((w >>> 20) & 1) << 11) | (((w >>> 21) & 0x3ff) << 1));
    default:
      return 0;
  }
}

// ------------------------------------------------------------ ALU and control

/** rvalu op codes: {funct7 bit 5, funct3}. */
export const ALU_OP = { add: 0, sub: 8, sll: 1, slt: 2, sltu: 3, xor: 4, srl: 5, sra: 13, or: 6, and: 7 } as const;

/** The rvalu block: unused op codes give 0. */
export function rvAlu(a: number, b: number, op: number): number {
  const sh = b & 31;
  switch (op & 15) {
    case 0:
      return u(a + b);
    case 8:
      return u(a - b);
    case 1:
      return u(a << sh);
    case 2:
      return (a | 0) < (b | 0) ? 1 : 0;
    case 3:
      return u(a) < u(b) ? 1 : 0;
    case 4:
      return u(a ^ b);
    case 5:
      return u(a) >>> sh;
    case 13:
      return u(a >> sh);
    case 6:
      return u(a | b);
    case 7:
      return u(a & b);
    default:
      return 0;
  }
}

/**
 * ALU control: the rvalu op for an instruction. OP: {inst[30], funct3}.
 * OP-IMM: funct3, plus inst[30] only for the right shifts (funct3 5), since
 * elsewhere inst[30] is an immediate bit. Everything else adds (addresses, auipc).
 */
export function aluControl(w: number): number {
  const f3 = funct3Of(w);
  const b30 = (w >>> 30) & 1;
  if (opcodeOf(w) === OPC.OP) return (b30 << 3) | f3;
  if (opcodeOf(w) === OPC.OP_IMM) return ((f3 === 5 ? b30 : 0) << 3) | f3;
  return 0;
}

/** Result of an OP or OP-IMM instruction with rs1 = a, rs2 = b. */
export function aluResult(w: number, a: number, b: number): number {
  return rvAlu(a, opcodeOf(w) === OPC.OP ? b : immOf(w), aluControl(w));
}

// -------------------------------------------------------- branch comparator

/** branchcmp: 0 beq, 1 bne, 4 blt, 5 bge, 6 bltu, 7 bgeu; 2 and 3 never take. */
export function branchTaken(a: number, b: number, f3: number): boolean {
  switch (f3 & 7) {
    case 0:
      return u(a) === u(b);
    case 1:
      return u(a) !== u(b);
    case 4:
      return (a | 0) < (b | 0);
    case 5:
      return (a | 0) >= (b | 0);
    case 6:
      return u(a) < u(b);
    case 7:
      return u(a) >= u(b);
    default:
      return false;
  }
}

// ------------------------------------------------------------ load/store unit

const loadSize = (f3: number): number => [1, 2, 4, 0, 1, 2, 0, 0][f3 & 7]!;
const storeSize = (f3: number): number => [1, 2, 4, 0, 0, 0, 0, 0][f3 & 7]!;

/** Loaded value (sign/zero extended); 0 when misaligned or not a load funct3. */
export function lsuLoad(addr: number, rdata: number, f3: number): number {
  const size = loadSize(f3);
  const off = addr & 3;
  if (size === 0 || off % size !== 0) return 0;
  const raw = rdata >>> (8 * off);
  const unsigned = (f3 & 4) !== 0;
  if (size === 1) return unsigned ? raw & 0xff : u((raw << 24) >> 24);
  if (size === 2) return unsigned ? raw & 0xffff : u((raw << 16) >> 16);
  return u(rdata);
}

/** Word written back by a store (read-modify-write); rdata when misaligned or not a store funct3. */
export function lsuStore(addr: number, wdata: number, rdata: number, f3: number): number {
  const size = storeSize(f3);
  const off = addr & 3;
  if (size === 0 || off % size !== 0) return u(rdata);
  if (size === 4) return u(wdata);
  const lane = (size === 1 ? 0xff : 0xffff) << (8 * off);
  return u((rdata & ~lane) | ((wdata << (8 * off)) & lane));
}

export function lsuMisaligned(addr: number, f3: number, isLoad: boolean): boolean {
  const size = isLoad ? loadSize(f3) : storeSize(f3);
  return size !== 0 && (addr & 3) % size !== 0;
}

/** Store write enable: a valid, aligned store. */
export const lsuWriteEnable = (addr: number, f3: number): boolean => storeSize(f3) !== 0 && !lsuMisaligned(addr, f3, false);

// ------------------------------------------------------------------ next PC

/** Next PC of the single-cycle CPU. `take` is the branch comparator's output; ebreak holds the PC (halt). */
export function nextPc(pc: number, w: number, rs1: number, take: boolean): number {
  if (u(w) === EBREAK) return u(pc);
  switch (opcodeOf(w)) {
    case OPC.JAL:
      return u(pc + immOf(w));
    case OPC.JALR:
      return u((rs1 + immOf(w)) & ~1);
    case OPC.BRANCH:
      return take ? u(pc + immOf(w)) : u(pc + 4);
    default:
      return u(pc + 4);
  }
}

// --------------------------------------------------------------------- PRNG

/** Deterministic 32-bit PRNG (mulberry32) for generated test rows. */
export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Interesting 32-bit operands: edges of signed and unsigned ranges. */
export const EDGE_WORDS = [0, 1, 2, 0x7fffffff, 0x80000000, 0x80000001, 0xffffffff, 0xfffffffe, 0x0000ffff, 0x00008000, 0x12345678, 0xdeadbeef];
