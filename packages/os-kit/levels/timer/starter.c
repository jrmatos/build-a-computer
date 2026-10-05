/*
 * timer.c: the timer interrupt, preemption and sleep. Yours to write.
 *
 * The CLINT raises a timer interrupt when mtime >= mtimecmp (both 64-bit,
 * low word first). One tick is one instruction.
 */
#include "kernel.h"

uint ticks;                      /* timer interrupts so far */

/* mtime, low word. */
uint timer_now(void) {
  return *(volatile uint *)MTIME;
}

/*
 * Ask for a timer interrupt `delay` ticks from now: mtimecmp = mtime + delay
 * (carry into the high word if the low word wraps). Write mtimecmp's low
 * word as 0xffffffff first, then the high word, then the low word.
 * proc.c calls timer_arm(QUANTUM) whenever it switches to a process.
 */
void timer_arm(uint delay) {
  /* TODO */
}

/* Arm the first time slice and enable timer interrupts (mie bit MIE_MTIE). */
void timer_init(void) {
  /* TODO */
}

/* Make every SLEEPING process whose wake time has come RUNNABLE. */
static void wake_sleepers(void) {
  /* TODO: compare as (int)(now - wake) >= 0, which survives wrap-around */
}

/* The running process's time slice is over: count it, wake sleepers, yield. */
struct trapframe *timer_interrupt(struct trapframe *tf) {
  /* TODO */
  return tf;
}

/* sleep(n): a0 = 0, wake at timer_now() + n, state SLEEPING, run someone else. */
struct trapframe *sys_sleep(uint n) {
  /* TODO */
  return &current->tf;
}

/*
 * Nothing is runnable but someone is asleep. Arm the timer for the earliest
 * wake time, wfi() until mip shows the timer pending (MIP_MTIP), wake the
 * sleepers, and schedule(). (The kernel runs with interrupts off, so the
 * interrupt waits in mip instead of trapping.)
 */
struct trapframe *timer_idle(void) {
  /* TODO */
  panic("timer_idle: not written yet");
  return 0;
}
