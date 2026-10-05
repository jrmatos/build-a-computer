/* 011-ternary-comma: nested conditional expressions, comma operator values and sequencing */
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

static int log_[16];
static int nlog = 0;

static int note(int v) { if (nlog < 16) log_[nlog++] = v; return v; }
static int sign(int x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }
static int max3(int a, int b, int c) { return a > b ? (a > c ? a : c) : (b > c ? b : c); }
static int classify(int n) {
  return n < 0 ? -1 : n == 0 ? 0 : n < 10 ? 1 : n < 100 ? 2 : n < 1000 ? 3 : 4;
}

int main(void) {
  int a = 3, b = 9, c, i, j, s = 0;
  int x = 10, y = 20;
  int *pp;
  show("sign(-7)", sign(-7));
  show("sign(0)", sign(0));
  show("sign(12)", sign(12));
  show("max3(3,9,4)", max3(3, 9, 4));
  show("max3(9,3,4)", max3(9, 3, 4));
  show("max3(1,2,30)", max3(1, 2, 30));
  show("max3(-5,-2,-9)", max3(-5, -2, -9));
  for (i = -5; i < 2000; i += 333) s = s * 5 + classify(i);
  show("classify chain", s);
  c = (a++, b++, a + b);
  show("comma (a++,b++,a+b)", c);
  show("a", a);
  show("b", b);
  c = (note(1), note(2), note(3));
  show("comma value", c);
  show("nlog", nlog);
  c = a > b ? (note(4), 40) : (note(5), 50);
  show("ternary with comma", c);
  s = 0;
  for (i = 0, j = 10; i < j; i++, j--) s += i * j;
  show("for i,j", s);
  pp = a < b ? &x : &y;
  *pp += 5;
  show("x via ?: ptr", x);
  show("y", y);
  *(a > b ? &x : &y) = 77;
  show("y after", y);
  c = 1 ? 'A' : 2;
  show("1?'A':2", c);
  c = (a & 1) ? (b & 1 ? 11 : 10) : (b & 1 ? 1 : 0);
  show("parity code", c);
  c = (x = 2, y = x * 3, x + y);
  show("assign chain", c);
  c = a ? b ? 1 : 2 : 3;
  show("a?b?1:2:3", c);
  c = 0 ? 5 : 0 ? 6 : 7;
  show("0?5:0?6:7", c);
  for (i = 0; i < nlog; i++) { puts_("log "); puti(log_[i]); nl(); }
  return (s + c + nlog) & 0xff;
}
