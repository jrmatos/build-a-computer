# Atomics, fences and system instructions.
    .text
    .globl _start
_start:
    la          a0, lock
    li          t0, 1
1:  amoswap.w.aq t1, t0, (a0)
    bnez        t1, 1b
    amoswap.w.rl zero, zero, (a0)
    lr.w        a1, (a0)
    sc.w        a2, a1, (a0)
    lr.w.aqrl   a1, (a0)
    sc.w.rl     a2, a1, (a0)
    amoadd.w    a3, t0, (a0)
    amoxor.w    a3, t0, (a0)
    amoand.w    a3, t0, (a0)
    amoor.w     a3, t0, (a0)
    amomin.w    a3, t0, (a0)
    amomax.w    a3, t0, (a0)
    amominu.w   a3, t0, (a0)
    amomaxu.w.aqrl a3, t0, (a0)
    fence
    fence rw, rw
    fence r, w
    fence iorw, o
    fence i, r
    fence.i
    sfence.vma
    sfence.vma a0
    sfence.vma a0, a1
    ecall
    ebreak
    wfi
    mret
    sret
    .data
    .align 2
lock:
    .word 0
