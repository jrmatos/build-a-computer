# Every pseudo-instruction the assembler supports.
    .text
    .globl _start
_start:
    nop
    mv    a0, a1
    not   a2, a3
    neg   a4, a5
    seqz  t0, t1
    snez  t2, s0
    sltz  s1, a0
    sgtz  a1, a2
    beqz  a0, target
    bnez  a0, target
    blez  a0, target
    bgez  a0, target
    bltz  a0, target
    bgtz  a0, target
    bgt   a0, a1, target
    ble   a0, a1, target
    bgtu  a0, a1, target
    bleu  a0, a1, target
    j     target
    jal   target
    jal   t0, target
    jr    t0
    jalr  t1
    jalr  t0, 8(t1)
    jalr  t0, t1, -4
    ret
    call  target
    tail  target
    la    a0, target
    lla   a1, target
    lw    a2, word
    lh    a3, word
    lbu   a4, word
    sw    a2, word, t3
    sb    a2, word, t4
target:
    ret
    .data
word:
    .word 0xdeadbeef
