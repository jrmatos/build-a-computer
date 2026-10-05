# Assembly-time expressions (GNU precedence).
    .equ A, 10
    .equ B, 3
    .equ C, (A + B) * 2
    .text
    .globl _start
_start:
    addi a0, zero, A + B
    addi a0, zero, A - B
    addi a0, zero, A * B
    addi a0, zero, A / B
    addi a0, zero, A % B
    addi a0, zero, A << B
    addi a0, zero, A >> 1
    addi a0, zero, A & B
    addi a0, zero, A | B
    addi a0, zero, A ^ B
    addi a0, zero, ~A
    addi a0, zero, -A
    addi a0, zero, C
    addi a0, zero, (1 << 4) - 1
    addi a0, zero, 'a'
    addi a0, zero, '\n'
    addi a0, zero, 0b1010
    addi a0, zero, 017
    addi a0, zero, 0x7f
    addi a0, zero, -(-5)
    li   a1, 1 << 31
    li   a1, (1 << 20) + 0x800
    li   a1, -1 >> 33
    slli a2, a2, B + 1
    .data
    .word A * 2 + B
    .word (end - start) / 4
start:
    .word 1, 2, 3
end:
    .word end - start
    .byte '0' + 7
