# A kernel whose first bytes are data: the entry point is not the load address.
    .text
table:
    .space 600, 0xff         # not instructions: jumping here is an illegal instruction
    .globl _start
_start:
    la   a0, msg
    li   t0, 0x10000000
1:  lbu  t1, 0(a0)
    beqz t1, 2f
    sb   t1, 0(t0)
    addi a0, a0, 1
    j    1b
2:  li   a0, 0
    li   a7, 93
    ecall

    .section .rodata
msg:
    .asciz "Started at the entry point.\n"
