/*
 * programs.c: starts this level's programs. They are separate programs,
 * each linked at USER_BASE and built into the kernel (programs.s); spawn()
 * gives each its own page table. The test picks the scenario with a0.
 */
#include "kernel.h"

void start_programs(uint arg) {
  if (arg == 0) {
    spawn("hello", 0);
  } else if (arg == 1) {
    spawn("same", 0);
    spawn("same", 0);
    spawn("same", 0);
  } else if (arg == 2) {
    spawn("hello", 0);
    spawn("nullread", 0);
    spawn("hello", 0);
  } else if (arg == 3) {
    spawn("rotext", 0);
    spawn("peek", 0);
    spawn("hello", 0);
  } else {
    spawn("badptr", 0);
  }
}
