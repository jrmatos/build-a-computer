/*
 * sh: the shell. Print a prompt, read a line, split it into words, run the
 * program named by the first word with the words as its arguments, wait for
 * it, repeat. "exit" ends the shell.
 */
#include "user.h"

#define MAXLINE 100
#define MAXARGS 8

/* Split line into words at spaces, in place. Returns how many. */
int split(char *line, char **words) {
  int n = 0;
  char *p = line;
  while (*p) {
    while (*p == ' ')
      p++;
    if (*p == 0)
      break;
    if (n == MAXARGS)
      break;
    words[n] = p;
    n++;
    while (*p && *p != ' ')
      p++;
    if (*p) {
      *p = 0;
      p++;
    }
  }
  words[n] = 0;
  return n;
}

int main(void) {
  char line[MAXLINE];
  char *words[MAXARGS + 1];
  int n;
  int pid;
  int status;
  for (;;) {
    print("$ ");
    n = read(0, line, MAXLINE - 1);
    if (n <= 0)
      return 0;                  /* no more input */
    line[n] = 0;
    if (line[n - 1] == '\n')
      line[n - 1] = 0;
    if (split(line, words) == 0)
      continue;
    if (strcmp(words[0], "exit") == 0) {
      if (words[1])
        return atoi(words[1]);
      return 0;
    }
    pid = spawn(words[0], words);
    if (pid < 0) {
      print("sh: command not found: ");
      print(words[0]);
      print("\n");
      continue;
    }
    wait(&status);
    if (status != 0) {
      print("sh: ");
      print(words[0]);
      print(" exited with ");
      printint(status);
      print("\n");
    }
  }
}
