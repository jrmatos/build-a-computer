/*
 * proc.c: processes and the context switch.
 *
 * A process is a program plus its saved registers (its trap frame). While a
 * process runs, its registers live in the CPU; when it traps, trap_vector
 * saves them in its trap frame. To switch, the kernel simply returns a
 * different process's trap frame from trap(): trap_return loads those
 * registers and that process continues where it left off.
 */
#include "kernel.h"

struct proc procs[NPROC];
struct proc *current;            /* the process running (or that ran last) */
static int next_pid = 1;
static int init_exitcode;        /* the machine's exit code: what pid 1 returned */

#ifndef CONFIG_VM
/* Without paging every process shares the kernel's memory: give each its own stack. */
#define USTACK_WORDS 512
static uint ustacks[NPROC * USTACK_WORDS];
#endif

/* Slot number of p in procs. */
static int slot(struct proc *p) {
  int i;
  for (i = 0; i < NPROC; i++)
    if (&procs[i] == p)
      return i;
  return -1;
}

/* Find an unused slot, clear it and give it a pid. Returns 0 when the table is full. */
struct proc *proc_alloc(void) {
  int i;
  struct proc *p;
  for (i = 0; i < NPROC; i++) {
    p = &procs[i];
    if (p->state == UNUSED) {
      kmemset(p, 0, sizeof(struct proc));
      p->pid = next_pid;
      next_pid++;
      p->tf.kstack = KSTACK_TOP;
      return p;
    }
  }
  return 0;
}

void proc_free(struct proc *p) {
  p->state = UNUSED;
}

#ifndef CONFIG_VM
/*
 * Create a process that calls entry(arg) in user mode. Its code is part of
 * the kernel image (there is no paging yet); it gets its own stack.
 * Returns 0 when the process table is full.
 */
struct proc *proc_create(char *name, uint entry, uint arg) {
  struct proc *p = proc_alloc();
  uint i;
  if (p == 0)
    return 0;
  for (i = 0; i < 15 && name[i]; i++)
    p->name[i] = name[i];
  p->tf.epc = entry;
  p->tf.regs[REG_A0] = arg;
  p->tf.regs[REG_SP] = (uint)&ustacks[(slot(p) + 1) * USTACK_WORDS];  /* top of its stack */
  p->state = RUNNABLE;
  return p;
}
#endif

#ifdef CONFIG_VM
static void exit_family(struct proc *p);
#endif

/* Make p the running process and hand back its registers to resume. */
static struct trapframe *switch_to(struct proc *p) {
  current = p;
  p->state = RUNNING;
#ifdef CONFIG_TIMER
  timer_arm(QUANTUM);            /* a fresh time slice */
#endif
#ifdef CONFIG_VM
  w_satp(SATP_SV32 | ((uint)p->pagetable >> 12));
  sfence_vma();
#endif
  return &p->tf;
}

/*
 * Pick the next process to run: round robin, starting with the slot after
 * the current one, so every runnable process gets its turn.
 */
struct trapframe *schedule(void) {
  int start = 0;
  int k;
  int i;
  if (current)
    start = slot(current) + 1;
  for (k = 0; k < NPROC; k++) {
    i = (start + k) % NPROC;
    if (procs[i].state == RUNNABLE)
      return switch_to(&procs[i]);
  }
#ifdef CONFIG_TIMER
  /* Nobody can run now; if someone is asleep, wait for the timer. */
  for (i = 0; i < NPROC; i++)
    if (procs[i].state == SLEEPING)
      return timer_idle();
#endif
#ifdef CONFIG_VM
  for (i = 0; i < NPROC; i++)
    if (procs[i].state == WAITING)
      panic("deadlock: every process is waiting");
#endif
  /* Every process has exited. */
  halt(init_exitcode);
  return 0;
}

/* The current process gives up the CPU but stays runnable. */
struct trapframe *proc_yield(struct trapframe *tf) {
  current->state = RUNNABLE;
  return schedule();
}

/* The current process ends with exit code `code`. */
struct trapframe *proc_exit(int code) {
  struct proc *p = current;
  p->exitcode = code;
  if (p->pid == 1)
    init_exitcode = code;
#ifdef CONFIG_VM
  exit_family(p);
#else
  proc_free(p);
#endif
  return schedule();
}

#ifdef CONFIG_VM
static struct proc *find_pid(int pid) {
  int i;
  for (i = 0; i < NPROC; i++)
    if (procs[i].state != UNUSED && procs[i].pid == pid)
      return &procs[i];
  return 0;
}

/* Free p's memory, then tell its children and its parent that it is gone. */
static void exit_family(struct proc *p) {
  struct proc *parent = 0;
  int i;
  uvm_free(p->pagetable);
  p->pagetable = 0;
  /* Orphans: nobody will wait for them now. */
  for (i = 0; i < NPROC; i++) {
    if (procs[i].state != UNUSED && procs[i].parent == p->pid) {
      procs[i].parent = 0;
      if (procs[i].state == ZOMBIE)
        proc_free(&procs[i]);
    }
  }
  if (p->parent)
    parent = find_pid(p->parent);
  if (parent == 0) {
    proc_free(p);
  } else if (parent->state == WAITING) {
    /* The parent is blocked in wait(): finish its system call now. */
    if (parent->wait_status)
      copyout_pt(parent->pagetable, parent->wait_status, &p->exitcode, 4);
    parent->tf.regs[REG_A0] = p->pid;
    parent->state = RUNNABLE;
    proc_free(p);
  } else {
    p->state = ZOMBIE;           /* keep the exit code until the parent asks */
  }
}

/*
 * wait(&status): wait for a child to exit. Returns its pid (and stores its
 * exit code at status unless that is 0), or -1 when there are no children.
 */
struct trapframe *proc_wait(uint status_uva) {
  int i;
  int have_kids = 0;
  struct proc *q;
  for (i = 0; i < NPROC; i++) {
    q = &procs[i];
    if (q->state != UNUSED && q->parent == current->pid) {
      have_kids = 1;
      if (q->state == ZOMBIE) {
        if (status_uva && copyout(status_uva, &q->exitcode, 4) < 0) {
          current->tf.regs[REG_A0] = -1;
          return &current->tf;
        }
        current->tf.regs[REG_A0] = q->pid;
        proc_free(q);
        return &current->tf;
      }
    }
  }
  if (!have_kids) {
    current->tf.regs[REG_A0] = -1;
    return &current->tf;
  }
  current->state = WAITING;
  current->wait_status = status_uva;
  return schedule();
}
#endif
