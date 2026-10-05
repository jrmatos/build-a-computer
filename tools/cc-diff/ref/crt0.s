# Startup code for corpus programs (both gcc and our toolchain).
# The loader sets sp to the top of RAM; main's return value becomes the exit code.
    .text
    .globl _start
_start:
    call main
    li a7, 93
    ecall
