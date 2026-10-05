/* 010-short-circuit: && || ?: skip side effects; call counters prove evaluation order */
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

static int calls = 0;
static int order = 0;

static int f(int id, int v) {
  calls++;
  order = order * 10 + id;
  return v;
}

static void report(const char *label, int r) {
  puts_(label); puts_(": r="); puti(r);
  puts_(" calls="); puti(calls);
  puts_(" order="); puti(order); nl();
  calls = 0;
  order = 0;
}

int main(void) {
  int r, x = 0, i, total = 0;
  int arr[5] = {4, 8, 15, 16, 23};
  int *np = 0;
  r = f(1, 0) && f(2, 1); report("0&&1", r);
  r = f(1, 1) && f(2, 0); report("1&&0", r);
  r = f(1, 1) && f(2, 5); report("1&&5", r);
  r = f(1, 7) || f(2, 1); report("7||1", r);
  r = f(1, 0) || f(2, 0); report("0||0", r);
  r = f(1, 0) || f(2, 3); report("0||3", r);
  r = (f(1, 1) && f(2, 0)) || f(3, 1); report("1&&0||1", r);
  r = (f(1, 0) && f(2, 1)) || f(3, 0); report("0&&1||0", r);
  r = f(1, 1) || (f(2, 1) && f(3, 1)); report("1||1&&1", r);
  r = (f(1, 0) || f(2, 1)) && (f(3, 0) || f(4, 2)); report("(0||1)&&(0||2)", r);
  r = f(1, 1) ? f(2, 20) : f(3, 30); report("1?20:30", r);
  r = f(1, 0) ? f(2, 20) : f(3, 30); report("0?20:30", r);
  r = f(1, 0) ? f(2, 1) : f(3, 0) ? f(4, 4) : f(5, 5); report("nested ?:", r);
  r = !f(1, 0) && !f(2, 0) && !f(3, 1) && f(4, 1); report("!chain", r);
  x = 0;
  r = (x != 0) && (10 / x > 1);
  show("guarded div", r);
  r = np != 0 && *np == 3;
  show("guarded deref", r);
  x = 5;
  r = (x > 3 || ++x);
  r += x;
  show("skipped ++x", r);
  r = (x > 30 || ++x);
  r += x;
  show("done ++x", r);
  i = 0;
  while (i < 5 && arr[i] != 16) i++;
  show("search 16", i);
  i = 0;
  while (i < 5 && arr[i] != 99) i++;
  show("search 99", i);
  for (i = 0; i < 10; i++) {
    if (i % 2 == 0 && f(i, i) > 4) total += 100;
    if (i % 3 == 0 || f(i, 0)) total += 1;
  }
  show("loop total", total);
  show("loop calls", calls);
  return (total + calls) & 0xff;
}
