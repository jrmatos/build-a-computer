/* 044-const-volatile: const pointers/pointees, volatile locals in loops, volatile global counter */
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

static volatile int vcount;
static volatile unsigned vflags = 0x10;
static const int ctable[5] = { 2, 3, 5, 7, 11 };
static const char *const msg = "constant";

static int sum_const(const int *p, int n) { int s = 0; while (n--) s += *p++; return s; }
static void tick(void) { vcount++; }
static int read_through(const volatile int *p) { return *p * 2; }

int main(void) {
  int a = 10, b = 20;
  const int ci = 7;
  int *const cp = &a;            /* const pointer to int */
  const int *pc = &a;            /* pointer to const int */
  const int *const cpc = &b;     /* const pointer to const int */
  volatile int vi = 0;
  volatile unsigned char vbuf[8];
  int i, s;
  unsigned u;

  show("ci", ci);
  *cp = 15;
  show("a via cp", a);
  show("*pc", *pc);
  pc = &b;
  show("*pc now b", *pc);
  show("*cpc", *cpc);
  b = 99;
  show("*cpc after b=99", *cpc);
  show("sum_const ctable", sum_const(ctable, 5));
  show("sum_const ctable+2", sum_const(ctable + 2, 3));
  puts_(msg); nl();
  show("msg[3]", msg[3]);

  for (i = 0; i < 100; i++) vi += i;
  show("vi", vi);
  for (i = 0; i < 37; i++) tick();
  show("vcount", vcount);
  vcount = vcount * 3;
  show("vcount*3", vcount);
  show("read_through", read_through(&vcount));

  for (i = 0; i < 8; i++) vbuf[i] = (unsigned char)(i * 37);
  u = 0;
  for (i = 0; i < 8; i++) u = u * 257u + vbuf[i];
  showu("vbuf hash", u);

  vflags |= 3;
  vflags &= ~0x10u;
  vflags ^= 0x100;
  showu("vflags", vflags);

  {
    volatile int spin = 0;
    int loops = 0;
    while (spin < 50) { spin = spin + 7; loops++; }
    show("spin", spin);
    show("loops", loops);
  }
  {
    const volatile int cv = 123;
    show("cv", cv);
  }
  s = a + b + ci + vi + vcount + (int)vflags;
  show("s", s);
  return s & 0xff;
}
