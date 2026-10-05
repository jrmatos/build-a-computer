/**
 * DEV-01: the machine bus. Devices register a window of the physical address
 * space; any access that hits no window is an access fault (E-CPU-09).
 */

/** Access width in bytes. */
export type Width = 1 | 2 | 4;

/** A memory-mapped device. Offsets are relative to the device's base. */
export interface Device {
  readonly name: string;
  /** Read `width` bytes at `offset` (already aligned). Returns the zero-extended value. */
  read(offset: number, width: Width): number;
  /** Write the low `width` bytes of `value` at `offset`. Return false to raise an access fault. */
  write(offset: number, width: Width, value: number): boolean;
  /** Interrupt line level for the PLIC, if the device has one. */
  irq?(): boolean;
  /** Called on power off / reset. */
  reset?(): void;
}

/** A device mapped into the bus. */
export interface Mapping {
  readonly base: number;
  readonly size: number;
  readonly device: Device;
}

/** Physical memory map (docs/plan.md, "Machine memory map"). Matches QEMU virt where it can. */
export const MEMORY_MAP = {
  bootRom: { base: 0x0000_0000, size: 64 * 1024 },
  clint: { base: 0x0200_0000, size: 64 * 1024 },
  plic: { base: 0x0c00_0000, size: 4 * 1024 * 1024 },
  uart: { base: 0x1000_0000, size: 256 },
  keyboard: { base: 0x1000_1000, size: 256 },
  block: { base: 0x1000_2000, size: 4 * 1024 },
  fbControl: { base: 0x1000_3000, size: 4 * 1024 },
  fbPixels: { base: 0x2000_0000, size: 64_000 },
  ram: { base: 0x8000_0000, size: 16 * 1024 * 1024 },
} as const;

/** Largest RAM size the machine accepts (64 MiB). */
export const MAX_RAM = 64 * 1024 * 1024;

/** PLIC interrupt source numbers. UART matches QEMU virt. */
export const IRQ = { uart: 10, keyboard: 11, block: 12 } as const;

export class Bus {
  private readonly maps: Mapping[] = [];

  /** Map `device` at [base, base + size). Throws on overlap. */
  register(base: number, size: number, device: Device): void {
    base >>>= 0;
    const end = base + size;
    for (const m of this.maps) {
      if (base < m.base + m.size && m.base < end) {
        throw new Error(`${device.name} at 0x${base.toString(16)} overlaps ${m.device.name}`);
      }
    }
    this.maps.push({ base, size, device });
    this.maps.sort((a, b) => a.base - b.base);
  }

  /** All mappings, sorted by base address. */
  get mappings(): readonly Mapping[] {
    return this.maps;
  }

  /** The mapping that fully contains [addr, addr + width), if any. */
  find(addr: number, width: number): Mapping | undefined {
    addr >>>= 0;
    for (const m of this.maps) {
      if (addr >= m.base && addr + width <= m.base + m.size) return m;
    }
    return undefined;
  }

  /** Read; returns undefined when no device maps the address (access fault). */
  read(addr: number, width: Width): number | undefined {
    const m = this.find(addr, width);
    if (!m) return undefined;
    return m.device.read((addr >>> 0) - m.base, width) >>> 0;
  }

  /** Write; returns false on an access fault. */
  write(addr: number, width: Width, value: number): boolean {
    const m = this.find(addr, width);
    if (!m) return false;
    return m.device.write((addr >>> 0) - m.base, width, value);
  }
}

/** Byte-array backed memory (RAM, ROM, framebuffer pixels). Little-endian. */
export class MemoryDevice implements Device {
  readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(
    readonly name: string,
    size: number,
    private readonly writable = true,
  ) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  read(offset: number, width: Width): number {
    if (width === 1) return this.view.getUint8(offset);
    if (width === 2) return this.view.getUint16(offset, true);
    return this.view.getUint32(offset, true);
  }

  write(offset: number, width: Width, value: number): boolean {
    if (!this.writable) return false;
    if (width === 1) this.view.setUint8(offset, value & 0xff);
    else if (width === 2) this.view.setUint16(offset, value & 0xffff, true);
    else this.view.setUint32(offset, value >>> 0, true);
    return true;
  }
}
