/**
 * RV32I test programs for the Phase 5 CPU levels (docs/rv32-datapath.md).
 *
 * Conventions of the Phase 5 machine (a Harvard machine, like Toy-8):
 * - Code is linked at address 0 and lives in the program ROM (256 words, so
 *   code stays below 0x400). The PC starts at 0.
 * - Data lives in a separate 4 KiB RAM behind the load/store unit. Programs
 *   only touch data addresses 0x400..0xFFF; the stack starts at 0x1000.
 * - A program ends with `ebreak`, which lights HALT and freezes the CPU.
 * - The tests check a0 (x10), shown on the A0 lamp.
 *
 * The assembled bytes and expected results live in programs.data.ts, made by
 * the packages/asm assembler and the packages/rv32 emulator (phase5.test.ts
 * checks that they are up to date; UPDATE_RV_PROGRAMS=1 rewrites them).
 */

export interface RvProgram {
  /** Stable key, also the test name. */
  name: string;
  /** One line for the test strip. */
  title: string;
  source: string;
}

const p = (name: string, title: string, source: string): RvProgram => ({ name, title, source });

// ------------------------------------------------- single-cycle datapath

export const ALU_OPS = p(
  'alu-ops',
  'every ALU instruction',
  `
# Every OP and OP-IMM instruction, folded into a0.
        li   t0, -7
        li   t1, 3
        add  a0, t0, t1      # -4
        sub  t2, t0, t1      # -10
        xor  a0, a0, t2
        and  t2, t0, t1
        add  a0, a0, t2
        or   t2, t0, t1
        add  a0, a0, t2
        sll  t2, t1, t1      # 24
        add  a0, a0, t2
        srl  t2, t0, t1
        xor  a0, a0, t2
        sra  t2, t0, t1      # -1
        add  a0, a0, t2
        slt  t2, t0, t1      # 1
        add  a0, a0, t2
        sltu t2, t0, t1      # 0
        add  a0, a0, t2
        addi a0, a0, -100
        xori a0, a0, 0x55
        ori  a0, a0, 0x700
        andi a0, a0, -2
        slli t2, a0, 3
        add  a0, a0, t2
        srli t2, t0, 28
        add  a0, a0, t2
        srai t2, t0, 1
        add  a0, a0, t2
        slti t2, t0, -6
        add  a0, a0, t2
        sltiu t2, t1, 4
        add  a0, a0, t2
        ebreak
`,
);

export const UPPER = p(
  'lui-auipc',
  'lui and auipc',
  `
        lui   a0, 0x12345
        addi  a0, a0, 0x678  # 0x12345678
        auipc t0, 1          # 0x1000 + this pc
        add   a0, a0, t0
        lui   t1, 0xfffff
        add   a0, a0, t1
        ebreak
`,
);

export const BRANCHES = p(
  'branches',
  'every branch, taken and not taken',
  `
# Each test adds one bit to a0 when the branch behaves; a0 = 0xfff at the end.
        li   a0, 0
        li   t0, -1
        li   t1, 1
        beq  t0, t0, 1f
        j    fail
1:      ori  a0, a0, 1
        beq  t0, t1, fail
        ori  a0, a0, 2
        bne  t0, t1, 1f
        j    fail
1:      ori  a0, a0, 4
        bne  t1, t1, fail
        ori  a0, a0, 8
        blt  t0, t1, 1f      # -1 < 1 signed
        j    fail
1:      ori  a0, a0, 16
        blt  t1, t0, fail
        ori  a0, a0, 32
        bge  t1, t0, 1f
        j    fail
1:      ori  a0, a0, 64
        bge  t0, t1, fail
        ori  a0, a0, 128
        bltu t1, t0, 1f      # 1 < 0xffffffff unsigned
        j    fail
1:      ori  a0, a0, 256
        bltu t0, t1, fail
        ori  a0, a0, 512
        bgeu t0, t1, 1f
        j    fail
1:      ori  a0, a0, 1024
        bgeu t1, t0, fail
        li   t2, 2048
        or   a0, a0, t2
        ebreak
fail:   li   a0, -1
        ebreak
`,
);

export const LOAD_STORE_WORD = p(
  'load-store-word',
  'sw and lw',
  `
        li   s0, 0x400
        li   t0, 0x11223344
        sw   t0, 0(s0)
        li   t1, -5
        sw   t1, 8(s0)
        addi s1, s0, 16
        sw   s0, -4(s1)      # 0x400 at 0x40c
        lw   a0, 0(s0)
        lw   t2, 8(s0)
        add  a0, a0, t2
        lw   t2, 12(s0)
        add  a0, a0, t2
        lw   t2, 4(s0)       # never written: 0
        add  a0, a0, t2
        ebreak
`,
);

export const BYTES_HALVES = p(
  'bytes-halves',
  'sb, sh, lb, lbu, lh, lhu',
  `
        li   s0, 0x500
        li   t0, 0x80
        sb   t0, 1(s0)
        li   t0, 0x7f
        sb   t0, 2(s0)
        li   t0, -2
        sh   t0, 6(s0)
        lw   a0, 0(s0)       # 0x007f8000
        lb   t1, 1(s0)       # -128
        add  a0, a0, t1
        lbu  t1, 1(s0)       # 128
        add  a0, a0, t1
        lb   t1, 2(s0)       # 127
        add  a0, a0, t1
        lh   t1, 6(s0)       # -2
        add  a0, a0, t1
        lhu  t1, 6(s0)       # 0xfffe
        add  a0, a0, t1
        lh   t1, 0(s0)       # 0x8000 → -32768
        xor  a0, a0, t1
        ebreak
`,
);

export const JUMPS = p(
  'jal-jalr',
  'jal, jalr, call and return',
  `
        li   a0, 5
        jal  ra, double      # a0 = 10
        jal  ra, double      # a0 = 20
        la   t0, add3
        jalr ra, 0(t0)       # a0 = 23
        jal  t1, 1f          # t1 = address of the next instruction
        li   a0, -1
1:      add  a0, a0, t1
        ebreak
double: add  a0, a0, a0
        ret
add3:   addi a0, a0, 3
        jr   ra
`,
);

// ------------------------------------------------- running test programs

export const SUM_LOOP = p(
  'sum-loop',
  'sum of 1..100',
  `
        li   a0, 0
        li   t0, 1
        li   t1, 100
loop:   add  a0, a0, t0
        addi t0, t0, 1
        bge  t1, t0, loop
        ebreak
`,
);

export const FIBONACCI = p(
  'fibonacci',
  'fib(25), iterative',
  `
        li   t0, 25          # n
        li   a0, 0           # fib(i)
        li   a1, 1           # fib(i + 1)
loop:   beqz t0, done
        add  t1, a0, a1
        mv   a0, a1
        mv   a1, t1
        addi t0, t0, -1
        j    loop
done:   ebreak
`,
);

export const MEMCPY = p(
  'memcpy-bytes',
  'copy bytes with lb and sb',
  `
# Write 16 bytes (some with the top bit set) to src, copy them to dst one
# byte at a time with lb/sb, then sum dst signed (lb) and unsigned (lbu).
        li   s0, 0x600       # src
        li   s1, 0x700       # dst
        li   t0, 0
        li   t1, 16
fill:   slli t2, t0, 4
        add  t2, t2, t0      # 17 * i: 0x00, 0x11, ..., 0xff
        add  t3, s0, t0
        sb   t2, 0(t3)
        addi t0, t0, 1
        blt  t0, t1, fill

        li   t0, 0
copy:   add  t3, s0, t0
        lb   t2, 0(t3)
        add  t3, s1, t0
        sb   t2, 0(t3)
        addi t0, t0, 1
        bltu t0, t1, copy

        li   a0, 0           # signed sum
        li   a1, 0           # unsigned sum
        li   t0, 0
sum:    add  t3, s1, t0
        lb   t2, 0(t3)
        add  a0, a0, t2
        lbu  t2, 0(t3)
        add  a1, a1, t2
        addi t0, t0, 1
        bne  t0, t1, sum
        slli a1, a1, 16
        xor  a0, a0, a1
        lw   t2, 12(s1)      # bytes 12..15 as one word
        xor  a0, a0, t2
        ebreak
`,
);

export const RECURSIVE_FIB = p(
  'recursive-fib',
  'fib(12), recursive with a stack',
  `
        li   sp, 0x1000
        li   a0, 12
        call fib
        ebreak

# fib(n) = n < 2 ? n : fib(n - 1) + fib(n - 2)
fib:    li   t0, 2
        blt  a0, t0, 1f
        addi sp, sp, -12
        sw   ra, 8(sp)
        sw   s0, 4(sp)
        sw   s1, 0(sp)
        mv   s0, a0
        addi a0, s0, -1
        call fib
        mv   s1, a0
        addi a0, s0, -2
        call fib
        add  a0, a0, s1
        lw   s1, 0(sp)
        lw   s0, 4(sp)
        lw   ra, 8(sp)
        addi sp, sp, 12
1:      ret
`,
);

export const MULTIPLY = p(
  'shift-add-multiply',
  '1234 x 5678 by shift and add',
  `
        li   a1, 1234
        li   a2, 5678
        li   a0, 0
loop:   andi t0, a2, 1
        beqz t0, skip
        add  a0, a0, a1
skip:   slli a1, a1, 1
        srli a2, a2, 1
        bnez a2, loop
        ebreak
`,
);

export const BUBBLE_SORT = p(
  'bubble-sort',
  'sort 8 words, then checksum',
  `
        li   s0, 0x800
        li   t0, 0
        li   t1, 8
        li   t2, 0x9e3779b9
        li   t3, 12345
gen:    xor  t3, t3, t2      # some scrambled values, signed
        srai t4, t3, 7
        add  t3, t3, t4
        slli t4, t0, 2
        add  t4, t4, s0
        sw   t3, 0(t4)
        addi t0, t0, 1
        blt  t0, t1, gen

        li   t5, 7           # passes
outer:  li   t0, 0
inner:  slli t4, t0, 2
        add  t4, t4, s0
        lw   a1, 0(t4)
        lw   a2, 4(t4)
        ble  a1, a2, 1f
        sw   a2, 0(t4)
        sw   a1, 4(t4)
1:      addi t0, t0, 1
        blt  t0, t5, inner
        addi t5, t5, -1
        bnez t5, outer

        li   a0, 0           # sorted? and a position-weighted checksum
        li   t0, 0
        li   a3, 1           # 1 while sorted
check:  slli t4, t0, 2
        add  t4, t4, s0
        lw   a1, 0(t4)
        sll  a2, a1, t0
        add  a0, a0, a2
        addi t0, t0, 1
        bge  t0, t1, 2f
        lw   a2, 4(t4)
        slt  a2, a2, a1
        beqz a2, check
        li   a3, 0
        j    check
2:      xor  a0, a0, a3
        ebreak
`,
);

/** Back-to-back dependencies and a load-use pair: the hazards a pipeline must handle. */
export const HAZARDS = p(
  'hazards',
  'dependent instructions back to back',
  `
        li   s0, 0x400
        addi t0, zero, 1
        addi t0, t0, 2       # depends on the line above
        add  t1, t0, t0      # and again
        sw   t1, 0(s0)
        lw   t2, 0(s0)
        add  t3, t2, t1      # load-use
        lw   t4, 0(s0)
        beq  t4, t1, 1f      # load then branch
        li   t3, -1
1:      add  a0, t3, t4
        jal  ra, 2f
        addi a0, a0, 100     # runs after the return
        ebreak
2:      addi a0, a0, 1000
        ret
`,
);

/** The single-cycle datapath level: one program per instruction class. */
export const DATAPATH_PROGRAMS = [ALU_OPS, UPPER, BRANCHES, LOAD_STORE_WORD, BYTES_HALVES, JUMPS];
/** The running-programs level. */
export const RUN_PROGRAMS = [SUM_LOOP, FIBONACCI, MEMCPY, RECURSIVE_FIB, MULTIPLY, BUBBLE_SORT];
/** The pipeline level. */
export const PIPELINE_PROGRAMS = [HAZARDS, BRANCHES, BYTES_HALVES, JUMPS, SUM_LOOP, RECURSIVE_FIB, BUBBLE_SORT];

export const ALL_PROGRAMS: RvProgram[] = [...new Map([...DATAPATH_PROGRAMS, ...RUN_PROGRAMS, ...PIPELINE_PROGRAMS].map((q) => [q.name, q])).values()];
