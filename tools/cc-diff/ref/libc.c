/*
 * Reference libc for the gcc golden build of the libc group (corpus programs
 * that include <stdio.h>, <stdlib.h> or <string.h>). It implements the
 * standard behavior of the subset packages/libc provides, so the goldens are
 * plain ISO C results, independent of our libc. Never linked into our build.
 */
#include <stdarg.h>
#include <stddef.h>

#define UART ((volatile unsigned char *)0x10000000)

int putchar(int c) { *UART = (unsigned char)c; return (unsigned char)c; }

int puts(const char *s) {
  while (*s) putchar(*s++);
  putchar('\n');
  return 0;
}

static int out_unsigned(unsigned v, unsigned base) {
  char buf[12];
  int i = 0, n;
  do { buf[i++] = "0123456789abcdef"[v % base]; v /= base; } while (v);
  n = i;
  while (i > 0) putchar(buf[--i]);
  return n;
}

int printf(const char *fmt, ...) {
  va_list ap;
  int n = 0;
  va_start(ap, fmt);
  for (; *fmt; fmt++) {
    if (*fmt != '%') { putchar(*fmt); n++; continue; }
    fmt++;
    switch (*fmt) {
      case 'd': {
        int v = va_arg(ap, int);
        if (v < 0) { putchar('-'); n++; n += out_unsigned(0u - (unsigned)v, 10); }
        else n += out_unsigned((unsigned)v, 10);
        break;
      }
      case 'u': n += out_unsigned(va_arg(ap, unsigned), 10); break;
      case 'x': n += out_unsigned(va_arg(ap, unsigned), 16); break;
      case 'p': putchar('0'); putchar('x'); n += 2 + out_unsigned((unsigned)va_arg(ap, void *), 16); break;
      case 'c': putchar(va_arg(ap, int)); n++; break;
      case 's': {
        const char *s = va_arg(ap, const char *);
        while (*s) { putchar(*s++); n++; }
        break;
      }
      case '%': putchar('%'); n++; break;
      case 0: fmt--; break;
      default: putchar('%'); putchar(*fmt); n += 2; break;
    }
  }
  va_end(ap);
  return n;
}

void *memcpy(void *dst, const void *src, size_t n) {
  unsigned char *d = (unsigned char *)dst;
  const unsigned char *s = (const unsigned char *)src;
  while (n > 0) { *d++ = *s++; n--; }
  return dst;
}

void *memmove(void *dst, const void *src, size_t n) {
  unsigned char *d = (unsigned char *)dst;
  const unsigned char *s = (const unsigned char *)src;
  if (d < s) { while (n > 0) { *d++ = *s++; n--; } }
  else { while (n > 0) { n--; d[n] = s[n]; } }
  return dst;
}

void *memset(void *dst, int c, size_t n) {
  unsigned char *d = (unsigned char *)dst;
  while (n > 0) { *d++ = (unsigned char)c; n--; }
  return dst;
}

size_t strlen(const char *s) {
  size_t n = 0;
  while (s[n]) n++;
  return n;
}

int strcmp(const char *a, const char *b) {
  while (*a && *a == *b) { a++; b++; }
  return (int)(unsigned char)*a - (int)(unsigned char)*b;
}

/* First-fit free list over [_end, top of RAM - 64 KiB stack). */
extern char _end[];
#define RAM_TOP 0x80100000u
#define STACK_RESERVE 0x10000u

typedef struct Block { size_t size; struct Block *next; } Block;
static Block *free_list;
static char *brk_ptr;

void *malloc(size_t n) {
  Block **pp, *b;
  if (n == 0) n = 1;
  n = (n + 7u) & ~7u;
  for (pp = &free_list; *pp; pp = &(*pp)->next) {
    b = *pp;
    if (b->size >= n) { *pp = b->next; return (char *)b + sizeof(Block); }
  }
  if (!brk_ptr) brk_ptr = (char *)(((unsigned)_end + 7u) & ~7u);
  if ((unsigned)brk_ptr + sizeof(Block) + n > RAM_TOP - STACK_RESERVE) return NULL;
  b = (Block *)brk_ptr;
  b->size = n;
  brk_ptr += sizeof(Block) + n;
  return (char *)b + sizeof(Block);
}

void free(void *p) {
  Block *b;
  if (!p) return;
  b = (Block *)((char *)p - sizeof(Block));
  b->next = free_list;
  free_list = b;
}
