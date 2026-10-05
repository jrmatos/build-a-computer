# Every register-register and register-immediate ALU instruction, plus M.
    .text
    .globl _start
_start:
    add    x1, x2, x3
    sub    x4, x5, x6
    sll    x7, x8, x9
    slt    x10, x11, x12
    sltu   x13, x14, x15
    xor    x16, x17, x18
    srl    x19, x20, x21
    sra    x22, x23, x24
    or     x25, x26, x27
    and    x28, x29, x30
    mul    a0, a1, a2
    mulh   a3, a4, a5
    mulhsu a6, a7, s2
    mulhu  s3, s4, s5
    div    s6, s7, s8
    divu   s9, s10, s11
    rem    t3, t4, t5
    remu   t6, zero, ra
    addi   sp, gp, -2048
    slti   tp, t0, 2047
    sltiu  t1, t2, -1
    xori   s0, fp, 0x7ff
    ori    s1, a0, -0x800
    andi   a1, a2, 255
    slli   a3, a4, 0
    srli   a5, a6, 31
    srai   a7, s2, 17
    lui    s3, 0xfffff
    auipc  s4, 1
