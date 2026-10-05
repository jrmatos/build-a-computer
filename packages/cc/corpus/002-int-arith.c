/* 002-int-arith: + - * / % on mixed int values, precedence and associativity */
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

static int vals[8] = {0, 1, -1, 7, -13, 100, 12345, -999};

static int combine(int x, int y) {
  int r = x + y * 3 - x * 2;
  if (y != 0) r += x / y + x % y;
  return r;
}

int main(void) {
  int i, j;
  unsigned sum = 0;
  int a = 17, b = 5, c = -4;
  show("a+b", a + b);
  show("a-b", a - b);
  show("b-a", b - a);
  show("a*b", a * b);
  show("a/b", a / b);
  show("a%b", a % b);
  show("a*c", a * c);
  show("a/c", a / c);
  show("a%c", a % c);
  show("expr1", a * b + a / b - a % b);
  show("expr2", (a + b) * (a - b));
  show("expr3 a-b-3", a - b - 3);
  show("expr4 100/10/5", 100 / 10 / 5);
  show("expr5", 2 + 3 * 4 - 6 / 2);
  show("expr6 -a*-b", -a * -b);
  show("expr7", -(a - 2 * b));
  show("expr8", a * b % 7 * c);
  show("expr9", (a - b) * (b - a) / (c - 1));
  show("expr10", +a - -b - - -c);
  for (i = 0; i < 8; i++) {
    unsigned row = 0;
    for (j = 0; j < 8; j++) {
      int r = combine(vals[i], vals[j]);
      row = row * 31u + (unsigned)r;
    }
    puts_("row ");
    puti(i);
    puts_(": ");
    putx(row);
    nl();
    sum = sum * 17u + row;
  }
  showu("sum", sum);
  return (int)(sum & 0xff);
}
