import type { Level, PartType } from '@build-a-computer/schema';
import { defineLevel } from '../define';
import {
  DATA,
  KEPT,
  NO_BOARD,
  PHASE5_LAST_ID,
  RAM_BASE,
  callerLibrary,
  code,
  cstringHex,
  rv,
  u32,
  wordsHex,
} from './common';

/**
 * Phase 6, Assembly: hand-encoding, ABI names, loops, arrays, functions and
 * the stack, recursion, strings, and (optional) an instruction encoder.
 * Code levels: the player writes RV32 assembly; tests run it on the
 * emulator (docs/code-levels.md). DRAFT text (owner approves). CNT-08.
 */

const base = { track: 'nand-to-os' as const, phase: 6, palette: [] as PartType[], starter: NO_BOARD, mode: 'code' as const };

/** The instructions of the hand-encoding level and their machine words. */
export const HAND_ENCODED: readonly { asm: string; word: number }[] = [
  { asm: 'add  a2, a0, a1', word: 0x00b5_0633 },
  { asm: 'sub  a3, a0, a1', word: 0x40b5_06b3 },
  { asm: 'addi a4, a0, -1', word: 0xfff5_0713 },
  { asm: 'lui  a5, 0x12345', word: 0x1234_57b7 },
  { asm: 'ebreak', word: 0x0010_0073 },
];

const handEncodeCase = (a0: number, a1: number) =>
  rv(
    `a0 = ${a0 | 0}, a1 = ${a1 | 0}`,
    { regs: { a0: u32(a0), a1: u32(a1) } },
    {
      regs: { a2: u32(a0 + a1), a3: u32(a0 - a1), a4: u32(a0 - 1), a5: 0x1234_5000 },
      memory: [{ addr: RAM_BASE, hex: wordsHex(HAND_ENCODED.map((i) => i.word)) }],
    },
    100,
  );

const abiCase = (a0: number, a1: number) =>
  rv(
    `a0 = ${a0 | 0}, a1 = ${a1 | 0}`,
    { regs: { a0: u32(a0), a1: u32(a1), s0: 0xc0ffee, s1: 0xbeef } },
    { regs: { a0: u32(a1), a1: u32(a0), a2: u32(a0 + a1), a3: u32(a0 - a1), s0: 0xc0ffee, s1: 0xbeef } },
    100,
  );

const sumTo = (n: number) => u32((n * (n + 1)) / 2);
const loopCase = (n: number) => rv(`n = ${n}`, { regs: { a0: n } }, { regs: { a0: sumTo(n) }, exitCode: sumTo(n) }, 1_000_000);

function arrayCase(name: string, xs: number[], memoryWords = xs) {
  const sum = u32(xs.reduce((a, b) => a + b, 0));
  const max = xs.length ? u32(Math.max(...xs)) : 0;
  return rv(
    name,
    { regs: { a0: DATA, a1: xs.length }, memory: [{ addr: DATA, hex: wordsHex(memoryWords) }] },
    { regs: { a0: sum, a1: max } },
    10_000,
  );
}

const sumSquares = (n: number) => u32((n * (n + 1) * (2 * n + 1)) / 6);
const fib = (n: number): number => {
  let [a, b] = [0, 1];
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
};

const upper = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase());
const stringCase = (name: string, s: string) =>
  rv(
    name,
    { regs: { a0: DATA }, memory: [{ addr: DATA, hex: cstringHex(s) }] },
    { uart: upper(s), exitCode: s.length },
    20_000,
  );

/** The addi word for rd, rs1, imm: what the encoder level computes. */
export const encodeAddi = (rd: number, rs1: number, imm: number): number =>
  u32(((imm & 0xfff) << 20) | (rs1 << 15) | (rd << 7) | 0x13);
const addiCase = (asm: string, rd: number, rs1: number, imm: number) =>
  rv(asm, { regs: { a0: rd, a1: rs1, a2: u32(imm) } }, { regs: { a0: encodeAddi(rd, rs1, imm) } }, 1_000);

const EXIT = 'li   a7, 93          # exit: a7 = 93, code in a0\n    ecall';

export const PHASE6: Level[] = [
  defineLevel({
    ...base,
    id: 'hand-encode',
    order: 1,
    title: 'Hand-encoding instructions',
    goal:
      'Write five instructions as raw 32-bit words with `.word`: add a2, a0, a1 / sub a3, a0, a1 / addi a4, a0, -1 / lui a5, 0x12345 / ebreak. ' +
      'Tests set a0 and a1, run your words, and check the results and the bytes in memory.',
    tutorial:
      'Your CPU from Phase 5 does not read text. It reads 32-bit words. An assembler turns `add a2, a0, a1` into a word for you; ' +
      'in this level you are the assembler.\n\n' +
      'Registers are 5-bit numbers: a0 is x10, a1 is x11, a2 is x12 and so on up to a5 = x15. ' +
      'An R-type instruction (add, sub) packs its fields like this, from bit 31 down to bit 0:\n\n' +
      '```\nfunct7  rs2   rs1   funct3 rd    opcode\n7 bits  5     5     3      5     7\n0000000 01011 01010 000    01100 0110011   add a2, a0, a1\n```\n\n' +
      'Group the 32 bits in fours and you get hex: `0x00b50633`. sub is the same with funct7 = 0100000. ' +
      'addi is I-type: a 12-bit two\'s complement immediate takes the place of funct7 and rs2, and the opcode is 0010011. ' +
      'lui is U-type: the 20-bit immediate goes in bits 31-12, then rd, then opcode 0110111.\n\n' +
      '```asm\n    .word 0x00b50633   # add a2, a0, a1\n```\n\n' +
      'You could just type `add a2, a0, a1`: the assembler would write the same word. Do it by hand once; it is the last time you have to.',
    hints: [
      'Write each field in binary, then glue them together from bit 31 to bit 0, then read off groups of 4 bits as hex digits.',
      'Register numbers: a0 = 10 (01010), a1 = 11 (01011), a2 = 12 (01100), a3 = 13 (01101), a4 = 14 (01110), a5 = 15 (01111).',
      'sub only changes funct7 to 0100000, which turns the top hex digit from 0 to 4: sub a3, a0, a1 is 0x40b506b3.',
      'addi a4, a0, -1: imm = 111111111111, rs1 = 01010, funct3 = 000, rd = 01110, opcode = 0010011 → 0xfff50713. ' +
        'lui a5, 0x12345: 0x12345 in the top 20 bits, then rd = 01111 and 0110111 → 0x123457b7.',
      'The full answer: `.word 0x00b50633`, `.word 0x40b506b3`, `.word 0xfff50713`, `.word 0x123457b7`, `.word 0x00100073`.',
    ],
    afterword:
      'Every program you write from now on becomes words like these. The assembler does the bit packing, and the disassembler in the debugger turns words back into text. ' +
      'The encoding was designed so that rs1, rs2 and rd sit in the same bits in every format, which keeps the decoder you built small.',
    code: code({
      starter:
        '# Write each instruction as a 32-bit word. The comment says which instruction it is.\n' +
        '# a0 = x10, a1 = x11, a2 = x12, a3 = x13, a4 = x14, a5 = x15.\n' +
        '    .word 0x00000000   # add  a2, a0, a1\n' +
        '    .word 0x00000000   # sub  a3, a0, a1\n' +
        '    .word 0x00000000   # addi a4, a0, -1\n' +
        '    .word 0x00000000   # lui  a5, 0x12345\n' +
        '    .word 0x00100073   # ebreak (done for you: stops the program)\n',
      devices: [],
    }),
    tests: [handEncodeCase(7, 5), handEncodeCase(5, 7), handEncodeCase(0, 0), handEncodeCase(-1, 1), handEncodeCase(0x7fff_ffff, 0x7fff_ffff)],
    requires: [PHASE5_LAST_ID],
  }),
  defineLevel({
    ...base,
    id: 'abi-names',
    order: 2,
    title: 'Register names and rules',
    goal:
      'a0 and a1 hold two numbers. Put a0 + a1 in a2 and a0 − a1 in a3, then swap a0 and a1. ' +
      'Use only t0–t6 as scratch: s0 and s1 belong to someone else and must keep their values. Stop with ebreak.',
    tutorial:
      'The 32 registers x0–x31 have second names from the calling convention (the ABI). The names say what a register is for:\n\n' +
      '```\nzero x0      always 0\nra   x1      return address\nsp   x2      stack pointer\nt0-t6        temporaries: anyone may overwrite them\n' +
      's0-s11       saved: whoever uses one must put the old value back\na0-a7        arguments and return values\n```\n\n' +
      'The assembler also gives you pseudo-instructions, shorthands for real ones:\n\n' +
      '```asm\n    mv   t0, a0      # addi t0, a0, 0\n    li   t1, 42      # addi t1, zero, 42 (or lui + addi for big numbers)\n```\n\n' +
      'The starter code works but uses x-numbers and borrows s0. Rewrite it with ABI names and keep s0 and s1 untouched.',
    hints: [
      'Read each x-number as its name: x10 = a0, x11 = a1, x12 = a2, x13 = a3, x8 = s0, x5 = t0.',
      'Compute a2 and a3 first, while a0 and a1 still hold the original values.',
      'Swapping needs a third register to hold one value while you overwrite it. Use t0, not s0.',
      'add a2, a0, a1 / sub a3, a0, a1 / mv t0, a0 / mv a0, a1 / mv a1, t0 / ebreak',
    ],
    afterword:
      'These rules are what let functions written by different people (or a compiler) call each other: arguments go in a0–a7, the result comes back in a0, ' +
      't registers may be trashed by any call, and s registers survive calls. You will lean on them from the functions level on.',
    code: code({
      starter:
        '# Rewrite with ABI names. The swap uses s0, which is not yours to change.\n' +
        '    add  x12, x10, x11   # a2 = a0 + a1\n' +
        '    mv   x8, x10         # s0 = a0 (fix: use a temporary)\n' +
        '    mv   x10, x11        # a0 = a1\n' +
        '    mv   x11, x8         # a1 = old a0\n' +
        '    # TODO: a3 = old a0 - old a1\n' +
        '    ebreak\n',
      devices: [],
    }),
    tests: [abiCase(7, 5), abiCase(5, 7), abiCase(0, 0), abiCase(-3, 100), abiCase(0x8000_0000, 1)],
    requires: ['hand-encode'],
  }),
  defineLevel({
    ...base,
    id: 'loop-sum',
    order: 3,
    title: 'Loops',
    goal: 'a0 holds n. Compute 1 + 2 + … + n (0 when n = 0), put it in a0 and exit with it as the exit code (a7 = 93, ecall).',
    tutorial:
      'Assembly has no `for` or `while`. A loop is a label you jump back to, and a branch that leaves when you are done:\n\n' +
      '```asm\nloop:\n    beqz a0, done      # leave when the counter reaches 0\n    # ... body ...\n    addi a0, a0, -1    # count down\n    j    loop\ndone:\n```\n\n' +
      '`beqz` and `j` are pseudo-instructions for `beq a0, zero, done` and `jal zero, loop`. Put the test at the top so n = 0 runs the body zero times.\n\n' +
      'To end a program and report a result, set a7 = 93 (the exit call number) and a0 = the exit code, then run `ecall`.',
    hints: [
      'Keep a running total in a temporary, say t0, starting at 0. Count a0 down from n to 1 and add it to t0 each time.',
      'Check for zero before adding, at the top of the loop, so that n = 0 gives 0.',
      'After the loop, move t0 into a0, then li a7, 93 and ecall.',
      'li t0, 0 / loop: beqz a0, done / add t0, t0, a0 / addi a0, a0, -1 / j loop / done: mv a0, t0 / li a7, 93 / ecall',
    ],
    afterword:
      'Every loop a compiler emits looks like this: a label, a body, a counter and a branch. ' +
      'Counting down to zero saves an instruction, because comparing with zero needs no second register.',
    code: code({
      starter:
        '# a0 = n. Exit with 1 + 2 + ... + n.\n' +
        '    li   t0, 0          # t0 = running total\n' +
        '    # TODO: loop while a0 != 0: add a0 to t0, then subtract 1 from a0\n' +
        '    mv   a0, t0\n' +
        `    ${EXIT}\n`,
      devices: [],
    }),
    tests: [loopCase(0), loopCase(1), loopCase(10), loopCase(100), loopCase(65_535)],
    requires: ['abi-names'],
  }),
  defineLevel({
    ...base,
    id: 'array-sum-max',
    order: 4,
    title: 'Arrays',
    goal:
      'a0 points at an array of 32-bit signed words and a1 is how many there are. Return the sum in a0 and the largest word in a1 (both 0 for an empty array), then exit.',
    tutorial:
      'An array is just words next to each other in memory. Word i is at address `base + 4*i`. `lw` loads a word from an address plus an offset:\n\n' +
      '```asm\n    lw   t2, 0(a0)     # t2 = the word at a0\n    addi a0, a0, 4     # move to the next word\n```\n\n' +
      'Walk a pointer through the array instead of computing `base + 4*i` each time. ' +
      'The words are signed: compare with `blt`/`bge`, not `bltu`/`bgeu`, or -1 will look bigger than 100.',
    hints: [
      'Use t0 for the sum and t1 for the largest so far. Loop a1 times; each time load a word, add it, compare it, and move the pointer on by 4.',
      'What should "largest so far" start at? 0 is wrong when every word is negative. Start it at the first word, but only after checking that the array is not empty.',
      'bge t1, t2, skip jumps over the update when the current max t1 is already at least t2.',
      'li t0, 0 / li t1, 0 / beqz a1, done / lw t1, 0(a0) / loop: lw t2, 0(a0) / add t0, t0, t2 / bge t1, t2, skip / mv t1, t2 / ' +
        'skip: addi a0, a0, 4 / addi a1, a1, -1 / bnez a1, loop / done: mv a0, t0 / mv a1, t1 / exit',
    ],
    afterword:
      'A C compiler turns `for (i = 0; i < n; i++) sum += a[i];` into nearly this loop. The pointer walk is a classic optimisation called strength reduction: an add instead of a multiply.',
    code: code({
      starter:
        '# a0 = address of the first word, a1 = number of words.\n' +
        '# Return a0 = sum, a1 = largest (signed). Empty array: both 0.\n' +
        '    li   t0, 0          # sum\n' +
        '    li   t1, 0          # largest so far\n' +
        '    # TODO: walk the array\n' +
        '    mv   a0, t0\n' +
        '    mv   a1, t1\n' +
        `    ${EXIT}\n`,
      devices: [],
    }),
    tests: [
      arrayCase('3 1 4 1 5 9 2 6', [3, 1, 4, 1, 5, 9, 2, 6]),
      arrayCase('empty array', [], [77]),
      arrayCase('one word: -5', [-5]),
      arrayCase('all negative', [-3, -1, -7]),
      arrayCase('largest first', [100, 2, 3, -50]),
      arrayCase('64 words', Array.from({ length: 64 }, (_, i) => ((i * 37) % 101) - 50)),
    ],
    requires: ['loop-sum'],
  }),
  defineLevel({
    ...base,
    id: 'functions-stack',
    order: 5,
    title: 'Functions and the stack',
    goal:
      'Write the function sum_squares(n) that returns 1² + 2² + … + n² in a0. Compute each square by calling the provided square(x). ' +
      'Follow the rules: s registers and sp must be as they were when you return.',
    tutorial:
      '`call f` jumps to f and puts the return address in ra; `ret` jumps back to ra. A function that calls another loses its own ra, so it saves ra first. ' +
      'The place to save things is the stack: memory below sp, which starts at the top of RAM and grows down.\n\n' +
      '```asm\nf:\n    addi sp, sp, -16    # make room (keep sp a multiple of 16)\n    sw   ra, 12(sp)\n    sw   s0, 8(sp)      # we use s0, so save the caller\'s value\n' +
      '    # ... call other functions; s0 survives them ...\n    lw   s0, 8(sp)\n    lw   ra, 12(sp)\n    addi sp, sp, 16\n    ret\n```\n\n' +
      'The library file runs first: it calls your sum_squares and checks s0–s3 and sp afterwards. square follows the rules too, so it may wipe every t and a register.',
    hints: [
      'Values that must survive `call square` go in s registers, never t or a registers: square overwrites them.',
      'You need two: one counting from n down to 1 (s0), one for the total (s1). Save both, and ra, on the stack at the start; restore them at the end.',
      'Inside the loop: mv a0, s0 / call square / add s1, s1, a0 / addi s0, s0, -1.',
      'sum_squares: addi sp, sp, -16 / sw ra, 12(sp) / sw s0, 8(sp) / sw s1, 4(sp) / mv s0, a0 / li s1, 0 / loop: beqz s0, done / mv a0, s0 / call square / ' +
        'add s1, s1, a0 / addi s0, s0, -1 / j loop / done: mv a0, s1 / lw s1, 4(sp) / lw s0, 8(sp) / lw ra, 12(sp) / addi sp, sp, 16 / ret',
    ],
    afterword:
      'This prologue and epilogue (make a frame, save ra and s registers, undo it all before ret) is what every C function compiles to. ' +
      'Forgetting to save ra is the classic bug: the ret jumps back into your own function forever.',
    code: code({
      starter:
        '# sum_squares(a0 = n) returns a0 = 1*1 + 2*2 + ... + n*n.\n' +
        '# Call square (in library.s): a0 in, a0 = a0 * a0 out. It may change every t and a register.\n' +
        '    .globl sum_squares\n' +
        'sum_squares:\n' +
        '    # TODO: save ra (and any s register you use) on the stack\n' +
        '    # TODO: loop, calling square\n' +
        '    li   a0, 0\n' +
        '    ret\n',
      devices: [],
      library: [
        {
          name: 'library.s',
          text: callerLibrary(
            'sum_squares',
            `
    .globl square
# square(a0) -> a0 = a0 * a0. Like any function, it may change t and a registers, and it does.
square:
    mul  a0, a0, a0
    li   t0, -1
    li   t1, -1
    li   t2, -1
    li   t3, -1
    li   t4, -1
    li   t5, -1
    li   t6, -1
    li   a1, -1
    li   a2, -1
    li   a3, -1
    li   a4, -1
    li   a5, -1
    li   a6, -1
    li   a7, -1
    ret
`,
          ),
        },
      ],
    }),
    tests: [0, 1, 3, 10, 100].map((n) => rv(`n = ${n}`, { regs: { a0: n } }, { regs: { a0: sumSquares(n), ...KEPT }, exitCode: sumSquares(n) }, 100_000)),
    requires: ['array-sum-max'],
  }),
  defineLevel({
    ...base,
    id: 'recursion',
    order: 6,
    title: 'Recursion',
    goal:
      'Write fib(n) that calls itself: fib(0) = 0, fib(1) = 1, fib(n) = fib(n−1) + fib(n−2). Return the result in a0 and keep the calling rules.',
    tutorial:
      'A recursive function is an ordinary function that happens to call itself. Each call gets its own stack frame, so each one has its own saved ra and s registers:\n\n' +
      '```asm\nfact:                       # fact(n) = n * fact(n - 1)\n    li   t0, 2\n    blt  a0, t0, base\n    addi sp, sp, -16\n    sw   ra, 12(sp)\n    sw   s0, 8(sp)\n' +
      '    mv   s0, a0             # keep n across the call\n    addi a0, a0, -1\n    call fact\n    mul  a0, a0, s0\n    lw   s0, 8(sp)\n    lw   ra, 12(sp)\n    addi sp, sp, 16\n    ret\nbase:\n    li   a0, 1\n    ret\n```\n\n' +
      'fib needs two recursive calls, and the result of the first must survive the second. fib(20) makes over 20,000 calls, and the stack goes 20 frames deep.',
    hints: [
      'The base case needs no frame: if n < 2, fib(n) = n, so just ret with a0 unchanged.',
      'For n ≥ 2 you must remember two things across calls: n (to compute n − 2 after the first call) and fib(n − 1) (during the second call). Use s0 and s1.',
      'Save ra, s0 and s1 in one 16-byte frame. Order: save, s0 = n, call fib(n − 1), s1 = a0, call fib(n − 2), a0 = a0 + s1, restore, ret.',
      'fib: li t0, 2 / blt a0, t0, base / addi sp, sp, -16 / sw ra, 12(sp) / sw s0, 8(sp) / sw s1, 4(sp) / mv s0, a0 / addi a0, a0, -1 / call fib / ' +
        'mv s1, a0 / addi a0, s0, -2 / call fib / add a0, a0, s1 / lw s1, 4(sp) / lw s0, 8(sp) / lw ra, 12(sp) / addi sp, sp, 16 / base: ret',
    ],
    afterword:
      'Recursive fib is slow, since it computes the same values again and again, but it shows that the stack is all recursion needs: no special hardware, only a pointer and the rules from the last level. ' +
      'Run fib(25) in the debugger and watch sp go down and come back up.',
    code: code({
      starter:
        '# fib(a0 = n) returns a0 = fib(n). fib(0) = 0, fib(1) = 1.\n' +
        '    .globl fib\n' +
        'fib:\n' +
        '    li   t0, 2\n' +
        '    blt  a0, t0, base    # fib(0) = 0, fib(1) = 1: a0 is already the answer\n' +
        '    # TODO: save ra, s0, s1; return fib(n - 1) + fib(n - 2); restore\n' +
        'base:\n' +
        '    ret\n',
      devices: [],
      library: [{ name: 'library.s', text: callerLibrary('fib') }],
    }),
    tests: [0, 1, 2, 3, 10, 20].map((n) => rv(`fib(${n})`, { regs: { a0: n } }, { regs: { a0: fib(n), ...KEPT }, exitCode: fib(n) }, 2_000_000)),
    requires: ['functions-stack'],
  }),
  defineLevel({
    ...base,
    id: 'strings-uart',
    order: 7,
    title: 'Strings',
    goal:
      'a0 points at a string that ends with a 0 byte. Print it to the UART with a–z turned into A–Z (everything else unchanged), then exit with its length as the exit code.',
    tutorial:
      'A string is bytes in memory, one per character, ended by a 0 byte (a C string). `lbu` loads one byte, zero-extended.\n\n' +
      'The UART is a device mapped into memory: a byte stored at address 0x10000000 appears in the console.\n\n' +
      '```asm\n    li   t0, 0x10000000   # UART transmit register\n    li   t1, \'H\'\n    sb   t1, 0(t0)        # prints H\n```\n\n' +
      'In ASCII, \'a\' is 97 and \'A\' is 65: a lowercase letter becomes uppercase by subtracting 32. Only change bytes from \'a\' to \'z\'; \'`\' and \'{\' sit right next to them.',
    hints: [
      'Loop: load a byte with lbu, stop if it is 0, maybe change it, store it to the UART, move the pointer on by 1, add 1 to a length counter.',
      'A byte c is lowercase when \'a\' ≤ c ≤ \'z\'. Two branches skip the change: blt c, \'a\' and bgt c, \'z\'. Branches compare registers, so li the bounds into temporaries first.',
      'An empty string is just a 0 byte: the loop must check before printing anything, and the length is 0.',
      'li t0, 0x10000000 / li t1, 0 / loop: lbu t2, 0(a0) / beqz t2, done / li t3, \'a\' / blt t2, t3, put / li t3, \'z\' / bgt t2, t3, put / addi t2, t2, -32 / ' +
        'put: sb t2, 0(t0) / addi a0, a0, 1 / addi t1, t1, 1 / j loop / done: mv a0, t1 / exit',
    ],
    afterword:
      'You just wrote strlen, toupper and puts in one loop. A real UART also has a status register that says when it can take another byte; this one is always ready.',
    code: code({
      starter:
        '# a0 = address of a 0-terminated string. Print it in uppercase; exit with its length.\n' +
        '    .equ UART, 0x10000000\n' +
        '    li   t0, UART       # store a byte here to print it\n' +
        '    li   t1, 0          # length\n' +
        '    # TODO: for each byte until the 0: uppercase it if it is a-z, print it, count it\n' +
        '    mv   a0, t1\n' +
        `    ${EXIT}\n`,
      devices: ['uart'],
    }),
    tests: [
      stringCase('hello, world!', 'hello, world!'),
      stringCase('empty string', ''),
      stringCase('already UPPER 123', 'Already UPPER 123'),
      stringCase('edges: az`{@[', 'az`{@[AZ'),
      stringCase('one letter', 'q'),
    ],
    requires: ['recursion'],
  }),
  defineLevel({
    ...base,
    id: 'encode-addi',
    order: 8,
    title: 'Write an assembler',
    goal:
      'Be the assembler: a0 = rd, a1 = rs1, a2 = imm (−2048 to 2047). Return in a0 the machine word for addi rd, rs1, imm, then exit.',
    tutorial:
      'An assembler is mostly bit packing. In the first level you packed fields by hand; now write the program that does it. addi is I-type:\n\n' +
      '```\nimm[11:0]   rs1    funct3  rd     opcode\nbits 31-20  19-15  14-12   11-7   6-0\n                   000            0010011 (0x13)\n```\n\n' +
      'Shift each field to its place and OR them together:\n\n' +
      '```asm\n    slli a0, a0, 7      # rd into bits 11-7\n    ori  a0, a0, 0x13   # opcode\n```\n\n' +
      'The immediate arrives as a 32-bit signed number: −1 is 0xffffffff. Only its low 12 bits belong in the word.',
    hints: [
      'rd goes up by 7, rs1 by 15, imm by 20. funct3 is 0, so it adds nothing.',
      'Shifting imm left by 20 pushes its upper 20 bits off the top of the register: exactly the masking you need, for free.',
      'Combine with or, then or in the opcode 0x13 with ori.',
      'slli a2, a2, 20 / slli a1, a1, 15 / slli a0, a0, 7 / or a0, a0, a1 / or a0, a0, a2 / ori a0, a0, 0x13 / li a7, 93 / ecall',
    ],
    afterword:
      'A full assembler adds a lexer, a table of formats and two passes for labels, but every instruction ends in a step like this one. ' +
      'Going further: extend it to R-type, or read a line of text from memory and parse the register names.',
    code: code({
      starter:
        '# a0 = rd, a1 = rs1, a2 = imm. Return a0 = the word for: addi rd, rs1, imm\n' +
        '    # TODO: shift each field into place and OR them together\n' +
        `    ${EXIT}\n`,
      devices: [],
    }),
    tests: [
      addiCase('addi x1, x0, 5', 1, 0, 5),
      addiCase('addi a0, a0, -1', 10, 10, -1),
      addiCase('nop (addi x0, x0, 0)', 0, 0, 0),
      addiCase('addi x31, x31, -2048', 31, 31, -2048),
      addiCase('addi sp, sp, 2047', 2, 2, 2047),
    ],
    requires: ['strings-uart'],
    optional: true,
  }),
];
