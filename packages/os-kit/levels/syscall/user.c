/*
 * user.c: this level's test programs. They run in user mode and reach the
 * kernel only through system calls (usys.s). `which` comes from the test.
 */
#include "user.h"

static void hello(void) {
  int n = write(1, "Hello from user mode!\n", 22);
  print("write returned ");
  printint(n);
  print("\n");
  exit(0);
}

static void pid_and_exit(void) {
  print("my pid is ");
  printint(getpid());
  print("\n");
  exit(42);
}

/* Pointers the kernel must refuse without crashing. */
static void bad_pointers(void) {
  print("null: ");
  printint(write(1, (void *)0, 5));
  print("\nbelow RAM: ");
  printint(write(1, (void *)0x7ffffff0, 32));
  print("\npast the end of RAM: ");
  printint(write(1, (void *)0x803ffff0, 32));
  print("\nwrapping around: ");
  printint(write(1, (void *)0x80001000, -1));
  print("\nfd 7: ");
  printint(write(7, "x", 1));
  print("\nstill alive\n");
  exit(0);
}

static void unknown_call(void) {
  int r = raw_syscall(999, 1, 2, 3);
  print("system call 999 returned ");
  printint(r);
  print("\n");
  exit(0);
}

/* Read lines from the console until there is no more input. */
static void echo_lines(void) {
  char buf[32];
  int n;
  int lines = 0;
  for (;;) {
    n = read(0, buf, 31);
    if (n <= 0)
      break;
    buf[n] = 0;
    lines++;
    print("[");
    printint(n);
    print(" bytes]\n");
  }
  print("read returned ");
  printint(n);
  print(" after ");
  printint(lines);
  print(" lines\n");
  exit(lines);
}

static void small_buffer(void) {
  char buf[4];
  int n = read(0, buf, 3);
  print("\nfirst read: ");
  printint(n);
  n = read(0, buf, 3);
  print("\nsecond read: ");
  printint(n);
  print("\n");
  exit(0);
}

void user_main(int which) {
  if (which == 0)
    hello();
  if (which == 1)
    pid_and_exit();
  if (which == 2)
    bad_pointers();
  if (which == 3)
    unknown_call();
  if (which == 4)
    echo_lines();
  small_buffer();
}
