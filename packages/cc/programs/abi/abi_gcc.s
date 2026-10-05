	.file	"abi_gcc.c"
	.option nopic
	.option norelax
	.attribute arch, "rv32i2p1_m2p0"
	.attribute unaligned_access, 0
	.attribute stack_align, 16
	.text
	.align	2
	.globl	g_c3
	.type	g_c3, @function
g_c3:
	addi	sp,sp,-32
	andi	a1,a1,0xff
	sw	a0,12(sp)
	add	a5,a1,a0
	sb	a5,12(sp)
	srli	a0,a0,16
	lhu	a5,12(sp)
	sub	a0,a0,a1
	andi	a0,a0,0xff
	slli	a0,a0,16
	or	a0,a5,a0
	addi	sp,sp,32
	jr	ra
	.size	g_c3, .-g_c3
	.align	2
	.globl	g_i2
	.type	g_i2, @function
g_i2:
	addi	sp,sp,-32
	mul	a0,a1,a0
	addi	sp,sp,32
	mul	a1,a3,a2
	jr	ra
	.size	g_i2, .-g_i2
	.align	2
	.globl	g_i3
	.type	g_i3, @function
g_i3:
	lw	a2,0(a1)
	lw	a3,8(a1)
	lw	a4,4(a1)
	sw	a2,8(a0)
	sw	a3,0(a0)
	sw	a4,4(a0)
	ret
	.size	g_i3, .-g_i3
	.align	2
	.globl	g_big
	.type	g_big, @function
g_big:
	mv	a5,a1
	addi	a6,a1,40
	li	a3,0
.L8:
	lw	a4,0(a5)
	addi	a5,a5,4
	add	a4,a4,a3
	sw	a4,-4(a5)
	add	a3,a3,a2
	bne	a5,a6,.L8
	lw	t5,0(a1)
	lw	t4,4(a1)
	lw	t3,8(a1)
	lw	t1,12(a1)
	lw	a7,16(a1)
	lw	a6,20(a1)
	lw	a2,24(a1)
	lw	a3,28(a1)
	lw	a4,32(a1)
	lw	a5,36(a1)
	sw	t5,0(a0)
	sw	t4,4(a0)
	sw	t3,8(a0)
	sw	t1,12(a0)
	sw	a7,16(a0)
	sw	a6,20(a0)
	sw	a2,24(a0)
	sw	a3,28(a0)
	sw	a4,32(a0)
	sw	a5,36(a0)
	ret
	.size	g_big, .-g_big
	.align	2
	.globl	g_ll
	.type	g_ll, @function
g_ll:
	srli	t4,a1,31
	slli	t3,a2,1
	slli	t1,a1,1
	add	a1,t1,a1
	or	t3,t4,t3
	add	t4,t3,a2
	sltu	t1,a1,t1
	add	t1,t1,t4
	srai	t4,a0,31
	add	a0,a1,a0
	add	t4,t1,t4
	srli	t5,a4,30
	sltu	a1,a0,a1
	slli	t6,a4,2
	slli	t0,a5,2
	addi	sp,sp,-16
	add	a1,a1,t4
	add	a4,t6,a4
	srai	t4,a3,31
	or	t0,t5,t0
	add	a3,a0,a3
	lw	t3,24(sp)
	lw	a2,28(sp)
	add	a1,a1,t4
	add	t0,t0,a5
	sltu	a0,a3,a0
	sltu	t6,a4,t6
	add	t6,t6,t0
	add	a4,a3,a4
	add	a0,a0,a1
	li	t1,11
	add	a0,a0,t6
	sltu	a3,a4,a3
	lw	t5,16(sp)
	mulhu	t4,t3,t1
	add	a3,a3,a0
	slli	a1,a7,3
	srli	t0,a7,29
	slli	a5,t5,3
	sub	a7,a1,a7
	srai	t6,a6,31
	or	a5,t0,a5
	add	a6,a4,a6
	sltu	a4,a6,a4
	mul	a0,t3,t1
	add	a3,a3,t6
	sgtu	t3,a7,a1
	sub	a5,a5,t5
	lw	a1,20(sp)
	add	a7,a6,a7
	sub	a5,a5,t3
	add	a4,a4,a3
	add	a4,a4,a5
	sltu	a6,a7,a6
	mul	a2,a2,t1
	srai	a5,a1,31
	add	a6,a6,a4
	add	a1,a7,a1
	sltu	a7,a1,a7
	add	a6,a6,a5
	add	a0,a1,a0
	add	a7,a7,a6
	sltu	a1,a0,a1
	add	a2,a2,t4
	add	a7,a7,a2
	add	a1,a1,a7
	addi	sp,sp,16
	jr	ra
	.size	g_ll, .-g_ll
	.align	2
	.globl	g_many
	.type	g_many, @function
g_many:
	lw	t1,8(sp)
	lw	t5,12(sp)
	li	t4,100
	mul	t1,t1,t4
	slli	t3,a2,1
	li	t4,1000
	slli	a1,a1,1
	add	t3,t3,a2
	add	a1,a1,a0
	slli	a3,a3,2
	add	a1,a1,t3
	slli	a2,a5,1
	slli	t3,a4,2
	mul	a0,t5,t4
	add	t3,t3,a4
	lw	t5,0(sp)
	lw	t4,4(sp)
	add	a1,a1,a3
	add	a2,a2,a5
	add	a1,a1,t3
	slli	a2,a2,1
	slli	a5,a6,3
	sub	a5,a5,a6
	add	a1,a1,a2
	slli	a7,a7,3
	add	a1,a1,a5
	slli	a3,t5,3
	slli	a4,t4,2
	add	a5,a1,a7
	add	a3,a3,t5
	add	a4,a4,t4
	add	a5,a5,a3
	slli	a4,a4,1
	add	a5,a5,a4
	add	a5,a5,t1
	add	a0,a5,a0
	ret
	.size	g_many, .-g_many
	.align	2
	.globl	g_sum
	.type	g_sum, @function
g_sum:
	addi	sp,sp,-48
	addi	t1,sp,20
	sw	a1,20(sp)
	sw	a2,24(sp)
	sw	a3,28(sp)
	sw	a4,32(sp)
	sw	a5,36(sp)
	sw	a6,40(sp)
	sw	a7,44(sp)
	sw	t1,12(sp)
	beq	a0,zero,.L16
	addi	a4,a0,-1
	mv	a5,t1
	li	a0,0
	li	a2,-1
.L15:
	lw	a3,0(a5)
	addi	a4,a4,-1
	addi	a5,a5,4
	add	a0,a0,a3
	bne	a4,a2,.L15
	addi	sp,sp,48
	jr	ra
.L16:
	li	a0,0
	addi	sp,sp,48
	jr	ra
	.size	g_sum, .-g_sum
	.align	2
	.globl	g_sumll
	.type	g_sumll, @function
g_sumll:
	addi	sp,sp,-48
	addi	t1,sp,20
	sw	a1,20(sp)
	sw	a2,24(sp)
	sw	a3,28(sp)
	sw	a4,32(sp)
	sw	a5,36(sp)
	sw	a6,40(sp)
	sw	a7,44(sp)
	sw	t1,12(sp)
	beq	a0,zero,.L22
	addi	a3,a0,-1
	mv	a5,t1
	li	a0,0
	li	a1,0
	li	a7,-1
.L21:
	addi	a5,a5,7
	andi	a5,a5,-8
	lw	a4,0(a5)
	lw	a6,4(a5)
	addi	a3,a3,-1
	add	a4,a0,a4
	sltu	a2,a4,a0
	add	a1,a1,a6
	mv	a0,a4
	add	a1,a2,a1
	addi	a5,a5,8
	bne	a3,a7,.L21
	addi	sp,sp,48
	jr	ra
.L22:
	li	a0,0
	li	a1,0
	addi	sp,sp,48
	jr	ra
	.size	g_sumll, .-g_sumll
	.align	2
	.globl	g_call
	.type	g_call, @function
g_call:
	addi	sp,sp,-32
	sw	ra,28(sp)
	mv	a4,a0
	addi	a2,a1,1
	slli	a0,a1,1
	jalr	a4
	lw	ra,28(sp)
	addi	a0,a0,1
	addi	sp,sp,32
	jr	ra
	.size	g_call, .-g_call
	.align	2
	.globl	g_mixed
	.type	g_mixed, @function
g_mixed:
	lbu	a5,0(a1)
	lw	a3,8(a1)
	lw	a4,12(a1)
	addi	a5,a5,1
	sb	a5,0(a1)
	lw	a6,0(a1)
	lw	a2,4(a1)
	srli	a7,a3,31
	slli	a4,a4,1
	slli	a3,a3,1
	or	a4,a7,a4
	sw	a6,0(a0)
	sw	a2,4(a0)
	sw	a3,8(a1)
	sw	a3,8(a0)
	sw	a4,12(a1)
	sw	a4,12(a0)
	ret
	.size	g_mixed, .-g_mixed
	.align	2
	.globl	g_uchar
	.type	g_uchar, @function
g_uchar:
	add	a0,a0,a2
	add	a0,a0,a3
	add	a0,a0,a1
	andi	a0,a0,0xff
	ret
	.size	g_uchar, .-g_uchar
	.align	2
	.globl	g_back
	.type	g_back, @function
g_back:
	lui	a5,%hi(.LANCHOR0)
	addi	a5,a5,%lo(.LANCHOR0)
	lw	a4,8(a5)
	lw	a2,0(a5)
	lw	a3,4(a5)
	lw	a5,12(a5)
	addi	sp,sp,-240
	sw	s0,232(sp)
	sw	a4,160(sp)
	sw	a5,164(sp)
	sw	ra,236(sp)
	sw	s1,228(sp)
	sw	s2,224(sp)
	sw	s3,220(sp)
	sw	a2,152(sp)
	sw	a3,156(sp)
	addi	a5,sp,168
	li	s0,0
	li	a4,10
.L30:
	sw	s0,0(a5)
	addi	s0,s0,1
	addi	a5,a5,4
	bne	s0,a4,.L30
	li	s1,3
	li	a5,513
	sh	a5,140(sp)
	sb	s1,142(sp)
	lw	a0,140(sp)
	li	a1,2
	li	s3,7
	call	o_c3
	srli	a5,a0,8
	li	a3,4
	andi	a5,a5,0xff
	andi	s2,a0,0xff
	srli	a0,a0,16
	add	s2,s2,a5
	mv	a1,a3
	andi	a5,a0,0xff
	li	a2,5
	mv	a0,s1
	add	s2,s2,a5
	call	o_i2
	lw	a2,176(sp)
	lw	t5,168(sp)
	lw	t4,172(sp)
	lw	t3,180(sp)
	lw	t1,184(sp)
	lw	a7,188(sp)
	lw	a6,192(sp)
	lw	a3,196(sp)
	lw	a4,200(sp)
	lw	a5,204(sp)
	sw	a0,144(sp)
	add	a0,a1,a0
	sw	a1,148(sp)
	sw	a2,40(sp)
	addi	a1,sp,32
	add	s2,a0,s2
	li	a2,2
	addi	a0,sp,80
	sw	t5,32(sp)
	sw	t4,36(sp)
	sw	t3,44(sp)
	sw	t1,48(sp)
	sw	a7,52(sp)
	sw	a6,56(sp)
	sw	a3,60(sp)
	sw	a4,64(sp)
	sw	a5,68(sp)
	call	o_big
	lw	a6,84(sp)
	lw	a3,88(sp)
	lw	a7,92(sp)
	lw	a0,96(sp)
	lw	a4,100(sp)
	lw	a5,104(sp)
	lw	a1,108(sp)
	lw	a2,112(sp)
	li	t1,8
	lw	t3,80(sp)
	sw	t1,8(sp)
	lw	t1,116(sp)
	li	t2,0
	sw	t2,12(sp)
	sw	s3,4(sp)
	sw	a6,172(sp)
	sw	a3,176(sp)
	sw	a7,180(sp)
	mv	a3,s1
	sw	a0,184(sp)
	sw	a4,188(sp)
	sw	a5,192(sp)
	sw	a1,196(sp)
	sw	a2,200(sp)
	sw	zero,0(sp)
	li	a6,5
	li	a7,6
	li	a4,4
	li	a5,0
	li	a2,0
	li	a0,1
	li	a1,2
	sw	t3,168(sp)
	add	s2,s2,t1
	sw	t1,204(sp)
	call	o_ll
	lw	a3,144(sp)
	lw	a4,148(sp)
	slli	t1,a0,16
	li	a5,9
	srli	t1,t1,16
	sw	s0,4(sp)
	mv	a6,s3
	sw	a3,8(sp)
	sw	a4,12(sp)
	sw	a5,0(sp)
	mv	a2,s1
	li	a7,8
	li	a4,5
	li	a3,4
	li	a5,6
	li	a1,2
	li	a0,1
	add	s0,t1,s2
	call	o_many
	li	a5,5
	mv	a6,a0
	mv	a3,s1
	li	a4,4
	mv	a0,a5
	li	a2,2
	li	a1,1
	add	s0,s0,a6
	call	o_sum
	lw	a4,160(sp)
	lw	a5,164(sp)
	lw	a2,152(sp)
	lw	a3,156(sp)
	mv	a6,a0
	addi	a1,sp,16
	addi	a0,sp,152
	add	s0,s0,a6
	sw	a4,24(sp)
	sw	a5,28(sp)
	sw	a2,16(sp)
	sw	a3,20(sp)
	call	o_mixed
	lw	a4,164(sp)
	lw	a5,160(sp)
	lbu	a0,152(sp)
	slli	a4,a4,28
	srli	a5,a5,4
	or	a5,a4,a5
	add	a0,a0,a5
	lw	ra,236(sp)
	add	a0,a0,s0
	lw	s0,232(sp)
	lw	s1,228(sp)
	lw	s2,224(sp)
	lw	s3,220(sp)
	addi	sp,sp,240
	jr	ra
	.size	g_back, .-g_back
	.section	.rodata
	.align	3
	.set	.LANCHOR0,. + 0
.LC0:
	.byte	120
	.zero	7
	.word	591751049
	.word	1
	.ident	"GCC: (14.2.0+19) 14.2.0"
	.section	.note.GNU-stack,"",@progbits
