# bootlib.s: boot_jump(entry, a0, a1, a2) (provided).
# C cannot jump to a number, so this moves the arguments down one register
# and jumps. The kernel starts with a0, a1, a2 set; ra is left as it was.

    .text
    .globl boot_jump
boot_jump:
    mv   t0, a0
    mv   a0, a1
    mv   a1, a2
    mv   a2, a3
    jr   t0
