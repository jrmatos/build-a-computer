# strlen and strcpy over NUL-terminated strings.
    .text
    .globl _start
_start:
    la   a0, greeting
    call strlen
    mv   s0, a0
    la   a0, buffer
    la   a1, greeting
    call strcpy
1:  j    1b

strlen:
    mv   t0, a0
1:  lbu  t1, 0(t0)
    beqz t1, 2f
    addi t0, t0, 1
    j    1b
2:  sub  a0, t0, a0
    ret

strcpy:
    mv   t0, a0
1:  lbu  t1, 0(a1)
    sb   t1, 0(t0)
    addi a1, a1, 1
    addi t0, t0, 1
    bnez t1, 1b
    ret

    .section .rodata
greeting:
    .string "Hello, RISC-V!\n"
escapes:
    .ascii "tab\there \"quoted\" back\\slash \x41\101\0"
    .asciz "a", "bc"

    .bss
buffer:
    .space 64
