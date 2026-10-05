# Several functions: gcd (iterative), multiply-add, and a tail call.
    .text
    .globl _start
_start:
    li    sp, 0x80200000
    li    a0, 1071
    li    a1, 462
    call  gcd
    mv    s0, a0
    li    a0, 6
    li    a1, 7
    li    a2, 8
    call  muladd
    call  forward
3:  j     3b

gcd:
    beq   a0, a1, 2f
    bltu  a0, a1, 1f
    sub   a0, a0, a1
    j     gcd
1:  sub   a1, a1, a0
    j     gcd
2:  ret

muladd:
    mul   a0, a0, a1
    add   a0, a0, a2
    ret

forward:
    addi  a0, a0, 1
    tail  muladd
