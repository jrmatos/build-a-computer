/* 009-compare-logic: relational/equality results are 0/1, logical not/and/or produce 0/1 */
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

static int vals[5] = {-3, 0, 2, 2, 7};

int main(void) {
  int i, j, acc = 0, t;
  unsigned ua = 5, ub = 0xfffffff0u;
  int arr[4] = {1, 2, 3, 4};
  int *p = &arr[1], *q = &arr[3];
  for (i = 0; i < 5; i++) {
    for (j = 0; j < 5; j++) {
      int a = vals[i], b = vals[j];
      int bits = (a < b) | (a <= b) << 1 | (a > b) << 2 | (a >= b) << 3 | (a == b) << 4 | (a != b) << 5;
      puti(a); puts_(" vs "); puti(b); puts_(": "); puti(bits); nl();
      acc = acc * 3 + bits;
      acc &= 0xffffff;
    }
  }
  show("!0", !0);
  show("!5", !5);
  show("!-3", !-3);
  show("!!-3", !!-3);
  show("!!0", !!0);
  show("3&&4", 3 && 4);
  show("3&&0", 3 && 0);
  show("0||-9", 0 || -9);
  show("0||0", 0 || 0);
  show("(3>2)>1", (3 > 2) > 1);
  show("(1==1)==1", (1 == 1) == 1);
  show("(2==2)+(3!=3)+(4<5)", (2 == 2) + (3 != 3) + (4 < 5));
  show("ua<ub", ua < ub);
  show("(int)ub<(int)ua", (int)ub < (int)ua);
  show("p<q", p < q);
  show("p==&arr[1]", p == &arr[1]);
  show("q-p", (int)(q - p));
  show("p!=0", p != 0);
  show("!p", !p);
  t = 0;
  for (i = -5; i <= 5; i++) t += (i > 0) - (i < 0);
  show("sum of signs", t);
  t = 0;
  for (i = 0; i < 20; i++) t += !(i % 3) + 2 * (i % 5 == 0 || i % 7 == 0) + 4 * (i > 4 && i < 12);
  show("mixed", t);
  t = (vals[0] < vals[1]) * 100 + (vals[2] == vals[3]) * 10 + (vals[4] != 7);
  show("weighted", t);
  show("acc", acc);
  return (acc + t) & 0xff;
}
