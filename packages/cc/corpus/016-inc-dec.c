/* 016-inc-dec: pre/post increment/decrement on ints, narrow types (wrapping), pointers, array elements, members */
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

struct pt { int x; int y; };
static int arr[5] = {10, 20, 30, 40, 50};

int main(void) {
  int i = 5, j, n, s = 0;
  unsigned u = 0;
  unsigned char uc = 254;
  signed char sc = 126;
  char c = 1;
  short sh = 32766;
  int *p = arr;
  struct pt pt = {3, 4}, *pp = &pt;
  j = i++; show("j=i++ j", j); show("i", i);
  j = ++i; show("j=++i j", j); show("i", i);
  j = i--; show("j=i-- j", j); show("i", i);
  j = --i; show("j=--i j", j); show("i", i);
  u--; showu("u-- from 0", u);
  u++; showu("u++ back", u);
  uc++; show("uc++", uc);
  uc++; show("uc++ wrap", uc);
  uc--; show("uc-- wrap", uc);
  sc++; show("sc++", sc);
  sc++; show("sc++ wrap", sc);
  sc--; show("sc-- back", sc);
  c--; show("c--", c);
  c--; show("c-- wrap", c);
  j = c++; show("j=c++", j); show("c", c);
  sh++; sh++; show("sh++ x2 wrap", sh);
  j = *p++; show("*p++", j); show("p-arr", (int)(p - arr));
  j = *++p; show("*++p", j);
  j = (*p)++; show("(*p)++", j); show("arr[2]", arr[2]);
  j = ++*p; show("++*p", j);
  j = *p--; show("*p--", j); show("*p", *p);
  j = --*p; show("--*p", j);
  i = 3;
  arr[i]++; show("arr[3]++", arr[3]);
  --arr[i]; show("--arr[3]", arr[3]);
  j = arr[i]--; show("arr[3]-- old", j); show("new", arr[3]);
  j = arr[--i]; show("arr[--i]", j); show("i", i);
  j = arr[i++]; show("arr[i++]", j); show("i", i);
  pt.x++; show("pt.x++", pt.x);
  pp->y--; show("pp->y--", pt.y);
  j = ++pp->x; show("++pp->x", j);
  j = pp->y++; show("pp->y++ old", j); show("pt.y", pt.y);
  n = 10;
  while (n--) s += n;
  show("while(n--) sum", s); show("n after", n);
  n = 0;
  do s += ++n; while (n < 5);
  show("do ++n sum", s);
  for (i = 0, j = 10; i < j; ++i, --j) s += i * j;
  show("for ++i --j", s);
  p = &arr[4];
  while (p >= &arr[1]) { s += *p; p--; }
  show("ptr walk", s);
  return (s + uc + sc + c) & 0xff;
}
