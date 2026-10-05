# Recursive Fibonacci with a proper stack frame.
    .text
    .globl _start
_start:
    li   sp, 0x80100000
    li   a0, 10
    call fib
    la   t0, result
    sw   a0, 0(t0)
halt:
    wfi
    j    halt

# a0 = n -> a0 = fib(n)
fib:
    li   t0, 2
    blt  a0, t0, fib_base
    addi sp, sp, -16
    sw   ra, 12(sp)
    sw   s0, 8(sp)
    sw   s1, 4(sp)
    mv   s0, a0
    addi a0, s0, -1
    call fib
    mv   s1, a0
    addi a0, s0, -2
    call fib
    add  a0, a0, s1
    lw   ra, 12(sp)
    lw   s0, 8(sp)
    lw   s1, 4(sp)
    addi sp, sp, 16
fib_base:
    ret

    .bss
    .align 2
result:
    .zero 4
