/*
 * timer.c: the timer interrupt, preemption and sleep.
 *
 * The CLINT raises a timer interrupt when mtime >= mtimecmp. Each interrupt
 * ends the running process's time slice: the kernel re-arms the timer for
 * the next slice and switches to the next runnable process. A program that
 * never makes a system call can no longer keep the CPU to itself.
 */
#include "kernel.h"

uint ticks;                      /* timer interrupts so far */

/* mtime, low word: one tick per instruction in this machine. */
uint timer_now(void) {
  return *(volatile uint *)MTIME;
}

/* Ask for a timer interrupt `delay` ticks from now. */
void timer_arm(uint delay) {
  uint lo = *(volatile uint *)MTIME;
  uint hi = *(volatile uint *)(MTIME + 4);
  uint when = lo + delay;
  if (when < lo)
    hi = hi + 1;                 /* the low word wrapped: carry */
  /* Write mtimecmp in an order that never asks for an early interrupt. */
  *(volatile uint *)MTIMECMP = 0xffffffff;
  *(volatile uint *)(MTIMECMP + 4) = hi;
  *(volatile uint *)MTIMECMP = when;
}

void timer_init(void) {
  timer_arm(QUANTUM);
  w_mie(r_mie() | MIE_MTIE);     /* in user mode, timer interrupts are now taken */
}

/* Make sleepers whose time has come runnable again. */
static void wake_sleepers(void) {
  uint now = timer_now();
  int i;
  for (i = 0; i < NPROC; i++)
    if (procs[i].state == SLEEPING && (int)(now - procs[i].wake) >= 0)
      procs[i].state = RUNNABLE;
}

/* The running process's time slice is over: next! (switch_to re-arms the timer.) */
struct trapframe *timer_interrupt(struct trapframe *tf) {
  ticks++;
  wake_sleepers();
  return proc_yield(tf);
}

/* sleep(n): the current process waits at least n ticks. */
struct trapframe *sys_sleep(uint n) {
  current->tf.regs[REG_A0] = 0;
  current->wake = timer_now() + n;
  current->state = SLEEPING;
  return schedule();
}

/*
 * Nothing can run, but someone is asleep. Set the timer for the earliest
 * wake-up and wait (wfi) for it. The kernel runs with interrupts off, so the
 * interrupt stays pending in mip: the kernel sees it here, not in trap().
 */
struct trapframe *timer_idle(void) {
  uint now;
  uint first;
  int found;
  int i;
  for (;;) {
    now = timer_now();
    found = 0;
    first = 0;
    for (i = 0; i < NPROC; i++) {
      if (procs[i].state == SLEEPING && (!found || (int)(procs[i].wake - first) < 0)) {
        first = procs[i].wake;
        found = 1;
      }
    }
    if (!found)
      panic("timer_idle: nobody is asleep");
    if ((int)(first - now) > 0) {
      timer_arm(first - now);
      while ((r_mip() & MIP_MTIP) == 0)
        wfi();
      ticks++;
    }
    wake_sleepers();
    for (i = 0; i < NPROC; i++)
      if (procs[i].state == RUNNABLE)
        return schedule();
  }
}
