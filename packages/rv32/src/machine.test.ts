import { describe, expect, it } from 'vitest';
import { asm, li, toBytes } from './asm';
import { Bus, MEMORY_MAP, MemoryDevice } from './bus';
import { RAM_BASE } from './cpu';
import { BLOCK_CMD, BLOCK_REG, FB_REG, KEYBOARD_REG, SECTOR_SIZE, UART_REG } from './devices';
import { Machine } from './machine';

const T0 = 5;
const T1 = 6;
const T2 = 7;
const A0 = 10;
const SPIN = asm('jal', 0, 0);

function boot(words: number[], m = new Machine({ ramSize: 1 << 20 })): Machine {
  m.load(RAM_BASE, toBytes([...words, SPIN]));
  m.hart.pc = RAM_BASE;
  return m;
}

describe('DEV-01 memory map', () => {
  it('matches the spec table in docs/plan.md', () => {
    const m = new Machine();
    const rows = m.bus.mappings.map((x) => [x.device.name, x.base, x.size]);
    expect(rows).toEqual([
      ['boot-rom', 0x0000_0000, 64 * 1024],
      ['clint', 0x0200_0000, 64 * 1024],
      ['plic', 0x0c00_0000, 4 * 1024 * 1024],
      ['uart', 0x1000_0000, 256],
      ['keyboard', 0x1000_1000, 256],
      ['block', 0x1000_2000, 4 * 1024],
      ['fb-control', 0x1000_3000, 4 * 1024],
      ['fb-pixels', 0x2000_0000, 320 * 200],
      ['ram', 0x8000_0000, 16 * 1024 * 1024],
    ]);
  });

  it('RAM size is configurable up to 64 MiB', () => {
    expect(new Machine({ ramSize: 64 * 1024 * 1024 }).ram.bytes.length).toBe(64 * 1024 * 1024);
    expect(() => new Machine({ ramSize: 65 * 1024 * 1024 })).toThrow();
    expect(() => new Machine({ ramSize: 1000 })).toThrow();
  });

  it('E-CPU-09: the bus reports unmapped addresses and partial overlaps as faults', () => {
    const m = new Machine();
    expect(m.bus.read(0x0001_0000, 4)).toBeUndefined(); // just past the boot ROM
    expect(m.bus.read(0x1000_00fe, 4)).toBeUndefined(); // straddles the end of the UART window
    expect(m.bus.read(MEMORY_MAP.fbPixels.base + 64_000, 1)).toBeUndefined();
    expect(m.bus.write(0x7fff_fffc, 4, 0)).toBe(false);
    expect(m.read32(RAM_BASE + 16 * 1024 * 1024)).toBeUndefined();
  });

  it('rejects overlapping registrations', () => {
    const bus = new Bus();
    bus.register(0x1000, 0x100, new MemoryDevice('a', 0x100));
    expect(() => bus.register(0x10f0, 0x100, new MemoryDevice('b', 0x100))).toThrow(/overlaps/);
  });

  it('boots from the ROM reset vector', () => {
    const m = new Machine({ ramSize: 1 << 20 });
    m.loadRom(toBytes([...li(A0, 1234), SPIN]));
    m.reset();
    expect(m.hart.pc).toBe(0);
    m.run(10);
    expect(m.hart.reg(A0)).toBe(1234);
  });
});

describe('DEV-03 UART', () => {
  it('a hello-world program prints through the transmit register', () => {
    const msg = 'Hello, world!\n';
    const out: number[] = [];
    const m = new Machine({ ramSize: 1 << 20, onUartTx: (b) => out.push(b) });
    const words = [...li(T0, MEMORY_MAP.uart.base)];
    for (const ch of msg)
      words.push(asm('addi', T1, 0, ch.charCodeAt(0)), asm('sb', T1, T0, UART_REG.rbrThr));
    boot(words, m).run(1000);
    expect(m.uart.output).toBe(msg);
    expect(String.fromCharCode(...out)).toBe(msg);
  });

  it('receives queued bytes; LSR shows data ready', () => {
    const m = boot([
      ...li(T0, MEMORY_MAP.uart.base),
      asm('lbu', A0, T0, UART_REG.lsr),
      asm('lbu', 11, T0, UART_REG.rbrThr),
      asm('lbu', 12, T0, UART_REG.lsr),
    ]);
    m.uart.receive('A');
    m.run(100);
    expect(m.hart.reg(A0) & 1).toBe(1);
    expect(m.hart.reg(A0) & 0x20).toBe(0x20);
    expect(m.hart.reg(11)).toBe(65);
    expect(m.hart.reg(12) & 1).toBe(0);
  });

  it('raises its interrupt line when rx data arrives and IER bit 0 is set', () => {
    const m = new Machine();
    m.bus.write(MEMORY_MAP.uart.base + UART_REG.ier, 1, 1);
    expect(m.uart.irq()).toBe(false);
    m.uart.receive([1]);
    expect(m.uart.irq()).toBe(true);
    expect(m.bus.read(MEMORY_MAP.uart.base + UART_REG.iirFcr, 1)! & 0x0f).toBe(0x04);
  });
});

describe('DEV-04 CLINT', () => {
  it('mtime follows executed cycles and is writable; mtimecmp has 32-bit halves', () => {
    const m = boot([asm('addi', A0, 0, 1), asm('addi', A0, 0, 1), asm('addi', A0, 0, 1)]);
    m.run(3);
    const base = MEMORY_MAP.clint.base;
    expect(m.bus.read(base + 0xbff8, 4)).toBe(3);
    m.bus.write(base + 0xbffc, 4, 1);
    expect(m.clint.mtime).toBe(2 ** 32 + 3);
    m.bus.write(base + 0x4000, 4, 0x10);
    m.bus.write(base + 0x4004, 4, 0);
    expect(m.clint.mtimecmp).toBe(0x10);
    expect(m.clint.mtip).toBe(true);
  });

  it('cyclesPerTick divides the timebase', () => {
    const m = boot([asm('jal', 0, 0)], new Machine({ ramSize: 1 << 20, cyclesPerTick: 10 }));
    m.run(95);
    expect(m.clint.mtime).toBe(9);
  });
});

describe('DEV-05 keyboard', () => {
  it('polling the status and data registers works', () => {
    const kb = MEMORY_MAP.keyboard.base;
    const m = boot([
      ...li(T0, kb),
      asm('lw', A0, T0, KEYBOARD_REG.status),
      asm('lw', 11, T0, KEYBOARD_REG.data),
    ]);
    m.keyboard.press(0x41);
    m.run(100);
    expect(m.hart.reg(A0)).toBe(1);
    expect(m.hart.reg(11)).toBe(0x41);
    expect(m.bus.read(kb, 4)).toBe(0);
  });
});

describe('DEV-07 block device', () => {
  it('write a sector, power cycle, then read back the same bytes', () => {
    const disk = new Uint8Array(SECTOR_SIZE * 8);
    const m = new Machine({ ramSize: 1 << 20, disk });
    const blk = MEMORY_MAP.block.base;
    // Guest fills the buffer with 0x5A, sector 3, command write.
    boot(
      [
        ...li(T0, blk),
        ...li(T2, 0x5a5a5a5a),
        asm('addi', T1, 0, 0),
        // loop: sw t2, 0x200(t0 + t1); t1 += 4; until 512
        asm('add', 11, T0, T1),
        asm('sw', T2, 11, BLOCK_REG.buffer),
        asm('addi', T1, T1, 4),
        asm('addi', 12, 0, 512),
        asm('blt', T1, 12, -16),
        asm('addi', T1, 0, 3),
        asm('sw', T1, T0, BLOCK_REG.sector),
        asm('addi', T1, 0, BLOCK_CMD.write),
        asm('sw', T1, T0, BLOCK_REG.command),
        asm('lw', A0, T0, BLOCK_REG.status),
      ],
      m,
    ).run(5000);
    expect(m.hart.reg(A0)).toBe(0);
    expect(disk[3 * SECTOR_SIZE]).toBe(0x5a);
    expect(disk[3 * SECTOR_SIZE + 511]).toBe(0x5a);
    expect(disk[2 * SECTOR_SIZE + 511]).toBe(0);

    m.powerCycle();
    expect(m.ram.bytes.every((b) => b === 0)).toBe(true);
    m.bus.write(blk + BLOCK_REG.sector, 4, 3);
    m.bus.write(blk + BLOCK_REG.command, 4, BLOCK_CMD.read);
    expect(m.bus.read(blk + BLOCK_REG.status, 4)).toBe(0);
    expect(m.bus.read(blk + BLOCK_REG.buffer + 508, 4)).toBe(0x5a5a5a5a);
    expect(m.bus.read(blk + BLOCK_REG.count, 4)).toBe(8);
  });

  it('an out-of-range sector sets the error status', () => {
    const m = new Machine({ disk: new Uint8Array(SECTOR_SIZE) });
    const blk = MEMORY_MAP.block.base;
    m.bus.write(blk + BLOCK_REG.sector, 4, 1);
    m.bus.write(blk + BLOCK_REG.command, 4, BLOCK_CMD.read);
    expect(m.bus.read(blk + BLOCK_REG.status, 4)).toBe(1);
  });
});

describe('DEV-06 framebuffer', () => {
  it('exposes 320x200 pixels, a palette and a control window', () => {
    const m = new Machine({ ramSize: 1 << 20 });
    const ctl = MEMORY_MAP.fbControl.base;
    expect(m.bus.read(ctl + FB_REG.width, 4)).toBe(320);
    expect(m.bus.read(ctl + FB_REG.height, 4)).toBe(200);
    boot(
      [
        ...li(T0, MEMORY_MAP.fbPixels.base),
        asm('addi', T1, 0, 15),
        asm('sb', T1, T0, 0),
        ...li(T2, 63_999),
        asm('add', T2, T0, T2),
        asm('sb', T1, T2, 0),
        ...li(T0, ctl),
        ...li(T1, 0x123456),
        asm('sw', T1, T0, FB_REG.palette + 4 * 15),
        asm('addi', T1, 0, 1),
        asm('sw', T1, T0, FB_REG.enable),
      ],
      m,
    ).run(200);
    expect(m.fbPixels.bytes[0]).toBe(15);
    expect(m.fbPixels.bytes[63_999]).toBe(15);
    expect(m.fbControl.palette[15]).toBe(0x123456);
    expect(m.fbControl.enabled).toBe(1);
  });
});

describe('determinism', () => {
  it('two machines running the same program end in identical states', () => {
    const prog = [
      ...li(T0, RAM_BASE + 0x4000),
      ...li(T1, 1000),
      asm('mul', T2, T1, T1),
      asm('xor', A0, A0, T2),
      asm('sw', A0, T0, 0),
      asm('addi', T1, T1, -1),
      asm('bne', T1, 0, -16),
    ];
    const a = boot(prog);
    const b = boot(prog);
    a.run(10_000);
    b.run(10_000);
    expect(Array.from(a.hart.x)).toEqual(Array.from(b.hart.x));
    expect(a.hart.pc).toBe(b.hart.pc);
    expect(a.read32(RAM_BASE + 0x4000)).toBe(b.read32(RAM_BASE + 0x4000));
  });
});
