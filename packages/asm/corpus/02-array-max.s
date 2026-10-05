# Find the largest word in an array.
    .equ N, 8
    .text
    .globl _start
_start:
    la   a0, values
    li   a1, N
    call max
1:  j    1b

# a0 = array, a1 = count -> a0 = max
max:
    lw   t0, 0(a0)
    addi a1, a1, -1
2:  beqz a1, 3f
    addi a0, a0, 4
    lw   t1, 0(a0)
    bge  t0, t1, 4f
    mv   t0, t1
4:  addi a1, a1, -1
    j    2b
3:  mv   a0, t0
    ret

    .data
values:
    .word 12, -5, 99, 42, 0x7fffffff, -2147483648, 7, 3
