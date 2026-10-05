# ucrt.s: where a program starts. The kernel enters here in user mode with
# a0 = argc and a1 = argv; main's return value becomes the exit code.

    .text
    .globl _ustart
_ustart:
    call main
    call exit
1:  j    1b

# Start read-only data on a fresh page, so the pages holding code hold
# nothing else: the kernel maps them executable but not writable.
    .section .rodata
    .balign 4096
    .asciz "ucrt"
