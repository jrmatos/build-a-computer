# Bubble sort of a word array in place.
    .text
    .globl _start
_start:
    la    a0, data
    la    a1, data_end
    sub   a1, a1, a0
    srli  a1, a1, 2
    call  sort
2:  j     2b

# a0 = array, a1 = n
sort:
    addi  sp, sp, -16
    sw    ra, 12(sp)
    li    t0, 1
outer:
    bge   t0, a1, sorted
    li    t2, 0          # swapped
    li    t1, 0
inner:
    addi  t3, a1, -1
    bge   t1, t3, inner_done
    slli  t4, t1, 2
    add   t4, a0, t4
    lw    t5, 0(t4)
    lw    t6, 4(t4)
    ble   t5, t6, no_swap
    sw    t6, 0(t4)
    sw    t5, 4(t4)
    li    t2, 1
no_swap:
    addi  t1, t1, 1
    j     inner
inner_done:
    beqz  t2, sorted
    j     outer
sorted:
    lw    ra, 12(sp)
    addi  sp, sp, 16
    ret

    .data
data:
    .word 5, 3, 9, -1, 0, 42, 17, 8, 8, -100
data_end:
