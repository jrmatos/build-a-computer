# A kernel several sectors long: it prints a message stored after its code.
    .text
    .globl _start
_start:
    la   a0, msg
    li   t0, 0x10000000
1:  lbu  t1, 0(a0)
    beqz t1, 2f
    sb   t1, 0(t0)
    addi a0, a0, 1
    j    1b
2:  li   a0, 7
    li   a7, 93
    ecall

    .section .rodata
msg:
    .ascii "Line 01 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 02 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 03 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 04 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 05 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 06 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 07 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 08 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 09 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 10 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 11 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 12 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 13 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 14 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 15 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 16 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 17 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 18 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 19 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 20 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 21 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 22 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 23 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 24 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 25 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 26 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 27 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 28 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 29 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 30 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 31 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 32 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 33 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 34 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 35 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 36 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 37 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 38 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 39 of the kernel: every sector has to be loaded.\n"
    .ascii "Line 40 of the kernel: every sector has to be loaded.\n"
    .byte 0
