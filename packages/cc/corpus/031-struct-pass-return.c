/* 031-struct-pass-return: pass/return small and large structs by value, callee copy isolation */
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

struct pair { int a, b; };                    /* 8 bytes */
struct trio { short x; char c; };             /* small, padded */
struct big { int v[6]; char name[6]; int k; }; /* > 24 bytes */

static struct pair mkpair(int a, int b) { struct pair p; p.a = a; p.b = b; return p; }
static struct pair swap_pair(struct pair p) { int t = p.a; p.a = p.b; p.b = t; return p; }
static int pair_sum(struct pair p) { int s = p.a + p.b; p.a = 0; p.b = 0; return s; }
static struct trio mktrio(short x, char c) { struct trio t; t.x = x; t.c = c; return t; }
static int trio_val(struct trio t) { return t.x * 2 + t.c; }

static struct big mkbig(int seed) {
  struct big b;
  int i;
  for (i = 0; i < 6; i++) b.v[i] = seed * (i + 1) - i;
  for (i = 0; i < 5; i++) b.name[i] = (char)('a' + (seed + i) % 26);
  b.name[5] = 0;
  b.k = seed * 1000;
  return b;
}
static int big_sum(struct big b) {
  int s = b.k, i;
  for (i = 0; i < 6; i++) { s += b.v[i]; b.v[i] = -1; }
  b.k = 0;
  b.name[0] = '#';
  return s;
}
static struct big big_twice(struct big b) {
  int i;
  for (i = 0; i < 6; i++) b.v[i] *= 2;
  b.k += 1;
  b.name[0] = 'Z';
  return b;
}
static struct big pick(int which, struct big x, struct big y) { return which ? y : x; }

static void show_big(const char *l, struct big *b) {
  int i;
  puts_(l); puts_(": ");
  for (i = 0; i < 6; i++) { puti(b->v[i]); putch(' '); }
  puts_(b->name); putch(' '); puti(b->k); nl();
}

int main(void) {
  struct pair p = mkpair(3, 17), q;
  struct trio t;
  struct big b1, b2, b3;
  int r;

  q = swap_pair(p);
  show("p.a", p.a); show("p.b", p.b);
  show("q.a", q.a); show("q.b", q.b);
  show("pair_sum(p)", pair_sum(p));
  show("p.a after", p.a);
  show("pair_sum(mkpair)", pair_sum(mkpair(-5, 40)));
  show("swap_pair(...).a", swap_pair(mkpair(8, 9)).a);

  t = mktrio(300, 'q');
  show("trio_val", trio_val(t));
  show("trio_val direct", trio_val(mktrio(-7, 'A')));

  b1 = mkbig(3);
  show_big("b1", &b1);
  r = big_sum(b1);
  show("big_sum(b1)", r);
  show_big("b1 after", &b1);
  b2 = big_twice(b1);
  show_big("b2", &b2);
  show_big("b1 still", &b1);
  b3 = big_twice(big_twice(mkbig(5)));
  show_big("b3", &b3);
  b3 = pick(1, b1, b2);
  show_big("pick1", &b3);
  b3 = pick(0, b1, b2);
  show_big("pick0", &b3);
  show("big_sum(mkbig(7))", big_sum(mkbig(7)));
  show("mkbig(9).v[5]", mkbig(9).v[5]);
  return (r + q.a + b2.k) & 0xff;
}
