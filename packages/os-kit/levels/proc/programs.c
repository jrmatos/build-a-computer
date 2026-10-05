/*
 * programs.c: creates this level's processes. The test picks the scenario
 * with the boot argument (a0). Each process runs a function from user.c in
 * user mode.
 */
#include "kernel.h"

void pinger(int arg);
void counter(int n);
void show_pid(int arg);
void letter(int c);
void last_word(int code);

void start_programs(uint arg) {
  int i;
  if (arg == 0) {
    proc_create("ping", (uint)pinger, 0);
    proc_create("pong", (uint)pinger, 1);
  } else if (arg == 1) {
    proc_create("one", (uint)counter, 1);
    proc_create("three", (uint)counter, 3);
    proc_create("two", (uint)counter, 2);
  } else if (arg == 2) {
    for (i = 0; i < 3; i++)
      proc_create("pid", (uint)show_pid, 0);
  } else if (arg == 3) {
    for (i = 0; i < 9; i++) {
      if (proc_create("letter", (uint)letter, 'A' + i) == 0) {
        kputs("process ");
        kputi(i + 1);
        kputs(": the table is full\n");
      }
    }
  } else {
    proc_create("first", (uint)last_word, 7);
    proc_create("second", (uint)counter, 2);
  }
}
