/* 017-enum: implicit/explicit/negative enumerator values, enums in switch, as indices, arithmetic */
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

enum color { RED, GREEN, BLUE, NCOLORS };
enum misc { M_A = 5, M_B, M_C = -3, M_D, M_E = 100, M_F = M_E * 2, M_G = M_B + M_D };
enum day { MON = 1, TUE, WED, THU, FRI, SAT, SUN };
typedef enum { OP_ADD, OP_SUB, OP_MUL, OP_NEG = 10, OP_LAST } op_t;

static const char *names[NCOLORS] = {"red", "green", "blue"};
static int counts[NCOLORS];

static enum day next_day(enum day d) { return d == SUN ? MON : (enum day)(d + 1); }

static int apply(op_t op, int a, int b) {
  switch (op) {
  case OP_ADD: return a + b;
  case OP_SUB: return a - b;
  case OP_MUL: return a * b;
  case OP_NEG: return -a;
  default: return 9999;
  }
}

static int weekend(enum day d) {
  switch (d) {
  case SAT:
  case SUN: return 1;
  default: return 0;
  }
}

int main(void) {
  enum color c;
  enum day d = FRI;
  int i, s = 0;
  op_t op;
  show("RED", RED); show("GREEN", GREEN); show("BLUE", BLUE); show("NCOLORS", NCOLORS);
  show("M_A", M_A); show("M_B", M_B); show("M_C", M_C); show("M_D", M_D);
  show("M_E", M_E); show("M_F", M_F); show("M_G", M_G);
  show("SUN", SUN);
  show("sizeof(enum day)", (int)sizeof(enum day));
  for (i = 0; i < 20; i++) {
    c = (enum color)(i * 7 % NCOLORS);
    counts[c]++;
  }
  for (c = RED; c < NCOLORS; c++) {
    puts_(names[c]); puts_(" = "); puti(counts[c]); nl();
  }
  for (i = 0; i < 10; i++) {
    puts_("day "); puti(d); puts_(weekend(d) ? " weekend" : " weekday"); nl();
    s = s * 2 + weekend(d);
    d = next_day(d);
  }
  for (op = OP_ADD; op <= OP_LAST; op++) {
    int r = apply(op, 7, -3);
    puts_("op "); puti(op); puts_(" -> "); puti(r); nl();
    s += r;
  }
  show("M_C < 0", M_C < 0);
  show("BLUE - RED", BLUE - RED);
  show("(SUN - MON + 1) % 7", (SUN - MON + 1) % 7);
  show("M_D * M_B", M_D * M_B);
  show("s", s);
  return s & 0xff;
}
