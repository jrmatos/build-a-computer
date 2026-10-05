/**
 * Machine devices: CLINT, PLIC subset, UART 16550 subset, keyboard,
 * block device and framebuffer control. All deterministic: time comes from
 * the hart's cycle counter, input arrives through host calls.
 */

import type { Device, Width } from './bus';

const byteLane = (value: number, offset: number, width: Width): number => {
  // Extract `width` bytes starting at byte `offset & 3` of a 32-bit register.
  const shift = (offset & 3) * 8;
  const v = value >>> shift;
  return width === 4 ? v >>> 0 : width === 2 ? v & 0xffff : v & 0xff;
};

const mergeLane = (old: number, offset: number, width: Width, value: number): number => {
  const shift = (offset & 3) * 8;
  const mask = width === 4 ? 0xffffffff : width === 2 ? 0xffff : 0xff;
  return ((old & ~(mask << shift)) | ((value & mask) << shift)) >>> 0;
};

// ---------------------------------------------------------------------------
// CLINT
// ---------------------------------------------------------------------------

/** Register offsets inside the CLINT window (QEMU/SiFive layout). */
export const CLINT_REG = { msip: 0x0, mtimecmp: 0x4000, mtime: 0xbff8 } as const;

/**
 * Core-local interruptor: `mtime`, `mtimecmp` and `msip` for hart 0.
 * `mtime` = floor(cycles / cyclesPerTick) + offset, so it is a pure function
 * of executed instructions plus injected time (deterministic).
 */
export class Clint implements Device {
  readonly name = 'clint';
  msip = 0;
  /** mtimecmp as two 32-bit halves (exact for every 64-bit value). */
  cmpLo = 0xffffffff;
  cmpHi = 0xffffffff;
  private offset = 0;

  constructor(
    private readonly cycles: () => number,
    readonly cyclesPerTick = 1,
  ) {}

  /** mtimecmp as a number (exact below 2^53; larger values effectively never fire). */
  get mtimecmp(): number {
    return join(this.cmpLo, this.cmpHi);
  }

  set mtimecmp(v: number) {
    this.cmpLo = lo32(v);
    this.cmpHi = hi32(v);
  }

  get mtime(): number {
    return Math.floor(this.cycles() / this.cyclesPerTick) + this.offset;
  }

  set mtime(v: number) {
    this.offset = v - Math.floor(this.cycles() / this.cyclesPerTick);
  }

  /** Inject `ticks` of time (e.g. to skip an idle WFI). */
  advance(ticks: number): void {
    this.offset += ticks;
  }

  /** Machine timer interrupt pending. */
  get mtip(): boolean {
    return this.mtime >= this.mtimecmp;
  }

  /** Cycles until mtip becomes true (Infinity if never, 0 if already). */
  cyclesUntilTimer(): number {
    const ticks = this.mtimecmp - this.mtime;
    if (ticks <= 0) return 0;
    if (!Number.isFinite(ticks) || ticks > 2 ** 52) return Infinity;
    // Cycles needed for floor(c / cpt) to grow by `ticks`, from the current cycle.
    const c = this.cycles();
    const target = (Math.floor(c / this.cyclesPerTick) + ticks) * this.cyclesPerTick;
    return target - c;
  }

  read(offset: number, width: Width): number {
    const base = offset & ~3;
    let reg: number;
    if (base === CLINT_REG.msip) reg = this.msip;
    else if (base === CLINT_REG.mtimecmp) reg = this.cmpLo;
    else if (base === CLINT_REG.mtimecmp + 4) reg = this.cmpHi;
    else if (base === CLINT_REG.mtime) reg = lo32(this.mtime);
    else if (base === CLINT_REG.mtime + 4) reg = hi32(this.mtime);
    else reg = 0;
    return byteLane(reg, offset, width);
  }

  write(offset: number, width: Width, value: number): boolean {
    const base = offset & ~3;
    if (base === CLINT_REG.msip) this.msip = mergeLane(this.msip, offset, width, value) & 1;
    else if (base === CLINT_REG.mtimecmp) this.cmpLo = mergeLane(this.cmpLo, offset, width, value);
    else if (base === CLINT_REG.mtimecmp + 4)
      this.cmpHi = mergeLane(this.cmpHi, offset, width, value);
    else if (base === CLINT_REG.mtime) {
      this.mtime = join(mergeLane(lo32(this.mtime), offset, width, value), hi32(this.mtime));
    } else if (base === CLINT_REG.mtime + 4) {
      this.mtime = join(lo32(this.mtime), mergeLane(hi32(this.mtime), offset, width, value));
    }
    return true;
  }

  reset(): void {
    this.msip = 0;
    this.cmpLo = this.cmpHi = 0xffffffff;
    this.offset = -Math.floor(this.cycles() / this.cyclesPerTick);
  }
}

const lo32 = (v: number): number => (v >= 2 ** 64 ? 0xffffffff : v % 2 ** 32) >>> 0;
const hi32 = (v: number): number =>
  (v >= 2 ** 64 ? 0xffffffff : Math.floor(v / 2 ** 32) % 2 ** 32) >>> 0;
const join = (lo: number, hi: number): number => hi * 2 ** 32 + lo;

// ---------------------------------------------------------------------------
// PLIC
// ---------------------------------------------------------------------------

/** Number of PLIC sources supported (ids 1..31). */
export const PLIC_SOURCES = 32;
/** PLIC contexts: 0 = hart 0 machine mode, 1 = hart 0 supervisor mode. */
export const PLIC_CONTEXTS = 2;

/**
 * Platform-level interrupt controller subset (QEMU virt layout): priorities at
 * 4*id, pending bits at 0x1000, enables at 0x2000 + 0x80*ctx, threshold at
 * 0x200000 + 0x1000*ctx and claim/complete 4 bytes after it. Level-triggered.
 */
export class Plic implements Device {
  readonly name = 'plic';
  readonly priority = new Uint32Array(PLIC_SOURCES);
  readonly enable = new Uint32Array(PLIC_CONTEXTS);
  readonly threshold = new Uint32Array(PLIC_CONTEXTS);
  private inService = 0;
  private readonly lines: (() => boolean)[] = [];

  /** Connect a device's interrupt line to source `id`. */
  connect(id: number, line: () => boolean): void {
    this.lines[id] = line;
  }

  /** Bitmask of sources whose line is high and that are not being serviced. */
  pending(): number {
    let p = 0;
    for (let id = 1; id < PLIC_SOURCES; id++) {
      const line = this.lines[id];
      if (line && line()) p |= 1 << id;
    }
    return (p & ~this.inService) >>> 0;
  }

  private best(ctx: number): number {
    const p = this.pending() & (this.enable[ctx] ?? 0);
    let bestId = 0;
    let bestPri = this.threshold[ctx] ?? 0;
    for (let id = 1; id < PLIC_SOURCES; id++) {
      if (p & (1 << id) && (this.priority[id] ?? 0) > bestPri) {
        bestId = id;
        bestPri = this.priority[id] ?? 0;
      }
    }
    return bestId;
  }

  /** Interrupt output for a context (MEIP for 0, SEIP for 1). */
  output(ctx: number): boolean {
    return this.best(ctx) !== 0;
  }

  read(offset: number, width: Width): number {
    const base = offset & ~3;
    let reg = 0;
    if (base < 0x1000) reg = this.priority[base >>> 2] ?? 0;
    else if (base === 0x1000) reg = this.pending();
    else if (base >= 0x2000 && base < 0x2000 + 0x80 * PLIC_CONTEXTS && (base & 0x7f) === 0) {
      reg = this.enable[(base - 0x2000) >>> 7] ?? 0;
    } else if (base >= 0x200000) {
      const ctx = (base - 0x200000) >>> 12;
      const r = base & 0xfff;
      if (ctx < PLIC_CONTEXTS) {
        if (r === 0) reg = this.threshold[ctx] ?? 0;
        else if (r === 4) {
          reg = this.best(ctx);
          if (reg) this.inService |= 1 << reg;
        }
      }
    }
    return byteLane(reg, offset, width);
  }

  write(offset: number, width: Width, value: number): boolean {
    const base = offset & ~3;
    const v = mergeLane(0, offset, width, value);
    if (base < 0x1000) {
      const id = base >>> 2;
      if (id > 0 && id < PLIC_SOURCES) this.priority[id] = v & 7;
    } else if (base >= 0x2000 && base < 0x2000 + 0x80 * PLIC_CONTEXTS && (base & 0x7f) === 0) {
      this.enable[(base - 0x2000) >>> 7] = v & ~1;
    } else if (base >= 0x200000) {
      const ctx = (base - 0x200000) >>> 12;
      const r = base & 0xfff;
      if (ctx < PLIC_CONTEXTS) {
        if (r === 0) this.threshold[ctx] = v & 7;
        else if (r === 4 && v > 0 && v < PLIC_SOURCES) this.inService &= ~(1 << v);
      }
    }
    return true;
  }

  reset(): void {
    this.priority.fill(0);
    this.enable.fill(0);
    this.threshold.fill(0);
    this.inService = 0;
  }
}

// ---------------------------------------------------------------------------
// UART 16550 subset
// ---------------------------------------------------------------------------

/** 16550 register offsets. */
export const UART_REG = {
  rbrThr: 0,
  ier: 1,
  iirFcr: 2,
  lcr: 3,
  mcr: 4,
  lsr: 5,
  msr: 6,
  scr: 7,
} as const;

/**
 * UART, 16550 subset: byte registers, transmit goes to `onTx` and a buffer,
 * receive comes from a queue filled by the host with `receive()`.
 * Interrupts: received data available (IER bit 0) and THR empty (IER bit 1).
 */
export class Uart implements Device {
  readonly name = 'uart';
  /** Every byte the guest transmitted, in order. */
  readonly txLog: number[] = [];
  private rx: number[] = [];
  private ier = 0;
  private lcr = 0;
  private mcr = 0;
  private scr = 0;
  private dll = 0;
  private dlm = 0;
  private fifo = false;
  private threPending = false;

  constructor(public onTx: (byte: number) => void = () => {}) {}

  /** Queue bytes for the guest to read. */
  receive(bytes: Iterable<number> | string): void {
    if (typeof bytes === 'string') for (const b of new TextEncoder().encode(bytes)) this.rx.push(b);
    else for (const b of bytes) this.rx.push(b & 0xff);
  }

  /** Transmitted bytes decoded as UTF-8. */
  get output(): string {
    return new TextDecoder().decode(new Uint8Array(this.txLog));
  }

  irq(): boolean {
    return (
      ((this.ier & 1) !== 0 && this.rx.length > 0) || ((this.ier & 2) !== 0 && this.threPending)
    );
  }

  read(offset: number, _width: Width): number {
    const dlab = (this.lcr & 0x80) !== 0;
    switch (offset & 7) {
      case UART_REG.rbrThr:
        if (dlab) return this.dll;
        return this.rx.shift() ?? 0;
      case UART_REG.ier:
        return dlab ? this.dlm : this.ier;
      case UART_REG.iirFcr: {
        const fifoBits = this.fifo ? 0xc0 : 0;
        if ((this.ier & 1) !== 0 && this.rx.length > 0) return fifoBits | 0x04;
        if ((this.ier & 2) !== 0 && this.threPending) {
          this.threPending = false;
          return fifoBits | 0x02;
        }
        return fifoBits | 0x01;
      }
      case UART_REG.lcr:
        return this.lcr;
      case UART_REG.mcr:
        return this.mcr;
      case UART_REG.lsr:
        return (this.rx.length > 0 ? 0x01 : 0) | 0x60;
      case UART_REG.msr:
        return 0xb0;
      default:
        return this.scr;
    }
  }

  write(offset: number, _width: Width, value: number): boolean {
    const v = value & 0xff;
    const dlab = (this.lcr & 0x80) !== 0;
    switch (offset & 7) {
      case UART_REG.rbrThr:
        if (dlab) this.dll = v;
        else {
          this.txLog.push(v);
          this.onTx(v);
          this.threPending = true;
        }
        break;
      case UART_REG.ier:
        if (dlab) this.dlm = v;
        else {
          if ((v & 2) !== 0 && (this.ier & 2) === 0) this.threPending = true;
          this.ier = v & 0x0f;
        }
        break;
      case UART_REG.iirFcr:
        this.fifo = (v & 1) !== 0;
        if (v & 2) this.rx = [];
        break;
      case UART_REG.lcr:
        this.lcr = v;
        break;
      case UART_REG.mcr:
        this.mcr = v & 0x1f;
        break;
      case UART_REG.scr:
        this.scr = v;
        break;
    }
    return true;
  }

  reset(): void {
    this.rx = [];
    this.ier = this.lcr = this.mcr = this.scr = this.dll = this.dlm = 0;
    this.fifo = this.threPending = false;
  }
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

/** Keyboard register offsets. */
export const KEYBOARD_REG = { status: 0x0, data: 0x4, control: 0x8 } as const;

/**
 * Keyboard: a queue of key codes. `status` bit 0 = data ready; reading `data`
 * pops one code (0 when empty); `control` bit 0 enables the interrupt.
 */
export class Keyboard implements Device {
  readonly name = 'keyboard';
  private queue: number[] = [];
  private control = 0;

  /** Host: a key was pressed (code is device-defined; ASCII for printable keys). */
  press(code: number): void {
    this.queue.push(code >>> 0);
  }

  irq(): boolean {
    return (this.control & 1) !== 0 && this.queue.length > 0;
  }

  read(offset: number, width: Width): number {
    const base = offset & ~3;
    let reg = 0;
    if (base === KEYBOARD_REG.status) reg = this.queue.length > 0 ? 1 : 0;
    else if (base === KEYBOARD_REG.data) reg = (offset & 3) === 0 ? (this.queue.shift() ?? 0) : 0;
    else if (base === KEYBOARD_REG.control) reg = this.control;
    return byteLane(reg, offset, width);
  }

  write(offset: number, width: Width, value: number): boolean {
    if ((offset & ~3) === KEYBOARD_REG.control)
      this.control = mergeLane(this.control, offset, width, value) & 1;
    return true;
  }

  reset(): void {
    this.queue = [];
    this.control = 0;
  }
}

// ---------------------------------------------------------------------------
// Block device
// ---------------------------------------------------------------------------

export const SECTOR_SIZE = 512;
/** Block device register offsets; the sector buffer is at `buffer`..+512. */
export const BLOCK_REG = {
  sector: 0x0,
  command: 0x4,
  status: 0x8,
  count: 0xc,
  buffer: 0x200,
} as const;
/** Values written to `command`. */
export const BLOCK_CMD = { read: 1, write: 2 } as const;

/**
 * Block device with 512-byte sectors, programmed I/O: set `sector`, write a
 * command, then read or fill the 512-byte buffer. `status` 0 = ok, 1 = error.
 * Storage is non-volatile: `reset()` keeps it.
 */
export class BlockDevice implements Device {
  readonly name = 'block';
  readonly buffer = new Uint8Array(SECTOR_SIZE);
  private sector = 0;
  private status = 0;

  constructor(readonly storage: Uint8Array = new Uint8Array(0)) {
    if (storage.length % SECTOR_SIZE !== 0)
      throw new Error('block storage must be a multiple of 512 bytes');
  }

  get sectorCount(): number {
    return this.storage.length / SECTOR_SIZE;
  }

  read(offset: number, width: Width): number {
    if (offset >= BLOCK_REG.buffer && offset + width <= BLOCK_REG.buffer + SECTOR_SIZE) {
      const o = offset - BLOCK_REG.buffer;
      let v = 0;
      for (let i = width - 1; i >= 0; i--) v = (v << 8) | (this.buffer[o + i] ?? 0);
      return v >>> 0;
    }
    const base = offset & ~3;
    let reg = 0;
    if (base === BLOCK_REG.sector) reg = this.sector;
    else if (base === BLOCK_REG.status) reg = this.status;
    else if (base === BLOCK_REG.count) reg = this.sectorCount;
    return byteLane(reg, offset, width);
  }

  write(offset: number, width: Width, value: number): boolean {
    if (offset >= BLOCK_REG.buffer && offset + width <= BLOCK_REG.buffer + SECTOR_SIZE) {
      const o = offset - BLOCK_REG.buffer;
      for (let i = 0; i < width; i++) this.buffer[o + i] = (value >>> (8 * i)) & 0xff;
      return true;
    }
    const base = offset & ~3;
    if (base === BLOCK_REG.sector) this.sector = mergeLane(this.sector, offset, width, value);
    else if (base === BLOCK_REG.command) this.execute(value & 0xff);
    return true;
  }

  private execute(cmd: number): void {
    if (this.sector >= this.sectorCount || (cmd !== BLOCK_CMD.read && cmd !== BLOCK_CMD.write)) {
      this.status = 1;
      return;
    }
    const at = this.sector * SECTOR_SIZE;
    if (cmd === BLOCK_CMD.read) this.buffer.set(this.storage.subarray(at, at + SECTOR_SIZE));
    else this.storage.set(this.buffer, at);
    this.status = 0;
  }

  reset(): void {
    this.sector = 0;
    this.status = 0;
    this.buffer.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Framebuffer control
// ---------------------------------------------------------------------------

export const FB_WIDTH = 320;
export const FB_HEIGHT = 200;
/** Framebuffer control offsets; the 256-entry palette (0x00RRGGBB) starts at `palette`. */
export const FB_REG = { width: 0x0, height: 0x4, enable: 0x8, frame: 0xc, palette: 0x400 } as const;

/** Default palette: 16 CGA colors, a 6x6x6 color cube, then a gray ramp. */
export function defaultPalette(): Uint32Array {
  const p = new Uint32Array(256);
  const cga = [
    0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xaa5500, 0xaaaaaa, 0x555555,
    0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff,
  ];
  cga.forEach((c, i) => (p[i] = c));
  for (let i = 0; i < 216; i++) {
    const r = Math.floor(i / 36) * 51;
    const g = (Math.floor(i / 6) % 6) * 51;
    const b = (i % 6) * 51;
    p[16 + i] = (r << 16) | (g << 8) | b;
  }
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    p[232 + i] = (v << 16) | (v << 8) | v;
  }
  return p;
}

/**
 * Framebuffer control: read-only width/height, an enable flag, a frame
 * counter the host bumps on each presented frame, and the palette.
 * Pixels live in a separate MemoryDevice at 0x2000_0000.
 */
export class FramebufferControl implements Device {
  readonly name = 'fb-control';
  palette = defaultPalette();
  enabled = 0;
  frame = 0;

  read(offset: number, width: Width): number {
    const base = offset & ~3;
    let reg = 0;
    if (base === FB_REG.width) reg = FB_WIDTH;
    else if (base === FB_REG.height) reg = FB_HEIGHT;
    else if (base === FB_REG.enable) reg = this.enabled;
    else if (base === FB_REG.frame) reg = this.frame;
    else if (base >= FB_REG.palette && base < FB_REG.palette + 1024)
      reg = this.palette[(base - FB_REG.palette) >>> 2] ?? 0;
    return byteLane(reg, offset, width);
  }

  write(offset: number, width: Width, value: number): boolean {
    const base = offset & ~3;
    if (base === FB_REG.enable) this.enabled = mergeLane(this.enabled, offset, width, value) & 1;
    else if (base >= FB_REG.palette && base < FB_REG.palette + 1024) {
      const i = (base - FB_REG.palette) >>> 2;
      this.palette[i] = mergeLane(this.palette[i] ?? 0, offset, width, value) & 0xffffff;
    }
    return true;
  }

  reset(): void {
    this.palette = defaultPalette();
    this.enabled = 0;
    this.frame = 0;
  }
}
