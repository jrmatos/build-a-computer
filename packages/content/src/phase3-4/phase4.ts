import type { Level, Part, SequenceStep, TestSpec, TruthRow } from '@ground-up/schema';
import { defineLevel, lamp, sw } from '../define';
import { Toy8, assemble, assembleLine, toHex } from '../toy8';
import { AFTER_PHASE3, check, cycle } from './common';
import { clockPart } from './phase3';
import {
  COUNTDOWN_PARK_SOURCE,
  COUNT_UP_SOURCE,
  FIBONACCI_LOOP_SOURCE,
  HALT_ONLY_SOURCE,
  HALT_STOPS_SOURCE,
  MEMORY_SUM_SOURCE,
  maxParkSource,
  multiplySource,
  signParkSource,
  sumToSource,
  zeroParkSource,
} from './programs';

/**
 * Phase 4, Toy CPU (8-bit): program counter, fetch from ROM, decoder,
 * register file wiring, ALU execute, load and store, jump, conditional
 * branch, halt, first program (multiply by repeated addition).
 * The machine is Toy-8 (docs/toy8.md). DRAFT text (owner approves). CNT-06.
 */

const base = { track: 'nand-to-os', phase: 4 } as const;
const P4 = AFTER_PHASE3;

/** The program ROM every CPU level starts with: 256 bytes, filled by the `program` test. */
export const romPart = (data = '', x = -16, y = 8): Part => ({
  id: 'ROM',
  type: 'rom',
  x,
  y,
  rot: 0,
  flip: false,
  label: 'ROM',
  locked: true,
  props: { addrWidth: 8, width: 8, data },
});

/**
 * Starter of the full-CPU levels: clock, ROM, OUT, and HALT from the halt
 * level on. (A board with a HALT lamp must halt within maxCycles to pass a
 * program test, so the jump and branch levels run fixed cycle counts without one.)
 */
const cpuStarter = (halt: boolean): Level['starter'] => ({
  parts: [clockPart(-16, -8), romPart(), lamp('OUT', 16, -2, 8, 'dec'), ...(halt ? [lamp('HALT', 16, 2)] : [])],
  wires: [],
});

/** Starter of the datapath levels: IR, IMM, WE in; A, B (and more) out. */
const datapathStarter = (extraOut: Part[] = []): Level['starter'] => ({
  parts: [clockPart(), sw('IR', -16, -4, 8), sw('IMM', -16, 0, 8), sw('WE', -16, 4), lamp('A', 16, -6, 8, 'hex'), lamp('B', 16, -2, 8, 'hex'), ...extraOut],
  wires: [],
});

type DpLine = string | { asm: string; we: 0 };

/**
 * Sequence steps for a datapath level, with expectations from the Toy-8
 * model. Each line sets IR/IMM and WE and runs one cycle; A and B show
 * R[rd] and R[rs] for the instruction still on IR. Registers start random
 * (E-SIM-07), so a register is only checked after it has been written.
 */
export function datapathSteps(lines: DpLine[], o: { flags: boolean }): SequenceStep[] {
  const m = new Toy8();
  const written = new Set<number>();
  let flagsKnown = false;
  const regExpect = (ir: number): Record<string, number> => {
    const rd = (ir >> 2) & 3;
    const rs = ir & 3;
    return {
      ...(written.has(rd) ? { A: m.r[rd]! } : {}),
      ...(written.has(rs) ? { B: m.r[rs]! } : {}),
    };
  };
  const steps: SequenceStep[] = [];
  for (const line of lines) {
    const asm = typeof line === 'string' ? line : line.asm;
    const we = typeof line === 'string' ? 1 : 0;
    const [b0, b1] = assembleLine(asm) as [number, number];
    if (we) {
      m.execute(b0, b1);
      const cls = b0 >> 4;
      if (cls >= 8 || cls === 1 || cls === 2 || cls === 3) written.add((b0 >> 2) & 3);
      if (cls >= 8) flagsKnown = true;
    }
    const flags: Record<string, number> = o.flags && flagsKnown ? { Z: m.z, N: m.n, C: m.c } : {};
    steps.push(cycle({ IR: b0, IMM: b1, WE: we }, { ...regExpect(b0), ...flags }));
  }
  // Read every register back with WE off.
  for (const ir of [0x21, 0x2b, 0x2e]) steps.push(check({ IR: ir, IMM: 0, WE: 0 }, regExpect(ir)));
  return steps;
}

/**
 * A `program` test (TOY-03) whose expectations come from the Toy-8 model:
 * OUT after `maxCycles` cycles or at HALT, and HALT = 1 when `halts`.
 */
export function programTest(src: string, maxCycles: number, halts = false): TestSpec {
  const bytes = assemble(src).bytes;
  const m = new Toy8(bytes);
  m.run(maxCycles);
  if (halts && !m.halted) throw new Error(`program does not halt within ${maxCycles} cycles:\n${src}`);
  return {
    kind: 'program',
    program: toHex(bytes),
    rom: 'ROM',
    halt: 'HALT',
    maxCycles,
    expect: { OUT: m.out, ...(halts ? { HALT: 1 } : {}) },
  };
}

/** Control lines of the decoder level, from an instruction byte. */
export function decodeLines(ir: number): Record<string, number> {
  const a = ir >> 7;
  const c = (ir >> 4) & 7;
  const sys = (k: number) => (a === 0 && c === k ? 1 : 0);
  return {
    ALU: a,
    HALT: sys(0),
    LDI: sys(1),
    MOV: sys(2),
    LD: sys(3),
    ST: sys(4),
    OUT: sys(5),
    JMP: sys(6),
    JCC: sys(7),
    OP: c,
    RD: (ir >> 2) & 3,
    RS: ir & 3,
  };
}

/** Bytes in the fetch level's ROM. */
export const FETCH_ROM = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa];

const REG_FILL = ['LDI R0, 0x10', 'LDI R1, 0x21', 'LDI R2, 0x32', 'LDI R3, 0x43'];

export const PHASE4: Level[] = [
  defineLevel({
    ...base,
    id: 'program-counter',
    order: 1,
    title: 'Program counter',
    goal: 'At each rising edge: if RESET, PC becomes 0; else if JUMP, PC becomes TARGET; else PC adds 1.',
    tutorial:
      'A program is a list of instructions in memory. The program counter (PC) holds the address of the next one. ' +
      'Normally it just counts up; a jump loads a new address. At power on its value is junk, so a RESET input sets it to 0.',
    hints: ['Use the counter block with EN always on.', 'RESET wins: feed the counter\'s D from a multiplexer that picks 0 when RESET is on, and load when JUMP or RESET.'],
    afterword: 'Your CPU will use exactly this. In the full machine, power on clears every register, so RESET is not needed there.',
    palette: P4,
    starter: { parts: [clockPart(), sw('RESET', -16, -4), sw('JUMP', -16, 0), sw('TARGET', -16, 4, 8), lamp('PC', 16, 0, 8, 'hex')], wires: [] },
    power: 'random',
    tests: [
      {
        kind: 'sequence',
        steps: [
          cycle({ RESET: 1, JUMP: 0, TARGET: 0x55 }, { PC: 0 }),
          cycle({ RESET: 0 }, { PC: 1 }),
          cycle(undefined, { PC: 2 }),
          cycle(undefined, { PC: 4 }, 2),
          cycle({ JUMP: 1, TARGET: 0x80 }, { PC: 0x80 }),
          cycle({ JUMP: 0 }, { PC: 0x81 }),
          check({ JUMP: 1, TARGET: 0x10 }, { PC: 0x81 }),
          cycle({ RESET: 1 }, { PC: 0 }),
          cycle({ RESET: 0, TARGET: 0xff }, { PC: 0xff }),
          cycle({ JUMP: 0 }, { PC: 0 }),
        ],
      },
    ],
    requires: ['rom-lookup'],
  }),
  defineLevel({
    ...base,
    id: 'fetch',
    order: 2,
    title: 'Fetch from ROM',
    goal:
      'Toy-8 takes 2 cycles per instruction. PHASE flips every cycle, starting at 0. In a fetch cycle (PHASE 0), the instruction register IR takes ROM[PC]. ' +
      'PC adds 1 every cycle. Power on clears everything.',
    tutorial:
      'Every Toy-8 instruction is two bytes: the instruction byte, then an operand byte. ' +
      'In the fetch cycle the CPU copies the instruction byte into the instruction register (IR). In the execute cycle the PC already points at the operand byte, ' +
      'so the ROM output is the operand, ready to use.\n\nThe full spec is in the Toy-8 manual (docs/toy8.md).',
    hints: [
      'A flip-flop whose D is its own output through NOT flips every cycle: that is PHASE.',
      'The ROM\'s address is the PC. The IR\'s LOAD is NOT PHASE.',
      'The counter needs D and LOAD connected even if unused: a constant 0 works.',
    ],
    afterword: 'Fetch is done: the CPU now knows what to do. Next, it has to understand it.',
    palette: P4,
    starter: {
      parts: [clockPart(), romPart(toHex(FETCH_ROM)), lamp('PC', 16, -4, 8, 'hex'), lamp('IR', 16, 0, 8, 'hex'), lamp('PHASE', 16, 4)],
      wires: [],
    },
    tests: [
      {
        kind: 'sequence',
        steps: [
          check(undefined, { PC: 0, IR: 0, PHASE: 0 }),
          cycle(undefined, { PC: 1, IR: 0x11, PHASE: 1 }),
          cycle(undefined, { PC: 2, IR: 0x11, PHASE: 0 }),
          cycle(undefined, { PC: 3, IR: 0x33, PHASE: 1 }),
          cycle(undefined, { PC: 4, IR: 0x33, PHASE: 0 }),
          cycle(undefined, { PC: 7, IR: 0x77, PHASE: 1 }, 3),
          cycle(undefined, { PC: 10, IR: 0x99, PHASE: 0 }, 3),
        ],
      },
    ],
    requires: ['program-counter'],
  }),
  defineLevel({
    ...base,
    id: 'instruction-decoder',
    order: 3,
    title: 'Decoder',
    goal:
      'Split the instruction byte IR into its fields and control lines. Bit 7 is ALU. Bits 6..4 are OP. Bits 3..2 are RD, bits 1..0 are RS. ' +
      'When ALU is 0, exactly one of HALT, LDI, MOV, LD, ST, OUT, JMP, JCC is on, for OP = 0..7.',
    tutorial:
      'Toy-8 packs each instruction byte as A ccc dd ss. A = 1 means an ALU instruction: ccc goes straight to the ALU\'s op pin. ' +
      'A = 0 means a system instruction, and ccc says which one. dd and ss name registers.\n\n' +
      'This layout makes decoding cheap: one 3-bit decoder and eight AND gates.',
    hints: ['A splitter gives you the 8 bits; joiners rebuild the 2- and 3-bit fields.', 'Decoder on OP, then AND each output with NOT ALU.'],
    afterword: 'The decoder is the CPU\'s control unit in miniature: every other part listens to these lines.',
    palette: P4,
    starter: {
      parts: [
        sw('IR', -16, 0, 8),
        ...['ALU', 'HALT', 'LDI', 'MOV', 'LD', 'ST', 'OUT', 'JMP', 'JCC'].map((l, i) => lamp(l, 16, -16 + i * 4)),
        lamp('OP', 22, -4, 3, 'dec'),
        lamp('RD', 22, 0, 2, 'dec'),
        lamp('RS', 22, 4, 2, 'dec'),
      ],
      wires: [],
    },
    tests: [{ kind: 'truth-table', rows: Array.from({ length: 256 }, (_, ir): TruthRow => ({ inputs: { IR: ir }, expect: decodeLines(ir) })) }],
    requires: ['fetch'],
  }),
  defineLevel({
    ...base,
    id: 'register-file-wiring',
    order: 4,
    title: 'Register file wiring',
    goal:
      'Wire a register file to the instruction. A shows R[RD] and B shows R[RS] of the instruction on IR. At a rising edge with WE on, ' +
      'LDI RD, IMM writes IMM into R[RD], and MOV RD, RS writes R[RS] into R[RD].',
    tutorial:
      'Here IR and IMM are switches and WE stands in for "this is the execute cycle". Later you connect them to the fetch logic.\n\n' +
      'LDI is 0x1_ (0001 dd 00) and MOV is 0x2_ (0010 dd ss). Which register is written comes from the dd bits; what is written comes from a multiplexer.',
    hints: [
      'Bit 5 of IR tells MOV (1) from LDI (0): use it to pick between IMM and B.',
      'Write only when WE is on and the instruction is LDI or MOV.',
      'Your register file from Phase 3, with RA = bits 3..2 and RB = bits 1..0.',
    ],
    afterword: 'The CPU can now move data around. Next it learns to compute.',
    palette: P4,
    starter: datapathStarter(),
    power: 'random',
    tests: [
      {
        kind: 'sequence',
        steps: datapathSteps(
          [...REG_FILL, 'MOV R0, R3', 'MOV R2, R1', { asm: 'LDI R1, 0xEE', we: 0 }, 'LDI R3, 0xC5', 'MOV R1, R3', { asm: 'MOV R0, R2', we: 0 }],
          { flags: false },
        ),
      },
    ],
    requires: ['instruction-decoder'],
  }),
  defineLevel({
    ...base,
    id: 'alu-execute',
    order: 5,
    title: 'ALU execute',
    goal:
      'Add the ALU. When IR bit 7 is on, the ALU computes R[RD] op R[RS] (op = bits 6..4) and, at the edge with WE on, writes it to R[RD] and stores its flags in Z, N, C. ' +
      'LDI and MOV still work. Flags change only on ALU instructions.',
    tutorial:
      'ALU instructions are 1ccc dd ss: rd ← rd op rs, with op in the ALU\'s own order (add, sub, and, or, xor, not, shl, shr). ' +
      'The flags go into three one-bit registers so a later instruction can test them.',
    hints: ['ALU a = A, b = B, op = IR bits 6..4.', 'One more multiplexer on the write data: bit 7 picks the ALU result.', 'Flag registers load when WE and bit 7 are both on.'],
    afterword: 'Your CPU can calculate. It still cannot remember more than four numbers: next, memory.',
    palette: P4,
    starter: datapathStarter([lamp('Z', 16, 2), lamp('N', 16, 6), lamp('C', 16, 10)]),
    power: 'random',
    tests: [
      {
        kind: 'sequence',
        steps: datapathSteps(
          [
            ...REG_FILL,
            'ADD R0, R1',
            'SUB R2, R3',
            'LDI R3, 0xF0',
            'ADD R3, R3',
            'AND R1, R3',
            'OR R1, R0',
            'MOV R2, R1',
            'XOR R2, R1',
            'NOT R0',
            'LDI R3, 2',
            'SHL R1, R3',
            'SHR R0, R3',
            { asm: 'ADD R0, R0', we: 0 },
            'LDI R2, 1',
          ],
          { flags: true },
        ),
      },
    ],
    requires: ['register-file-wiring'],
  }),
  defineLevel({
    ...base,
    id: 'load-store',
    order: 6,
    title: 'Load and store',
    goal:
      'Add 256 bytes of RAM. LD RD, [RS] (0x3_) reads the byte at address R[RS] into R[RD]; ST RD, [RS] (0x4_) writes R[RD] to address R[RS] at the edge with WE on. ' +
      'LDI, MOV and the ALU instructions still work.',
    tutorial:
      'Four registers are not enough for real programs. Data memory holds the rest. The address comes from a register, so a program can walk through an array by adding 1 to it.\n\n' +
      'Toy-8 is a Harvard machine: the program lives in ROM, the data in a separate RAM.',
    hints: ['RAM addr = B, d = A, we = WE AND ST.', 'For LD, the written value is the RAM output: extend the write-back multiplexers using IR bit 4.'],
    afterword: 'The datapath is complete. Now connect it to fetch, and the CPU runs on its own.',
    palette: P4,
    starter: datapathStarter([lamp('Z', 16, 2), lamp('N', 16, 6), lamp('C', 16, 10)]),
    power: 'random',
    tests: [
      {
        kind: 'sequence',
        steps: datapathSteps(
          [
            ...REG_FILL,
            'ST R0, [R1]',
            'ST R2, [R3]',
            'LDI R0, 0',
            'LD R0, [R3]',
            'LD R2, [R1]',
            'ADD R2, R0',
            'ST R2, [R2]',
            'LD R3, [R2]',
            { asm: 'ST R1, [R2]', we: 0 },
            'LD R1, [R2]',
          ],
          { flags: true },
        ),
      },
    ],
    requires: ['alu-execute'],
  }),
  defineLevel({
    ...base,
    id: 'jump',
    order: 7,
    title: 'Jump',
    goal:
      'Build the whole Toy-8 CPU: fetch, decode, execute, with JMP (pc ← imm) and OUT (the OUT lamp shows R[RD]). The tests load programs into ROM and run them for a fixed number of cycles.',
    tutorial:
      'Time to put it together: the program counter and fetch from the earlier levels, the datapath from the last three. ' +
      'The execute cycle happens when PHASE is 1: that is your old WE. The operand byte is the ROM output during execute.\n\n' +
      'JMP loads the PC with the operand. OUT copies a register into an 8-bit OUT register shown on the OUT lamp.\n\n' +
      'You can copy your parts from earlier levels and paste them here.',
    hints: [
      'PC: counter, d = ROM output, en on, load = execute AND JMP.',
      'OUT register: d = A, load = execute AND OUT.',
      'The tests count cycles exactly: 2 per instruction.',
    ],
    afterword: 'Your CPU runs programs. Loops forever, though: next, decisions.',
    palette: P4,
    starter: cpuStarter(false),
    tests: [
      programTest(COUNT_UP_SOURCE, 31),
      programTest(COUNT_UP_SOURCE, 64),
      programTest(FIBONACCI_LOOP_SOURCE, 100),
      programTest(FIBONACCI_LOOP_SOURCE, 101),
    ],
    requires: ['load-store'],
  }),
  defineLevel({
    ...base,
    id: 'conditional-branch',
    order: 8,
    title: 'Conditional branch',
    goal: 'Add Jcc (0x7_): the RS bits choose a condition, 0 JZ (Z on), 1 JNZ (Z off), 2 JC (C on), 3 JN (N on). If it holds, pc ← imm.',
    tutorial:
      'A branch is a jump that only happens sometimes. With it come loops that end and if/else. ' +
      'The condition looks at the flags the last ALU instruction stored. After SUB, C means "no borrow": the first number was at least the second.',
    hints: ['A 4-to-1 multiplexer on RS picks Z, NOT Z, C or N.', 'Jump taken = JMP OR (JCC AND condition).'],
    afterword: 'With a conditional branch your CPU can compute anything a bigger one can, given enough time and memory.',
    palette: P4,
    starter: cpuStarter(false),
    tests: [
      programTest(COUNTDOWN_PARK_SOURCE, 18),
      programTest(COUNTDOWN_PARK_SOURCE, 120),
      programTest(zeroParkSource(0), 60),
      programTest(zeroParkSource(5), 60),
      programTest(maxParkSource(9, 4), 60),
      programTest(maxParkSource(4, 9), 60),
      programTest(signParkSource(3, 5), 60),
      programTest(signParkSource(5, 3), 60),
    ],
    requires: ['jump'],
  }),
  defineLevel({
    ...base,
    id: 'halt',
    order: 9,
    title: 'Halt',
    goal: 'Add HALT (0x00): the HALT lamp turns on and stays on, and nothing changes after it. The tests run each program until HALT.',
    tutorial:
      'A program that is finished should say so. HALT sets a one-bit register; while it is on, nothing loads: not the PC, the registers, memory or OUT.\n\n' +
      'An empty ROM is all zeros, which is HALT: a CPU with no program stops at once.',
    hints: ['halted register: d = 1, load = execute AND HALT.', 'run = NOT halted. AND it into every load and enable.'],
    afterword: 'Your CPU is complete. One thing left: give it something worth doing.',
    palette: P4,
    starter: cpuStarter(true),
    tests: [
      programTest(HALT_ONLY_SOURCE, 20, true),
      programTest(HALT_STOPS_SOURCE, 200, true),
      programTest(sumToSource(5), 500, true),
      programTest(sumToSource(0), 500, true),
      programTest(MEMORY_SUM_SOURCE, 2000, true),
    ],
    requires: ['conditional-branch'],
  }),
  defineLevel({
    ...base,
    id: 'first-program',
    order: 10,
    title: 'First program: multiply',
    goal:
      'Toy-8 has no multiply instruction. Run the multiply-by-repeated-addition program on your CPU: OUT must show the product (mod 256) and HALT must be on.',
    tutorial:
      'Multiplying a by b is adding a to itself b times. In Toy-8:\n\n' +
      '```\n        LDI R0, 0       ; product\n        LDI R1, 6       ; a\n        LDI R2, 7       ; b, counts down\n        LDI R3, 1\n' +
      '        OR  R2, R2      ; Z = (b == 0)\n        JZ  done\nloop:   ADD R0, R1\n        SUB R2, R3\n        JNZ loop\ndone:   OUT R0\n        HALT\n```\n\n' +
      'Type it into the machine-code editor and watch it run, then let the tests try other numbers.',
    hints: [
      'If an earlier program worked, this one should too. If not, step it one cycle at a time and compare with the listing.',
      'b = 0 must give 0: the JZ before the loop handles it.',
    ],
    afterword:
      'You built a computer from NAND gates and ran a program on it. Everything from here is the same idea, wider and faster: next, a real 32-bit RISC-V core.',
    palette: P4,
    starter: cpuStarter(true),
    tests: [
      programTest(multiplySource(6, 7), 1000, true),
      programTest(multiplySource(13, 11), 1000, true),
      programTest(multiplySource(0, 9), 1000, true),
      programTest(multiplySource(9, 0), 1000, true),
      programTest(multiplySource(1, 255), 2000, true),
      programTest(multiplySource(15, 17), 1000, true),
    ],
    requires: ['halt'],
  }),
];
