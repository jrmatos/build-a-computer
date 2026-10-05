import type { Level } from '@build-a-computer/schema';

/**
 * Reference solutions for every Phase 7 level, as assembly source (the
 * player's main.s; library files come from the level). Loaded by the game
 * only on "Show solution" (ADR-007).
 */

const EXIT = `    li   a7, 93          # exit, code in a0
    ecall`;

export const PHASE7_SOLUTIONS: Record<string, string> = {
  'mmio-basics': `    .equ UART, 0x10000000
    li   t0, UART
    sb   a0, 0(t0)       # transmit register (offset 0): prints the low byte of a0
    sb   a0, 0(t0)       # and again
    lbu  a1, 5(t0)       # line status register (offset 5)
    ebreak
`,

  'uart-output': `    .equ UART, 0x10000000
    .section .rodata
hello:
    .asciz "Hello, world!\\n"

    .text
    .globl _start
_start:
    mv   s0, a0          # the number, for later
    li   t0, UART
    la   t1, hello
print:
    lbu  t2, 0(t1)
    beqz t2, number
    sb   t2, 0(t0)
    addi t1, t1, 1
    j    print
number:
    la   t1, digits_end  # build the digits backwards, last digit first
    li   t3, 10
digit:
    remu t2, s0, t3      # lowest digit
    divu s0, s0, t3
    addi t2, t2, '0'
    addi t1, t1, -1
    sb   t2, 0(t1)
    bnez s0, digit       # do-while: 0 still prints one digit
    la   t3, digits_end
out:
    lbu  t2, 0(t1)
    sb   t2, 0(t0)
    addi t1, t1, 1
    bne  t1, t3, out
    li   t2, '\\n'
    sb   t2, 0(t0)
    ebreak

    .bss
digits:
    .space 12            # 4294967295 has 10 digits
digits_end:
`,

  'keyboard-polling': `    .equ KBD, 0x10001000
    .text
    .globl _start
_start:
    li   s0, KBD
    li   s1, 0           # keys before the newline
wait:
    lw   t0, 0(s0)       # status: bit 0 = a key is waiting
    andi t0, t0, 1
    beqz t0, wait
    lw   a0, 4(s0)       # data: pops the key
    li   t1, '\\n'
    beq  a0, t1, done
    li   t1, 'a'
    bltu a0, t1, echo
    li   t1, 'z'
    bgtu a0, t1, echo
    addi a0, a0, -32     # a-z -> A-Z
echo:
    call putc
    addi s1, s1, 1
    j    wait
done:
    call putc            # echo the newline too
    mv   a0, s1
${EXIT}
`,

  'csr-timer': `    .text
    .globl _start
_start:
    csrr a1, misa        # a CSR read: which ISA is this?
    rdtime t0            # start time (csrr t0, time)
spin:
    rdtime t1
    sub  t2, t1, t0      # elapsed, correct even if the low word wraps
    bltu t2, a0, spin
    li   t3, 1000
    divu a0, t2, t3      # elapsed thousands of ticks
${EXIT}
`,

  'trap-handler': `    .text
    .globl _start
_start:
    la   t0, handler
    csrw mtvec, t0       # direct mode: every trap jumps to handler
    call run_program
    la   t0, faults
    lw   a0, 0(t0)
${EXIT}

    .align 2             # mtvec needs a 4-byte aligned address
handler:
    csrw mscratch, t0    # free one register
    la   t0, save
    sw   t1, 0(t0)
    sw   t2, 4(t0)
    csrr t1, mcause
    li   t2, 11          # ecall from machine mode
    beq  t1, t2, syscall
    la   t2, faults      # anything else: count it and skip the instruction
    lw   t1, 0(t2)
    addi t1, t1, 1
    sw   t1, 0(t2)
    j    skip
syscall:
    li   t2, 1
    bne  a7, t2, skip
    li   t1, 0x10000000
    sb   a0, 0(t1)       # call 1: print a0
skip:
    csrr t1, mepc
    addi t1, t1, 4       # resume after the trapping instruction
    csrw mepc, t1
    lw   t1, 0(t0)
    lw   t2, 4(t0)
    csrr t0, mscratch
    mret

    .data
save:
    .word 0, 0
faults:
    .word 0
`,

  'timer-interrupt': `    .equ MTIMECMP, 0x02004000
    .equ MTIME, 0x0200bff8
    .equ UART, 0x10000000
    .equ PERIOD, 10000
    .text
    .globl _start
_start:
    mv   s0, a0          # N
    la   t0, handler
    csrw mtvec, t0
    call arm             # mtimecmp = mtime + PERIOD
    li   t0, 0x80
    csrs mie, t0         # MTIE: timer interrupts enabled
    csrsi mstatus, 8     # MIE: interrupts on
    la   s1, ticks
loop:
    lw   t0, 0(s1)
    bgeu t0, s0, done
    wfi                  # sleep until the next interrupt
    j    loop
done:
    csrci mstatus, 8     # interrupts off
    li   t0, UART
    li   t1, '\\n'
    sb   t1, 0(t0)
    lw   a0, 0(s1)
    la   t0, last_cause
    lw   a1, 0(t0)
${EXIT}

# mtimecmp = mtime + PERIOD (64-bit add). Changes t0-t3.
arm:
    li   t0, MTIME
    lw   t1, 0(t0)
    lw   t2, 4(t0)
    li   t3, PERIOD
    add  t3, t1, t3
    sltu t1, t3, t1      # carry out of the low word
    add  t2, t2, t1
    li   t0, MTIMECMP
    li   t1, -1
    sw   t1, 0(t0)       # low = max first, so no early match while updating
    sw   t2, 4(t0)
    sw   t3, 0(t0)
    ret

    .align 2
handler:
    addi sp, sp, -32
    sw   ra, 0(sp)
    sw   t0, 4(sp)
    sw   t1, 8(sp)
    sw   t2, 12(sp)
    sw   t3, 16(sp)
    csrr t0, mcause
    la   t1, last_cause
    sw   t0, 0(t1)
    la   t1, ticks
    lw   t2, 0(t1)
    addi t2, t2, 1
    sw   t2, 0(t1)
    li   t0, UART
    li   t1, '.'
    sb   t1, 0(t0)
    call arm             # next interrupt one period from now (clears MTIP)
    lw   ra, 0(sp)
    lw   t0, 4(sp)
    lw   t1, 8(sp)
    lw   t2, 12(sp)
    lw   t3, 16(sp)
    addi sp, sp, 32
    mret

    .data
ticks:
    .word 0
last_cause:
    .word 0
`,

  'draw-framebuffer': `    .equ FB, 0x20000000
    .equ FBCTL, 0x10003000
    .equ W, 320
    .equ H, 200
    .text
    .globl _start
_start:
    li   t0, FBCTL
    li   t1, 1
    sw   t1, 8(t0)       # enable the screen
    li   t0, FB          # 1. fill with a0
    li   t1, FB + W*H
fill:
    sb   a0, 0(t0)
    addi t0, t0, 1
    bltu t0, t1, fill
    li   t2, 15          # 2. white border
    li   t0, FB          # top row
    li   t3, FB + W*(H-1) # bottom row
    li   t4, W
rows:
    sb   t2, 0(t0)
    sb   t2, 0(t3)
    addi t0, t0, 1
    addi t3, t3, 1
    addi t4, t4, -1
    bnez t4, rows
    li   t0, FB          # left and right columns
    li   t4, H
cols:
    sb   t2, 0(t0)
    sb   t2, W-1(t0)
    addi t0, t0, W
    addi t4, t4, -1
    bnez t4, cols
    li   t2, 12          # 3. a1 x a1 square at (10, 10)
    li   t0, FB + 10*W + 10
    mv   t4, a1          # rows left
square:
    beqz t4, done
    mv   t5, t0
    mv   t6, a1          # pixels left in this row
line:
    beqz t6, next_row
    sb   t2, 0(t5)
    addi t5, t5, 1
    addi t6, t6, -1
    j    line
next_row:
    addi t0, t0, W
    addi t4, t4, -1
    j    square
done:
    ebreak
`,

  'block-device': `    .equ BLK, 0x10002000
    .equ UART, 0x10000000
    .text
    .globl main
main:
    li   t0, BLK
    sw   zero, 0(t0)     # SECTOR = 0: the directory
    li   t1, 1
    sw   t1, 4(t0)       # COMMAND = 1: read
    lw   t1, 8(t0)       # STATUS: 0 = ok
    bnez t1, error
    lw   a1, 0x200(t0)   # first sector of the message
    lw   a2, 0x204(t0)   # its length in bytes
    li   a0, 0           # sum of the bytes
    li   t3, UART
    li   t5, 512
    mv   t4, t5          # offset in the buffer; 512 = read the next sector
    addi a1, a1, -1
copy:
    beqz a2, done
    bltu t4, t5, byte
    addi a1, a1, 1       # next sector
    sw   a1, 0(t0)
    li   t1, 1
    sw   t1, 4(t0)
    lw   t1, 8(t0)
    bnez t1, error
    li   t4, 0
byte:
    add  t1, t0, t4
    lbu  t2, 0x200(t1)
    sb   t2, 0(t3)
    add  a0, a0, t2
    addi t4, t4, 1
    addi a2, a2, -1
    j    copy
done:
    ret
error:
    la   t1, message
    li   t3, UART
1:  lbu  t2, 0(t1)
    beqz t2, 2f
    sb   t2, 0(t3)
    addi t1, t1, 1
    j    1b
2:  li   a0, -1
    ret

    .section .rodata
message:
    .asciz "disk error\\n"
`,
};

export const phase7Source = (level: Level): string | undefined => PHASE7_SOLUTIONS[level.id];
