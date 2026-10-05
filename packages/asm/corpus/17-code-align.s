# Alignment padding inside code.
    .text
    .globl _start
_start:
    nop
    .align 3
aligned8:
    nop
    .byte 1
    .align 4
aligned16:
    nop
    .byte 1, 2
    .balign 8
    nop
    .byte 1, 2, 3
    .p2align 3
    ret
    .align 2
    .byte 9
