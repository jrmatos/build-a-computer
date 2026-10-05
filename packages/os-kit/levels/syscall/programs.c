/*
 * programs.c: starts this level's user program (user.c) in user mode. The
 * test picks which one with the boot argument (a0).
 */
#include "kernel.h"

void user_main(int which);

void start_programs(uint arg) {
  enter_user((uint)user_main, arg);
}
