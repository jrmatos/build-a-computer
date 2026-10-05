import type { Level } from '@build-a-computer/schema';

/**
 * Reference solutions for every Phase 6 level, as assembly source (the
 * player's main.s; library files come from the level). Loaded by the game
 * only on "Show solution" (ADR-007).
 */

const EXIT = `    li   a7, 93          # exit, code in a0
    ecall`;

export const PHASE6_SOLUTIONS: Record<string, string> = {
  'hand-encode': `# Each instruction, packed by hand.
    .word 0x00b50633   # add  a2, a0, a1
    .word 0x40b506b3   # sub  a3, a0, a1
    .word 0xfff50713   # addi a4, a0, -1
    .word 0x123457b7   # lui  a5, 0x12345
    .word 0x00100073   # ebreak
`,

  'abi-names': `    add  a2, a0, a1      # sum, while a0 and a1 are still the originals
    sub  a3, a0, a1      # difference
    mv   t0, a0          # swap through a temporary; s0 and s1 stay untouched
    mv   a0, a1
    mv   a1, t0
    ebreak
`,

  'loop-sum': `# a0 = n. Exit with 1 + 2 + ... + n.
    li   t0, 0           # running total
loop:
    beqz a0, done        # test first, so n = 0 runs the body zero times
    add  t0, t0, a0
    addi a0, a0, -1
    j    loop
done:
    mv   a0, t0
${EXIT}
`,

  'array-sum-max': `# a0 = address, a1 = count. Return a0 = sum, a1 = largest (signed).
    li   t0, 0           # sum
    li   t1, 0           # largest (0 for an empty array)
    beqz a1, done
    lw   t1, 0(a0)       # largest starts at the first word
loop:
    lw   t2, 0(a0)
    add  t0, t0, t2
    bge  t1, t2, skip    # signed compare
    mv   t1, t2
skip:
    addi a0, a0, 4
    addi a1, a1, -1
    bnez a1, loop
done:
    mv   a0, t0
    mv   a1, t1
${EXIT}
`,

  'functions-stack': `# sum_squares(a0 = n) returns a0 = 1*1 + 2*2 + ... + n*n.
    .globl sum_squares
sum_squares:
    addi sp, sp, -16
    sw   ra, 12(sp)
    sw   s0, 8(sp)
    sw   s1, 4(sp)
    mv   s0, a0          # s0 = i, from n down to 1
    li   s1, 0           # s1 = total
loop:
    beqz s0, done
    mv   a0, s0
    call square          # may wipe t and a registers, never s
    add  s1, s1, a0
    addi s0, s0, -1
    j    loop
done:
    mv   a0, s1
    lw   s1, 4(sp)
    lw   s0, 8(sp)
    lw   ra, 12(sp)
    addi sp, sp, 16
    ret
`,

  recursion: `# fib(a0 = n) returns a0 = fib(n).
    .globl fib
fib:
    li   t0, 2
    blt  a0, t0, base    # fib(0) = 0, fib(1) = 1
    addi sp, sp, -16
    sw   ra, 12(sp)
    sw   s0, 8(sp)
    sw   s1, 4(sp)
    mv   s0, a0          # n
    addi a0, a0, -1
    call fib
    mv   s1, a0          # fib(n - 1)
    addi a0, s0, -2
    call fib
    add  a0, a0, s1      # fib(n - 2) + fib(n - 1)
    lw   s1, 4(sp)
    lw   s0, 8(sp)
    lw   ra, 12(sp)
    addi sp, sp, 16
base:
    ret
`,

  'strings-uart': `# a0 = address of a 0-terminated string. Print it in uppercase; exit with its length.
    .equ UART, 0x10000000
    li   t0, UART
    li   t1, 0           # length
loop:
    lbu  t2, 0(a0)
    beqz t2, done
    li   t3, 'a'
    blt  t2, t3, put
    li   t3, 'z'
    bgt  t2, t3, put
    addi t2, t2, -32     # 'a' - 'A' = 32
put:
    sb   t2, 0(t0)
    addi a0, a0, 1
    addi t1, t1, 1
    j    loop
done:
    mv   a0, t1
${EXIT}
`,

  'encode-addi': `# a0 = rd, a1 = rs1, a2 = imm. Return a0 = the word for addi rd, rs1, imm.
    slli a2, a2, 20      # imm[11:0] -> bits 31-20; the upper bits fall off
    slli a1, a1, 15      # rs1 -> bits 19-15
    slli a0, a0, 7       # rd -> bits 11-7
    or   a0, a0, a1
    or   a0, a0, a2
    ori  a0, a0, 0x13    # opcode OP-IMM, funct3 = 0
${EXIT}
`,
};

/** The reference source of a Phase 6 level, or undefined. */
export const phase6Source = (level: Level): string | undefined => PHASE6_SOLUTIONS[level.id];
