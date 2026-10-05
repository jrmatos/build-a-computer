# A stack in .bss, set up with la, plus a sum over a .bss array.
    .equ STACK_SIZE, 1024
    .equ N, 16
    .text
    .globl _start
_start:
    la    sp, stack_top
    la    a0, numbers
    li    t0, 0
fill:
    slli  t1, t0, 2
    add   t1, a0, t1
    sw    t0, 0(t1)
    addi  t0, t0, 1
    li    t2, N
    blt   t0, t2, fill
    li    a1, N
    call  sum
park:
    j     park

sum:
    addi  sp, sp, -8
    sw    ra, 4(sp)
    li    t0, 0
1:  beqz  a1, 2f
    lw    t1, 0(a0)
    add   t0, t0, t1
    addi  a0, a0, 4
    addi  a1, a1, -1
    j     1b
2:  mv    a0, t0
    lw    ra, 4(sp)
    addi  sp, sp, 8
    ret

    .bss
    .align 4
numbers:
    .zero N * 4
stack:
    .space STACK_SIZE
stack_top:
