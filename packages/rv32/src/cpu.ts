/**
 * RV-02/03/04, DEV-02, DEV-08: the RV32IMA + Zicsr hart.
 *
 * - Interpreter over a decode cache: one lazily-filled 1024-entry page per
 *   4 KiB of physical memory. Every store into RAM clears the cached entry of
 *   the word it hits, which covers self-modifying code and FENCE.I (E-CPU-10).
 * - Machine, supervisor and user modes; traps and interrupts follow the
 *   privileged spec (1.12) including medeleg/mideleg delegation.
 * - Sv32 paging with a small TLB, hardware A/D bit updates, SUM/MXR/MPRV.
 * - Deterministic: no clock, no randomness. Time is the cycle counter.
 *
 * Internally the pc and addresses are kept as signed 32-bit integers (so
 * they stay small integers for V8); public accessors return unsigned values.
 */

import type { Bus } from './bus';
import {
  CAUSE,
  CSR,
  MEDELEG_MASK,
  MIDELEG_MASK,
  MIE_MASK,
  MIP_MEIP,
  MIP_MSIP,
  MIP_MTIP,
  MIP_SEIP,
  MIP_SSIP,
  MIP_STIP,
  MISA,
  MSTATUS,
  MSTATUS_WRITABLE,
  PRIV,
  SSTATUS_MASK,
  type Priv,
} from './csr';
import { decode } from './decode';
import type { Clint, Plic } from './devices';

/** Physical base of RAM. */
export const RAM_BASE = 0x8000_0000;

const PAGE_WORDS = 1024;

/** One 4 KiB page of decoded instructions. `op` 0 means "not decoded yet". */
interface CodePage {
  readonly op: Uint8Array;
  /** rd | rs1 << 5 | rs2 << 10 */
  readonly regs: Int32Array;
  readonly imm: Int32Array;
}

const newPage = (): CodePage => ({
  op: new Uint8Array(PAGE_WORDS),
  regs: new Int32Array(PAGE_WORDS),
  imm: new Int32Array(PAGE_WORDS),
});

/** Thrown internally to unwind the interpreter on a synchronous exception. */
class TrapSignal {
  cause = 0;
  tval = 0;
}

const ACC_LOAD = 0;
const ACC_STORE = 1;
const ACC_FETCH = 2;
const TLB_SIZE = 256;

/** Why `run` returned. 'stopped': an `onTrap` hook asked to stop. */
export type StopReason = 'budget' | 'wfi' | 'stopped';

/**
 * Called just before the hart takes a trap. `cause` has bit 31 set for
 * interrupts; `epc` is the trapping pc. Return 'stop' to stop instead: no
 * state changes, pc stays at `epc`, WFI is cleared and `run` returns with
 * reason 'stopped' (the step that trapped still counts as a cycle).
 */
export type TrapHook = (cause: number, tval: number, epc: number) => 'take' | 'stop';

export interface RunResult {
  /** Steps executed (instructions retired plus exceptions taken). */
  steps: number;
  reason: StopReason;
}

export interface HartOptions {
  bus: Bus;
  /** RAM bytes, mapped at RAM_BASE; must also be registered on the bus. */
  ram: Uint8Array;
  clint?: Clint;
  plic?: Plic;
  /** Reset vector (default 0, the boot ROM). */
  resetVector?: number;
  /**
   * When the hart sits in WFI and the CLINT timer is armed, jump time forward
   * to mtimecmp instead of returning 'wfi' (default true).
   */
  idleSkip?: boolean;
  /** Misaligned data access policy (default 'trap'). */
  misaligned?: 'trap' | 'emulate';
}

/** Fast 32x32 -> high 32 bits multiply, unsigned. */
export function mulhu32(a: number, b: number): number {
  a >>>= 0;
  b >>>= 0;
  const al = a & 0xffff;
  const ah = a >>> 16;
  const bl = b & 0xffff;
  const bh = b >>> 16;
  const lo = al * bl;
  const m1 = ah * bl;
  const m2 = al * bh;
  const carry = ((lo >>> 16) + (m1 & 0xffff) + (m2 & 0xffff)) >>> 16;
  return (ah * bh + (m1 >>> 16) + (m2 >>> 16) + carry) >>> 0;
}

/** Signed x signed high word. */
export function mulh32(a: number, b: number): number {
  let r = mulhu32(a, b);
  if (a < 0 || a >= 0x80000000) r -= b >>> 0;
  if (b < 0 || b >= 0x80000000) r -= a >>> 0;
  return r >>> 0;
}

/** Signed x unsigned high word. */
export function mulhsu32(a: number, b: number): number {
  let r = mulhu32(a, b);
  if (a < 0 || a >= 0x80000000) r -= b >>> 0;
  return r >>> 0;
}

const MASK64 = (1n << 64n) - 1n;

export class Hart {
  /** Integer registers. x[0] is forced to 0 after every instruction (E-CPU-01). */
  readonly x = new Int32Array(32);
  private _pc = 0;
  priv: Priv = PRIV.M;
  /** True while parked in WFI. */
  waiting = false;

  // CSRs.
  mstatus = 0;
  medeleg = 0;
  mideleg = 0;
  mie = 0;
  /** Software-writable mip bits (SSIP, STIP, SEIP). */
  mipSw = 0;
  mtvec = 0;
  mscratch = 0;
  mepc = 0;
  mcause = 0;
  mtval = 0;
  mcounteren = 0;
  scounteren = 0;
  stvec = 0;
  sscratch = 0;
  sepc = 0;
  scause = 0;
  stval = 0;
  satp = 0;
  menvcfg = 0;
  senvcfg = 0;
  readonly pmpcfg = new Uint32Array(16);
  readonly pmpaddr = new Uint32Array(64);

  /** Steps (cycles) and retired instructions since power on. */
  cycles = 0;
  instret = 0;
  private cycleBase = 0n;
  private instretBase = 0n;
  /** Instructions retired so far inside the running chunk (not yet in `cycles`). */
  private inChunk = 0;

  private reservation = -1;
  private readonly signal = new TrapSignal();

  // Memory.
  private readonly bus: Bus;
  private readonly clint: Clint | undefined;
  private readonly plic: Plic | undefined;
  private readonly ram8: Uint8Array;
  private readonly ram8s: Int8Array;
  private readonly ram16: Uint16Array;
  private readonly ram16s: Int16Array;
  private readonly ram32: Int32Array;
  private readonly ramSize: number;
  private readonly ramPages: (CodePage | undefined)[];
  private readonly otherPages = new Map<number, CodePage>();

  // Paging.
  private fetchVm = false;
  private dataVm = false;
  private readonly tlbTag = new Int32Array(TLB_SIZE * 3).fill(-1);
  private readonly tlbPa = new Int32Array(TLB_SIZE * 3);

  readonly resetVector: number;
  idleSkip: boolean;
  /** Misaligned loads/stores: 'trap' (default, E-CPU-05) or 'emulate' in hardware. */
  misaligned: 'trap' | 'emulate';
  /** Optional trap hook (see `TrapHook`): lets a host stop on ebreak, exit, or unhandled traps. */
  onTrap: TrapHook | undefined = undefined;
  /** Set when `onTrap` returned 'stop'; `run` returns 'stopped' and clears it. */
  private stopRequested = false;

  constructor(opts: HartOptions) {
    const probe = new Uint16Array(new Uint8Array([1, 0]).buffer);
    if (probe[0] !== 1) throw new Error('rv32 requires a little-endian host');
    this.bus = opts.bus;
    this.clint = opts.clint;
    this.plic = opts.plic;
    const ram = opts.ram;
    if (ram.byteOffset !== 0 || ram.length % 4096 !== 0)
      throw new Error('RAM must be a whole buffer of 4 KiB pages');
    this.ram8 = ram;
    this.ram8s = new Int8Array(ram.buffer);
    this.ram16 = new Uint16Array(ram.buffer);
    this.ram16s = new Int16Array(ram.buffer);
    this.ram32 = new Int32Array(ram.buffer);
    this.ramSize = ram.length;
    this.ramPages = new Array<CodePage | undefined>(ram.length / 4096).fill(undefined);
    this.resetVector = (opts.resetVector ?? 0) | 0;
    this.idleSkip = opts.idleSkip ?? true;
    this.misaligned = opts.misaligned ?? 'trap';
    this.reset();
  }

  /** Program counter (unsigned). */
  get pc(): number {
    return this._pc >>> 0;
  }

  set pc(v: number) {
    this._pc = v | 0;
  }

  /** Register value, unsigned. */
  reg(i: number): number {
    return (this.x[i] ?? 0) >>> 0;
  }

  /** Reset: pc to the reset vector, M-mode, CSRs cleared. Registers keep their values. */
  reset(): void {
    this._pc = this.resetVector;
    this.priv = PRIV.M;
    this.waiting = false;
    this.mstatus = 0;
    this.medeleg = this.mideleg = this.mie = this.mipSw = 0;
    this.mtvec = this.mscratch = this.mepc = this.mcause = this.mtval = 0;
    this.mcounteren = this.scounteren = 0;
    this.stvec = this.sscratch = this.sepc = this.scause = this.stval = this.satp = 0;
    this.menvcfg = this.senvcfg = 0;
    this.pmpcfg.fill(0);
    this.pmpaddr.fill(0);
    this.reservation = -1;
    this.updateVm();
  }

  /** Drop every cached decode (call after the host writes memory directly). */
  flushDecodeCache(): void {
    this.ramPages.fill(undefined);
    this.otherPages.clear();
  }

  /** Invalidate decode-cache entries for a RAM range written by the host. */
  invalidateRange(addr: number, length: number): void {
    const start = ((addr >>> 0) - RAM_BASE) >>> 0;
    if (start >= this.ramSize) {
      this.otherPages.clear();
      return;
    }
    const end = Math.min(this.ramSize, start + length);
    for (let p = start >>> 12; p <= (end - 1) >>> 12; p++) this.ramPages[p] = undefined;
  }

  // -------------------------------------------------------------------------
  // Counters
  // -------------------------------------------------------------------------

  /** Current cycle count, including instructions retired in the running chunk. */
  cycleNow(): number {
    return this.cycles + this.inChunk;
  }

  private mcycle64(): bigint {
    return (this.cycleBase + BigInt(this.cycles + this.inChunk)) & MASK64;
  }

  private minstret64(): bigint {
    return (this.instretBase + BigInt(this.instret + this.inChunk)) & MASK64;
  }

  // -------------------------------------------------------------------------
  // Interrupts
  // -------------------------------------------------------------------------

  /** Current mip value, combining software bits with device lines. */
  get mip(): number {
    let mip = this.mipSw;
    const c = this.clint;
    if (c) {
      if (c.mtip) mip |= MIP_MTIP;
      if (c.msip) mip |= MIP_MSIP;
    }
    const p = this.plic;
    if (p) {
      if (p.output(0)) mip |= MIP_MEIP;
      if (p.output(1)) mip |= MIP_SEIP;
    }
    return mip;
  }

  /** The interrupt cause to take now, or -1. */
  private pendingInterrupt(): number {
    const pending = this.mip & this.mie;
    if (pending === 0) return -1;
    const m = pending & ~this.mideleg;
    const mEnabled = this.priv < PRIV.M || (this.mstatus & MSTATUS.MIE) !== 0;
    if (m !== 0 && mEnabled) return pickInterrupt(m);
    const s = pending & this.mideleg;
    const sEnabled =
      this.priv < PRIV.S || (this.priv === PRIV.S && (this.mstatus & MSTATUS.SIE) !== 0);
    if (s !== 0 && sEnabled) return pickInterrupt(s);
    return -1;
  }

  // -------------------------------------------------------------------------
  // Traps
  // -------------------------------------------------------------------------

  /** Take a trap: `cause` with bit 31 set for interrupts. `epc` is the trapping pc. */
  private takeTrap(cause: number, tval: number, epc: number): void {
    if (this.onTrap && this.onTrap(cause >>> 0, tval >>> 0, epc >>> 0) === 'stop') {
      this._pc = epc | 0;
      this.waiting = false;
      this.stopRequested = true;
      return;
    }
    const interrupt = cause < 0 || cause >= 0x80000000;
    const code = cause & 0x7fffffff;
    const deleg = interrupt ? this.mideleg : this.medeleg;
    this.reservation = -1;
    if (this.priv <= PRIV.S && ((deleg >>> code) & 1) !== 0) {
      this.scause = cause | 0;
      this.sepc = epc | 0;
      this.stval = tval | 0;
      let s = this.mstatus;
      s = (s & MSTATUS.SIE ? s | MSTATUS.SPIE : s & ~MSTATUS.SPIE) & ~MSTATUS.SIE;
      s = this.priv === PRIV.S ? s | MSTATUS.SPP : s & ~MSTATUS.SPP;
      this.mstatus = s;
      this.priv = PRIV.S;
      const base = this.stvec & ~3;
      this._pc = interrupt && (this.stvec & 3) === 1 ? (base + 4 * code) | 0 : base;
    } else {
      this.mcause = cause | 0;
      this.mepc = epc | 0;
      this.mtval = tval | 0;
      let s = this.mstatus;
      s = (s & MSTATUS.MIE ? s | MSTATUS.MPIE : s & ~MSTATUS.MPIE) & ~MSTATUS.MIE;
      s = (s & ~MSTATUS.MPP) | (this.priv << 11);
      this.mstatus = s;
      this.priv = PRIV.M;
      const base = this.mtvec & ~3;
      this._pc = interrupt && (this.mtvec & 3) === 1 ? (base + 4 * code) | 0 : base;
    }
    this.updateVm();
  }

  private raise(cause: number, tval: number): never {
    const s = this.signal;
    s.cause = cause;
    s.tval = tval;
    throw s;
  }

  private updateVm(): void {
    const on = this.satp < 0;
    const m = this.mstatus;
    const dataPriv = this.priv === PRIV.M && (m & MSTATUS.MPRV) !== 0 ? (m >>> 11) & 3 : this.priv;
    this.fetchVm = on && this.priv !== PRIV.M;
    this.dataVm = on && dataPriv !== PRIV.M;
    this.tlbTag.fill(-1);
  }

  // -------------------------------------------------------------------------
  // Sv32
  // -------------------------------------------------------------------------

  /** Translate a virtual address. Throws page or access faults. Returns a physical address (int32). */
  private translate(va: number, acc: number): number {
    const vpn = va >>> 12;
    const slot = (vpn & (TLB_SIZE - 1)) + acc * TLB_SIZE;
    if (this.tlbTag[slot] === vpn) return (this.tlbPa[slot] ?? 0) | (va & 0xfff);
    const pa = this.walk(va, acc);
    this.tlbTag[slot] = vpn;
    this.tlbPa[slot] = pa & ~0xfff;
    return pa;
  }

  private walk(va: number, acc: number): number {
    const pageFault =
      acc === ACC_FETCH
        ? CAUSE.instPageFault
        : acc === ACC_LOAD
          ? CAUSE.loadPageFault
          : CAUSE.storePageFault;
    const accessFault =
      acc === ACC_FETCH
        ? CAUSE.instAccessFault
        : acc === ACC_LOAD
          ? CAUSE.loadAccessFault
          : CAUSE.storeAccessFault;
    const m = this.mstatus;
    const priv =
      acc === ACC_FETCH
        ? this.priv
        : this.priv === PRIV.M && m & MSTATUS.MPRV
          ? (m >>> 11) & 3
          : this.priv;
    let table = (this.satp & 0x3fffff) * 4096;
    let level = 1;
    let pteAddr: number;
    let pte: number;
    for (;;) {
      const vpnPart = level === 1 ? va >>> 22 : (va >>> 12) & 0x3ff;
      pteAddr = table + vpnPart * 4;
      if (pteAddr >= 2 ** 32) this.raise(accessFault, va);
      const v = this.physRead(pteAddr | 0, 4);
      if (v === undefined) this.raise(accessFault, va);
      pte = v | 0;
      if ((pte & 1) === 0 || ((pte & 2) === 0 && (pte & 4) !== 0)) this.raise(pageFault, va);
      if ((pte & 0xa) !== 0) break; // R or X: leaf
      if (level === 0) this.raise(pageFault, va);
      table = (pte >>> 10) * 4096;
      level = 0;
    }
    // Leaf permission checks.
    const user = (pte & 0x10) !== 0;
    if (priv === PRIV.U && !user) this.raise(pageFault, va);
    if (priv === PRIV.S && user && (acc === ACC_FETCH || (m & MSTATUS.SUM) === 0))
      this.raise(pageFault, va);
    if (acc === ACC_FETCH && (pte & 8) === 0) this.raise(pageFault, va);
    if (acc === ACC_LOAD && (pte & 2) === 0 && !((m & MSTATUS.MXR) !== 0 && (pte & 8) !== 0))
      this.raise(pageFault, va);
    if (acc === ACC_STORE && (pte & 4) === 0) this.raise(pageFault, va);
    const ppn = pte >>> 10;
    if (level === 1 && (ppn & 0x3ff) !== 0) this.raise(pageFault, va); // misaligned superpage
    // Hardware A/D update.
    const want = 0x40 | (acc === ACC_STORE ? 0x80 : 0);
    if ((pte & want) !== want) {
      pte |= want;
      if (!this.physWrite(pteAddr | 0, 4, pte)) this.raise(accessFault, va);
    }
    const pa = level === 1 ? (ppn >>> 10) * 2 ** 22 + (va & 0x3fffff) : ppn * 4096 + (va & 0xfff);
    if (pa >= 2 ** 32) this.raise(accessFault, va);
    return pa | 0;
  }

  // -------------------------------------------------------------------------
  // Physical memory slow paths
  // -------------------------------------------------------------------------

  /** Physical read through RAM or the bus; undefined on access fault. */
  physRead(pa: number, width: 1 | 2 | 4): number | undefined {
    const off = (pa - RAM_BASE) >>> 0;
    if (off < this.ramSize) {
      if (width === 4) return this.ram32[off >>> 2]! >>> 0;
      if (width === 2) return this.ram16[off >>> 1]!;
      return this.ram8[off]!;
    }
    return this.bus.read(pa >>> 0, width);
  }

  /** Physical write through RAM or the bus; false on access fault. */
  physWrite(pa: number, width: 1 | 2 | 4, value: number): boolean {
    const off = (pa - RAM_BASE) >>> 0;
    if (off < this.ramSize) {
      if (width === 4) this.ram32[off >>> 2] = value;
      else if (width === 2) this.ram16[off >>> 1] = value;
      else this.ram8[off] = value;
      const pg = this.ramPages[off >>> 12];
      if (pg !== undefined) pg.op[(off >>> 2) & 1023] = 0;
      return true;
    }
    return this.bus.write(pa >>> 0, width, value);
  }

  private loadSlow(pa: number, width: 1 | 2 | 4, va: number): number {
    const v = this.bus.read(pa >>> 0, width);
    if (v === undefined) this.raise(CAUSE.loadAccessFault, va);
    return v;
  }

  private storeSlow(pa: number, width: 1 | 2 | 4, value: number, va: number): void {
    if (!this.bus.write(pa >>> 0, width, value)) this.raise(CAUSE.storeAccessFault, va);
  }

  /**
   * Misaligned load: traps with the misaligned cause (E-CPU-05) unless
   * `misaligned` is 'emulate', which splits it into byte accesses.
   */
  private misalignedLoad(va: number, width: 2 | 4, signed: boolean): number {
    if (this.misaligned === 'trap') this.raise(CAUSE.loadMisaligned, va);
    let v = 0;
    for (let k = width - 1; k >= 0; k--) {
      const a = (va + k) | 0;
      const pa = this.dataVm ? this.translate(a, ACC_LOAD) : a;
      const b = this.physRead(pa, 1);
      if (b === undefined) this.raise(CAUSE.loadAccessFault, a);
      v = (v << 8) | b;
    }
    return signed && width === 2 ? (v << 16) >> 16 : v | 0;
  }

  private misalignedStore(va: number, width: 2 | 4, value: number): void {
    if (this.misaligned === 'trap') this.raise(CAUSE.storeMisaligned, va);
    // Translate every byte first so a fault leaves memory unchanged.
    const pas: number[] = [];
    for (let k = 0; k < width; k++) {
      const a = (va + k) | 0;
      pas.push(this.dataVm ? this.translate(a, ACC_STORE) : a);
    }
    for (let k = 0; k < width; k++) {
      if (!this.physWrite(pas[k]!, 1, (value >>> (8 * k)) & 0xff))
        this.raise(CAUSE.storeAccessFault, (va + k) | 0);
    }
  }

  /** Read a word for debugging/host use: virtual address in the current mode, no side effects on faults. */
  peek32(va: number): number | undefined {
    return this.physRead(va | 0, 4);
  }

  // -------------------------------------------------------------------------
  // Fetch and decode
  // -------------------------------------------------------------------------

  private pageFor(pc: number): CodePage {
    const pa = this.fetchVm ? this.translate(pc, ACC_FETCH) : pc;
    const off = (pa - RAM_BASE) >>> 0;
    if (off < this.ramSize) {
      const n = off >>> 12;
      let pg = this.ramPages[n];
      if (pg === undefined) {
        pg = newPage();
        this.ramPages[n] = pg;
      }
      return pg;
    }
    // Outside RAM: only executable from ROM-like memory the bus can read.
    const key = pa >>> 12;
    let pg = this.otherPages.get(key);
    if (pg === undefined) {
      const m = this.bus.find(pa >>> 0, 4);
      if (!m || !isExecutable(m.device.name)) this.raise(CAUSE.instAccessFault, pc);
      pg = newPage();
      this.otherPages.set(key, pg);
    }
    return pg;
  }

  /** Decode the instruction at `pc` into `pg` slot `i`. Returns its op. */
  private fill(pg: CodePage, i: number, pc: number): number {
    const pa = this.fetchVm ? this.translate(pc, ACC_FETCH) : pc;
    const w = this.physRead(pa, 4);
    if (w === undefined) this.raise(CAUSE.instAccessFault, pc);
    const d = decode(w);
    pg.regs[i] = d.rd | (d.rs1 << 5) | (d.rs2 << 10);
    pg.imm[i] = d.op === 1 ? w | 0 : d.imm;
    pg.op[i] = d.op;
    return d.op;
  }

  // -------------------------------------------------------------------------
  // Run loop
  // -------------------------------------------------------------------------

  /**
   * Execute up to `maxSteps` steps (an instruction or a taken exception each).
   * Returns early with reason 'wfi' when parked with nothing to wake it.
   */
  run(maxSteps: number): RunResult {
    let steps = 0;
    while (steps < maxSteps) {
      if (this.waiting) {
        if ((this.mip & this.mie) !== 0) this.waiting = false;
        else if (
          this.idleSkip &&
          this.clint &&
          (this.mie & MIP_MTIP) !== 0 &&
          this.clint.mtimecmp - this.clint.mtime > 0 &&
          this.clint.cyclesUntilTimer() !== Infinity
        ) {
          this.clint.advance(this.clint.mtimecmp - this.clint.mtime);
          continue;
        } else return { steps, reason: 'wfi' };
      }
      const irq = this.pendingInterrupt();
      if (irq >= 0) {
        this.takeTrap((irq | 0x80000000) >>> 0, 0, this._pc);
        this.cycles++;
        steps++;
        if (this.stopRequested) {
          this.stopRequested = false;
          return { steps, reason: 'stopped' };
        }
        continue;
      }
      let limit = maxSteps - steps;
      if (this.clint) {
        const t = this.clint.cyclesUntilTimer();
        if (t > 0 && t < limit && (this.mie & MIP_MTIP) !== 0) limit = t;
      }
      steps += this.chunk(limit);
      if (this.stopRequested) {
        this.stopRequested = false;
        return { steps, reason: 'stopped' };
      }
    }
    return { steps, reason: 'budget' };
  }

  /** Execute one step. */
  step(): RunResult {
    return this.run(1);
  }

  /** The inner interpreter loop. Returns steps taken (retired + 1 if it trapped). */
  private chunk(limit: number): number {
    const x = this.x;
    const ram8 = this.ram8;
    const ram8s = this.ram8s;
    const ram16 = this.ram16;
    const ram16s = this.ram16s;
    const ram32 = this.ram32;
    const ramSize = this.ramSize;
    const ramPages = this.ramPages;
    const vm = this.dataVm;
    let pc = this._pc;
    let n = 0;
    let curPage = -1;
    let ops: Uint8Array = EMPTY_OPS;
    let regs: Int32Array = EMPTY_I32;
    let imms: Int32Array = EMPTY_I32;
    let page: CodePage | undefined;
    this.inChunk = 0;
    try {
      while (n < limit) {
        if (pc >>> 12 !== curPage) {
          page = this.pageFor(pc);
          curPage = pc >>> 12;
          ops = page.op;
          regs = page.regs;
          imms = page.imm;
        }
        const i = (pc >>> 2) & 1023;
        let op = ops[i]!;
        if (op === 0) op = this.fill(page!, i, pc);
        const r = regs[i]!;
        const imm = imms[i]!;
        const rd = r & 31;
        const rs1 = (r >>> 5) & 31;
        switch (op) {
          case 20: // ADDI
            x[rd] = x[rs1]! + imm;
            pc = (pc + 4) | 0;
            break;
          case 29: // ADD
            x[rd] = x[rs1]! + x[(r >>> 10) & 31]!;
            pc = (pc + 4) | 0;
            break;
          case 14: {
            // LW
            let a = (x[rs1]! + imm) | 0;
            if ((a & 3) !== 0) {
              this.inChunk = n;
              x[rd] = this.misalignedLoad(a, 4, false);
              limit = 0;
            } else {
              const va = a;
              if (vm) a = this.translate(a, ACC_LOAD);
              const off = (a - RAM_BASE) >>> 0;
              if (off < ramSize) x[rd] = ram32[off >>> 2]!;
              else {
                this.inChunk = n;
                x[rd] = this.loadSlow(a, 4, va);
                limit = 0;
              }
            }
            pc = (pc + 4) | 0;
            break;
          }
          case 19: {
            // SW
            let a = (x[rs1]! + imm) | 0;
            if ((a & 3) !== 0) {
              this.inChunk = n;
              this.misalignedStore(a, 4, x[(r >>> 10) & 31]!);
              limit = 0;
            } else {
              const va = a;
              if (vm) a = this.translate(a, ACC_STORE);
              const off = (a - RAM_BASE) >>> 0;
              if (off < ramSize) {
                ram32[off >>> 2] = x[(r >>> 10) & 31]!;
                const pg = ramPages[off >>> 12];
                if (pg !== undefined) pg.op[(off >>> 2) & 1023] = 0;
              } else {
                this.inChunk = n;
                this.storeSlow(a, 4, x[(r >>> 10) & 31]!, va);
                limit = 0;
              }
            }
            pc = (pc + 4) | 0;
            break;
          }
          case 6: // BEQ
            if (x[rs1] === x[(r >>> 10) & 31]) pc = this.jumpTarget(pc, imm);
            else pc = (pc + 4) | 0;
            break;
          case 7: // BNE
            if (x[rs1] !== x[(r >>> 10) & 31]) pc = this.jumpTarget(pc, imm);
            else pc = (pc + 4) | 0;
            break;
          case 8: // BLT
            if (x[rs1]! < x[(r >>> 10) & 31]!) pc = this.jumpTarget(pc, imm);
            else pc = (pc + 4) | 0;
            break;
          case 9: // BGE
            if (x[rs1]! >= x[(r >>> 10) & 31]!) pc = this.jumpTarget(pc, imm);
            else pc = (pc + 4) | 0;
            break;
          case 10: // BLTU
            if (x[rs1]! >>> 0 < x[(r >>> 10) & 31]! >>> 0) pc = this.jumpTarget(pc, imm);
            else pc = (pc + 4) | 0;
            break;
          case 11: // BGEU
            if (x[rs1]! >>> 0 >= x[(r >>> 10) & 31]! >>> 0) pc = this.jumpTarget(pc, imm);
            else pc = (pc + 4) | 0;
            break;
          case 2: // LUI
            x[rd] = imm;
            pc = (pc + 4) | 0;
            break;
          case 3: // AUIPC
            x[rd] = pc + imm;
            pc = (pc + 4) | 0;
            break;
          case 4: {
            // JAL
            const t = this.jumpTarget(pc, imm);
            x[rd] = pc + 4;
            pc = t;
            break;
          }
          case 5: {
            // JALR (E-CPU-06: lowest bit cleared)
            const t = (x[rs1]! + imm) & ~1;
            if ((t & 2) !== 0) this.raise(CAUSE.instMisaligned, t);
            x[rd] = pc + 4;
            pc = t;
            break;
          }
          case 12: {
            // LB
            let a = (x[rs1]! + imm) | 0;
            const va = a;
            if (vm) a = this.translate(a, ACC_LOAD);
            const off = (a - RAM_BASE) >>> 0;
            if (off < ramSize) x[rd] = ram8s[off]!;
            else {
              this.inChunk = n;
              x[rd] = (this.loadSlow(a, 1, va) << 24) >> 24;
              limit = 0;
            }
            pc = (pc + 4) | 0;
            break;
          }
          case 15: {
            // LBU
            let a = (x[rs1]! + imm) | 0;
            const va = a;
            if (vm) a = this.translate(a, ACC_LOAD);
            const off = (a - RAM_BASE) >>> 0;
            if (off < ramSize) x[rd] = ram8[off]!;
            else {
              this.inChunk = n;
              x[rd] = this.loadSlow(a, 1, va);
              limit = 0;
            }
            pc = (pc + 4) | 0;
            break;
          }
          case 13: {
            // LH
            let a = (x[rs1]! + imm) | 0;
            if ((a & 1) !== 0) {
              this.inChunk = n;
              x[rd] = this.misalignedLoad(a, 2, true);
              limit = 0;
            } else {
              const va = a;
              if (vm) a = this.translate(a, ACC_LOAD);
              const off = (a - RAM_BASE) >>> 0;
              if (off < ramSize) x[rd] = ram16s[off >>> 1]!;
              else {
                this.inChunk = n;
                x[rd] = (this.loadSlow(a, 2, va) << 16) >> 16;
                limit = 0;
              }
            }
            pc = (pc + 4) | 0;
            break;
          }
          case 16: {
            // LHU
            let a = (x[rs1]! + imm) | 0;
            if ((a & 1) !== 0) {
              this.inChunk = n;
              x[rd] = this.misalignedLoad(a, 2, false);
              limit = 0;
            } else {
              const va = a;
              if (vm) a = this.translate(a, ACC_LOAD);
              const off = (a - RAM_BASE) >>> 0;
              if (off < ramSize) x[rd] = ram16[off >>> 1]!;
              else {
                this.inChunk = n;
                x[rd] = this.loadSlow(a, 2, va);
                limit = 0;
              }
            }
            pc = (pc + 4) | 0;
            break;
          }
          case 17: {
            // SB
            let a = (x[rs1]! + imm) | 0;
            const va = a;
            if (vm) a = this.translate(a, ACC_STORE);
            const off = (a - RAM_BASE) >>> 0;
            if (off < ramSize) {
              ram8[off] = x[(r >>> 10) & 31]!;
              const pg = ramPages[off >>> 12];
              if (pg !== undefined) pg.op[(off >>> 2) & 1023] = 0;
            } else {
              this.inChunk = n;
              this.storeSlow(a, 1, x[(r >>> 10) & 31]! & 0xff, va);
              limit = 0;
            }
            pc = (pc + 4) | 0;
            break;
          }
          case 18: {
            // SH
            let a = (x[rs1]! + imm) | 0;
            if ((a & 1) !== 0) {
              this.inChunk = n;
              this.misalignedStore(a, 2, x[(r >>> 10) & 31]!);
              limit = 0;
            } else {
              const va = a;
              if (vm) a = this.translate(a, ACC_STORE);
              const off = (a - RAM_BASE) >>> 0;
              if (off < ramSize) {
                ram16[off >>> 1] = x[(r >>> 10) & 31]!;
                const pg = ramPages[off >>> 12];
                if (pg !== undefined) pg.op[(off >>> 2) & 1023] = 0;
              } else {
                this.inChunk = n;
                this.storeSlow(a, 2, x[(r >>> 10) & 31]! & 0xffff, va);
                limit = 0;
              }
            }
            pc = (pc + 4) | 0;
            break;
          }
          case 21: // SLTI
            x[rd] = x[rs1]! < imm ? 1 : 0;
            pc = (pc + 4) | 0;
            break;
          case 22: // SLTIU
            x[rd] = x[rs1]! >>> 0 < imm >>> 0 ? 1 : 0;
            pc = (pc + 4) | 0;
            break;
          case 23: // XORI
            x[rd] = x[rs1]! ^ imm;
            pc = (pc + 4) | 0;
            break;
          case 24: // ORI
            x[rd] = x[rs1]! | imm;
            pc = (pc + 4) | 0;
            break;
          case 25: // ANDI
            x[rd] = x[rs1]! & imm;
            pc = (pc + 4) | 0;
            break;
          case 26: // SLLI
            x[rd] = x[rs1]! << imm;
            pc = (pc + 4) | 0;
            break;
          case 27: // SRLI
            x[rd] = x[rs1]! >>> imm;
            pc = (pc + 4) | 0;
            break;
          case 28: // SRAI
            x[rd] = x[rs1]! >> imm;
            pc = (pc + 4) | 0;
            break;
          case 30: // SUB
            x[rd] = x[rs1]! - x[(r >>> 10) & 31]!;
            pc = (pc + 4) | 0;
            break;
          case 31: // SLL
            x[rd] = x[rs1]! << (x[(r >>> 10) & 31]! & 31);
            pc = (pc + 4) | 0;
            break;
          case 32: // SLT
            x[rd] = x[rs1]! < x[(r >>> 10) & 31]! ? 1 : 0;
            pc = (pc + 4) | 0;
            break;
          case 33: // SLTU
            x[rd] = x[rs1]! >>> 0 < x[(r >>> 10) & 31]! >>> 0 ? 1 : 0;
            pc = (pc + 4) | 0;
            break;
          case 34: // XOR
            x[rd] = x[rs1]! ^ x[(r >>> 10) & 31]!;
            pc = (pc + 4) | 0;
            break;
          case 35: // SRL
            x[rd] = x[rs1]! >>> (x[(r >>> 10) & 31]! & 31);
            pc = (pc + 4) | 0;
            break;
          case 36: // SRA
            x[rd] = x[rs1]! >> (x[(r >>> 10) & 31]! & 31);
            pc = (pc + 4) | 0;
            break;
          case 37: // OR
            x[rd] = x[rs1]! | x[(r >>> 10) & 31]!;
            pc = (pc + 4) | 0;
            break;
          case 38: // AND
            x[rd] = x[rs1]! & x[(r >>> 10) & 31]!;
            pc = (pc + 4) | 0;
            break;
          case 53: // MUL
            x[rd] = Math.imul(x[rs1]!, x[(r >>> 10) & 31]!);
            pc = (pc + 4) | 0;
            break;
          case 54: // MULH
            x[rd] = mulh32(x[rs1]!, x[(r >>> 10) & 31]!);
            pc = (pc + 4) | 0;
            break;
          case 55: // MULHSU
            x[rd] = mulhsu32(x[rs1]!, x[(r >>> 10) & 31]!);
            pc = (pc + 4) | 0;
            break;
          case 56: // MULHU
            x[rd] = mulhu32(x[rs1]!, x[(r >>> 10) & 31]!);
            pc = (pc + 4) | 0;
            break;
          case 57: {
            // DIV (E-CPU-03, E-CPU-04)
            const a = x[rs1]!;
            const b = x[(r >>> 10) & 31]!;
            x[rd] = b === 0 ? -1 : a === -0x80000000 && b === -1 ? a : (a / b) | 0;
            pc = (pc + 4) | 0;
            break;
          }
          case 58: {
            // DIVU
            const a = x[rs1]! >>> 0;
            const b = x[(r >>> 10) & 31]! >>> 0;
            x[rd] = b === 0 ? -1 : (a / b) >>> 0;
            pc = (pc + 4) | 0;
            break;
          }
          case 59: {
            // REM
            const a = x[rs1]!;
            const b = x[(r >>> 10) & 31]!;
            x[rd] = b === 0 ? a : b === -1 ? 0 : a % b;
            pc = (pc + 4) | 0;
            break;
          }
          case 60: {
            // REMU
            const a = x[rs1]! >>> 0;
            const b = x[(r >>> 10) & 31]! >>> 0;
            x[rd] = b === 0 ? a : a % b;
            pc = (pc + 4) | 0;
            break;
          }
          case 39: // FENCE: memory is sequentially consistent here.
            pc = (pc + 4) | 0;
            break;
          case 40: // FENCE.I: stores already invalidate the decode cache (E-CPU-10).
            pc = (pc + 4) | 0;
            limit = 0;
            break;
          case 61:
          case 62:
          case 63:
          case 64:
          case 65:
          case 66:
          case 67:
          case 68:
          case 69:
          case 70:
          case 71:
            this.inChunk = n;
            this.atomic(op, rd, rs1, (r >>> 10) & 31);
            pc = (pc + 4) | 0;
            limit = 0;
            break;
          default:
            // System instructions, CSRs and illegal words: the slow path.
            this._pc = pc;
            this.inChunk = n;
            pc = this.system(op, rd, rs1, (r >>> 10) & 31, imm, pc);
            limit = 0;
            break;
        }
        x[0] = 0;
        n++;
      }
    } catch (e) {
      if (e !== this.signal) {
        this._pc = pc;
        this.commit(n);
        throw e;
      }
      x[0] = 0;
      this.commit(n);
      this.cycles++;
      this.takeTrap(this.signal.cause, this.signal.tval, pc);
      return n + 1;
    }
    this._pc = pc;
    this.commit(n);
    return n;
  }

  private commit(n: number): void {
    this.cycles += n;
    this.instret += n;
    this.inChunk = 0;
  }

  /** Branch/jump target with the misaligned check (E-CPU-07). */
  private jumpTarget(pc: number, imm: number): number {
    const t = (pc + imm) | 0;
    if ((t & 3) !== 0) this.raise(CAUSE.instMisaligned, t);
    return t;
  }

  // -------------------------------------------------------------------------
  // A extension
  // -------------------------------------------------------------------------

  private atomic(op: number, rd: number, rs1: number, rs2: number): void {
    const x = this.x;
    const va = x[rs1]! | 0;
    if (op === 61) {
      // LR.W
      if ((va & 3) !== 0) this.raise(CAUSE.loadMisaligned, va);
      const pa = this.dataVm ? this.translate(va, ACC_LOAD) : va;
      const v = this.physRead(pa, 4);
      if (v === undefined) this.raise(CAUSE.loadAccessFault, va);
      x[rd] = v;
      this.reservation = pa;
      return;
    }
    if ((va & 3) !== 0) this.raise(CAUSE.storeMisaligned, va);
    const pa = this.dataVm ? this.translate(va, ACC_STORE) : va;
    if (op === 62) {
      // SC.W
      const ok = this.reservation === pa;
      this.reservation = -1;
      if (ok) {
        if (!this.physWrite(pa, 4, x[rs2]!)) this.raise(CAUSE.storeAccessFault, va);
        x[rd] = 0;
      } else x[rd] = 1;
      return;
    }
    const old = this.physRead(pa, 4);
    if (old === undefined) this.raise(CAUSE.storeAccessFault, va);
    const a = old | 0;
    const b = x[rs2]!;
    let v: number;
    switch (op) {
      case 63:
        v = b;
        break;
      case 64:
        v = (a + b) | 0;
        break;
      case 65:
        v = a ^ b;
        break;
      case 66:
        v = a & b;
        break;
      case 67:
        v = a | b;
        break;
      case 68:
        v = a < b ? a : b;
        break;
      case 69:
        v = a > b ? a : b;
        break;
      case 70:
        v = a >>> 0 < b >>> 0 ? a : b;
        break;
      default:
        v = a >>> 0 > b >>> 0 ? a : b;
        break;
    }
    if (!this.physWrite(pa, 4, v)) this.raise(CAUSE.storeAccessFault, va);
    x[rd] = a;
  }

  // -------------------------------------------------------------------------
  // SYSTEM: CSRs, ECALL/EBREAK, xRET, WFI, SFENCE.VMA, illegal
  // -------------------------------------------------------------------------

  /** Execute a system instruction; returns the next pc. */
  private system(
    op: number,
    rd: number,
    rs1: number,
    rs2: number,
    imm: number,
    pc: number,
  ): number {
    const next = (pc + 4) | 0;
    switch (op) {
      case 41: // ECALL
        this.raise(
          this.priv === PRIV.M ? CAUSE.ecallM : this.priv === PRIV.S ? CAUSE.ecallS : CAUSE.ecallU,
          0,
        );
        break;
      case 42: // EBREAK
        this.raise(CAUSE.breakpoint, pc);
        break;
      case 43: {
        // MRET
        if (this.priv !== PRIV.M) this.illegal(pc);
        let s = this.mstatus;
        const mpp = ((s >>> 11) & 3) as Priv;
        s = s & MSTATUS.MPIE ? s | MSTATUS.MIE : s & ~MSTATUS.MIE;
        s = (s | MSTATUS.MPIE) & ~MSTATUS.MPP;
        if (mpp !== PRIV.M) s &= ~MSTATUS.MPRV;
        this.mstatus = s;
        this.priv = mpp;
        this.updateVm();
        return this.mepc;
      }
      case 44: {
        // SRET
        if (this.priv === PRIV.U || (this.priv === PRIV.S && (this.mstatus & MSTATUS.TSR) !== 0))
          this.illegal(pc);
        let s = this.mstatus;
        const spp = (s & MSTATUS.SPP ? PRIV.S : PRIV.U) as Priv;
        s = s & MSTATUS.SPIE ? s | MSTATUS.SIE : s & ~MSTATUS.SIE;
        s = (s | MSTATUS.SPIE) & ~MSTATUS.SPP;
        s &= ~MSTATUS.MPRV;
        this.mstatus = s;
        this.priv = spp;
        this.updateVm();
        return this.sepc;
      }
      case 45: // WFI
        if (this.priv === PRIV.U || (this.priv === PRIV.S && (this.mstatus & MSTATUS.TW) !== 0))
          this.illegal(pc);
        if ((this.mip & this.mie) === 0) this.waiting = true;
        return next;
      case 46: // SFENCE.VMA
        if (this.priv === PRIV.U || (this.priv === PRIV.S && (this.mstatus & MSTATUS.TVM) !== 0))
          this.illegal(pc);
        this.tlbTag.fill(-1);
        return next;
      case 47:
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
        this.csrInstr(op, rd, rs1, imm & 0xfff, pc);
        return next;
      default:
        this.illegal(pc);
    }
    return next;
  }

  private illegal(pc: number): never {
    // E-CPU-08: mtval holds the instruction word.
    const pa = this.fetchVm ? this.translate(pc, ACC_FETCH) : pc;
    return this.raise(CAUSE.illegalInstruction, this.physRead(pa, 4) ?? 0);
  }

  private csrInstr(op: number, rd: number, rs1: number, csr: number, pc: number): void {
    const imm = op >= 50;
    const src = imm ? rs1 : this.x[rs1]! >>> 0;
    const kind = imm ? op - 3 : op; // 47 write, 48 set, 49 clear
    const writes = kind === 47 || rs1 !== 0;
    const reads = kind !== 47 || rd !== 0;
    // Privilege and read-only checks (E-CPU-12).
    if (this.priv < ((csr >>> 8) & 3)) this.illegal(pc);
    if (writes && csr >>> 10 === 3) this.illegal(pc);
    const old = this.csrRead(csr, pc, !reads);
    if (old === undefined) this.illegal(pc);
    if (writes) {
      const v = kind === 47 ? src : kind === 48 ? old | src : old & ~src;
      if (!this.csrWrite(csr, v >>> 0, pc)) this.illegal(pc);
    }
    if (rd !== 0) this.x[rd] = old;
  }

  private counterAllowed(csr: number): boolean {
    const bit = 1 << (csr & 31);
    if (this.priv < PRIV.M && (this.mcounteren & bit) === 0) return false;
    if (this.priv < PRIV.S && (this.scounteren & bit) === 0) return false;
    return true;
  }

  /** Read a CSR. Undefined means "does not exist / not accessible" (illegal instruction). */
  private csrRead(csr: number, _pc: number, _sideEffectFree: boolean): number | undefined {
    if ((csr >= 0xc00 && csr <= 0xc1f) || (csr >= 0xc80 && csr <= 0xc9f)) {
      if (!this.counterAllowed(csr)) return undefined;
      const high = csr >= 0xc80;
      const n = csr & 31;
      let v: bigint;
      if (n === 0) v = this.mcycle64();
      else if (n === 2) v = this.minstret64();
      else if (n === 1) {
        if (!this.clint) return undefined;
        v = BigInt(this.clint.mtime) & MASK64;
      } else v = 0n;
      return Number(high ? v >> 32n : v & 0xffffffffn) >>> 0;
    }
    if (
      (csr >= 0xb03 && csr <= 0xb1f) ||
      (csr >= 0xb83 && csr <= 0xb9f) ||
      (csr >= 0x323 && csr <= 0x33f)
    )
      return 0;
    if (csr >= CSR.pmpcfg0 && csr < CSR.pmpcfg0 + 16)
      return (csr & 1) !== 0 ? undefined : this.pmpcfg[csr - CSR.pmpcfg0];
    if (csr >= CSR.pmpaddr0 && csr < CSR.pmpaddr0 + 64) return this.pmpaddr[csr - CSR.pmpaddr0];
    switch (csr) {
      case CSR.sstatus:
        return (this.mstatus & SSTATUS_MASK) >>> 0;
      case CSR.sie:
        return (this.mie & this.mideleg) >>> 0;
      case CSR.stvec:
        return this.stvec >>> 0;
      case CSR.scounteren:
        return this.scounteren >>> 0;
      case CSR.senvcfg:
        return this.senvcfg >>> 0;
      case CSR.sscratch:
        return this.sscratch >>> 0;
      case CSR.sepc:
        return this.sepc >>> 0;
      case CSR.scause:
        return this.scause >>> 0;
      case CSR.stval:
        return this.stval >>> 0;
      case CSR.sip:
        return (this.mip & this.mideleg) >>> 0;
      case CSR.satp:
        if (this.priv === PRIV.S && (this.mstatus & MSTATUS.TVM) !== 0) return undefined;
        return this.satp >>> 0;
      case CSR.mvendorid:
      case CSR.marchid:
      case CSR.mimpid:
      case CSR.mhartid:
      case CSR.mconfigptr:
        return 0;
      case CSR.mstatus:
        return this.mstatus >>> 0;
      case CSR.misa:
        return MISA;
      case CSR.medeleg:
        return this.medeleg >>> 0;
      case CSR.mideleg:
        return this.mideleg >>> 0;
      case CSR.mie:
        return this.mie >>> 0;
      case CSR.mtvec:
        return this.mtvec >>> 0;
      case CSR.mcounteren:
        return this.mcounteren >>> 0;
      case CSR.menvcfg:
        return this.menvcfg >>> 0;
      case CSR.mstatush:
      case CSR.medelegh:
      case CSR.menvcfgh:
      case CSR.mcountinhibit:
      case CSR.mtinst:
      case CSR.mtval2:
      case CSR.mseccfg:
      case CSR.mseccfgh:
        return 0;
      case CSR.mscratch:
        return this.mscratch >>> 0;
      case CSR.mepc:
        return this.mepc >>> 0;
      case CSR.mcause:
        return this.mcause >>> 0;
      case CSR.mtval:
        return this.mtval >>> 0;
      case CSR.mip:
        return this.mip >>> 0;
      case CSR.mcycle:
        return Number(this.mcycle64() & 0xffffffffn) >>> 0;
      case CSR.mcycleh:
        return Number(this.mcycle64() >> 32n) >>> 0;
      case CSR.minstret:
        return Number(this.minstret64() & 0xffffffffn) >>> 0;
      case CSR.minstreth:
        return Number(this.minstret64() >> 32n) >>> 0;
      case CSR.tselect:
      case CSR.tdata1:
      case CSR.tdata2:
      case CSR.tdata3:
        return 0;
      default:
        return undefined;
    }
  }

  /** Write a CSR (privilege already checked). Returns false for "illegal". */
  private csrWrite(csr: number, v: number, _pc: number): boolean {
    if (csr >= CSR.pmpcfg0 && csr < CSR.pmpcfg0 + 16) {
      const i = csr - CSR.pmpcfg0;
      // Locked entries ignore writes; reserved R=0,W=1 combinations are cleared.
      const old = this.pmpcfg[i] ?? 0;
      let out = 0;
      for (let b = 0; b < 4; b++) {
        const o = (old >>> (8 * b)) & 0xff;
        let n = (v >>> (8 * b)) & 0x9f;
        if (o & 0x80) n = o;
        else if ((n & 3) === 2) n &= ~3;
        out |= n << (8 * b);
      }
      this.pmpcfg[i] = out;
      return true;
    }
    if (csr >= CSR.pmpaddr0 && csr < CSR.pmpaddr0 + 64) {
      const i = csr - CSR.pmpaddr0;
      if (((this.pmpcfg[i >>> 2] ?? 0) >>> (8 * (i & 3))) & 0x80) return true;
      this.pmpaddr[i] = v;
      return true;
    }
    if (
      (csr >= 0xb03 && csr <= 0xb1f) ||
      (csr >= 0xb83 && csr <= 0xb9f) ||
      (csr >= 0x323 && csr <= 0x33f)
    )
      return true;
    switch (csr) {
      case CSR.sstatus:
        this.mstatus = (this.mstatus & ~SSTATUS_MASK) | (v & SSTATUS_MASK);
        this.updateVm();
        return true;
      case CSR.sie:
        this.mie = (this.mie & ~this.mideleg) | (v & this.mideleg & MIE_MASK);
        return true;
      case CSR.stvec:
        this.stvec = (v & 3) >= 2 ? v & ~3 : v | 0;
        return true;
      case CSR.scounteren:
        this.scounteren = v | 0;
        return true;
      case CSR.senvcfg:
        this.senvcfg = 0;
        return true;
      case CSR.sscratch:
        this.sscratch = v | 0;
        return true;
      case CSR.sepc:
        this.sepc = v & ~3;
        return true;
      case CSR.scause:
        this.scause = v | 0;
        return true;
      case CSR.stval:
        this.stval = v | 0;
        return true;
      case CSR.sip: {
        const m = MIP_SSIP & this.mideleg;
        this.mipSw = (this.mipSw & ~m) | (v & m);
        return true;
      }
      case CSR.satp:
        if (this.priv === PRIV.S && (this.mstatus & MSTATUS.TVM) !== 0) return false;
        this.satp = v & 0x803fffff;
        this.updateVm();
        return true;
      case CSR.mstatus: {
        let s = (this.mstatus & ~MSTATUS_WRITABLE) | (v & MSTATUS_WRITABLE);
        if ((s & MSTATUS.MPP) === 2 << 11) s &= ~MSTATUS.MPP; // reserved MPP -> U
        this.mstatus = s;
        this.updateVm();
        return true;
      }
      case CSR.misa:
        return true;
      case CSR.medeleg:
        this.medeleg = v & MEDELEG_MASK;
        return true;
      case CSR.mideleg:
        this.mideleg = v & MIDELEG_MASK;
        return true;
      case CSR.mie:
        this.mie = v & MIE_MASK;
        return true;
      case CSR.mtvec:
        this.mtvec = (v & 3) >= 2 ? v & ~3 : v | 0;
        return true;
      case CSR.mcounteren:
        this.mcounteren = v | 0;
        return true;
      case CSR.menvcfg:
        this.menvcfg = 0;
        return true;
      case CSR.mstatush:
      case CSR.medelegh:
      case CSR.menvcfgh:
      case CSR.mcountinhibit:
      case CSR.mtinst:
      case CSR.mtval2:
      case CSR.mseccfg:
      case CSR.mseccfgh:
        return true;
      case CSR.mscratch:
        this.mscratch = v | 0;
        return true;
      case CSR.mepc:
        this.mepc = v & ~3;
        return true;
      case CSR.mcause:
        this.mcause = v | 0;
        return true;
      case CSR.mtval:
        this.mtval = v | 0;
        return true;
      case CSR.mip: {
        const m = MIP_SSIP | MIP_STIP | MIP_SEIP;
        this.mipSw = (this.mipSw & ~m) | (v & m);
        return true;
      }
      case CSR.mcycle:
      case CSR.mcycleh: {
        const cur = this.mcycle64();
        const val =
          csr === CSR.mcycle
            ? (cur & ~0xffffffffn) | BigInt(v)
            : (cur & 0xffffffffn) | (BigInt(v) << 32n);
        // The write replaces this instruction's own increment.
        this.cycleBase = (val - BigInt(this.cycles + this.inChunk + 1)) & MASK64;
        return true;
      }
      case CSR.minstret:
      case CSR.minstreth: {
        const cur = this.minstret64();
        const val =
          csr === CSR.minstret
            ? (cur & ~0xffffffffn) | BigInt(v)
            : (cur & 0xffffffffn) | (BigInt(v) << 32n);
        this.instretBase = (val - BigInt(this.instret + this.inChunk + 1)) & MASK64;
        return true;
      }
      case CSR.tselect:
      case CSR.tdata1:
      case CSR.tdata2:
      case CSR.tdata3:
        return true;
      default:
        return false;
    }
  }
}

const EMPTY_OPS = new Uint8Array(0);
const EMPTY_I32 = new Int32Array(0);

/** Interrupt priority: MEI, MSI, MTI, SEI, SSI, STI. */
function pickInterrupt(bits: number): number {
  if (bits & MIP_MEIP) return 11;
  if (bits & MIP_MSIP) return 3;
  if (bits & MIP_MTIP) return 7;
  if (bits & MIP_SEIP) return 9;
  if (bits & MIP_SSIP) return 1;
  return 5;
}

/** Only ROM and RAM hold code; fetching from a device window is an access fault. */
function isExecutable(name: string): boolean {
  return name === 'boot-rom';
}
