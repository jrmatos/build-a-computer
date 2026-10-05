# Print a string to the 16550 UART at 0x1000_0000.
    .equ UART_BASE, 0x10000000
    .equ UART_THR, 0
    .equ UART_LSR, 5
    .equ LSR_THRE, 1 << 5
    .text
    .globl _start
_start:
    li   s0, UART_BASE
    la   s1, hello
next:
    lbu  a0, 0(s1)
    beqz a0, finished
wait:
    lbu  t0, UART_LSR(s0)
    andi t0, t0, LSR_THRE
    beqz t0, wait
    sb   a0, UART_THR(s0)
    addi s1, s1, 1
    j    next
finished:
    wfi
    j    finished
    .section .rodata
hello:
    .asciz "Hello from the board\r\n"
