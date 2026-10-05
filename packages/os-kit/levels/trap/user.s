# user.s: the user program for this level (read only). It runs in user mode
# and traps into your trap vector with ecall:
#   a7 = 1: print the character in a0      a7 = 2: a0 = a0 + a1
#   a7 = 93: exit with code a0
# a0 (from the boot argument) picks what it does:
#   0  print "Hello from user mode!"
#   1  fill all 31 registers (even sp), trap, and check that every register
#      except a0 came back unchanged and a0 = a0 + a1
#   2  trap 1000 times in a loop, printing a dot every 100 traps
#   3  run an illegal instruction
#   4  load from 0x40000000, where there is no memory or device

    .equ SYS_PUTC, 1
    .equ SYS_ADD, 2
    .equ SYS_EXIT, 93

    .text
    .globl user_main
user_main:
    beqz a0, hello
    li   t0, 1
    beq  a0, t0, regcheck
    li   t0, 2
    beq  a0, t0, many
    li   t0, 3
    beq  a0, t0, illegal
    j    badload

# ---------------------------------------------------------------- 0: hello
hello:
    la   s0, hello_msg
1:  lbu  a0, 0(s0)
    beqz a0, 2f
    li   a7, SYS_PUTC
    ecall
    addi s0, s0, 1
    j    1b
2:  li   a0, 0
    li   a7, SYS_EXIT
    ecall

# ------------------------------------------------------- 1: register check
# Pass A checks x1..x30 with x31 (t6) as scratch; pass B then checks x31.
regcheck:
    li   x1, 0x5b010101
    li   x2, 0x58020202
    li   x3, 0x59030303
    li   x4, 0x5e040404
    li   x5, 0x5f050505
    li   x6, 0x5c060606
    li   x7, 0x5d070707
    li   x8, 0x52080808
    li   x9, 0x53090909
    li   x10, 0x500a0a0a
    li   x11, 0x510b0b0b
    li   x12, 0x560c0c0c
    li   x13, 0x570d0d0d
    li   x14, 0x540e0e0e
    li   x15, 0x550f0f0f
    li   x16, 0x4a101010
    li   x17, 0x00000002
    li   x18, 0x48121212
    li   x19, 0x49131313
    li   x20, 0x4e141414
    li   x21, 0x4f151515
    li   x22, 0x4c161616
    li   x23, 0x4d171717
    li   x24, 0x42181818
    li   x25, 0x43191919
    li   x26, 0x401a1a1a
    li   x27, 0x411b1b1b
    li   x28, 0x461c1c1c
    li   x29, 0x471d1d1d
    li   x30, 0x441e1e1e
    li   x31, 0x451f1f1f
    ecall
    # a0 should now be the sum of the a0 and a1 we passed
    li   x31, 0x5b010101
    bne  x1, x31, bad1
    li   x31, 0x58020202
    bne  x2, x31, bad2
    li   x31, 0x59030303
    bne  x3, x31, bad3
    li   x31, 0x5e040404
    bne  x4, x31, bad4
    li   x31, 0x5f050505
    bne  x5, x31, bad5
    li   x31, 0x5c060606
    bne  x6, x31, bad6
    li   x31, 0x5d070707
    bne  x7, x31, bad7
    li   x31, 0x52080808
    bne  x8, x31, bad8
    li   x31, 0x53090909
    bne  x9, x31, bad9
    li   x31, 0xa1151515
    bne  x10, x31, bad10
    li   x31, 0x510b0b0b
    bne  x11, x31, bad11
    li   x31, 0x560c0c0c
    bne  x12, x31, bad12
    li   x31, 0x570d0d0d
    bne  x13, x31, bad13
    li   x31, 0x540e0e0e
    bne  x14, x31, bad14
    li   x31, 0x550f0f0f
    bne  x15, x31, bad15
    li   x31, 0x4a101010
    bne  x16, x31, bad16
    li   x31, 0x00000002
    bne  x17, x31, bad17
    li   x31, 0x48121212
    bne  x18, x31, bad18
    li   x31, 0x49131313
    bne  x19, x31, bad19
    li   x31, 0x4e141414
    bne  x20, x31, bad20
    li   x31, 0x4f151515
    bne  x21, x31, bad21
    li   x31, 0x4c161616
    bne  x22, x31, bad22
    li   x31, 0x4d171717
    bne  x23, x31, bad23
    li   x31, 0x42181818
    bne  x24, x31, bad24
    li   x31, 0x43191919
    bne  x25, x31, bad25
    li   x31, 0x401a1a1a
    bne  x26, x31, bad26
    li   x31, 0x411b1b1b
    bne  x27, x31, bad27
    li   x31, 0x461c1c1c
    bne  x28, x31, bad28
    li   x31, 0x471d1d1d
    bne  x29, x31, bad29
    li   x31, 0x441e1e1e
    bne  x30, x31, bad30
    # pass B: x31 itself
    li   x31, 0x13572468
    li   a7, SYS_ADD
    ecall
    li   x30, 0x13572468
    bne  x31, x30, bad31
    la   s0, ok_msg
    j    print_exit
bad1: li s1, 1
    j    bad
bad2: li s1, 2
    j    bad
bad3: li s1, 3
    j    bad
bad4: li s1, 4
    j    bad
bad5: li s1, 5
    j    bad
bad6: li s1, 6
    j    bad
bad7: li s1, 7
    j    bad
bad8: li s1, 8
    j    bad
bad9: li s1, 9
    j    bad
bad10: li s1, 10
    j    bad
bad11: li s1, 11
    j    bad
bad12: li s1, 12
    j    bad
bad13: li s1, 13
    j    bad
bad14: li s1, 14
    j    bad
bad15: li s1, 15
    j    bad
bad16: li s1, 16
    j    bad
bad17: li s1, 17
    j    bad
bad18: li s1, 18
    j    bad
bad19: li s1, 19
    j    bad
bad20: li s1, 20
    j    bad
bad21: li s1, 21
    j    bad
bad22: li s1, 22
    j    bad
bad23: li s1, 23
    j    bad
bad24: li s1, 24
    j    bad
bad25: li s1, 25
    j    bad
bad26: li s1, 26
    j    bad
bad27: li s1, 27
    j    bad
bad28: li s1, 28
    j    bad
bad29: li s1, 29
    j    bad
bad30: li s1, 30
    j    bad
bad31: li s1, 31
    j    bad
bad:
    la   sp, user_stack_top      # (sp may be the broken one)
    la   s0, bad_msg
    call print
    li   t0, 10
    blt  s1, t0, 3f
    li   t0, 10                  # two digits: tens first
    div  a0, s1, t0
    addi a0, a0, '0'
    li   a7, SYS_PUTC
    ecall
    li   t0, 10
    rem  s1, s1, t0
3:  addi a0, s1, '0'
    li   a7, SYS_PUTC
    ecall
    la   s0, changed_msg
    j    print_exit

# ---------------------------------------------------------- 2: many traps
many:
    li   s0, 0                   # traps so far
    li   s1, 1000
4:  li   a0, 7
    li   a1, 5
    li   a7, SYS_ADD
    ecall
    li   t0, 12
    bne  a0, t0, wrong_sum
    addi s0, s0, 1
    li   t0, 100
    rem  t1, s0, t0
    bnez t1, 5f
    li   a0, '.'
    li   a7, SYS_PUTC
    ecall
5:  blt  s0, s1, 4b
    la   s0, newline
    j    print_exit
wrong_sum:
    la   s0, sum_msg
    j    print_exit

# -------------------------------------------------- 3 and 4: faults
illegal:
    .word 0x00000000             # not an instruction
    la   s0, survived_msg
    j    print_exit
badload:
    li   t1, 0x40000000
    lw   t0, 0(t1)               # no memory or device there: access fault
    la   s0, survived_msg
    j    print_exit

# print the string at s0, then exit(0)
print_exit:
    call print
    li   a0, 0
    li   a7, SYS_EXIT
    ecall

# print(s0): one ecall per character
print:
1:  lbu  a0, 0(s0)
    beqz a0, 2f
    li   a7, SYS_PUTC
    ecall
    addi s0, s0, 1
    j    1b
2:  ret

    .section .rodata
hello_msg:    .asciz "Hello from user mode!\n"
ok_msg:       .asciz "registers ok\n"
bad_msg:      .asciz "register x"
changed_msg:  .asciz " changed\n"
sum_msg:      .asciz "\nwrong result from ecall\n"
survived_msg: .asciz "the fault was ignored!\n"
newline:      .asciz "\n"

    .bss
    .align 4
user_stack: .space 256
user_stack_top:
