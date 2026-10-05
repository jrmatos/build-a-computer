/*
 * trap.c: what the kernel does when a program traps.
 *
 * trap_vector (trapvec.s) has saved the program's registers in *tf. trap()
 * looks at mcause, handles the event, and returns the trap frame of the
 * process to run next. Returning a different process's frame is a context
 * switch.
 */
#include "kernel.h"

static char *fault_name(uint cause) {
  if (cause == EXC_ILLEGAL)
    return "illegal instruction";
  if (cause == EXC_BREAKPOINT)
    return "breakpoint";
  if (cause == EXC_LOAD_MISALIGNED || cause == EXC_STORE_MISALIGNED)
    return "misaligned access";
  if (cause == EXC_LOAD_FAULT || cause == EXC_STORE_FAULT)
    return "access fault";
  if (cause == EXC_INST_PAGE_FAULT)
    return "instruction page fault";
  if (cause == EXC_LOAD_PAGE_FAULT)
    return "load page fault";
  if (cause == EXC_STORE_PAGE_FAULT)
    return "store page fault";
  return "unknown fault";
}

#ifndef CONFIG_SYSCALL
/*
 * Before there are real system calls, the kernel answers three:
 *   a7 = 1:  print the character in a0
 *   a7 = 2:  return a0 + a1 in a0
 *   a7 = 93: exit (stop the machine with exit code a0)
 */
static struct trapframe *early_syscall(struct trapframe *tf) {
  uint num = tf->regs[REG_A7];
  if (num == 1) {
    kputc(tf->regs[REG_A0]);
  } else if (num == 2) {
    tf->regs[REG_A0] = tf->regs[REG_A0] + tf->regs[REG_A1];
  } else if (num == 93) {
    halt(tf->regs[REG_A0]);
  } else {
    kputs("unknown system call\n");
    tf->regs[REG_A0] = -1;
  }
  return tf;
}
#endif

struct trapframe *trap(struct trapframe *tf) {
  uint cause = r_mcause();

  if (cause & CAUSE_INTERRUPT) {
#ifdef CONFIG_TIMER
    if ((cause & 0xff) == IRQ_TIMER)
      return timer_interrupt(tf);
#endif
    panic("unexpected interrupt");
  }

  if ((r_mstatus() & MSTATUS_MPP) == MSTATUS_MPP) {
    /* The trap came from the kernel itself: a kernel bug. */
    kputs("kernel trap: ");
    kputs(fault_name(cause));
    kputs(" at pc ");
    kputx(tf->epc);
    kputs(", address ");
    kputx(r_mtval());
    kputc('\n');
    panic("kernel trap");
  }

  if (cause == EXC_ECALL_U) {
    tf->epc = tf->epc + 4;   /* resume after the ecall, not on it */
#ifdef CONFIG_SYSCALL
    return syscall(tf);
#else
    return early_syscall(tf);
#endif
  }

  /* The program did something wrong: stop it. */
  kputs("trap: ");
  kputs(fault_name(cause));
#ifdef CONFIG_VM
  if (cause == EXC_INST_PAGE_FAULT || cause == EXC_LOAD_PAGE_FAULT || cause == EXC_STORE_PAGE_FAULT) {
    kputs(" at ");
    kputx(r_mtval());
  }
#endif
#ifdef CONFIG_PROC
  kputs(" in pid ");
  kputi(current->pid);
  kputs(" (");
  kputs(current->name);
  kputs("), killed\n");
  return proc_exit(-1);
#else
  kputs(", program killed\n");
  halt(255);
  return tf;
#endif
}
