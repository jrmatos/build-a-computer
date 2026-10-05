/** CSR numbers and bit fields used by the hart (RISC-V privileged spec 1.12). */

export const CSR = {
  // Unprivileged counters.
  cycle: 0xc00,
  time: 0xc01,
  instret: 0xc02,
  cycleh: 0xc80,
  timeh: 0xc81,
  instreth: 0xc82,
  // Supervisor.
  sstatus: 0x100,
  sie: 0x104,
  stvec: 0x105,
  scounteren: 0x106,
  senvcfg: 0x10a,
  sscratch: 0x140,
  sepc: 0x141,
  scause: 0x142,
  stval: 0x143,
  sip: 0x144,
  satp: 0x180,
  // Machine information.
  mvendorid: 0xf11,
  marchid: 0xf12,
  mimpid: 0xf13,
  mhartid: 0xf14,
  mconfigptr: 0xf15,
  // Machine trap setup and handling.
  mstatus: 0x300,
  misa: 0x301,
  medeleg: 0x302,
  mideleg: 0x303,
  mie: 0x304,
  mtvec: 0x305,
  mcounteren: 0x306,
  menvcfg: 0x30a,
  mstatush: 0x310,
  medelegh: 0x312,
  menvcfgh: 0x31a,
  mcountinhibit: 0x320,
  mscratch: 0x340,
  mepc: 0x341,
  mcause: 0x342,
  mtval: 0x343,
  mip: 0x344,
  mtinst: 0x34a,
  mtval2: 0x34b,
  pmpcfg0: 0x3a0,
  pmpaddr0: 0x3b0,
  mseccfg: 0x747,
  mseccfgh: 0x757,
  // Machine counters.
  mcycle: 0xb00,
  minstret: 0xb02,
  mcycleh: 0xb80,
  minstreth: 0xb82,
  // Debug triggers (no triggers implemented: tdata1 reads 0).
  tselect: 0x7a0,
  tdata1: 0x7a1,
  tdata2: 0x7a2,
  tdata3: 0x7a3,
} as const;

/** mstatus bits. */
export const MSTATUS = {
  SIE: 1 << 1,
  MIE: 1 << 3,
  SPIE: 1 << 5,
  MPIE: 1 << 7,
  SPP: 1 << 8,
  MPP: 3 << 11,
  MPRV: 1 << 17,
  SUM: 1 << 18,
  MXR: 1 << 19,
  TVM: 1 << 20,
  TW: 1 << 21,
  TSR: 1 << 22,
} as const;

export const MSTATUS_WRITABLE =
  MSTATUS.SIE |
  MSTATUS.MIE |
  MSTATUS.SPIE |
  MSTATUS.MPIE |
  MSTATUS.SPP |
  MSTATUS.MPP |
  MSTATUS.MPRV |
  MSTATUS.SUM |
  MSTATUS.MXR |
  MSTATUS.TVM |
  MSTATUS.TW |
  MSTATUS.TSR;

export const SSTATUS_MASK = MSTATUS.SIE | MSTATUS.SPIE | MSTATUS.SPP | MSTATUS.SUM | MSTATUS.MXR;

/** Interrupt bit numbers (mip/mie) and causes. */
export const IRQ_BIT = { SSI: 1, MSI: 3, STI: 5, MTI: 7, SEI: 9, MEI: 11 } as const;
export const MIP_SSIP = 1 << IRQ_BIT.SSI;
export const MIP_MSIP = 1 << IRQ_BIT.MSI;
export const MIP_STIP = 1 << IRQ_BIT.STI;
export const MIP_MTIP = 1 << IRQ_BIT.MTI;
export const MIP_SEIP = 1 << IRQ_BIT.SEI;
export const MIP_MEIP = 1 << IRQ_BIT.MEI;
export const MIE_MASK = MIP_SSIP | MIP_MSIP | MIP_STIP | MIP_MTIP | MIP_SEIP | MIP_MEIP;
export const MIDELEG_MASK = MIP_SSIP | MIP_STIP | MIP_SEIP;
/** Exceptions that can be delegated (all but ECALL from M and reserved ones). */
export const MEDELEG_MASK = 0xb3ff;

/** Exception causes. */
export const CAUSE = {
  instMisaligned: 0,
  instAccessFault: 1,
  illegalInstruction: 2,
  breakpoint: 3,
  loadMisaligned: 4,
  loadAccessFault: 5,
  storeMisaligned: 6,
  storeAccessFault: 7,
  ecallU: 8,
  ecallS: 9,
  ecallM: 11,
  instPageFault: 12,
  loadPageFault: 13,
  storePageFault: 15,
} as const;

/** Privilege levels. */
export const PRIV = { U: 0, S: 1, M: 3 } as const;
export type Priv = 0 | 1 | 3;

/** misa for RV32IMA with S and U modes. */
export const MISA =
  ((1 << 30) |
    (1 << 0) /* A */ |
    (1 << 8) /* I */ |
    (1 << 12) /* M */ |
    (1 << 18) /* S */ |
    (1 << 20)) /* U */ >>>
  0;
