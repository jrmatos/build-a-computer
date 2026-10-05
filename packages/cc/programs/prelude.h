/* Prelude for packages/cc/programs: freestanding output over the UART. */
#ifndef PRELUDE_H
#define PRELUDE_H
#define UART ((volatile unsigned char *)0x10000000)
typedef unsigned int size_t;

void *memcpy(void *d, const void *s, size_t n) {
  unsigned char *a = (unsigned char *)d;
  const unsigned char *b = (const unsigned char *)s;
  while (n--) *a++ = *b++;
  return d;
}
void *memmove(void *d, const void *s, size_t n) {
  unsigned char *a = (unsigned char *)d;
  const unsigned char *b = (const unsigned char *)s;
  if (a < b) while (n--) *a++ = *b++;
  else while (n--) a[n] = b[n];
  return d;
}
void *memset(void *d, int c, size_t n) {
  unsigned char *a = (unsigned char *)d;
  while (n--) *a++ = (unsigned char)c;
  return d;
}

static void putch(int c) { *UART = (unsigned char)c; }
static void puts_(const char *s) { while (*s) putch(*s++); }
static void putu(unsigned v) {
  char b[12];
  int i = 0;
  do { b[i++] = (char)('0' + v % 10); v /= 10; } while (v);
  while (i > 0) putch(b[--i]);
}
static void puti(int v) {
  if (v < 0) { putch('-'); putu(0u - (unsigned)v); } else putu((unsigned)v);
}
static void putx(unsigned v) {
  int i;
  for (i = 28; i >= 0; i -= 4) putch("0123456789abcdef"[(v >> i) & 15]);
}
static void putxll(unsigned long long v) { putx((unsigned)(v >> 32)); putx((unsigned)v); }
static void nl(void) { putch('\n'); }
static void show(const char *l, int v) { puts_(l); puts_(" = "); puti(v); nl(); }
static void showu(const char *l, unsigned v) { puts_(l); puts_(" = "); putu(v); puts_(" 0x"); putx(v); nl(); }
static void showll(const char *l, long long v) { puts_(l); puts_(" = 0x"); putxll((unsigned long long)v); nl(); }
static unsigned hash_ = 2166136261u;
#ifdef TRACE
static void mix(unsigned v) { hash_ = (hash_ ^ v) * 16777619u; putx(v); putch('\n'); }
#else
static void mix(unsigned v) { hash_ = (hash_ ^ v) * 16777619u; }
#endif
static void mixll(unsigned long long v) { mix((unsigned)v); mix((unsigned)(v >> 32)); }
#endif
