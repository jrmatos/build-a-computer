/*
 * user.c: this level's processes. Each one is a function that runs in user
 * mode; yield() lets the next process run.
 */
#include "user.h"

/* arg 0 prints ping, arg 1 pong: three times, yielding after each. */
void pinger(int arg) {
  int i;
  for (i = 0; i < 3; i++) {
    if (arg == 0)
      print("ping ");
    else
      print("pong ");
    printint(i);
    print("\n");
    yield();
  }
  exit(0);
}

/* Count to n, yielding after each number. */
void counter(int n) {
  int i;
  for (i = 1; i <= n; i++) {
    print("[");
    printint(getpid());
    print("] ");
    printint(i);
    print("/");
    printint(n);
    print("\n");
    yield();
  }
  exit(0);
}

void show_pid(int arg) {
  print("I am pid ");
  printint(getpid());
  print("\n");
  yield();
  print("pid ");
  printint(getpid());
  print(" again\n");
  exit(0);
}

void letter(int c) {
  putchar(c);
  yield();
  putchar(c - 'A' + 'a');
  exit(0);
}

/* Exit first, with code `code`: the machine's exit code is pid 1's. */
void last_word(int code) {
  print("pid 1 exits with ");
  printint(code);
  print("\n");
  exit(code);
}
