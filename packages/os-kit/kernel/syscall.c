/*
 * syscall.c: system calls. A program asks the kernel for something by
 * putting the call number in a7 and its arguments in a0, a1, a2, then
 * running ecall. The result goes back in a0 (-1 means it failed).
 *
 * Every pointer a program passes is a *user* address: check and copy it with
 * copyin / copyout (uaccess.c); never trust it.
 */
#include "kernel.h"

/* Bytes copied through the kernel per step. */
#define CHUNK 64

/*
 * Read from the console into the program's buffer: up to n bytes, stopping
 * after a newline. Each byte is echoed, like a terminal does. Returns the
 * number of bytes read: 0 means there is no more input.
 */
int console_read(uint uva, uint n) {
  uint i = 0;
  char c;
  int ch;
  while (i < n) {
    ch = kgetc();
    if (ch < 0)
      break;
    c = ch;
    if (copyout(uva + i, &c, 1) < 0)
      return -1;
    kputc(ch);
    i++;
    if (ch == '\n')
      break;
  }
  return i;
}

/* write(fd, buf, n): fd 1 and 2 are the console. */
static int sys_write(uint fd, uint uva, uint n) {
  char buf[CHUNK];
  uint done = 0;
  uint k;
  uint i;
  if (fd != 1 && fd != 2)
    return -1;
  if (uva + n < uva)
    return -1;                   /* the buffer would wrap around the address space */
  while (done < n) {
    k = n - done;
    if (k > CHUNK)
      k = CHUNK;
    if (copyin(buf, uva + done, k) < 0)
      return -1;
    for (i = 0; i < k; i++)
      kputc(buf[i]);
    done = done + k;
  }
  return n;
}

/* read(fd, buf, n): fd 0 is the console. */
static int sys_read(uint fd, uint uva, uint n) {
  if (fd == 0)
    return console_read(uva, n);
#ifdef CONFIG_FS
  return file_read(fd, uva, n);
#else
  return -1;
#endif
}

#ifdef CONFIG_VM
/* spawn(path, argv): start a program; returns its pid or -1. */
static int sys_spawn(uint path_uva, uint argv_uva) {
  char path[MAXPATH];
  if (copyinstr(path, path_uva, MAXPATH) < 0)
    return -1;
  return spawn(path, argv_uva);
}
#endif

#ifdef CONFIG_FS
/* getkey(): the next key from the keyboard, or -1 when none is waiting. */
static int sys_getkey(void) {
  if ((*(volatile uint *)KBD & 1) == 0)
    return -1;
  return *(volatile uint *)(KBD + 4);
}
#endif

struct trapframe *syscall(struct trapframe *tf) {
  uint num = tf->regs[REG_A7];
  uint a0 = tf->regs[REG_A0];
  uint a1 = tf->regs[REG_A1];
  uint a2 = tf->regs[REG_A2];
  int ret;

  if (num == SYS_write) {
    ret = sys_write(a0, a1, a2);
  } else if (num == SYS_read) {
    ret = sys_read(a0, a1, a2);
  } else if (num == SYS_exit) {
#ifdef CONFIG_PROC
    return proc_exit(a0);
#else
    halt(a0);
    ret = 0;
#endif
  } else if (num == SYS_getpid) {
#ifdef CONFIG_PROC
    ret = current->pid;
#else
    ret = 1;
#endif
#ifdef CONFIG_PROC
  } else if (num == SYS_yield) {
    tf->regs[REG_A0] = 0;
    return proc_yield(tf);
#endif
#ifdef CONFIG_TIMER
  } else if (num == SYS_sleep) {
    return sys_sleep(a0);
  } else if (num == SYS_uptime) {
    ret = timer_now();
#endif
#ifdef CONFIG_VM
  } else if (num == SYS_spawn) {
    ret = sys_spawn(a0, a1);
  } else if (num == SYS_wait) {
    return proc_wait(a0);
  } else if (num == SYS_sbrk) {
    ret = sys_sbrk(a0);
  } else if (num == SYS_freemem) {
    ret = kfree_count();
#endif
#ifdef CONFIG_FS
  } else if (num == SYS_open) {
    ret = file_open(a0);
  } else if (num == SYS_close) {
    ret = file_close(a0);
  } else if (num == SYS_readdir) {
    ret = file_readdir(a0, a1);
  } else if (num == SYS_fbmap) {
    ret = sys_fbmap();
  } else if (num == SYS_getkey) {
    ret = sys_getkey();
#endif
  } else {
    kputs("unknown system call ");
    kputu(num);
    kputc('\n');
    ret = -1;
  }
  tf->regs[REG_A0] = ret;
  return tf;
}
