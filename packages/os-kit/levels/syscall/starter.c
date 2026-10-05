/*
 * syscall.c: system calls. Yours to write.
 *
 * The program put the call number in a7 and its arguments in a0, a1, a2;
 * they are in tf->regs[REG_A7], tf->regs[REG_A0], ... Put the result in
 * tf->regs[REG_A0] (-1 for failure) and return tf.
 *
 *   write(fd, buf, n)  fd 1 or 2: print n bytes from the user buffer; return n
 *   read(fd, buf, n)   fd 0: console_read(buf, n)
 *   exit(code)         halt(code): there is only one program
 *   getpid()           1
 *   anything else      print "unknown system call <num>\n", return -1
 *
 * Never touch a user pointer directly: copy through copyin (uaccess.c).
 */
#include "kernel.h"

#define CHUNK 64

/*
 * Read from the console into the program's buffer: up to n bytes, stopping
 * after a newline. Echo each byte (kputc) after storing it. Returns the
 * number of bytes read: 0 means there is no more input.
 */
int console_read(uint uva, uint n) {
  /* TODO: kgetc() until it returns -1, n bytes are read, or a '\n' was read;
     copyout each byte to uva + i (return -1 if that fails), then kputc it. */
  return 0;
}

static int sys_write(uint fd, uint uva, uint n) {
  /* TODO: check fd; reject a buffer that wraps around (uva + n < uva); copy
     the bytes in CHUNK at a time with copyin and print them with kputc. */
  return -1;
}

struct trapframe *syscall(struct trapframe *tf) {
  uint num = tf->regs[REG_A7];
  int ret = -1;

  /* TODO: dispatch on num */
  tf->regs[REG_A0] = ret;
  return tf;
}
