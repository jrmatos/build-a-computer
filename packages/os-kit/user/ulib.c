/* ulib.c: small helpers every program links with. */
#include "user.h"

int strlen(char *s) {
  int n = 0;
  while (s[n])
    n++;
  return n;
}

int strcmp(char *a, char *b) {
  while (*a && *a == *b) {
    a++;
    b++;
  }
  return (unsigned char)*a - (unsigned char)*b;
}

void *memset(void *dst, int c, int n) {
  char *d = dst;
  int i;
  for (i = 0; i < n; i++)
    d[i] = c;
  return dst;
}

void *memcpy(void *dst, void *src, int n) {
  char *d = dst;
  char *s = src;
  int i;
  for (i = 0; i < n; i++)
    d[i] = s[i];
  return dst;
}

int atoi(char *s) {
  int n = 0;
  int neg = 0;
  if (*s == '-') {
    neg = 1;
    s++;
  }
  while (*s >= '0' && *s <= '9') {
    n = n * 10 + (*s - '0');
    s++;
  }
  if (neg)
    return -n;
  return n;
}

void putchar(int c) {
  char ch = c;
  write(1, &ch, 1);
}

void print(char *s) {
  write(1, s, strlen(s));
}

void printint(int n) {
  char buf[12];
  int i = 11;
  uint u = n;
  if (n < 0)
    u = 0 - u;
  buf[i] = 0;
  do {
    i--;
    buf[i] = '0' + u % 10;
    u = u / 10;
  } while (u != 0);
  if (n < 0) {
    i--;
    buf[i] = '-';
  }
  print(buf + i);
}

void printhex(uint n) {
  char buf[11];
  int i;
  buf[0] = '0';
  buf[1] = 'x';
  for (i = 0; i < 8; i++)
    buf[2 + i] = "0123456789abcdef"[(n >> (28 - 4 * i)) & 15];
  buf[10] = 0;
  print(buf);
}
