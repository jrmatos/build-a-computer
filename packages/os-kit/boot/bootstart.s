# bootstart.s: the machine starts here (provided). Run the bootloader; if it
# returns, something went wrong: exit with its return value.

    .text
    .globl _start
_start:
    call boot_main
    li   a7, 93
    ecall
