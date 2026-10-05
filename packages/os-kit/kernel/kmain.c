/*
 * kmain.c: the kernel starts here (called from start.s).
 *
 *   arg         boot argument (a0): which test scenario to start
 *   user_entry  when the bootloader brought a program along: where it starts
 *   user_end    ... and the first byte after its image
 */
#include "kernel.h"

extern char kernel_end[];        /* end.s: the first byte after the kernel */

#ifndef CONFIG_PROC
/* One program, no process table: enter it directly. */
static struct trapframe frame;
static uint ustack[512];

void enter_user(uint entry, uint arg) {
  kmemset(&frame, 0, sizeof(struct trapframe));
  frame.epc = entry;
  frame.regs[REG_A0] = arg;
  frame.regs[REG_SP] = (uint)&ustack[512];
  frame.kstack = KSTACK_TOP;
  trap_return(&frame);           /* never returns: the program runs */
}
#endif

void kmain(uint arg, uint user_entry, uint user_end) {
  w_mtvec((uint)trap_vector);    /* every trap now enters the kernel */
  pmp_open();
  w_mstatus(r_mstatus() & ~MSTATUS_MPP);   /* mret goes to user mode */
#ifdef CONFIG_VM
  kinit((uint)kernel_end, KSTACK_TOP - KSTACK_SIZE);
#endif
#ifdef CONFIG_FS
  if (fs_init() < 0)
    panic("no file system on the disk");
#endif
#ifdef CONFIG_TIMER
  timer_init();
#endif
#ifdef CONFIG_FS
  if (user_entry)
    spawn_inmemory(user_entry, user_end);
  else if (spawn("init", 0) < 0)
    panic("cannot start init");
#else
  start_programs(arg);           /* the level's programs.c */
#endif
#ifdef CONFIG_PROC
  trap_return(schedule());
#endif
  panic("nothing to run");
}
