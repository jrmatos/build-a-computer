/* 039-varargs: <stdarg.h> sum/max of n ints, mini formatter with %d %u %x %s %c */
#include <stdarg.h>
/* Corpus prelude: paste at the top of every freestanding program (no libc). */
#define UART ((volatile unsigned char *)0x10000000)

static void putch(int c) { *UART = (unsigned char)c; }
static void puts_(const char *s) { while (*s) putch(*s++); }
static void putu(unsigned v) {
  char buf[12];
  int i = 0;
  do { buf[i++] = (char)('0' + v % 10); v /= 10; } while (v);
  while (i > 0) putch(buf[--i]);
}
static void puti(int v) {
  if (v < 0) { putch('-'); putu(0u - (unsigned)v); }
  else putu((unsigned)v);
}
static void putx(unsigned v) {
  int i;
  for (i = 28; i >= 0; i -= 4) putch("0123456789abcdef"[(v >> i) & 15]);
}
static void nl(void) { putch('\n'); }
static void show(const char *label, int v) { puts_(label); puts_(" = "); puti(v); nl(); }
static void showu(const char *label, unsigned v) { puts_(label); puts_(" = "); putu(v); puts_(" 0x"); putx(v); nl(); }
/* end prelude */

static int sum_n(int n, ...) {
  va_list ap;
  int s = 0;
  va_start(ap, n);
  while (n-- > 0) s += va_arg(ap, int);
  va_end(ap);
  return s;
}

static int max_n(int n, ...) {
  va_list ap;
  int m, v;
  va_start(ap, n);
  m = va_arg(ap, int);
  while (--n > 0) { v = va_arg(ap, int); if (v > m) m = v; }
  va_end(ap);
  return m;
}

static int count;
static void out(int c) { putch(c); count++; }

static int vmy_print(const char *fmt, va_list ap) {
  const char *s;
  count = 0;
  for (; *fmt; fmt++) {
    if (*fmt != '%') { out(*fmt); continue; }
    fmt++;
    switch (*fmt) {
    case 'd': {
      int v = va_arg(ap, int);
      unsigned u;
      char buf[12]; int i = 0;
      if (v < 0) { out('-'); u = 0u - (unsigned)v; } else u = (unsigned)v;
      do { buf[i++] = (char)('0' + u % 10); u /= 10; } while (u);
      while (i) out(buf[--i]);
      break;
    }
    case 'u': {
      unsigned u = va_arg(ap, unsigned);
      char buf[12]; int i = 0;
      do { buf[i++] = (char)('0' + u % 10); u /= 10; } while (u);
      while (i) out(buf[--i]);
      break;
    }
    case 'x': {
      unsigned u = va_arg(ap, unsigned);
      int sh = 28;
      while (sh > 0 && ((u >> sh) & 15) == 0) sh -= 4;
      for (; sh >= 0; sh -= 4) out("0123456789abcdef"[(u >> sh) & 15]);
      break;
    }
    case 's':
      for (s = va_arg(ap, const char *); *s; s++) out(*s);
      break;
    case 'c': out(va_arg(ap, int)); break;
    case '%': out('%'); break;
    default: out('?'); break;
    }
  }
  return count;
}

static int my_print(const char *fmt, ...) {
  va_list ap;
  int n;
  va_start(ap, fmt);
  n = vmy_print(fmt, ap);
  va_end(ap);
  return n;
}

static int pass_on(int tag, ...) {
  va_list ap, ap2;
  int a, b;
  va_start(ap, tag);
  va_copy(ap2, ap);
  a = va_arg(ap, int);
  b = va_arg(ap2, int);
  va_end(ap2);
  va_end(ap);
  return tag * 1000 + a * 10 + b;
}

int main(void) {
  int t = 0, n;
  char c = 'Q';
  short sh = -12;

  show("sum_n(0)", sum_n(0));
  show("sum_n(3)", sum_n(3, 10, 20, 30));
  show("sum_n(9)", sum_n(9, 1, -2, 3, -4, 5, -6, 7, -8, 9));
  show("max_n(1)", max_n(1, -9));
  show("max_n(6)", max_n(6, 3, 77, -100, 76, 0, 12));
  show("max_n(10)", max_n(10, -5, -4, -3, -2, -1, -20, -30, -40, -50, -60));
  n = my_print("d=%d u=%u x=%x s=%s c=%c%%\n", -42, 3000000000u, 0xbeefu, "str", 'Z');
  show("len", n); t += n;
  n = my_print("[%d|%d|%d] %x %x\n", 0, 2147483647, -2147483647 - 1, 0u, 0xffffffffu);
  show("len", n); t += n;
  n = my_print("%c%c%c sh=%d %s%s!\n", c, c + 1, 'a', sh, "con", "cat");
  show("len", n); t += n;
  n = my_print("bad %q end\n");
  show("len", n); t += n;
  show("pass_on", pass_on(4, 5, 6));
  show("t", t);
  return t & 0xff;
}
