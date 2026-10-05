/**
 * Operation numbers used by the decoder and the interpreter's decode cache.
 * 0 is reserved: in the cache it means "not decoded yet".
 */

export const OP_UNDECODED = 0;
export const OP_ILLEGAL = 1;

export const LUI = 2;
export const AUIPC = 3;
export const JAL = 4;
export const JALR = 5;
export const BEQ = 6;
export const BNE = 7;
export const BLT = 8;
export const BGE = 9;
export const BLTU = 10;
export const BGEU = 11;
export const LB = 12;
export const LH = 13;
export const LW = 14;
export const LBU = 15;
export const LHU = 16;
export const SB = 17;
export const SH = 18;
export const SW = 19;
export const ADDI = 20;
export const SLTI = 21;
export const SLTIU = 22;
export const XORI = 23;
export const ORI = 24;
export const ANDI = 25;
export const SLLI = 26;
export const SRLI = 27;
export const SRAI = 28;
export const ADD = 29;
export const SUB = 30;
export const SLL = 31;
export const SLT = 32;
export const SLTU = 33;
export const XOR = 34;
export const SRL = 35;
export const SRA = 36;
export const OR = 37;
export const AND = 38;
export const FENCE = 39;
export const FENCE_I = 40;
export const ECALL = 41;
export const EBREAK = 42;
export const MRET = 43;
export const SRET = 44;
export const WFI = 45;
export const SFENCE_VMA = 46;
export const CSRRW = 47;
export const CSRRS = 48;
export const CSRRC = 49;
export const CSRRWI = 50;
export const CSRRSI = 51;
export const CSRRCI = 52;
export const MUL = 53;
export const MULH = 54;
export const MULHSU = 55;
export const MULHU = 56;
export const DIV = 57;
export const DIVU = 58;
export const REM = 59;
export const REMU = 60;
export const LR_W = 61;
export const SC_W = 62;
export const AMOSWAP_W = 63;
export const AMOADD_W = 64;
export const AMOXOR_W = 65;
export const AMOAND_W = 66;
export const AMOOR_W = 67;
export const AMOMIN_W = 68;
export const AMOMAX_W = 69;
export const AMOMINU_W = 70;
export const AMOMAXU_W = 71;

export const OP_COUNT = 72;

/** Instruction encoding formats. */
export type Format =
  | 'R' // rd, rs1, rs2
  | 'I' // rd, rs1, imm[11:0]
  | 'SH' // shift by immediate: rd, rs1, shamt[4:0]
  | 'S'
  | 'B'
  | 'U'
  | 'J'
  | 'CSR' // rd, rs1, csr (imm holds the CSR number)
  | 'CSRI' // rd, uimm (in rs1), csr
  | 'SYS' // a fixed 32-bit word
  | 'SFENCE' // rs1, rs2
  | 'FENCE' // rd, rs1, imm[11:0] kept verbatim (fm/pred/succ)
  | 'AMO'; // rd, rs1, rs2, imm = aq<<1 | rl

export interface OpSpec {
  readonly op: number;
  readonly name: string;
  readonly fmt: Format;
  readonly opcode: number;
  readonly funct3: number;
  /** funct7 for R/SH, funct5 for AMO, the whole word for SYS. */
  readonly funct7: number;
}

const s = (
  op: number,
  name: string,
  fmt: Format,
  opcode: number,
  funct3 = 0,
  funct7 = 0,
): OpSpec => ({
  op,
  name,
  fmt,
  opcode,
  funct3,
  funct7,
});

/** Every implemented instruction, indexed by op number (holes are undefined). */
export const OP_SPECS: readonly OpSpec[] = (() => {
  const list: OpSpec[] = [
    s(LUI, 'lui', 'U', 0x37),
    s(AUIPC, 'auipc', 'U', 0x17),
    s(JAL, 'jal', 'J', 0x6f),
    s(JALR, 'jalr', 'I', 0x67, 0),
    s(BEQ, 'beq', 'B', 0x63, 0),
    s(BNE, 'bne', 'B', 0x63, 1),
    s(BLT, 'blt', 'B', 0x63, 4),
    s(BGE, 'bge', 'B', 0x63, 5),
    s(BLTU, 'bltu', 'B', 0x63, 6),
    s(BGEU, 'bgeu', 'B', 0x63, 7),
    s(LB, 'lb', 'I', 0x03, 0),
    s(LH, 'lh', 'I', 0x03, 1),
    s(LW, 'lw', 'I', 0x03, 2),
    s(LBU, 'lbu', 'I', 0x03, 4),
    s(LHU, 'lhu', 'I', 0x03, 5),
    s(SB, 'sb', 'S', 0x23, 0),
    s(SH, 'sh', 'S', 0x23, 1),
    s(SW, 'sw', 'S', 0x23, 2),
    s(ADDI, 'addi', 'I', 0x13, 0),
    s(SLTI, 'slti', 'I', 0x13, 2),
    s(SLTIU, 'sltiu', 'I', 0x13, 3),
    s(XORI, 'xori', 'I', 0x13, 4),
    s(ORI, 'ori', 'I', 0x13, 6),
    s(ANDI, 'andi', 'I', 0x13, 7),
    s(SLLI, 'slli', 'SH', 0x13, 1, 0x00),
    s(SRLI, 'srli', 'SH', 0x13, 5, 0x00),
    s(SRAI, 'srai', 'SH', 0x13, 5, 0x20),
    s(ADD, 'add', 'R', 0x33, 0, 0x00),
    s(SUB, 'sub', 'R', 0x33, 0, 0x20),
    s(SLL, 'sll', 'R', 0x33, 1, 0x00),
    s(SLT, 'slt', 'R', 0x33, 2, 0x00),
    s(SLTU, 'sltu', 'R', 0x33, 3, 0x00),
    s(XOR, 'xor', 'R', 0x33, 4, 0x00),
    s(SRL, 'srl', 'R', 0x33, 5, 0x00),
    s(SRA, 'sra', 'R', 0x33, 5, 0x20),
    s(OR, 'or', 'R', 0x33, 6, 0x00),
    s(AND, 'and', 'R', 0x33, 7, 0x00),
    s(MUL, 'mul', 'R', 0x33, 0, 0x01),
    s(MULH, 'mulh', 'R', 0x33, 1, 0x01),
    s(MULHSU, 'mulhsu', 'R', 0x33, 2, 0x01),
    s(MULHU, 'mulhu', 'R', 0x33, 3, 0x01),
    s(DIV, 'div', 'R', 0x33, 4, 0x01),
    s(DIVU, 'divu', 'R', 0x33, 5, 0x01),
    s(REM, 'rem', 'R', 0x33, 6, 0x01),
    s(REMU, 'remu', 'R', 0x33, 7, 0x01),
    s(FENCE, 'fence', 'FENCE', 0x0f, 0),
    s(FENCE_I, 'fence.i', 'FENCE', 0x0f, 1),
    s(ECALL, 'ecall', 'SYS', 0x73, 0, 0x00000073),
    s(EBREAK, 'ebreak', 'SYS', 0x73, 0, 0x00100073),
    s(MRET, 'mret', 'SYS', 0x73, 0, 0x30200073),
    s(SRET, 'sret', 'SYS', 0x73, 0, 0x10200073),
    s(WFI, 'wfi', 'SYS', 0x73, 0, 0x10500073),
    s(SFENCE_VMA, 'sfence.vma', 'SFENCE', 0x73, 0, 0x09),
    s(CSRRW, 'csrrw', 'CSR', 0x73, 1),
    s(CSRRS, 'csrrs', 'CSR', 0x73, 2),
    s(CSRRC, 'csrrc', 'CSR', 0x73, 3),
    s(CSRRWI, 'csrrwi', 'CSRI', 0x73, 5),
    s(CSRRSI, 'csrrsi', 'CSRI', 0x73, 6),
    s(CSRRCI, 'csrrci', 'CSRI', 0x73, 7),
    s(LR_W, 'lr.w', 'AMO', 0x2f, 2, 0x02),
    s(SC_W, 'sc.w', 'AMO', 0x2f, 2, 0x03),
    s(AMOSWAP_W, 'amoswap.w', 'AMO', 0x2f, 2, 0x01),
    s(AMOADD_W, 'amoadd.w', 'AMO', 0x2f, 2, 0x00),
    s(AMOXOR_W, 'amoxor.w', 'AMO', 0x2f, 2, 0x04),
    s(AMOAND_W, 'amoand.w', 'AMO', 0x2f, 2, 0x0c),
    s(AMOOR_W, 'amoor.w', 'AMO', 0x2f, 2, 0x08),
    s(AMOMIN_W, 'amomin.w', 'AMO', 0x2f, 2, 0x10),
    s(AMOMAX_W, 'amomax.w', 'AMO', 0x2f, 2, 0x14),
    s(AMOMINU_W, 'amominu.w', 'AMO', 0x2f, 2, 0x18),
    s(AMOMAXU_W, 'amomaxu.w', 'AMO', 0x2f, 2, 0x1c),
  ];
  const table: OpSpec[] = [];
  for (const spec of list) table[spec.op] = spec;
  return table;
})();
