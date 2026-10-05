# A switch statement through a table of addresses.
    .text
    .globl _start
_start:
    li    a0, 2
    call  dispatch
1:  j     1b

dispatch:
    li    t0, 4
    bgeu  a0, t0, case_default
    la    t1, jump_table
    slli  t2, a0, 2
    add   t1, t1, t2
    lw    t1, 0(t1)
    jr    t1
case0:
    li    a0, 100
    ret
case1:
    li    a0, 200
    ret
case2:
    li    a0, 300
    ret
case3:
    li    a0, 400
    ret
case_default:
    li    a0, -1
    ret

    .section .rodata
    .align 2
jump_table:
    .word case0, case1, case2, case3
