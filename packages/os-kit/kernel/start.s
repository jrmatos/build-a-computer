# start.s: the kernel's first instructions, and the machine helpers.
#
# The machine (or the bootloader) jumps to _start in machine mode. a0, a1 and
# a2 carry the boot arguments; they pass straight through to kmain.

    .text
    .globl _start
_start:
    li   sp, 0x80400000      # KSTACK_TOP: the kernel stack grows down from the end of RAM
    call kmain               # kmain(arg, user_entry, user_end) never returns
1:  j    1b

# ------------------------------------------------------------------ helpers
# C has no way to name a CSR, so each helper wraps one csrr / csrw (or wfi,
# sfence.vma, ecall). Arguments come in a0; results go back in a0.

    .text
    .globl r_mcause
r_mcause:
    csrr a0, mcause
    ret

    .globl r_mtval
r_mtval:
    csrr a0, mtval
    ret

    .globl r_mstatus
r_mstatus:
    csrr a0, mstatus
    ret

    .globl w_mstatus
w_mstatus:
    csrw mstatus, a0
    ret

    .globl w_mtvec
w_mtvec:
    csrw mtvec, a0
    ret

    .globl w_mscratch
w_mscratch:
    csrw mscratch, a0
    ret

    .globl r_mie
r_mie:
    csrr a0, mie
    ret

    .globl w_mie
w_mie:
    csrw mie, a0
    ret

    .globl r_mip
r_mip:
    csrr a0, mip
    ret

    .globl w_satp
w_satp:
    csrw satp, a0
    ret

    .globl sfence_vma
sfence_vma:
    sfence.vma zero, zero    # forget cached translations (the TLB)
    ret

    .globl wfi
wfi:
    wfi                      # sleep until an enabled interrupt is pending
    ret

# Let user mode reach all of memory through physical memory protection
# (one region covering everything, readable, writable, executable). Without
# it, real hardware refuses every user access; page tables do the real
# protecting from the virtual memory level on.
    .globl pmp_open
pmp_open:
    li   t0, -1
    csrw pmpaddr0, t0
    li   t0, 0x1f            # NAPOT region, R, W, X
    csrw pmpcfg0, t0
    ret

# halt(code): stop the machine. ecall 93 from machine mode is the emulator's
# power-off switch; the tests read the exit code from a0.
    .globl halt
halt:
    li   a7, 93
    ecall
1:  j    1b
