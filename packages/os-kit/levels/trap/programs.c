/*
 * programs.c: starts this level's user program. The test picks what it does
 * with the boot argument (a0): 0 hello, 1 register check, 2 many traps,
 * 3 illegal instruction, 4 bad load.
 */
#include "kernel.h"

void user_main(void);

void start_programs(uint arg) {
  enter_user((uint)user_main, arg);
}
