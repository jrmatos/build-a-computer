/**
 * RV32IMA + Zicsr + Zifencei instruction encodings: one table, plus encode and
 * decode.
 *
 * This file is self-contained (no imports) on purpose. The plan says `asm`
 * depends on the `rv32` encodings; until the emulator exports a table this one
 * is the source of truth for the assembler and disassembler. Moving it into
 * `packages/rv32` later is a file move plus an import change.
 */

/** Instruction formats, named by how the operands are written and encoded. */
export type Format =
  | 'R' // op rd, rs1, rs2
  | 'I' // op rd, rs1, imm12
  | 'SHIFT' // op rd, rs1, shamt
  | 'LOAD' // op rd, imm12(rs1)
  | 'STORE' // op rs2, imm12(rs1)
  | 'BRANCH' // op rs1, rs2, target
  | 'U' // op rd, imm20
  | 'JAL' // op rd, target
  | 'JALR' // op rd, imm12(rs1)
  | 'CSR' // op rd, csr, rs1
  | 'CSRI' // op rd, csr, zimm5
  | 'FENCE' // fence pred, succ
  | 'FIXED' // a single fixed word (ecall, fence.i, ...)
  | 'SFENCE' // sfence.vma rs1, rs2
  | 'LR' // lr.w rd, (rs1)
  | 'AMO'; // op rd, rs2, (rs1)

/** One row of the encoding table. */
export interface OpSpec {
  readonly name: string;
  readonly format: Format;
  readonly opcode: number;
  readonly funct3: number;
  /** funct7 for R and SHIFT, funct5 for AMO and LR, 0 otherwise. */
  readonly funct7: number;
  /** Full word for FIXED instructions. */
  readonly word?: number;
}

const r = (name: string, funct3: number, funct7: number): OpSpec => ({
  name,
  format: 'R',
  opcode: 0x33,
  funct3,
  funct7,
});
const spec = (name: string, format: Format, opcode: number, funct3 = 0, funct7 = 0): OpSpec => ({
  name,
  format,
  opcode,
  funct3,
  funct7,
});
const fixed = (name: string, word: number): OpSpec => ({
  name,
  format: 'FIXED',
  opcode: word & 0x7f,
  funct3: (word >>> 12) & 7,
  funct7: 0,
  word: word >>> 0,
});

/** Every base instruction the assembler knows (no pseudo-instructions). */
export const OPS: readonly OpSpec[] = [
  // RV32I register-register
  r('add', 0, 0x00),
  r('sub', 0, 0x20),
  r('sll', 1, 0x00),
  r('slt', 2, 0x00),
  r('sltu', 3, 0x00),
  r('xor', 4, 0x00),
  r('srl', 5, 0x00),
  r('sra', 5, 0x20),
  r('or', 6, 0x00),
  r('and', 7, 0x00),
  // M extension
  r('mul', 0, 0x01),
  r('mulh', 1, 0x01),
  r('mulhsu', 2, 0x01),
  r('mulhu', 3, 0x01),
  r('div', 4, 0x01),
  r('divu', 5, 0x01),
  r('rem', 6, 0x01),
  r('remu', 7, 0x01),
  // register-immediate
  spec('addi', 'I', 0x13, 0),
  spec('slti', 'I', 0x13, 2),
  spec('sltiu', 'I', 0x13, 3),
  spec('xori', 'I', 0x13, 4),
  spec('ori', 'I', 0x13, 6),
  spec('andi', 'I', 0x13, 7),
  spec('slli', 'SHIFT', 0x13, 1, 0x00),
  spec('srli', 'SHIFT', 0x13, 5, 0x00),
  spec('srai', 'SHIFT', 0x13, 5, 0x20),
  // loads and stores
  spec('lb', 'LOAD', 0x03, 0),
  spec('lh', 'LOAD', 0x03, 1),
  spec('lw', 'LOAD', 0x03, 2),
  spec('lbu', 'LOAD', 0x03, 4),
  spec('lhu', 'LOAD', 0x03, 5),
  spec('sb', 'STORE', 0x23, 0),
  spec('sh', 'STORE', 0x23, 1),
  spec('sw', 'STORE', 0x23, 2),
  // control flow
  spec('beq', 'BRANCH', 0x63, 0),
  spec('bne', 'BRANCH', 0x63, 1),
  spec('blt', 'BRANCH', 0x63, 4),
  spec('bge', 'BRANCH', 0x63, 5),
  spec('bltu', 'BRANCH', 0x63, 6),
  spec('bgeu', 'BRANCH', 0x63, 7),
  spec('jal', 'JAL', 0x6f),
  spec('jalr', 'JALR', 0x67, 0),
  spec('lui', 'U', 0x37),
  spec('auipc', 'U', 0x17),
  // Zicsr
  spec('csrrw', 'CSR', 0x73, 1),
  spec('csrrs', 'CSR', 0x73, 2),
  spec('csrrc', 'CSR', 0x73, 3),
  spec('csrrwi', 'CSRI', 0x73, 5),
  spec('csrrsi', 'CSRI', 0x73, 6),
  spec('csrrci', 'CSRI', 0x73, 7),
  // system and fences
  spec('fence', 'FENCE', 0x0f, 0),
  fixed('fence.i', 0x0000100f),
  fixed('ecall', 0x00000073),
  fixed('ebreak', 0x00100073),
  fixed('sret', 0x10200073),
  fixed('mret', 0x30200073),
  fixed('wfi', 0x10500073),
  spec('sfence.vma', 'SFENCE', 0x73, 0, 0x09),
  // A extension (word only)
  spec('lr.w', 'LR', 0x2f, 2, 0x02),
  spec('sc.w', 'AMO', 0x2f, 2, 0x03),
  spec('amoswap.w', 'AMO', 0x2f, 2, 0x01),
  spec('amoadd.w', 'AMO', 0x2f, 2, 0x00),
  spec('amoxor.w', 'AMO', 0x2f, 2, 0x04),
  spec('amoand.w', 'AMO', 0x2f, 2, 0x0c),
  spec('amoor.w', 'AMO', 0x2f, 2, 0x08),
  spec('amomin.w', 'AMO', 0x2f, 2, 0x10),
  spec('amomax.w', 'AMO', 0x2f, 2, 0x14),
  spec('amominu.w', 'AMO', 0x2f, 2, 0x18),
  spec('amomaxu.w', 'AMO', 0x2f, 2, 0x1c),
];

/** Lookup by mnemonic. AMO ordering suffixes (.aq, .rl, .aqrl) are not keys. */
export const OPS_BY_NAME: ReadonlyMap<string, OpSpec> = new Map(OPS.map((o) => [o.name, o]));

/** ABI register names, indexed by register number. */
export const ABI_NAMES: readonly string[] = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
  's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
  'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
  's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6',
]; // prettier-ignore

const REGS = new Map<string, number>();
ABI_NAMES.forEach((n, i) => REGS.set(n, i));
for (let i = 0; i < 32; i++) REGS.set(`x${i}`, i);
REGS.set('fp', 8);

/** Register number for an ABI or `xN` name, or undefined. Case-sensitive, like GNU as. */
export function registerNumber(name: string): number | undefined {
  return REGS.get(name);
}

/** Named CSRs (machine, supervisor and user counters). */
export const CSR_NAMES: ReadonlyMap<string, number> = new Map<string, number>([
  ['ustatus', 0x000],
  ['fflags', 0x001],
  ['frm', 0x002],
  ['fcsr', 0x003],
  ['cycle', 0xc00],
  ['time', 0xc01],
  ['instret', 0xc02],
  ['cycleh', 0xc80],
  ['timeh', 0xc81],
  ['instreth', 0xc82],
  ['sstatus', 0x100],
  ['sie', 0x104],
  ['stvec', 0x105],
  ['scounteren', 0x106],
  ['senvcfg', 0x10a],
  ['sscratch', 0x140],
  ['sepc', 0x141],
  ['scause', 0x142],
  ['stval', 0x143],
  ['sip', 0x144],
  ['satp', 0x180],
  ['mvendorid', 0xf11],
  ['marchid', 0xf12],
  ['mimpid', 0xf13],
  ['mhartid', 0xf14],
  ['mconfigptr', 0xf15],
  ['mstatus', 0x300],
  ['misa', 0x301],
  ['medeleg', 0x302],
  ['mideleg', 0x303],
  ['mie', 0x304],
  ['mtvec', 0x305],
  ['mcounteren', 0x306],
  ['menvcfg', 0x30a],
  ['mstatush', 0x310],
  ['menvcfgh', 0x31a],
  ['mcountinhibit', 0x320],
  ['mscratch', 0x340],
  ['mepc', 0x341],
  ['mcause', 0x342],
  ['mtval', 0x343],
  ['mip', 0x344],
  ['pmpcfg0', 0x3a0],
  ['pmpcfg1', 0x3a1],
  ['pmpcfg2', 0x3a2],
  ['pmpcfg3', 0x3a3],
  ...Array.from({ length: 16 }, (_, i): [string, number] => [`pmpaddr${i}`, 0x3b0 + i]),
  ['mcycle', 0xb00],
  ['minstret', 0xb02],
  ['mcycleh', 0xb80],
  ['minstreth', 0xb82],
]);

const CSR_BY_NUMBER = new Map<number, string>();
for (const [n, v] of CSR_NAMES) if (!CSR_BY_NUMBER.has(v)) CSR_BY_NUMBER.set(v, n);

/** Preferred name for a CSR number, or undefined when it has none. */
export function csrName(csr: number): string | undefined {
  return CSR_BY_NUMBER.get(csr);
}

/** A decoded (or to-be-encoded) instruction. Unused fields are 0. */
export interface Instr {
  readonly op: OpSpec;
  readonly rd: number;
  readonly rs1: number;
  readonly rs2: number;
  /** Signed immediate (byte offset for branches and jumps; upper 20 bits for U). */
  readonly imm: number;
  /** CSR number for CSR and CSRI. */
  readonly csr: number;
  /** Fence predecessor and successor sets (4 bits each: i, o, r, w). */
  readonly pred: number;
  readonly succ: number;
  /** AMO ordering bits. */
  readonly aq: boolean;
  readonly rl: boolean;
}

/** Builds an `Instr` with zero defaults. */
export function instr(op: OpSpec, fields: Partial<Omit<Instr, 'op'>> = {}): Instr {
  return {
    op,
    rd: 0,
    rs1: 0,
    rs2: 0,
    imm: 0,
    csr: 0,
    pred: 0,
    succ: 0,
    aq: false,
    rl: false,
    ...fields,
  };
}

// ---- immediate field packers (also used by the linker to patch words) ----

/** Places a 12-bit I-type immediate. */
export function packI(word: number, imm: number): number {
  return ((word & 0x000fffff) | ((imm & 0xfff) << 20)) >>> 0;
}
/** Places a 12-bit S-type immediate. */
export function packS(word: number, imm: number): number {
  return ((word & 0x01fff07f) | (((imm >> 5) & 0x7f) << 25) | ((imm & 0x1f) << 7)) >>> 0;
}
/** Places a 13-bit B-type offset (bit 0 dropped). */
export function packB(word: number, imm: number): number {
  return (
    ((word & 0x01fff07f) |
      (((imm >> 12) & 1) << 31) |
      (((imm >> 5) & 0x3f) << 25) |
      (((imm >> 1) & 0xf) << 8) |
      (((imm >> 11) & 1) << 7)) >>>
    0
  );
}
/** Places a 20-bit U-type immediate (the upper 20 bits value, not shifted). */
export function packU(word: number, imm20: number): number {
  return ((word & 0xfff) | ((imm20 & 0xfffff) << 12)) >>> 0;
}
/** Places a 21-bit J-type offset (bit 0 dropped). */
export function packJ(word: number, imm: number): number {
  return (
    ((word & 0xfff) |
      (((imm >> 20) & 1) << 31) |
      (((imm >> 1) & 0x3ff) << 21) |
      (((imm >> 11) & 1) << 20) |
      (((imm >> 12) & 0xff) << 12)) >>>
    0
  );
}

/** Sign-extends the low `bits` bits of `v`. */
export function signExtend(v: number, bits: number): number {
  const shift = 32 - bits;
  return (v << shift) >> shift;
}

const unpackI = (w: number): number => w >> 20;
const unpackS = (w: number): number => ((w >> 25) << 5) | ((w >>> 7) & 0x1f);
const unpackB = (w: number): number =>
  ((w >> 31) << 12) |
  (((w >>> 7) & 1) << 11) |
  (((w >>> 25) & 0x3f) << 5) |
  (((w >>> 8) & 0xf) << 1);
const unpackJ = (w: number): number =>
  ((w >> 31) << 20) |
  (((w >>> 12) & 0xff) << 12) |
  (((w >>> 20) & 1) << 11) |
  (((w >>> 21) & 0x3ff) << 1);

/** Encodes an instruction. Fields are masked, not range-checked: check before calling. */
export function encode(i: Instr): number {
  const { op } = i;
  const base = op.opcode | (op.funct3 << 12);
  const rd = (i.rd & 31) << 7;
  const rs1 = (i.rs1 & 31) << 15;
  const rs2 = (i.rs2 & 31) << 20;
  switch (op.format) {
    case 'R':
      return (base | rd | rs1 | rs2 | (op.funct7 << 25)) >>> 0;
    case 'I':
    case 'LOAD':
    case 'JALR':
      return packI(base | rd | rs1, i.imm);
    case 'SHIFT':
      return (base | rd | rs1 | ((i.imm & 31) << 20) | (op.funct7 << 25)) >>> 0;
    case 'STORE':
      return packS(base | rs1 | rs2, i.imm);
    case 'BRANCH':
      return packB(base | rs1 | rs2, i.imm);
    case 'U':
      return packU(op.opcode | rd, i.imm);
    case 'JAL':
      return packJ(op.opcode | rd, i.imm);
    case 'CSR':
      return (base | rd | rs1 | ((i.csr & 0xfff) << 20)) >>> 0;
    case 'CSRI':
      return (base | rd | ((i.imm & 31) << 15) | ((i.csr & 0xfff) << 20)) >>> 0;
    case 'FENCE':
      return (base | ((i.pred & 15) << 24) | ((i.succ & 15) << 20)) >>> 0;
    case 'FIXED':
      return op.word ?? 0;
    case 'SFENCE':
      return (base | rs1 | rs2 | (op.funct7 << 25)) >>> 0;
    case 'LR':
    case 'AMO': {
      const lrRs2 = op.format === 'LR' ? 0 : rs2;
      const ord = ((i.aq ? 1 : 0) << 26) | ((i.rl ? 1 : 0) << 25);
      return (base | rd | rs1 | lrRs2 | ord | (op.funct7 << 27)) >>> 0;
    }
  }
}

// ---- decoding ----

const byKey = new Map<string, OpSpec>();
for (const o of OPS) {
  if (o.format === 'FIXED') continue;
  byKey.set(
    `${o.opcode}/${o.funct3}/${o.format === 'R' || o.format === 'SHIFT' || o.format === 'AMO' || o.format === 'LR' || o.format === 'SFENCE' ? o.funct7 : ''}`,
    o,
  );
}
const FIXED_BY_WORD = new Map<number, OpSpec>();
for (const o of OPS) if (o.format === 'FIXED' && o.word !== undefined) FIXED_BY_WORD.set(o.word, o);

/**
 * Decodes one 32-bit word. Returns null for anything that is not a valid
 * RV32IMA/Zicsr/Zifencei encoding (reserved fields must be zero; fences must
 * use fm=0 with rd=rs1=0).
 */
export function decode(word: number): Instr | null {
  const w = word >>> 0;
  const fixedOp = FIXED_BY_WORD.get(w);
  if (fixedOp) return instr(fixedOp);
  const opcode = w & 0x7f;
  const rd = (w >>> 7) & 31;
  const funct3 = (w >>> 12) & 7;
  const rs1 = (w >>> 15) & 31;
  const rs2 = (w >>> 20) & 31;
  const funct7 = w >>> 25;
  switch (opcode) {
    case 0x33: {
      const op = byKey.get(`${opcode}/${funct3}/${funct7}`);
      return op ? instr(op, { rd, rs1, rs2 }) : null;
    }
    case 0x13: {
      if (funct3 === 1 || funct3 === 5) {
        const op = byKey.get(`${opcode}/${funct3}/${funct7}`);
        return op ? instr(op, { rd, rs1, imm: rs2 }) : null;
      }
      const op = byKey.get(`${opcode}/${funct3}/`);
      return op ? instr(op, { rd, rs1, imm: unpackI(w) }) : null;
    }
    case 0x03:
    case 0x67: {
      const op = byKey.get(`${opcode}/${funct3}/`);
      return op ? instr(op, { rd, rs1, imm: unpackI(w) }) : null;
    }
    case 0x23: {
      const op = byKey.get(`${opcode}/${funct3}/`);
      return op ? instr(op, { rs1, rs2, imm: unpackS(w) }) : null;
    }
    case 0x63: {
      const op = byKey.get(`${opcode}/${funct3}/`);
      return op ? instr(op, { rs1, rs2, imm: unpackB(w) }) : null;
    }
    case 0x37:
    case 0x17: {
      const op = byKey.get(`${opcode}/0/`);
      return op ? instr(op, { rd, imm: w >>> 12 }) : null;
    }
    case 0x6f: {
      const op = byKey.get(`${opcode}/0/`);
      return op ? instr(op, { rd, imm: unpackJ(w) }) : null;
    }
    case 0x73: {
      if (funct3 === 0) {
        if (funct7 === 0x09 && rd === 0) {
          const op = byKey.get(`${opcode}/0/9`);
          return op ? instr(op, { rs1, rs2 }) : null;
        }
        return null;
      }
      const op = byKey.get(`${opcode}/${funct3}/`);
      if (!op) return null;
      const csr = w >>> 20;
      return op.format === 'CSRI' ? instr(op, { rd, imm: rs1, csr }) : instr(op, { rd, rs1, csr });
    }
    case 0x0f: {
      if (funct3 !== 0 || rd !== 0 || rs1 !== 0 || w >>> 28 !== 0) return null;
      const op = byKey.get(`${opcode}/0/`);
      return op ? instr(op, { pred: (w >>> 24) & 15, succ: (w >>> 20) & 15 }) : null;
    }
    case 0x2f: {
      if (funct3 !== 2) return null;
      const op = byKey.get(`${opcode}/2/${w >>> 27}`);
      if (!op) return null;
      if (op.format === 'LR' && rs2 !== 0) return null;
      const aq = ((w >>> 26) & 1) === 1;
      const rl = ((w >>> 25) & 1) === 1;
      return instr(op, { rd, rs1, rs2: op.format === 'LR' ? 0 : rs2, aq, rl });
    }
    default:
      return null;
  }
}
