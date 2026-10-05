/*
 * programs.c: creates this level's processes (user.c). The test picks the
 * scenario with the boot argument (a0).
 */
#include "kernel.h"

void token(int me);
void sleeper(int ticks);
void hog(int n);
void ticker(int n);
void clock_check(int arg);

void start_programs(uint arg) {
  if (arg == 0) {
    proc_create("A", (uint)token, 0);
    proc_create("B", (uint)token, 1);
    proc_create("C", (uint)token, 2);
  } else if (arg == 1) {
    proc_create("slow", (uint)sleeper, 60000);
    proc_create("fast", (uint)sleeper, 20000);
    proc_create("medium", (uint)sleeper, 40000);
  } else if (arg == 2) {
    proc_create("hog", (uint)hog, 300000);
    proc_create("ticker", (uint)ticker, 3);
  } else {
    proc_create("clock", (uint)clock_check, 0);
  }
}
