# trapvec.s: the way into and out of the kernel.
#
# mtvec points at trap_vector. On every trap (system call, fault, interrupt)
# the CPU jumps there in machine mode with the program's registers still
# live. mscratch holds the address of the running process's trap frame
# (struct trapframe in kernel.h: regs[i] at 4*i, epc at 128, kstack at 132).

    .text
    .align 2
    .globl trap_vector
trap_vector:
    csrrw t6, mscratch, t6   # swap: t6 = trap frame, mscratch = the program's t6
    sw   x1, 4(t6)
    sw   x2, 8(t6)
    sw   x3, 12(t6)
    sw   x4, 16(t6)
    sw   x5, 20(t6)
    sw   x6, 24(t6)
    sw   x7, 28(t6)
    sw   x8, 32(t6)
    sw   x9, 36(t6)
    sw   x10, 40(t6)
    sw   x11, 44(t6)
    sw   x12, 48(t6)
    sw   x13, 52(t6)
    sw   x14, 56(t6)
    sw   x15, 60(t6)
    sw   x16, 64(t6)
    sw   x17, 68(t6)
    sw   x18, 72(t6)
    sw   x19, 76(t6)
    sw   x20, 80(t6)
    sw   x21, 84(t6)
    sw   x22, 88(t6)
    sw   x23, 92(t6)
    sw   x24, 96(t6)
    sw   x25, 100(t6)
    sw   x26, 104(t6)
    sw   x27, 108(t6)
    sw   x28, 112(t6)
    sw   x29, 116(t6)
    sw   x30, 120(t6)
    csrr t5, mscratch        # the program's t6
    sw   t5, 124(t6)
    csrr t5, mepc            # where the program was
    sw   t5, 128(t6)
    lw   sp, 132(t6)         # switch to the kernel stack
    mv   a0, t6
    call trap                # a0 = the trap frame to resume (maybe another process)
    # fall through

# trap_return(tf): resume the program whose registers are in *tf.
    .globl trap_return
trap_return:
    mv   t6, a0
    csrw mscratch, t6        # the next trap saves into this frame
    lw   t5, 128(t6)
    csrw mepc, t5            # mret jumps to mepc
    lw   x1, 4(t6)
    lw   x2, 8(t6)
    lw   x3, 12(t6)
    lw   x4, 16(t6)
    lw   x5, 20(t6)
    lw   x6, 24(t6)
    lw   x7, 28(t6)
    lw   x8, 32(t6)
    lw   x9, 36(t6)
    lw   x10, 40(t6)
    lw   x11, 44(t6)
    lw   x12, 48(t6)
    lw   x13, 52(t6)
    lw   x14, 56(t6)
    lw   x15, 60(t6)
    lw   x16, 64(t6)
    lw   x17, 68(t6)
    lw   x18, 72(t6)
    lw   x19, 76(t6)
    lw   x20, 80(t6)
    lw   x21, 84(t6)
    lw   x22, 88(t6)
    lw   x23, 92(t6)
    lw   x24, 96(t6)
    lw   x25, 100(t6)
    lw   x26, 104(t6)
    lw   x27, 108(t6)
    lw   x28, 112(t6)
    lw   x29, 116(t6)
    lw   x30, 120(t6)
    lw   x31, 124(t6)        # t6 last: it held the frame address
    mret                     # back to user mode (mstatus.MPP = 0) at mepc
