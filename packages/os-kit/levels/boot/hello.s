# A tiny kernel: say hello and power off.
    .text
    .globl _start
_start:
    la   a0, msg
    call puts
    li   a0, 0
    li   a7, 93
    ecall

puts:
    li   t0, 0x10000000
1:  lbu  t1, 0(a0)
    beqz t1, 2f
    sb   t1, 0(t0)
    addi a0, a0, 1
    j    1b
2:  ret

    .section .rodata
msg:
    .asciz "Hello from the kernel!\n"
