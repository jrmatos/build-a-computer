/*
 * programs.c: starts this level's first program (built into the kernel,
 * programs.s). The test picks the scenario with a0.
 */
#include "kernel.h"

void start_programs(uint arg) {
  if (arg == 0)
    spawn("leaks", 0);
  else if (arg == 1)
    spawn("zero", 0);
  else if (arg == 2)
    spawn("oom", 0);
  else
    spawn("heap", 0);
}
