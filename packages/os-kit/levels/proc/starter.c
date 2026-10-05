/*
 * proc.c: processes and the context switch. Yours to write.
 *
 * Saving a process's registers is already done: trap_vector saves them in
 * the trap frame of the process that trapped. Switching is returning another
 * process's trap frame from trap(): trap_return loads it and that process
 * runs on.
 */
#include "kernel.h"

struct proc procs[NPROC];
struct proc *current;            /* the process running (or that ran last) */
static int next_pid = 1;
static int init_exitcode;        /* the machine's exit code: what pid 1 returned */

/* Each process's user stack (no paging yet: everyone shares the kernel's memory). */
#define USTACK_WORDS 512
static uint ustacks[NPROC * USTACK_WORDS];

/* Find an UNUSED slot, zero it (kmemset), give it the next pid and
   tf.kstack = KSTACK_TOP. Returns 0 when the table is full. */
struct proc *proc_alloc(void) {
  /* TODO */
  return 0;
}

void proc_free(struct proc *p) {
  p->state = UNUSED;
}

/*
 * A new process that calls entry(arg) in user mode: name (at most 15
 * characters), epc = entry, a0 = arg, sp = the top of its own stack in
 * ustacks, state RUNNABLE. Returns 0 when the table is full.
 */
struct proc *proc_create(char *name, uint entry, uint arg) {
  /* TODO */
  return 0;
}

/*
 * Pick the next RUNNABLE process, round robin: start looking at the slot
 * after current's (slot 0 when there is no current) and wrap around. Make it
 * current and RUNNING, and return its trap frame. When nothing is runnable,
 * every process has exited: halt(init_exitcode).
 */
struct trapframe *schedule(void) {
  /* TODO */
  halt(init_exitcode);
  return 0;
}

/* yield(): the current process stays RUNNABLE but lets the next one run. */
struct trapframe *proc_yield(struct trapframe *tf) {
  /* TODO */
  return tf;
}

/* exit(code): remember pid 1's exit code, free the slot, run someone else. */
struct trapframe *proc_exit(int code) {
  /* TODO */
  halt(code);
  return 0;
}
