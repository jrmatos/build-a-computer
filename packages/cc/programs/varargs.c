#include "prelude.h"
#include <stdarg.h>
static int sum(int n, ...) {
  va_list ap; int s = 0;
  va_start(ap, n);
  while (n--) s += va_arg(ap, int);
  va_end(ap);
  return s;
}
static long long sumll(int n, ...) {
  va_list ap; long long s = 0;
  va_start(ap, n);
  while (n--) s += va_arg(ap, long long);
  va_end(ap);
  return s;
}
static int vsum(int n, va_list ap) { int s = 0; while (n--) s += va_arg(ap, int); return s; }
static int fwd(int n, ...) { va_list ap; int r; va_start(ap, n); r = vsum(n, ap); va_end(ap); return r; }
struct pt { int x, y; };
struct bigs { int a[4]; };
static int fmt(const char *f, ...) {
  va_list ap, ap2;
  int total = 0;
  va_start(ap, f);
  va_copy(ap2, ap);
  for (; *f; f++) {
    switch (*f) {
      case 'i': total += va_arg(ap, int); break;
      case 'c': total += (char)va_arg(ap, int); break;
      case 'l': total += (int)(va_arg(ap, long long) >> 20); break;
      case 's': { const char *s = va_arg(ap, const char *); while (*s) total += *s++; break; }
      case 'p': { struct pt p = va_arg(ap, struct pt); total += p.x * 3 + p.y; break; }
      case 'b': { struct bigs b = va_arg(ap, struct bigs); total += b.a[0] + b.a[3]; break; }
    }
  }
  total += va_arg(ap2, int) * 1000;
  va_end(ap2);
  va_end(ap);
  return total;
}
static int many(int a, int b, int c, int d, int e, int f, int g, ...) {
  va_list ap; long long x; int y;
  va_start(ap, g);
  x = va_arg(ap, long long);
  y = va_arg(ap, int);
  va_end(ap);
  return a + b + c + d + e + f + g + (int)(x >> 32) + y;
}
int main(void) {
  struct pt p = { 5, 6 };
  struct bigs b = { { 1, 2, 3, 4 } };
  show("sum", sum(5, 1, 2, 3, 4, 5));
  show("sum0", sum(0));
  show("sum10", sum(10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
  showll("sumll", sumll(3, 1LL << 40, -5LL, 7LL));
  showll("sumll odd", sumll(4, 1LL, 2LL, 3LL, 0x100000000LL));
  show("fwd", fwd(4, 10, 20, 30, 40));
  show("fmt", fmt("icslpb", 7, 'x', "AB", 3LL << 21, p, b));
  show("many", many(1, 2, 3, 4, 5, 6, 7, 0x500000000LL, 9));
  return 0;
}
