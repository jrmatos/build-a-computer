# Data directives, constants and sections.
    .equ  COUNT, 4
    .set  SIZE, COUNT * 4
    WIDTH = 320
    .text
    .globl _start
_start:
    la   a0, table
    li   a1, SIZE
    li   a2, WIDTH * 200
    lui  a3, %hi(WIDTH * 200)
    addi a3, a3, %lo(WIDTH * 200)
    j    _start

    .section .rodata
bytes:
    .byte 1, 2, 255, -128, 'A', '\n', 'z' - 'a'
halfs:
    .half 0x1234, -1, 65535
    .short 7
    .2byte 8
    .align 2
words:
    .word 0x12345678, -1, COUNT, SIZE
    .long 1
    .4byte 2
    .int 3
quad:
    .balign 8
    .dword 0x0123456789abcdef
    .quad -2

    .data
table:
    .word bytes, halfs, words, quad
    .word table + 4, words - bytes
    .half SIZE
    .byte COUNT
    .p2align 3
filled:
    .space 5, 0xaa
    .skip 3
    .zero 4
    .fill 3, 2, 0x1234
    .fill 2, 4, 0xcafef00d
    .fill 2
text:
    .ascii "abc"
    .string "def"
    .asciz "g"
end_of_data:

    .bss
    .align 3
heap_ptr:
    .word 0
scratch:
    .zero 100
