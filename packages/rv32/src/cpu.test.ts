import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { asm, li, toBytes } from './asm';
import { MEMORY_MAP } from './bus';
import { mulh32, mulhsu32, mulhu32, RAM_BASE } from './cpu';
import { CAUSE, CSR, MSTATUS } from './csr';
import { Machine, type MachineOptions } from './machine';
import { mulh, mulhu } from '@build-a-computer/det';

const SEED = 0x5eed_0002;
const T0 = 5;
const T1 = 6;
const T2 = 7;
const A0 = 10;
const A1 = 11;
const A2 = 12;
const HANDLER = RAM_BASE + 0x1000;
const SPIN = asm('jal', 0, 0);

const csrw = (csr: number, rs: number): number => asm('csrrw', 0, csr, rs);
const csrr = (rd: number, csr: number): number => asm('csrrs', rd, csr, 0);

/** Machine with `body` at RAM_BASE, mtvec -> a spin loop at HANDLER. */
function boot(body: number[], opts: MachineOptions = {}): Machine {
  const m = new Machine({ ramSize: 1 << 20, ...opts });
  const words = [...li(T0, HANDLER), csrw(CSR.mtvec, T0), ...body, SPIN];
  m.load(RAM_BASE, toBytes(words));
  m.load(HANDLER, toBytes([SPIN]));
  m.hart.pc = RAM_BASE;
  return m;
}

/** Address of body word `i` (after the 3-word mtvec prologue). */
const at = (i: number): number => RAM_BASE + 12 + 4 * i;

function runToHandler(m: Machine, steps = 10_000): void {
  m.run(steps);
  expect(m.hart.pc.toString(16)).toBe(HANDLER.toString(16));
}

/** Run a single R-type op on (a, b) and return rd as unsigned. */
function rop(name: string, a: number, b: number): number {
  const m = boot([...li(A1, a), ...li(A2, b), asm(name, A0, A1, A2)]);
  m.run(200);
  return m.hart.reg(A0);
}

const BOUNDARY = [0, 1, -1, 0x7fffffff, 0x80000000 | 0, 2, -2, 0x12345678, 31, 32];

/** BigInt reference for every R-type op (RV32IM). */
function refOp(name: string, a: number, b: number): number {
  const sa = BigInt(a | 0);
  const sb = BigInt(b | 0);
  const ua = BigInt(a >>> 0);
  const ub = BigInt(b >>> 0);
  const u = (v: bigint): number => Number(BigInt.asUintN(32, v));
  const sh = BigInt(b & 31);
  switch (name) {
    case 'add':
      return u(sa + sb);
    case 'sub':
      return u(sa - sb);
    case 'sll':
      return u(ua << sh);
    case 'slt':
      return sa < sb ? 1 : 0;
    case 'sltu':
      return ua < ub ? 1 : 0;
    case 'xor':
      return u(ua ^ ub);
    case 'srl':
      return u(ua >> sh);
    case 'sra':
      return u(sa >> sh);
    case 'or':
      return u(ua | ub);
    case 'and':
      return u(ua & ub);
    case 'mul':
      return u(sa * sb);
    case 'mulh':
      return u((sa * sb) >> 32n);
    case 'mulhsu':
      return u((sa * ub) >> 32n);
    case 'mulhu':
      return u((ua * ub) >> 32n);
    case 'div':
      if (sb === 0n) return 0xffffffff;
      if (sa === -(2n ** 31n) && sb === -1n) return u(sa);
      return u(sa / sb);
    case 'divu':
      return ub === 0n ? 0xffffffff : u(ua / ub);
    case 'rem':
      if (sb === 0n) return u(sa);
      if (sa === -(2n ** 31n) && sb === -1n) return 0;
      return u(sa % sb);
    case 'remu':
      return ub === 0n ? u(ua) : u(ua % ub);
  }
  throw new Error(name);
}

const R_OPS = ['add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and'];
const M_OPS = ['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu'];

describe('RV-02 base integer behavior', () => {
  it('E-CPU-01: writes to x0 are ignored and x0 always reads 0', () => {
    const m = boot([
      asm('addi', 0, 0, 5),
      asm('lui', 0, 0x12345000),
      asm('lw', 0, T0, 0), // load into x0 still performs the access
      asm('jal', 0, 4),
      asm('add', A0, 0, 0),
      asm('addi', A1, 0, 7),
    ]);
    m.run(200);
    expect(m.hart.x[0]).toBe(0);
    expect(m.hart.reg(A0)).toBe(0);
    expect(m.hart.reg(A1)).toBe(7);
  });

  it('E-CPU-02: RV32I ALU ops match a BigInt model at 0, 1, -1, 0x7FFFFFFF, 0x80000000', () => {
    for (const name of R_OPS)
      for (const a of BOUNDARY)
        for (const b of BOUNDARY) {
          expect([name, a, b, rop(name, a, b)]).toEqual([name, a, b, refOp(name, a, b)]);
        }
  });

  it('E-CPU-02: immediate ops and compares at the boundaries', () => {
    for (const a of BOUNDARY) {
      const m = boot([
        ...li(A1, a),
        asm('addi', A0, A1, -1),
        asm('slti', A2, A1, -1),
        asm('sltiu', 13, A1, -1),
        asm('srai', 14, A1, 31),
        asm('srli', 15, A1, 31),
        asm('slli', 16, A1, 31),
        asm('xori', 17, A1, -1),
      ]);
      m.run(200);
      expect(m.hart.reg(A0)).toBe((a - 1) >>> 0);
      expect(m.hart.reg(A2)).toBe((a | 0) < -1 ? 1 : 0);
      expect(m.hart.reg(13)).toBe(a >>> 0 < 0xffffffff ? 1 : 0);
      expect(m.hart.reg(14)).toBe((a >> 31) >>> 0);
      expect(m.hart.reg(15)).toBe(a >>> 31);
      expect(m.hart.reg(16)).toBe((a << 31) >>> 0);
      expect(m.hart.reg(17)).toBe(~a >>> 0);
    }
  });

  it('E-CPU-02: random operands match the BigInt model (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...R_OPS, ...M_OPS),
        fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
        fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
        (name, a, b) => rop(name, a, b) === refOp(name, a, b),
      ),
      { seed: SEED, numRuns: 2000 },
    );
  });

  it('loads sign- and zero-extend; stores write the low bytes', () => {
    const data = RAM_BASE + 0x2000;
    const m = boot([
      ...li(T1, data),
      ...li(T2, 0x8081f2f3 | 0),
      asm('sw', T2, T1, 0),
      asm('lb', A0, T1, 0),
      asm('lbu', A1, T1, 0),
      asm('lh', A2, T1, 2),
      asm('lhu', 13, T1, 2),
      asm('sb', T2, T1, 4),
      asm('sh', T2, T1, 6),
      asm('lw', 14, T1, 4),
    ]);
    m.run(200);
    expect(m.hart.reg(A0)).toBe(0xfffffff3);
    expect(m.hart.reg(A1)).toBe(0xf3);
    expect(m.hart.reg(A2)).toBe(0xffff8081);
    expect(m.hart.reg(13)).toBe(0x8081);
    expect(m.hart.reg(14)).toBe(0xf2f300f3);
  });

  it('lui, auipc, jal and jalr link correctly', () => {
    const m = boot([
      asm('auipc', A0, 0x1000),
      asm('jal', A1, 8),
      asm('addi', A2, 0, 1),
      asm('jalr', 13, A1, 8),
    ]);
    m.run(200);
    expect(m.hart.reg(A0)).toBe(at(0) + 0x1000);
    expect(m.hart.reg(A1)).toBe(at(2));
    expect(m.hart.reg(A2)).toBe(0); // skipped
    expect(m.hart.reg(13)).toBe(at(4));
    expect(m.hart.pc).toBe(at(2) + 8);
  });

  it('E-CPU-06: JALR clears the lowest bit of the target', () => {
    const m = boot([
      ...li(T1, at(4) + 1),
      asm('jalr', A0, T1, 0),
      asm('addi', A1, 0, 1),
      asm('addi', A2, 0, 2),
    ]);
    m.run(200);
    expect(m.hart.reg(A1)).toBe(0);
    expect(m.hart.reg(A2)).toBe(2);
    expect(m.hart.reg(A0)).toBe(at(3));
  });

  it('E-CPU-06: JALR to target+3 clears bit 0 then traps on bit 1', () => {
    const m = boot([...li(T1, at(4)), asm('jalr', A0, T1, 3)]);
    runToHandler(m);
    expect(m.hart.mcause).toBe(CAUSE.instMisaligned);
    expect(m.hart.mtval >>> 0).toBe(at(4) + 2);
    expect(m.hart.reg(A0)).toBe(0); // rd not written when the jump traps
  });

  it('E-CPU-07: a branch to an address not divisible by 4 raises instruction-address-misaligned', () => {
    const m = boot([asm('beq', 0, 0, 6)]);
    runToHandler(m);
    expect(m.hart.mcause).toBe(CAUSE.instMisaligned);
    expect(m.hart.mepc >>> 0).toBe(at(0));
    expect(m.hart.mtval >>> 0).toBe(at(0) + 6);
  });

  it('E-CPU-07: a not-taken misaligned branch does not trap; JAL misaligned traps without linking', () => {
    const m = boot([asm('bne', 0, 0, 6), asm('jal', A0, 2)]);
    runToHandler(m);
    expect(m.hart.mepc >>> 0).toBe(at(1));
    expect(m.hart.mcause).toBe(CAUSE.instMisaligned);
    expect(m.hart.reg(A0)).toBe(0);
  });
});

describe('RV-03 M extension', () => {
  it('E-CPU-03: division by zero gives all ones / the dividend, without a trap', () => {
    for (const a of BOUNDARY) {
      expect(rop('div', a, 0)).toBe(0xffffffff);
      expect(rop('divu', a, 0)).toBe(0xffffffff);
      expect(rop('rem', a, 0)).toBe(a >>> 0);
      expect(rop('remu', a, 0)).toBe(a >>> 0);
    }
    const m = boot([asm('div', A0, A1, 0)]);
    m.run(200);
    expect(m.hart.mcause).toBe(0);
    expect(m.hart.pc).toBe(at(1));
  });

  it('E-CPU-04: most negative integer divided by -1 gives the dividend and remainder 0', () => {
    expect(rop('div', 0x80000000 | 0, -1)).toBe(0x80000000);
    expect(rop('rem', 0x80000000 | 0, -1)).toBe(0);
    expect(rop('divu', 0x80000000 | 0, -1)).toBe(0);
    expect(rop('remu', 0x80000000 | 0, -1)).toBe(0x80000000);
  });

  it('E-CPU-02: M ops match the BigInt model at the boundaries', () => {
    for (const name of M_OPS)
      for (const a of BOUNDARY)
        for (const b of BOUNDARY) {
          expect([name, a, b, rop(name, a, b)]).toEqual([name, a, b, refOp(name, a, b)]);
        }
  });

  it('fast high-multiply helpers agree with @build-a-computer/det', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 0xffffffff }),
        (a, b) => {
          expect(mulhu32(a, b)).toBe(mulhu(a, b));
          expect(mulh32(a | 0, b | 0)).toBe(mulh(a, b));
          expect(mulhsu32(a | 0, b)).toBe(
            Number(BigInt.asUintN(32, (BigInt(a | 0) * BigInt(b)) >> 32n)),
          );
        },
      ),
      { seed: SEED, numRuns: 5000 },
    );
  });
});

describe('RV-02/DEV-02 traps', () => {
  it('E-CPU-05: misaligned load and store trap with the misaligned cause and address', () => {
    const cases: [string, number, number][] = [
      ['lw', 2, CAUSE.loadMisaligned],
      ['lh', 1, CAUSE.loadMisaligned],
      ['lhu', 3, CAUSE.loadMisaligned],
      ['sw', 1, CAUSE.storeMisaligned],
      ['sh', 1, CAUSE.storeMisaligned],
    ];
    for (const [name, off, cause] of cases) {
      const addr = RAM_BASE + 0x2000 + off;
      const m = boot([...li(T1, addr - off), asm(name, A0, T1, off)]);
      runToHandler(m);
      expect([name, m.hart.mcause]).toEqual([name, cause]);
      expect(m.hart.mtval >>> 0).toBe(addr);
      expect(m.hart.mepc >>> 0).toBe(at(2));
    }
  });

  it('E-CPU-05: AMOs and LR/SC trap when misaligned', () => {
    const m = boot([...li(T1, RAM_BASE + 0x2002), asm('amoadd.w', A0, A1, T1)]);
    runToHandler(m);
    expect(m.hart.mcause).toBe(CAUSE.storeMisaligned);
  });

  it('misaligned accesses work with the optional emulate policy', () => {
    const m = boot(
      [
        ...li(T1, RAM_BASE + 0x2001),
        ...li(T2, 0x11223344),
        asm('sw', T2, T1, 0),
        asm('lw', A0, T1, 0),
        asm('lh', A1, T1, 1),
      ],
      { misaligned: 'emulate' },
    );
    m.run(200);
    expect(m.hart.reg(A0)).toBe(0x11223344);
    expect(m.hart.reg(A1)).toBe(0x2233);
  });

  it('E-CPU-08: an all-zero word raises illegal instruction with the word in mtval', () => {
    const m = boot([0x00000000]);
    runToHandler(m);
    expect(m.hart.mcause).toBe(CAUSE.illegalInstruction);
    expect(m.hart.mtval).toBe(0);
    expect(m.hart.mepc >>> 0).toBe(at(0));
  });

  it('E-CPU-08: unimplemented instructions and CSRs trap with the instruction word', () => {
    for (const word of [
      0xffffffff,
      0x00002007 /* flw */,
      0x02009093 /* slli shamt 32 */,
      csrr(A0, 0x7c0),
    ]) {
      const m = boot([word]);
      runToHandler(m);
      expect(m.hart.mcause).toBe(CAUSE.illegalInstruction);
      expect(m.hart.mtval >>> 0).toBe(word >>> 0);
    }
  });

  it('E-CPU-09: loads, stores and fetches outside mapped memory raise access faults with mtval', () => {
    const load = boot([...li(T1, 0x4000_0000), asm('lw', A0, T1, 0x10)]);
    runToHandler(load);
    expect(load.hart.mcause).toBe(CAUSE.loadAccessFault);
    expect(load.hart.mtval >>> 0).toBe(0x4000_0010);

    const store = boot([...li(T1, 0x0300_0000), asm('sb', A0, T1, 0)]);
    runToHandler(store);
    expect(store.hart.mcause).toBe(CAUSE.storeAccessFault);
    expect(store.hart.mtval >>> 0).toBe(0x0300_0000);

    // Past the end of RAM.
    const past = boot([...li(T1, RAM_BASE + (1 << 20)), asm('lw', A0, T1, 0)]);
    runToHandler(past);
    expect(past.hart.mcause).toBe(CAUSE.loadAccessFault);

    // The boot ROM is read-only.
    const rom = boot([asm('sw', A0, 0, 0x10)]);
    runToHandler(rom);
    expect(rom.hart.mcause).toBe(CAUSE.storeAccessFault);
    expect(rom.hart.mtval).toBe(0x10);

    const fetch = boot([...li(T1, 0x3000_0000), asm('jalr', 0, T1, 0)]);
    runToHandler(fetch);
    expect(fetch.hart.mcause).toBe(CAUSE.instAccessFault);
    expect(fetch.hart.mtval >>> 0).toBe(0x3000_0000);
    expect(fetch.hart.mepc >>> 0).toBe(0x3000_0000);

    // Device windows are not executable.
    const dev = boot([...li(T1, MEMORY_MAP.uart.base), asm('jalr', 0, T1, 0)]);
    runToHandler(dev);
    expect(dev.hart.mcause).toBe(CAUSE.instAccessFault);
  });

  it('ECALL and EBREAK from M-mode', () => {
    const e = boot([asm('ecall')]);
    runToHandler(e);
    expect(e.hart.mcause).toBe(CAUSE.ecallM);
    expect(e.hart.mepc >>> 0).toBe(at(0));
    const b = boot([asm('ebreak')]);
    runToHandler(b);
    expect(b.hart.mcause).toBe(CAUSE.breakpoint);
  });

  it('trap entry saves MIE/priv in mstatus and MRET restores them', () => {
    const m = boot([...li(T1, MSTATUS.MIE), csrw(CSR.mstatus, T1), asm('ecall')]);
    runToHandler(m);
    const s = m.hart.mstatus;
    expect(s & MSTATUS.MIE).toBe(0);
    expect(s & MSTATUS.MPIE).toBe(MSTATUS.MPIE);
    expect((s >>> 11) & 3).toBe(3);
    // Handler: skip the ecall and return.
    m.load(
      HANDLER,
      toBytes([csrr(T1, CSR.mepc), asm('addi', T1, T1, 4), csrw(CSR.mepc, T1), asm('mret')]),
    );
    m.hart.pc = HANDLER;
    m.run(200);
    expect(m.hart.pc).toBe(at(4));
    expect(m.hart.mstatus & MSTATUS.MIE).toBe(MSTATUS.MIE);
  });

  it('vectored mtvec sends interrupts to base + 4 * cause', () => {
    const m = boot([
      ...li(T1, HANDLER | 1),
      csrw(CSR.mtvec, T1),
      ...li(T1, 1 << 3),
      csrw(CSR.mie, T1), // MSIE
      ...li(T1, MSTATUS.MIE),
      csrw(CSR.mstatus, T1),
      ...li(T1, MEMORY_MAP.clint.base),
      asm('addi', T2, 0, 1),
      asm('sw', T2, T1, 0), // msip = 1
      SPIN,
    ]);
    m.load(HANDLER + 12, toBytes([SPIN]));
    m.run(100);
    expect(m.hart.mcause >>> 0).toBe(0x80000003);
    expect(m.hart.pc).toBe(HANDLER + 12);
  });
});

/** Enter `mode` (0 = U, 1 = S) at `target` via MRET. */
function enterMode(mode: number, target: number): number[] {
  return [
    ...li(T1, mode << 11),
    asm('csrrc', 0, CSR.mstatus, 0), // no-op read of mstatus
    ...li(T2, MSTATUS.MPP),
    asm('csrrc', 0, CSR.mstatus, T2),
    asm('csrrs', 0, CSR.mstatus, T1),
    ...li(T1, target),
    csrw(CSR.mepc, T1),
    asm('mret'),
  ];
}

describe('DEV-08 privilege modes', () => {
  const USER = RAM_BASE + 0x3000;

  function lower(mode: number, code: number[], setup: number[] = []): Machine {
    const m = boot([...setup, ...enterMode(mode, USER)]);
    m.load(USER, toBytes([...code, SPIN]));
    return m;
  }

  it('E-CPU-12: CSR access from U-mode to a machine CSR is an illegal instruction', () => {
    const word = csrr(A0, CSR.mstatus);
    const m = lower(0, [word]);
    runToHandler(m);
    expect(m.hart.mcause).toBe(CAUSE.illegalInstruction);
    expect(m.hart.mtval >>> 0).toBe(word >>> 0);
    expect(m.hart.mepc >>> 0).toBe(USER);
    expect((m.hart.mstatus >>> 11) & 3).toBe(0);
  });

  it('E-CPU-12: S-mode cannot touch machine CSRs but can use supervisor CSRs', () => {
    const ok = lower(1, [csrr(A0, CSR.sstatus), csrw(CSR.sscratch, T0), asm('ecall')]);
    runToHandler(ok);
    expect(ok.hart.mcause).toBe(CAUSE.ecallS);
    const bad = lower(1, [csrw(CSR.mscratch, T0)]);
    runToHandler(bad);
    expect(bad.hart.mcause).toBe(CAUSE.illegalInstruction);
  });

  it('E-CPU-12: U-mode counters need mcounteren and scounteren; writes to read-only CSRs trap', () => {
    const denied = lower(0, [csrr(A0, CSR.cycle)]);
    runToHandler(denied);
    expect(denied.hart.mcause).toBe(CAUSE.illegalInstruction);

    const allowed = lower(
      0,
      [csrr(A0, CSR.instret), asm('ecall')],
      [asm('addi', T1, 0, 7), csrw(CSR.mcounteren, T1), csrw(CSR.scounteren, T1)],
    );
    runToHandler(allowed);
    expect(allowed.hart.mcause).toBe(CAUSE.ecallU);
    expect(allowed.hart.reg(A0)).toBeGreaterThan(0);

    const ro = boot([csrw(CSR.mvendorid, T0)]);
    runToHandler(ro);
    expect(ro.hart.mcause).toBe(CAUSE.illegalInstruction);
  });

  it('E-CPU-12: MRET from S-mode and SRET from U-mode are illegal; WFI is illegal in U-mode', () => {
    for (const [mode, word] of [
      [1, asm('mret')],
      [0, asm('sret')],
      [0, asm('wfi')],
    ] as const) {
      const m = lower(mode, [word]);
      runToHandler(m);
      expect(m.hart.mcause).toBe(CAUSE.illegalInstruction);
    }
  });

  it('medeleg sends U-mode ECALL to the S-mode handler; SRET returns to U', () => {
    const SHANDLER = RAM_BASE + 0x4000;
    const m = lower(
      0,
      [asm('ecall'), asm('addi', A1, 0, 9)],
      [
        ...li(T1, 1 << CAUSE.ecallU),
        csrw(CSR.medeleg, T1),
        ...li(T1, SHANDLER),
        csrw(CSR.stvec, T1),
      ],
    );
    m.load(
      SHANDLER,
      toBytes([
        csrr(A0, CSR.scause),
        csrr(T1, CSR.sepc),
        asm('addi', T1, T1, 4),
        csrw(CSR.sepc, T1),
        asm('sret'),
      ]),
    );
    m.run(200);
    expect(m.hart.reg(A0)).toBe(CAUSE.ecallU);
    expect(m.hart.reg(A1)).toBe(9);
    expect(m.hart.priv).toBe(0);
    expect(m.hart.pc).toBe(USER + 8);
  });
});

describe('RV-04 decode cache', () => {
  it('E-CPU-10: self-modifying code runs the new instruction (store + FENCE.I)', () => {
    // Loop twice over `target`; between passes overwrite it with addi a0, a0, 100.
    const target = 8; // body index of the patched instruction
    const body = [
      asm('addi', A1, 0, 2), // 0: pass counter
      ...li(T1, at(target)), // 1-2
      ...li(T2, asm('addi', A0, A0, 100) | 0), // 3-4
      asm('jal', 0, 12), // 5: jump to target
      asm('sw', T2, T1, 0), // 6: patch
      asm('fence.i'), // 7
      asm('addi', A0, A0, 1), // 8: target
      asm('addi', A1, A1, -1), // 9
      asm('bne', A1, 0, -16), // 10: back to 6
    ];
    const m = boot(body);
    m.run(200);
    expect(m.hart.reg(A0)).toBe(101);
  });

  it('E-CPU-10: a store invalidates the cached decode even without FENCE.I', () => {
    const body = [
      ...li(T1, at(6)),
      ...li(T2, asm('addi', A0, 0, 42) | 0),
      asm('sw', T2, T1, 0),
      asm('jal', 0, 4),
      asm('addi', A0, 0, 1), // 6: replaced before first execution? no: already decoded below
    ];
    const m = boot(body);
    // Execute the target once so it is in the cache, then rerun from the start.
    m.hart.pc = at(6);
    m.run(1);
    expect(m.hart.reg(A0)).toBe(1);
    m.hart.pc = RAM_BASE;
    m.run(12);
    expect(m.hart.reg(A0)).toBe(42);
  });

  it('E-CPU-10: host loads invalidate cached pages', () => {
    const m = boot([asm('addi', A0, 0, 1)]);
    m.run(200);
    expect(m.hart.reg(A0)).toBe(1);
    m.load(at(0), toBytes([asm('addi', A0, 0, 2)]));
    m.hart.pc = at(0);
    m.run(1);
    expect(m.hart.reg(A0)).toBe(2);
  });
});

describe('A extension', () => {
  it('LR/SC succeeds on a reservation and fails without one; AMOs return the old value', () => {
    const d = RAM_BASE + 0x2000;
    const m = boot([
      ...li(T1, d),
      asm('addi', T2, 0, 5),
      asm('sw', T2, T1, 0),
      asm('lr.w', A0, T1),
      asm('addi', T2, A0, 1),
      asm('sc.w', A1, T2, T1), // succeeds: a1 = 0, mem = 6
      asm('sc.w', A2, T2, T1), // fails: no reservation
      asm('addi', T2, 0, -10),
      asm('amomin.w', 13, T2, T1), // 13 = 6, mem = -10
      asm('amomaxu.w', 14, T2, T1), // 14 = -10, mem = max_u(-10,-10)
      asm('amoadd.w', 15, T2, T1), // 15 = -10, mem = -20
      asm('lw', 16, T1, 0),
    ]);
    m.run(200);
    expect(m.hart.reg(A0)).toBe(5);
    expect(m.hart.reg(A1)).toBe(0);
    expect(m.hart.reg(A2)).toBe(1);
    expect(m.hart.reg(13)).toBe(6);
    expect(m.hart.reg(14) | 0).toBe(-10);
    expect(m.hart.reg(15) | 0).toBe(-10);
    expect(m.hart.reg(16) | 0).toBe(-20);
  });
});

describe('DEV-04 timer and WFI', () => {
  it('the timer interrupt fires exactly when mtime reaches mtimecmp', () => {
    const clint = MEMORY_MAP.clint.base;
    const m = boot([
      ...li(T1, clint + 0x4000),
      asm('addi', T2, 0, 500),
      asm('sw', T2, T1, 0), // mtimecmp lo = 500
      asm('sw', 0, T1, 4), // mtimecmp hi = 0
      ...li(T1, 1 << 7),
      csrw(CSR.mie, T1),
      asm('csrrsi', 0, CSR.mstatus, MSTATUS.MIE),
      asm('addi', A0, A0, 1), // count loop iterations
      asm('jal', 0, -4),
    ]);
    m.run(2000);
    expect(m.hart.pc).toBe(HANDLER);
    expect(m.hart.mcause >>> 0).toBe(0x80000007);
    expect(m.clint.mtip).toBe(true);
    expect(boot([]).clint.mtip).toBe(false);
  });

  it('timer interrupt is taken at cycle == mtimecmp (precise)', () => {
    const m = boot([
      ...li(T1, 1 << 7),
      csrw(CSR.mie, T1),
      asm('csrrsi', 0, CSR.mstatus, MSTATUS.MIE),
      asm('jal', 0, 0),
    ]);
    m.clint.mtimecmp = 1000;
    let steps = 0;
    while (m.hart.pc !== HANDLER && steps < 5000) steps += m.run(1).steps;
    // The interrupt is a step of its own, taken when mtime first equals 1000.
    expect(m.clint.mtime).toBe(1001);
    expect(m.hart.mepc >>> 0).toBe(at(4));
  });

  it('E-CPU-11: WFI with no interrupt ever arriving parks the hart and respects the budget', () => {
    const m = boot([asm('wfi'), asm('addi', A0, 0, 1)]);
    const r = m.run(1_000_000);
    expect(r.reason).toBe('wfi');
    expect(r.steps).toBeLessThan(10);
    expect(m.hart.waiting).toBe(true);
    const again = m.run(1_000_000);
    expect(again).toEqual({ steps: 0, reason: 'wfi' });
    expect(m.hart.reg(A0)).toBe(0);
  });

  it('E-CPU-11: WFI wakes on the timer, skipping idle time deterministically', () => {
    const m = boot([...li(T1, 1 << 7), csrw(CSR.mie, T1), asm('wfi'), asm('addi', A0, 0, 1)]);
    m.clint.mtimecmp = 1_000_000;
    const r = m.run(100);
    expect(r.reason).toBe('budget');
    expect(m.hart.reg(A0)).toBe(1); // MIE=0: wakes without trapping
    expect(m.clint.mtime).toBeGreaterThanOrEqual(1_000_000);
  });

  it('WFI does not skip time when idleSkip is off', () => {
    const m = boot([...li(T1, 1 << 7), csrw(CSR.mie, T1), asm('wfi')], { idleSkip: false });
    m.clint.mtimecmp = 1_000_000;
    expect(m.run(100).reason).toBe('wfi');
    m.clint.advance(1_000_000);
    m.run(1);
    expect(m.hart.waiting).toBe(false);
  });
});

describe('DEV-05 external interrupts through the PLIC', () => {
  it('a key press raises a machine external interrupt; claim/complete works', () => {
    const plic = MEMORY_MAP.plic.base;
    const kb = MEMORY_MAP.keyboard.base;
    const m = boot([
      ...li(T1, plic),
      asm('addi', T2, 0, 1),
      asm('sw', T2, T1, 11 * 4), // priority[11] = 1
      ...li(T1, plic + 0x2000),
      ...li(T2, 1 << 11),
      asm('sw', T2, T1, 0), // enable source 11 for context 0
      ...li(T1, kb),
      asm('addi', T2, 0, 1),
      asm('sw', T2, T1, 8), // keyboard irq enable
      ...li(T1, 1 << 11),
      csrw(CSR.mie, T1),
      asm('csrrsi', 0, CSR.mstatus, MSTATUS.MIE),
      SPIN,
    ]);
    m.run(100);
    expect(m.hart.pc).not.toBe(HANDLER);
    m.keyboard.press(65);
    m.run(10);
    expect(m.hart.pc).toBe(HANDLER);
    expect(m.hart.mcause >>> 0).toBe(0x8000000b);
    expect(m.read32(plic + 0x200004)).toBe(11); // claim
    expect(m.read32(plic + 0x200004)).toBe(0); // in service
    expect(m.read32(kb + 4)).toBe(65); // polling the data register pops the key
    m.write32(plic + 0x200004, 11); // complete
    expect(m.plic.output(0)).toBe(false);
  });
});

describe('DEV-08 Sv32 paging', () => {
  const ROOT = RAM_BASE + 0x10000;
  const L0 = RAM_BASE + 0x11000;
  const CODE_PA = RAM_BASE + 0x20000;
  const DATA_PA = RAM_BASE + 0x21000;
  const CODE_VA = 0x0040_0000;
  const DATA_VA = 0x0040_1000;
  const V = 1;
  const R = 2;
  const W = 4;
  const X = 8;
  const U = 16;
  const pte = (pa: number, flags: number): number => (((pa >>> 12) << 10) | flags) >>> 0;

  function paged(code: number[], dataFlags = V | R | W, sum = false): Machine {
    const satp = (0x80000000 | (ROOT >>> 12)) >>> 0;
    const m = boot([
      ...li(T1, satp),
      csrw(CSR.satp, T1),
      ...(sum ? [...li(T1, MSTATUS.SUM), asm('csrrs', 0, CSR.mstatus, T1)] : []),
      ...enterMode(1, CODE_VA),
    ]);
    m.write32(ROOT + 4 * (CODE_VA >>> 22), pte(L0, V));
    m.write32(L0 + 4 * ((CODE_VA >>> 12) & 0x3ff), pte(CODE_PA, V | R | X));
    m.write32(L0 + 4 * ((DATA_VA >>> 12) & 0x3ff), pte(DATA_PA, dataFlags));
    m.load(CODE_PA, toBytes([...code, SPIN]));
    m.write32(DATA_PA + 0x10, 41);
    return m;
  }

  const incData = [
    asm('lui', T1, DATA_VA),
    asm('lw', A0, T1, 0x10),
    asm('addi', A0, A0, 1),
    asm('sw', A0, T1, 0x10),
    asm('ecall'),
  ];

  it('S-mode code runs from a virtual address and accesses data through the page table', () => {
    const m = paged(incData);
    runToHandler(m, 1000);
    expect(m.hart.mcause).toBe(CAUSE.ecallS);
    expect(m.hart.mepc >>> 0).toBe(CODE_VA + 16);
    expect(m.read32(DATA_PA + 0x10)).toBe(42);
    // Hardware set A on the code page and A+D on the data page.
    expect((m.read32(L0 + 4 * ((CODE_VA >>> 12) & 0x3ff)) ?? 0) & 0xc0).toBe(0x40);
    expect((m.read32(L0 + 4 * ((DATA_VA >>> 12) & 0x3ff)) ?? 0) & 0xc0).toBe(0xc0);
  });

  it('unmapped addresses raise page faults with the virtual address in mtval', () => {
    const m = paged([asm('lui', T1, 0x0080_0000), asm('lw', A0, T1, 4)]);
    runToHandler(m, 1000);
    expect(m.hart.mcause).toBe(CAUSE.loadPageFault);
    expect(m.hart.mtval >>> 0).toBe(0x0080_0004);
  });

  it('stores to a read-only page raise a store page fault', () => {
    const m = paged(incData, V | R);
    runToHandler(m, 1000);
    expect(m.hart.mcause).toBe(CAUSE.storePageFault);
    expect(m.hart.mtval >>> 0).toBe(DATA_VA + 0x10);
  });

  it('S-mode access to a U page faults unless SUM is set', () => {
    const denied = paged(incData, V | R | W | U);
    runToHandler(denied, 1000);
    expect(denied.hart.mcause).toBe(CAUSE.loadPageFault);
    const allowed = paged(incData, V | R | W | U, true);
    runToHandler(allowed, 1000);
    expect(allowed.hart.mcause).toBe(CAUSE.ecallS);
  });

  it('fetching from a non-executable page raises an instruction page fault', () => {
    const m = paged([asm('lui', T1, DATA_VA), asm('jalr', 0, T1, 0)]);
    runToHandler(m, 1000);
    expect(m.hart.mcause).toBe(CAUSE.instPageFault);
    expect(m.hart.mtval >>> 0).toBe(DATA_VA);
  });

  it('SFENCE.VMA flushes stale translations', () => {
    // Remap DATA_VA to another frame, then read through it after sfence.vma.
    const OTHER = RAM_BASE + 0x22000;
    const slot = L0 + 4 * ((DATA_VA >>> 12) & 0x3ff);
    const m = paged([
      asm('lui', T1, DATA_VA),
      asm('lw', A0, T1, 0x10), // caches the translation
      asm('ecall'),
      asm('sfence.vma', 0, 0),
      asm('lw', A1, T1, 0x10),
      asm('ecall'),
    ]);
    runToHandler(m, 1000);
    expect(m.hart.reg(A0)).toBe(41);
    m.write32(slot, pte(OTHER, V | R | W));
    m.write32(OTHER + 0x10, 7);
    // Return to S-mode after the first ecall.
    m.load(
      HANDLER,
      toBytes([csrr(T2, CSR.mepc), asm('addi', T2, T2, 4), csrw(CSR.mepc, T2), asm('mret')]),
    );
    m.hart.pc = HANDLER;
    m.run(7);
    expect(m.hart.reg(A1)).toBe(7);
  });
});
