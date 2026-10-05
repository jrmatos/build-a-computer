/* 033-unions: union size, int vs unsigned char[4] punning (little endian), tagged union in struct */
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

union word { unsigned u; int i; unsigned char b[4]; unsigned short h[2]; };
union mixed { char c; short s; int i; char buf[7]; };

enum kind { K_INT, K_CHR, K_PAIR, K_STR };
struct value {
  enum kind tag;
  union { int i; char c; struct { short a, b; } pair; const char *s; } u;
};

static int eval(const struct value *v) {
  switch (v->tag) {
  case K_INT: return v->u.i;
  case K_CHR: return v->u.c;
  case K_PAIR: return v->u.pair.a * v->u.pair.b;
  case K_STR: { int n = 0; while (v->u.s[n]) n++; return n; }
  }
  return -1;
}

static void put_value(const struct value *v) {
  switch (v->tag) {
  case K_INT: puts_("int "); puti(v->u.i); break;
  case K_CHR: puts_("chr "); putch(v->u.c); break;
  case K_PAIR: puts_("pair "); puti(v->u.pair.a); putch(','); puti(v->u.pair.b); break;
  case K_STR: puts_("str "); puts_(v->u.s); break;
  }
  puts_(" -> "); puti(eval(v)); nl();
}

int main(void) {
  union word w;
  union mixed m;
  struct value vals[5];
  int i, total = 0;

  show("sizeof word", (int)sizeof w);
  show("sizeof mixed", (int)sizeof m);
  show("sizeof value", (int)sizeof(struct value));

  w.u = 0x11223344u;
  for (i = 0; i < 4; i++) { puts_("b"); puti(i); puts_("="); putx(w.b[i]); nl(); }
  showu("h[0]", w.h[0]);
  showu("h[1]", w.h[1]);
  w.b[3] = 0xff;
  showu("u after b[3]=ff", w.u);
  show("i after b[3]=ff", w.i);
  w.i = -2;
  showu("u of -2", w.u);
  show("b[0] of -2", w.b[0]);
  w.h[0] = 0xbeef; w.h[1] = 0xdead;
  showu("u from halves", w.u);

  m.i = 0;
  m.c = 'A';
  show("m.i after c=A", m.i);
  m.s = 0x0142;
  show("m.c after s", m.c);
  show("m.buf[1]", m.buf[1]);

  vals[0].tag = K_INT; vals[0].u.i = -1234;
  vals[1].tag = K_CHR; vals[1].u.c = 'x';
  vals[2].tag = K_PAIR; vals[2].u.pair.a = 12; vals[2].u.pair.b = -3;
  vals[3].tag = K_STR; vals[3].u.s = "union!";
  vals[4] = vals[2];
  vals[4].u.pair.b = 9;
  for (i = 0; i < 5; i++) { put_value(&vals[i]); total += eval(&vals[i]); }
  show("vals[2].pair.b", vals[2].u.pair.b);
  show("total", total);
  return (total + (int)w.b[1]) & 0xff;
}
