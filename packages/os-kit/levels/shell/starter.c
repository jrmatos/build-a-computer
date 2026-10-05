/*
 * sh: the shell, a user program. Yours to write.
 *
 * Loop: print "$ ", read a line (read(0, ...) returns 0 when the input is
 * over: then return 0), split it into words at spaces, and:
 *   no words        prompt again
 *   exit [code]     return code (default 0)
 *   anything else   spawn(words[0], words) (words ends with a 0 pointer);
 *                   if it fails print "sh: command not found: <word>\n",
 *                   else wait(&status) and, when status is not 0, print
 *                   "sh: <word> exited with <status>\n"
 */
#include "user.h"

#define MAXLINE 100
#define MAXARGS 8

int main(void) {
  char line[MAXLINE];
  int n;
  print("$ ");
  n = read(0, line, MAXLINE - 1);
  /* TODO: the rest */
  return 0;
}
