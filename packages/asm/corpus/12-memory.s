# Loads, stores and branches in every form.
    .text
    .globl _start
_start:
    la   s0, buf
    lb   a0, 0(s0)
    lh   a1, 2(s0)
    lw   a2, 4(s0)
    lbu  a3, -1(s0)
    lhu  a4, 2047(s0)
    lw   a5, -2048(s0)
    lw   a6, (s0)
    sb   a0, 1(s0)
    sh   a1, -2(s0)
    sw   a2, 8(s0)
    sw   a2, (s0)
back:
    beq  a0, a1, back
    bne  a0, a1, fwd
    blt  a0, a1, back
    bge  a0, a1, fwd
    bltu a0, a1, back
    bgeu a0, a1, fwd
    jal  ra, back
    jal  zero, fwd
    jalr ra, 0(a0)
    jalr zero, -4(a0)
fwd:
    ret
    .data
    .zero 16
buf:
    .word 1, 2, 3, 4
