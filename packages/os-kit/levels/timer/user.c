/*
 * user.c: this level's processes. None of them yields: only the timer
 * interrupt can take the CPU away from them.
 */
#include "user.h"

/* Shared by every process: there is no paging yet, so they all see it. */
volatile int turn;

/*
 * Pass a token around without ever yielding: process `me` waits (spinning)
 * until turn == me, prints, and hands the turn on. Without preemption the
 * first process to spin would spin forever.
 */
void token(int me) {
  int round;
  for (round = 0; round < 4; round++) {
    while (turn != me) {
    }
    putchar('A' + me);
    printint(round);
    putchar(' ');
    turn = (me + 1) % 3;
  }
  if (me == 2)
    print("\n");
  exit(0);
}

void sleeper(int ticks) {
  sleep(ticks);
  print("slept ");
  printint(ticks);
  print("\n");
  exit(0);
}

/* Burn the CPU for n loop iterations without a single system call. */
void hog(int n) {
  volatile int i;
  for (i = 0; i < n; i++) {
  }
  print("hog done\n");
  exit(0);
}

void ticker(int n) {
  int i;
  for (i = 0; i < n; i++) {
    print("tick ");
    printint(i);
    print("\n");
    sleep(5000);
  }
  exit(0);
}

void clock_check(int arg) {
  uint t0 = uptime();
  uint t1;
  sleep(10000);
  t1 = uptime();
  if (t1 - t0 >= 10000)
    print("slept at least 10000 ticks\n");
  else
    print("woke up too early\n");
  if (t1 - t0 < 20000)
    print("and not much longer\n");
  else
    print("slept far too long\n");
  exit(0);
}
