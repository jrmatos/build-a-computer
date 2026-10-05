# li expansion at the boundaries (lui + addi rounding).
    .equ BIG, 0x12345678
    .text
    .globl _start
_start:
    li a0, 0
    li a0, 1
    li a0, -1
    li a0, 2047
    li a0, -2048
    li a0, 2048
    li a0, -2049
    li a0, 4095
    li a0, 4096
    li a0, 0x800
    li a0, 0xfff
    li a0, 0x1000
    li a0, 0x7ff
    li a0, 0x7fffffff
    li a0, 0x80000000
    li a0, -2147483648
    li a0, 0xffffffff
    li a0, 0xfffff800
    li a0, 0xfffff7ff
    li a0, 0x7ffff800
    li a0, 0x7ffff7ff
    li a0, 0x12345fff
    li a0, 0x12345800
    li a0, BIG
    li a0, BIG + 1
    li a0, -BIG
    li t6, 0x10000000
    li x31, 0x80000001
