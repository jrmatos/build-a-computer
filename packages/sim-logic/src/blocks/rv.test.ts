import { Prng } from '@build-a-computer/det';
import { asm, CSR, decode, li, Machine, OP_ILLEGAL, OP_SPECS, RAM_BASE, toBytes } from '@build-a-computer/rv32';
import type { Part, PartProps, PartType } from '@build-a-computer/schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { inputsOf, outputsOf, PART_INFO } from '../parts-spec';
import { allX, sig, type Signal } from '../values';
import { BLOCKS } from './index';
import { immOf, lsuLoad, lsuMisaligned, lsuStore, RV_ALU_OPS, rvAluOp, type RegFileState } from './rv';

const part = (type: PartType, props: PartProps = {}): Part => ({ id: 'p1', type, x: 0, y: 0, rot: 0, flip: false, props });
const zeroRng = { nextU32: () => 0 };
const s1 = (b: 0 | 1 | 'x'): Signal => (b === 'x' ? allX(1) : sig(1, b));
const w32 = (v: number): Signal => sig(32, v >>> 0);
const val = (s: Signal | undefined): string => (s ? `${s.v}/${s.x}` : 'missing');

/** E-CPU-02 boundary values. */
const BOUNDARY = [0, 1, -1, 0x7fffffff, 0x80000000, 2, -2, 0x12345678, 31, 32, 0x80000001, 0xfffffffe];
const u32 = fc.oneof(fc.constantFrom(...BOUNDARY.map((v) => v >>> 0)), fc.integer({ min: 0, max: 0xffffffff }));

// ------------------------------------------------------------ emulator rig

const A0 = 10;
const A1 = 11;
const A2 = 12;
const T0 = 5;
const SPIN = asm('jal', 0, 0);
const HANDLER = RAM_BASE + 0x800;
const DATA = RAM_BASE + 0x400;

/** Run `body` on the rv32 emulator (mtvec → a spin loop) until it spins; returns the machine. */
function exec(body: number[], data?: number): Machine {
  const m = new Machine({ ramSize: 1 << 16 });
  m.load(RAM_BASE, toBytes([...li(T0, HANDLER), asm('csrrw', 0, CSR.mtvec, T0), ...body, SPIN]));
  m.load(HANDLER, toBytes([SPIN]));
  if (data !== undefined) m.write32(DATA, data);
  m.hart.pc = RAM_BASE;
  m.run(200);
  return m;
}

const trapped = (m: Machine): boolean => m.hart.pc >>> 0 === HANDLER >>> 0;

// ------------------------------------------------------------------ registry

describe('RV-06 blocks registry', () => {
  it('registers regfile, immgen, rvalu, branchcmp and lsu with the pin contract', () => {
    for (const t of ['regfile', 'immgen', 'rvalu', 'branchcmp', 'lsu'] as const) {
      const model = BLOCKS[t];
      expect(model, t).toBeDefined();
      const p = part(t, PART_INFO[t].defaults);
      const st = model!.init(p, 'zero', zeroRng);
      const ins = inputsOf(p).map((pin) => sig(pin.width, 0));
      const outs = model!.outputs(ins, st, p);
      expect(outs.map((o) => o.w), t).toEqual(outputsOf(p).map((o) => o.width));
      expect(Boolean(model!.clock), t).toBe(PART_INFO[t].clocked);
      // All-X inputs never throw and give outputs of the right widths.
      const xs = model!.outputs(inputsOf(p).map((pin) => allX(pin.width)), st, p);
      expect(xs.map((o) => o.w), t).toEqual(outputsOf(p).map((o) => o.width));
    }
  });
});

// ------------------------------------------------------------------- regfile

describe('regfile', () => {
  const m = BLOCKS.regfile!;
  const p = part('regfile');
  // pins: rs1, rs2, rd, wd, we, clk → r1, r2
  const ins = (rs1: number, rs2: number, rd: number | Signal, wd: number | Signal, we: 0 | 1 | 'x'): Signal[] => [
    sig(5, rs1),
    sig(5, rs2),
    typeof rd === 'number' ? sig(5, rd) : rd,
    typeof wd === 'number' ? w32(wd) : wd,
    s1(we),
    s1(0),
  ];

  it('E-CPU-01: writes to x0 are ignored and x0 always reads 0', () => {
    let st: RegFileState = m.init(p, 'zero', zeroRng);
    st = m.clock!(ins(0, 0, 0, 0xdeadbeef, 1), st, p);
    expect(m.outputs(ins(0, 0, 0, 0, 0), st, p).map(val)).toEqual(['0/0', '0/0']);
    // Even an X write to an unknown rd leaves x0 alone.
    st = m.clock!(ins(0, 1, allX(5), allX(32), 'x'), st, p);
    expect(val(m.outputs(ins(0, 1, 0, 0, 0), st, p)[0])).toBe('0/0');
    expect(m.outputs(ins(0, 1, 0, 0, 0), st, p)[1]!.x).toBe(0xffffffff);
    // The emulator agrees.
    const em = exec([asm('addi', 0, 0, 5), asm('lui', 0, 0x12345000)]);
    expect(em.hart.reg(0)).toBe(0);
  });

  it('E-CPU-01: x0 reads 0 after a random power on', () => {
    const rng = new Prng(7);
    const st: RegFileState = m.init(p, 'random', rng);
    expect(st.v[0]).toBe(0);
    expect(Array.from(st.v.slice(1)).some((v) => v !== 0)).toBe(true);
    expect(m.inspect!(st).length).toBe(32);
  });

  it('writes rd on an edge only when we = 1, reads asynchronously on two ports', () => {
    let st: RegFileState = m.init(p, 'zero', zeroRng);
    st = m.clock!(ins(0, 0, 5, 0x80000000, 1), st, p);
    st = m.clock!(ins(0, 0, 31, 0xffffffff, 1), st, p);
    st = m.clock!(ins(0, 0, 6, 0x1234, 0), st, p);
    expect(m.outputs(ins(5, 31, 0, 0, 0), st, p).map(val)).toEqual([`${0x80000000}/0`, `${0xffffffff}/0`]);
    expect(val(m.outputs(ins(6, 6, 0, 0, 0), st, p)[0])).toBe('0/0');
    expect(m.inspect!(st)[5]).toBe(0x80000000);
  });

  it('matches a plain array model over random write sequences', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(31), u32, fc.boolean(), fc.nat(31), fc.nat(31)), { maxLength: 40 }),
        (ops) => {
          const ref = new Array<number>(32).fill(0);
          let st: RegFileState = m.init(p, 'zero', zeroRng);
          for (const [rd, wd, we, r1, r2] of ops) {
            st = m.clock!(ins(r1, r2, rd, wd, we ? 1 : 0), st, p);
            if (we && rd !== 0) ref[rd] = wd;
            const out = m.outputs(ins(r1, r2, 0, 0, 0), st, p);
            expect(out[0]!.v).toBe(ref[r1]);
            expect(out[1]!.v).toBe(ref[r2]);
          }
        },
      ),
    );
  });

  it('X: unknown we or rd bits make every reachable register (not x0) all-X', () => {
    let st: RegFileState = m.init(p, 'zero', zeroRng);
    st = m.clock!(ins(0, 0, 3, 7, 'x'), st, p);
    expect(m.outputs(ins(3, 4, 0, 0, 0), st, p).map(val)).toEqual([`0/${0xffffffff}`, '0/0']);
    // rd = 0b0001X: x2 and x3 may have been written; x1 not.
    st = m.init(p, 'zero', zeroRng);
    st = m.clock!(ins(0, 0, sig(5, 2, 1), 9, 1), st, p);
    expect(m.outputs(ins(2, 3, 0, 0, 0), st, p).map((s) => s.x)).toEqual([0xffffffff, 0xffffffff]);
    expect(val(m.outputs(ins(1, 4, 0, 0, 0), st, p)[0])).toBe('0/0');
    // An X read index gives an all-X read.
    expect(m.outputs([sig(5, 0, 1), sig(5, 0), sig(5, 0), w32(0), s1(0), s1(0)], st, p)[0]!.x).toBe(0xffffffff);
    // wd with X bits is stored per bit.
    st = m.clock!(ins(0, 0, 8, sig(32, 0xf0, 0x0f), 1), st, p);
    expect(val(m.outputs(ins(8, 0, 0, 0, 0), st, p)[0])).toBe(`${0xf0}/${0x0f}`);
  });
});

// -------------------------------------------------------------------- immgen

const OPCODES = [0x03, 0x13, 0x67, 0x73, 0x23, 0x63, 0x37, 0x17, 0x6f, 0x33, 0x0f, 0x2f];

describe('immgen', () => {
  const m = BLOCKS.immgen!;
  const p = part('immgen');
  const imm = (inst: number): number => m.outputs([w32(inst)], null, p)[0]!.v;

  it('matches the rv32 decoder immediate for every valid I/S/B/U/J instruction', () => {
    fc.assert(
      fc.property(fc.constantFrom(...OPCODES), fc.integer({ min: 0, max: 0x1ffffff }), (opcode, rest) => {
        const inst = ((rest << 7) | opcode) >>> 0;
        const d = decode(inst);
        if (d.op === OP_ILLEGAL) return;
        const fmt = OP_SPECS[d.op]!.fmt;
        const got = imm(inst);
        switch (fmt) {
          case 'I':
          case 'S':
          case 'B':
          case 'U':
          case 'J':
            expect(got).toBe(d.imm >>> 0);
            break;
          case 'SH': // shamt = imm[4:0]
            expect(got & 31).toBe(d.imm);
            break;
          case 'CSR':
          case 'CSRI': // CSR number = imm[11:0]
            expect(got & 0xfff).toBe(d.imm);
            break;
          default: // R, AMO, FENCE: not an immediate format here
            if (opcode === 0x33 || opcode === 0x2f || opcode === 0x0f) expect(got).toBe(0);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('round-trips immediates encoded by the rv32 assembler (E-CPU-02 edges)', () => {
    for (const v of [0, 1, -1, 2047, -2048, 0x7ff, -0x800]) {
      expect(imm(asm('addi', 1, 2, v))).toBe(v >>> 0);
      expect(imm(asm('lw', 1, 2, v))).toBe(v >>> 0);
      expect(imm(asm('jalr', 1, 2, v))).toBe(v >>> 0);
      expect(imm(asm('sw', 1, 2, v))).toBe(v >>> 0);
    }
    for (const v of [0, 2, -2, 4094, -4096]) expect(imm(asm('bne', 1, 2, v))).toBe(v >>> 0);
    for (const v of [0, 2, -2, 0xffffe, -0x100000]) expect(imm(asm('jal', 1, v))).toBe(v >>> 0);
    for (const v of [0, 0x1000, 0x7ffff000, 0x80000000, 0xfffff000]) {
      expect(imm(asm('lui', 1, v | 0))).toBe(v >>> 0);
      expect(imm(asm('auipc', 1, v | 0))).toBe(v >>> 0);
    }
  });

  it('gives 0 for unknown opcodes, X for any X instruction bit', () => {
    expect(imm(0xfffff000 | 0x33)).toBe(0);
    expect(imm(0xffffffff)).toBe(0);
    expect(immOf(0)).toBe(0);
    expect(m.outputs([sig(32, 0x13, 1 << 31)], null, p)[0]!.x).toBe(0xffffffff);
  });
});

// --------------------------------------------------------------------- rvalu

const ALU_NAMES = Object.keys(RV_ALU_OPS) as (keyof typeof RV_ALU_OPS)[];
const IMM_NAMES: Partial<Record<keyof typeof RV_ALU_OPS, string>> = {
  add: 'addi',
  slt: 'slti',
  sltu: 'sltiu',
  xor: 'xori',
  or: 'ori',
  and: 'andi',
  sll: 'slli',
  srl: 'srli',
  sra: 'srai',
};

/** One R-type op on the emulator; result unsigned. */
function emuR(name: string, a: number, b: number): number {
  return exec([...li(A1, a), ...li(A2, b), asm(name, A0, A1, A2)]).hart.reg(A0) >>> 0;
}

describe('rvalu', () => {
  const m = BLOCKS.rvalu!;
  const p = part('rvalu');
  const run = (a: number, b: number, op: number): Signal[] => m.outputs([w32(a), w32(b), sig(4, op)], null, p);

  it('matches the rv32 emulator for every R-type op (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALU_NAMES), u32, u32, (name, a, b) => {
        const [out, zero] = run(a, b, RV_ALU_OPS[name]);
        const ref = emuR(name, a, b);
        expect(out!.v).toBe(ref);
        expect(zero!.v).toBe(ref === 0 ? 1 : 0);
      }),
      { numRuns: 400 },
    );
  });

  it('E-CPU-02: boundary operands for every op', () => {
    for (const name of ALU_NAMES)
      for (const a of BOUNDARY)
        for (const b of BOUNDARY) expect(rvAluOp(a >>> 0, b >>> 0, RV_ALU_OPS[name]), `${name} ${a} ${b}`).toBe(emuR(name, a, b));
  });

  it('immgen + rvalu run OP-IMM instructions like the emulator', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALU_NAMES.filter((n) => IMM_NAMES[n])), u32, fc.integer({ min: -2048, max: 2047 }), (name, a, i) => {
        const shift = name === 'sll' || name === 'srl' || name === 'sra';
        const inst = asm(IMM_NAMES[name]!, A0, A1, shift ? i & 31 : i);
        const imm = BLOCKS.immgen!.outputs([w32(inst)], null, part('immgen'))[0]!;
        // ALU control: op = {inst[30] for shifts right, funct3}.
        const f3 = (inst >>> 12) & 7;
        const op = f3 === 5 ? f3 | (((inst >>> 30) & 1) << 3) : f3;
        const [out] = m.outputs([w32(a), imm, sig(4, op)], null, p);
        expect(out!.v).toBe(exec([...li(A1, a), inst]).hart.reg(A0) >>> 0);
      }),
      { numRuns: 300 },
    );
  });

  it('unused op codes give 0 with zero = 1; shifts use only b[4:0]', () => {
    for (const op of [9, 10, 11, 12, 14, 15]) expect(run(5, 7, op).map(val)).toEqual(['0/0', '1/0']);
    expect(run(1, 33, RV_ALU_OPS.sll)[0]!.v).toBe(2);
    expect(run(0x80000000, 63, RV_ALU_OPS.sra)[0]!.v).toBe(0xffffffff);
    expect(run(0x80000000, 63, RV_ALU_OPS.srl)[0]!.v).toBe(1);
  });

  it('X: op, a or the used bits of b unknown make both outputs X', () => {
    const xs = (a: Signal, b: Signal, op: Signal) => m.outputs([a, b, op], null, p).map((s) => s.x !== 0);
    expect(xs(w32(1), w32(2), allX(4))).toEqual([true, true]);
    expect(xs(sig(32, 0, 1 << 31), w32(2), sig(4, 0))).toEqual([true, true]);
    expect(xs(w32(1), sig(32, 0, 1 << 31), sig(4, 7))).toEqual([true, true]);
    // A shift ignores b[31:5].
    expect(xs(w32(1), sig(32, 3, 1 << 31), sig(4, 1))).toEqual([false, false]);
    expect(xs(w32(1), sig(32, 0, 1), sig(4, 1))).toEqual([true, true]);
    // Unused op: 0 whatever the operands.
    expect(xs(allX(32), allX(32), sig(4, 9))).toEqual([false, false]);
  });
});

// ----------------------------------------------------------------- branchcmp

const BRANCHES = [
  ['beq', 0],
  ['bne', 1],
  ['blt', 4],
  ['bge', 5],
  ['bltu', 6],
  ['bgeu', 7],
] as const;

/** Whether the emulator takes branch `name` on (a, b). */
function emuBranch(name: string, a: number, b: number): boolean {
  // a0 = 1 unless the branch skips the addi.
  const em = exec([...li(A1, a), ...li(A2, b), asm('addi', A0, 0, 0), asm(name, A1, A2, 8), asm('addi', A0, 0, 1)]);
  return em.hart.reg(A0) === 0;
}

describe('branchcmp', () => {
  const m = BLOCKS.branchcmp!;
  const p = part('branchcmp');
  const take = (a: Signal, b: Signal, f3: Signal): string => val(m.outputs([a, b, f3], null, p)[0]);

  it('matches the rv32 emulator for every branch (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...BRANCHES), u32, fc.boolean(), u32, ([name, f3], a, same, b0) => {
        const b = same ? a : b0;
        expect(take(w32(a), w32(b), sig(3, f3))).toBe(`${emuBranch(name, a, b) ? 1 : 0}/0`);
      }),
      { numRuns: 300 },
    );
  });

  it('E-CPU-02: signed vs unsigned at the 32-bit edges', () => {
    for (const [name, f3] of BRANCHES)
      for (const a of BOUNDARY)
        for (const b of BOUNDARY) expect(take(w32(a), w32(b), sig(3, f3)), `${name} ${a} ${b}`).toBe(`${emuBranch(name, a, b) ? 1 : 0}/0`);
  });

  it('funct3 2 and 3 never branch; X rules', () => {
    expect(take(w32(1), w32(1), sig(3, 2))).toBe('0/0');
    expect(take(allX(32), allX(32), sig(3, 3))).toBe('0/0');
    expect(take(w32(1), w32(1), allX(3))).toBe('0/1');
    expect(take(sig(32, 0, 1), w32(1), sig(3, 0))).toBe('0/1');
  });
});

// ----------------------------------------------------------------------- lsu

const LOADS = [
  ['lb', 0],
  ['lh', 1],
  ['lw', 2],
  ['lbu', 4],
  ['lhu', 5],
] as const;
const STORES = [
  ['sb', 0],
  ['sh', 1],
  ['sw', 2],
] as const;

describe('lsu', () => {
  const m = BLOCKS.lsu!;
  const p = part('lsu', { addrWidth: 10 });
  // pins: addr, wdata, funct3, load, store, rdata → maddr, mwdata, mwe, result, misaligned
  const run = (addr: number, wdata: number, f3: number, load: 0 | 1, store: 0 | 1, rdata: number) =>
    m.outputs([w32(addr), w32(wdata), sig(3, f3), s1(load), s1(store), w32(rdata)], null, p);

  it('loads match the rv32 emulator, misaligned loads trap (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LOADS), fc.nat(3), u32, ([name, f3], off, word) => {
        const em = exec([...li(A1, DATA + off), asm(name, A0, A1, 0)], word);
        const [maddr, , mwe, result, mis] = run(DATA + off, 0, f3, 1, 0, word);
        expect(mis!.v === 1, 'misaligned').toBe(trapped(em));
        expect(mwe!.v).toBe(0);
        expect(maddr!.v).toBe(((DATA + off) >>> 2) & 0x3ff);
        if (trapped(em)) expect(em.hart.mcause).toBe(4);
        else expect(result!.v).toBe(em.hart.reg(A0) >>> 0);
      }),
      { numRuns: 400 },
    );
  });

  it('stores match the rv32 emulator (read-modify-write), misaligned stores trap (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...STORES), fc.nat(3), u32, u32, ([name, f3], off, word, wdata) => {
        const em = exec([...li(A1, DATA + off), ...li(A2, wdata), asm(name, A2, A1, 0)], word);
        const [, mwdata, mwe, , mis] = run(DATA + off, wdata, f3, 0, 1, word);
        expect(mis!.v === 1, 'misaligned').toBe(trapped(em));
        expect(mwe!.v).toBe(trapped(em) ? 0 : 1);
        if (trapped(em)) expect(em.hart.mcause).toBe(6);
        else expect(mwdata!.v).toBe(em.read32(DATA)! >>> 0);
      }),
      { numRuns: 400 },
    );
  });

  it('E-CPU-02: sign extension at the byte and half edges', () => {
    const word = 0x807f_ff80;
    expect(lsuLoad(0, word, 0)).toBe(0xffffff80);
    expect(lsuLoad(1, word, 0)).toBe(0xffffffff);
    expect(lsuLoad(2, word, 0)).toBe(0x7f);
    expect(lsuLoad(3, word, 4)).toBe(0x80);
    expect(lsuLoad(0, word, 1)).toBe(0xffffff80);
    expect(lsuLoad(2, word, 1)).toBe(0xffff807f);
    expect(lsuLoad(2, word, 5)).toBe(0x807f);
    expect(lsuLoad(0, word, 2)).toBe(word);
    expect(lsuStore(3, 0x1ff, 0, 0)).toBe(0xff000000);
    expect(lsuStore(2, 0xabcd1234, 0xffffffff, 1)).toBe(0x1234ffff);
  });

  it('maddr is addr[addrWidth+1:2]; idle (load = store = 0) never writes or flags', () => {
    const [maddr, , mwe, , mis] = run(0xffff_fffd, 0, 2, 0, 0, 0);
    expect(maddr!.v).toBe(0x3ff);
    expect(mwe!.v).toBe(0);
    expect(mis!.v).toBe(0);
    const p4 = part('lsu', { addrWidth: 4 });
    expect(m.outputs([w32(0x7c), w32(0), sig(3, 2), s1(0), s1(0), w32(0)], null, p4)[0]).toEqual(sig(4, 0xf));
  });

  it('invalid funct3 does nothing: result 0, mwdata = rdata, no write, no misaligned', () => {
    for (const f3 of [3, 6, 7]) {
      const [, mwdata, mwe, result, mis] = run(1, 0xff, f3, 1, 0, 0x1234);
      expect([mwdata!.v, mwe!.v, result!.v, mis!.v]).toEqual([0x1234, 0, 0, 0]);
    }
    for (const f3 of [3, 4, 5]) {
      const [, mwdata, mwe, , mis] = run(0, 0xff, f3, 0, 1, 0x1234);
      expect([mwdata!.v, mwe!.v, mis!.v]).toEqual([0x1234, 0, 0]);
    }
    expect(lsuMisaligned(1, 6, true)).toBe(false);
  });

  it('X: unknown control or data makes the dependent outputs X', () => {
    const xs = (addr: Signal, f3: Signal, load: Signal, store: Signal, rdata: Signal) =>
      m.outputs([addr, w32(5), f3, load, store, rdata], null, p).map((s) => s.x !== 0);
    // X in addr[1:0]: everything but maddr is X while a store is active.
    expect(xs(sig(32, 0, 1), sig(3, 2), s1(0), s1(1), w32(0))).toEqual([false, true, true, true, true]);
    // X in high address bits only: maddr bits X, the rest known.
    expect(xs(sig(32, 0, 1 << 5), sig(3, 2), s1(1), s1(0), w32(0))).toEqual([true, false, false, false, false]);
    // X rdata: result and mwdata X; mwe and misaligned known.
    expect(xs(w32(0), sig(3, 0), s1(0), s1(1), allX(32))).toEqual([false, true, false, true, false]);
    // X store with idle load: mwe and misaligned X.
    expect(xs(w32(0), sig(3, 2), s1(0), s1('x'), w32(0))).toEqual([false, false, true, false, true]);
    // Idle: an X funct3 cannot raise mwe or misaligned.
    expect(xs(w32(0), allX(3), s1(0), s1(0), w32(0))).toEqual([false, true, false, true, false]);
  });
});
