# Numeric local labels, reused many times.
    .text
    .globl _start
_start:
    li   t0, 3
1:  addi t0, t0, -1
    bnez t0, 1b
    li   t0, 3
1:  addi t0, t0, -1
    beqz t0, 1f
    j    1b
1:  li   t1, 5
2:  j    3f
3:  addi t1, t1, -1
    bgtz t1, 2b
    j    1f
1:
10: nop
    j 10b
