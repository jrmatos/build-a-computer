/**
 * DEV-01: the whole machine — bus, memory map, devices and one hart — wired
 * exactly as the "Machine memory map" table in docs/plan.md.
 */

import { Bus, IRQ, MAX_RAM, MEMORY_MAP, MemoryDevice } from './bus';
import { Hart, type RunResult } from './cpu';
import { BlockDevice, Clint, FramebufferControl, Keyboard, Plic, Uart } from './devices';

export interface MachineOptions {
  /** RAM size in bytes (default 16 MiB, max 64 MiB, multiple of 4 KiB). */
  ramSize?: number;
  /** Cycles per CLINT mtime tick (default 1). */
  cyclesPerTick?: number;
  /** Block device storage (multiple of 512 bytes). Kept across power cycles. */
  disk?: Uint8Array;
  /** Called for every byte the guest writes to the UART. */
  onUartTx?: (byte: number) => void;
  /** Reset vector (default 0x0000_0000, the boot ROM). */
  resetVector?: number;
  /** Skip idle time while parked in WFI with the timer armed (default true). */
  idleSkip?: boolean;
  /** Misaligned data accesses: 'trap' (default, E-CPU-05) or 'emulate'. */
  misaligned?: 'trap' | 'emulate';
}

export class Machine {
  readonly bus = new Bus();
  readonly rom: MemoryDevice;
  readonly ram: MemoryDevice;
  readonly clint: Clint;
  readonly plic = new Plic();
  readonly uart: Uart;
  readonly keyboard = new Keyboard();
  readonly block: BlockDevice;
  readonly fbControl = new FramebufferControl();
  readonly fbPixels: MemoryDevice;
  readonly hart: Hart;

  constructor(opts: MachineOptions = {}) {
    const ramSize = opts.ramSize ?? MEMORY_MAP.ram.size;
    if (ramSize <= 0 || ramSize > MAX_RAM || ramSize % 4096 !== 0) {
      throw new Error(`RAM size must be a multiple of 4 KiB up to ${MAX_RAM} bytes`);
    }
    const map = MEMORY_MAP;
    this.rom = new MemoryDevice('boot-rom', map.bootRom.size, false);
    this.ram = new MemoryDevice('ram', ramSize);
    this.fbPixels = new MemoryDevice('fb-pixels', map.fbPixels.size);
    this.uart = new Uart(opts.onUartTx);
    this.block = new BlockDevice(opts.disk);
    // The CLINT reads the hart's cycle counter; the hart is created below.
    this.clint = new Clint(() => this.hart.cycleNow(), opts.cyclesPerTick ?? 1);

    this.bus.register(map.bootRom.base, map.bootRom.size, this.rom);
    this.bus.register(map.clint.base, map.clint.size, this.clint);
    this.bus.register(map.plic.base, map.plic.size, this.plic);
    this.bus.register(map.uart.base, map.uart.size, this.uart);
    this.bus.register(map.keyboard.base, map.keyboard.size, this.keyboard);
    this.bus.register(map.block.base, map.block.size, this.block);
    this.bus.register(map.fbControl.base, map.fbControl.size, this.fbControl);
    this.bus.register(map.fbPixels.base, map.fbPixels.size, this.fbPixels);
    this.bus.register(map.ram.base, ramSize, this.ram);

    this.plic.connect(IRQ.uart, () => this.uart.irq());
    this.plic.connect(IRQ.keyboard, () => this.keyboard.irq());

    this.hart = new Hart({
      bus: this.bus,
      ram: this.ram.bytes,
      clint: this.clint,
      plic: this.plic,
      resetVector: opts.resetVector ?? map.bootRom.base,
      idleSkip: opts.idleSkip ?? true,
      misaligned: opts.misaligned ?? 'trap',
    });
  }

  /** Copy bytes into the boot ROM (host only; the guest cannot write ROM). */
  loadRom(bytes: Uint8Array, offset = 0): void {
    this.rom.bytes.set(bytes, offset);
    this.hart.flushDecodeCache();
  }

  /** Copy bytes into physical memory (RAM, ROM or framebuffer) and drop stale decodes. */
  load(addr: number, bytes: Uint8Array): void {
    addr >>>= 0;
    const m = this.bus.find(addr, bytes.length);
    if (!m || !(m.device instanceof MemoryDevice))
      throw new Error(`cannot load at 0x${addr.toString(16)}`);
    m.device.bytes.set(bytes, addr - m.base);
    this.hart.invalidateRange(addr, bytes.length);
  }

  /** Read bytes from a memory region (RAM, ROM or framebuffer). */
  readBytes(addr: number, length: number): Uint8Array {
    addr >>>= 0;
    const m = this.bus.find(addr, length);
    if (!m || !(m.device instanceof MemoryDevice))
      throw new Error(`cannot read at 0x${addr.toString(16)}`);
    return m.device.bytes.slice(addr - m.base, addr - m.base + length);
  }

  /** Read a 32-bit word from physical memory, or undefined if unmapped. */
  read32(addr: number): number | undefined {
    return this.hart.physRead(addr | 0, 4);
  }

  /** Write a 32-bit word to physical memory (host). */
  write32(addr: number, value: number): boolean {
    return this.hart.physWrite(addr | 0, 4, value);
  }

  /** Run up to `steps` steps. */
  run(steps: number): RunResult {
    return this.hart.run(steps);
  }

  /** Reset button: devices back to power-on state (block storage kept), hart to the reset vector. */
  reset(): void {
    for (const m of this.bus.mappings) m.device.reset?.();
    this.hart.reset();
  }

  /** Power cycle: clear RAM, registers and framebuffer; keep ROM and disk. */
  powerCycle(): void {
    this.ram.bytes.fill(0);
    this.fbPixels.bytes.fill(0);
    this.hart.x.fill(0);
    this.hart.flushDecodeCache();
    this.reset();
  }
}
