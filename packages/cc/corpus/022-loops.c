/* 022-loops: for/while/do-while, break/continue, nested loops with flags, unsigned countdown, goto loop */
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

int main(void) {
  int i, j, s = 0, found, n, steps;
  unsigned u, cnt;
  for (i = 0; i < 10; i++) s += i;
  show("for sum 0..9", s);
  s = 0;
  for (i = 0; i < 20; i++) {
    if (i % 3 == 0) continue;
    if (i > 15) break;
    s += i;
  }
  show("continue/break", s);
  i = 1; n = 0;
  while (i < 1000) { i *= 3; n++; }
  show("while pow3", i); show("iterations", n);
  n = 0;
  do n++; while (0);
  show("do-while once", n);
  i = 100; n = 0;
  do { i -= 7; n++; } while (i > 0);
  show("do i", i); show("do n", n);
  found = 0;
  for (i = 1; i < 20 && !found; i++) {
    for (j = 1; j < 20; j++) {
      if (i * j == 91) { found = 1; break; }
    }
  }
  show("found i", i - 1); show("found j", j);
  cnt = 0;
  for (u = 10; u-- > 0;) cnt += u;
  showu("unsigned countdown sum", cnt);
  showu("u after", u);
  cnt = 0;
  for (u = 5; u != 0u - 1u; u--) cnt = cnt * 10u + u;
  showu("u to -1", cnt);
  s = 0;
  for (i = 1; i <= 9; i++)
    for (j = 1; j <= i; j++)
      s += i * j;
  show("triangle mul table", s);
  n = 27; steps = 0;
again:
  if (n != 1) {
    n = (n & 1) ? 3 * n + 1 : n / 2;
    steps++;
    goto again;
  }
  show("goto collatz 27", steps);
  s = 0;
  for (i = 0; i < 5; i++) {
    j = 0;
    while (1) {
      if (++j > i) break;
      if (j == 2) continue;
      s += i * 10 + j;
    }
  }
  show("while(1) nested", s);
  for (i = 0, j = 0; i < 100; i += j, j++) ;
  show("empty body i", i); show("empty body j", j);
  s = 0;
  for (;;) { s++; if (s >= 13) break; }
  show("for(;;)", s);
  return (s + steps + (int)cnt) & 0xff;
}
