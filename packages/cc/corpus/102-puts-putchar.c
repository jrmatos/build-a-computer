#include <stdio.h>

static const char *lines[] = {
  "first line",
  "",
  "  indented",
  "punctuation: !@#$%^&*()_+-=[]{};':\",./<>?",
  "last line",
};

static void put_str(const char *s) { while (*s) putchar(*s++); }

static void put_num(unsigned v) {
  char buf[12];
  int i = 0;
  do { buf[i++] = (char)('0' + v % 10u); v /= 10u; } while (v);
  while (i > 0) putchar(buf[--i]);
}

int main(void) {
  int i, j, r, sum = 0;
  for (i = 0; i < 5; i++) puts(lines[i]);
  for (i = 0; i < 26; i++) putchar('a' + i);
  putchar('\n');
  for (i = 0; i < 26; i++) putchar('Z' - i);
  putchar('\n');
  for (i = 32; i < 127; i++) {
    putchar(i);
    if ((i - 31) % 32 == 0) putchar('\n');
  }
  putchar('\n');
  /* triangle */
  for (i = 1; i <= 6; i++) {
    for (j = 0; j < 6 - i; j++) putchar(' ');
    for (j = 0; j < 2 * i - 1; j++) putchar('*');
    putchar('\n');
  }
  /* putchar returns the char written */
  for (i = 0; i < 4; i++) {
    r = putchar("wxyz"[i]);
    sum += r;
  }
  putchar('\n');
  put_str("sum of putchar returns: ");
  put_num((unsigned)sum);
  putchar('\n');
  r = puts("puts returns non-negative");
  put_str(r >= 0 ? "ok\n" : "bad\n");
  put_str("multi\nline\nvia putchar\n");
  puts("end");
  return sum & 0xff;
}
