# Sum the numbers 1..10 into a0, then stop.
    .text
    .globl _start
_start:
    li   a0, 0          # sum
    li   t0, 1          # i
    li   t1, 10         # limit
loop:
    add  a0, a0, t0
    addi t0, t0, 1
    ble  t0, t1, loop
done:
    j    done
