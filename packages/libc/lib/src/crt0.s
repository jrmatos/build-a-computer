# crt0.s: the code that runs before main.
#
# The machine starts here with sp already pointing one past the last byte of
# RAM (the stack grows down from there). crt0 then:
#   1. zeroes .bss, the globals with no initial value (C promises they start at 0);
#   2. calls main(0, NULL);
#   3. passes main's return value to exit, which ends the program with ecall 93.
#
# Link crt0.s first and end.s last: __bss_start (below) and _end (in end.s) are
# plain labels, so they only bracket all of .bss when the files are in that order.

    .text
    .globl _start
_start:
    la t0, __bss_start
    la t1, _end
zero_bss:
    bgeu t0, t1, call_main
    sb zero, 0(t0)
    addi t0, t0, 1
    j zero_bss

call_main:
    li a0, 0              # argc
    li a1, 0              # argv
    call main
                          # main's return value is in a0: fall into exit

# void exit(int code): stop the machine; the exit code is a0.
    .globl exit
    .globl _exit
exit:
_exit:
    li a7, 93             # 93 = exit
    ecall
    j exit                # ecall 93 never returns

    .bss
    .balign 4
    .globl __bss_start
__bss_start:
    .zero 4               # one word, so the section is not empty and the label has an address
