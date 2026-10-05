# Explicit %hi/%lo and %pcrel_hi/%pcrel_lo addressing.
    .text
    .globl _start
_start:
    lui   a0, %hi(counter)
    lw    a1, %lo(counter)(a0)
    addi  a1, a1, 1
    sw    a1, %lo(counter)(a0)
    lui   a2, %hi(message)
    addi  a2, a2, %lo(message)
.Lpc0:
    auipc a3, %pcrel_hi(counter)
    lw    a4, %pcrel_lo(.Lpc0)(a3)
    sw    a4, %pcrel_lo(.Lpc0)(a3)
    addi  a5, a3, %pcrel_lo(.Lpc0)
.Lpc1:
    auipc a6, %pcrel_hi(message + 3)
    lbu   a7, %pcrel_lo(.Lpc1)(a6)
    lui   t0, %hi(0x12345fff)
    addi  t0, t0, %lo(0x12345fff)
    lui   t1, 0x10000
    lui   t2, 0xfffff
    auipc t3, 0
    j     _start

    .data
    .align 2
counter:
    .word 41
message:
    .asciz "relocations"
