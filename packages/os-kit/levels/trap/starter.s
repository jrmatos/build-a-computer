# trapvec.s: the way into and out of the kernel. Yours to write.
#
# mtvec points at trap_vector. On a trap the CPU jumps there in machine mode
# with every register still holding the program's values. mscratch holds
# the address of the program's trap frame (kernel.h, struct trapframe):
#   regs[i] (register xi) at 4*i, epc at 128, kstack at 132.

    .text
    .align 2
    .globl trap_vector
trap_vector:
    # TODO 1: get a free register: csrrw t6, mscratch, t6
    # TODO 2: save x1 .. x30 at 4*i(t6); then the program's t6 (now in
    #         mscratch) at 124(t6); then mepc at 128(t6)
    # TODO 3: switch to the kernel stack: lw sp, 132(t6)
    # TODO 4: call trap with the frame in a0; it returns the frame to resume
    j    trap_vector

# trap_return(tf): resume the program whose registers are in *tf.
    .globl trap_return
trap_return:
    # TODO 5: mscratch = tf (for the next trap), mepc = tf->epc
    # TODO 6: load x1 .. x30 from the frame, then x31 (t6) last
    mret
