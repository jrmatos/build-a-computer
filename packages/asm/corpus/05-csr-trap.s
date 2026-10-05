# Machine-mode trap setup and handling with CSRs.
    .text
    .globl _start
_start:
    la    t0, trap_handler
    csrw  mtvec, t0
    li    t0, 0x888
    csrs  mie, t0
    csrsi mstatus, 8
    csrr  a0, mhartid
    csrr  a1, misa
    ecall
    ebreak
    csrc  mie, t0
    csrci mstatus, 8
    csrwi mscratch, 0
    csrrw a2, mscratch, a3
    csrrs a2, mcause, zero
    csrrc a2, mepc, a4
    csrrwi a2, mtval, 31
    csrrsi a2, 0x7c0, 1
    csrrci a2, 3857, 2
    rdcycle a5
    rdcycleh a6
    rdtime a5
    rdinstret a7
idle:
    wfi
    j     idle

    .align 4
trap_handler:
    csrw  mscratch, sp
    csrr  t1, mcause
    csrr  t2, mepc
    addi  t2, t2, 4
    csrw  mepc, t2
    csrr  sp, mscratch
    mret
    sret
