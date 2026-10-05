/* 030-struct-layout: sizeof, member offsets, padding, trailing padding, array-of-struct stride */
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

struct a { char c; int i; };
struct b { char c1; short s; char c2; int i; char c3; };
struct c { int i; char c; };
struct d { short s; char c; };
struct e { char c[3]; };
struct f { char c; struct d inner; int i; short tail; };
struct g { unsigned char u; signed char sc; unsigned short us; long l; };

int main(void) {
  struct a A; struct b B; struct c C; struct d D; struct e E; struct f F; struct g G;
  struct c carr[4];
  struct e earr[5];
  struct f farr[3];
  int total = 0;

  show("sizeof a", (int)sizeof(struct a));
  show("a.c", (int)((char *)&A.c - (char *)&A)); show("a.i", (int)((char *)&A.i - (char *)&A));
  show("sizeof b", (int)sizeof B);
  show("b.c1", (int)((char *)&B.c1 - (char *)&B)); show("b.s", (int)((char *)&B.s - (char *)&B)); show("b.c2", (int)((char *)&B.c2 - (char *)&B));
  show("b.i", (int)((char *)&B.i - (char *)&B)); show("b.c3", (int)((char *)&B.c3 - (char *)&B));
  show("sizeof c", (int)sizeof C);
  show("c.c", (int)((char *)&C.c - (char *)&C));
  show("sizeof d", (int)sizeof D);
  show("d.c", (int)((char *)&D.c - (char *)&D));
  show("sizeof e", (int)sizeof E);
  show("sizeof f", (int)sizeof F);
  show("f.inner", (int)((char *)&F.inner - (char *)&F)); show("f.inner.c", (int)((char *)&F.inner.c - (char *)&F));
  show("f.i", (int)((char *)&F.i - (char *)&F)); show("f.tail", (int)((char *)&F.tail - (char *)&F));
  show("sizeof g", (int)sizeof G);
  show("g.sc", (int)((char *)&G.sc - (char *)&G)); show("g.us", (int)((char *)&G.us - (char *)&G)); show("g.l", (int)((char *)&G.l - (char *)&G));

  show("sizeof carr", (int)sizeof carr);
  show("carr stride", (int)((char *)&carr[1] - (char *)&carr[0]));
  show("carr[3] off", (int)((char *)&carr[3] - (char *)carr));
  show("&carr[3].c - carr", (int)((char *)&carr[3].c - (char *)carr));
  show("sizeof earr", (int)sizeof earr);
  show("earr stride", (int)((char *)&earr[1] - (char *)&earr[0]));
  show("&earr[4].c[2] - earr", (int)(&earr[4].c[2] - (char *)earr));
  show("sizeof farr", (int)sizeof farr);
  show("farr[2].tail off", (int)((char *)&farr[2].tail - (char *)farr));

  show("sizeof char", (int)sizeof(char));
  show("sizeof short", (int)sizeof(short));
  show("sizeof int", (int)sizeof(int));
  show("sizeof long", (int)sizeof(long));
  show("sizeof int*", (int)sizeof(int *));
  show("sizeof struct a*", (int)sizeof(struct a *));

  /* write through members and read back bytes */
  B.c1 = 1; B.s = 0x0203; B.c2 = 4; B.i = 0x05060708; B.c3 = 9;
  {
    unsigned char *bp = (unsigned char *)&B;
    puts_("b bytes:");
    putch(' '); putu(bp[0]);
    putch(' '); putu(bp[(int)((char *)&B.s - (char *)&B)]); putch(' '); putu(bp[(int)((char *)&B.s - (char *)&B) + 1]);
    putch(' '); putu(bp[(int)((char *)&B.c2 - (char *)&B)]);
    putch(' '); putu(bp[(int)((char *)&B.i - (char *)&B)]); putch(' '); putu(bp[(int)((char *)&B.i - (char *)&B) + 3]);
    putch(' '); putu(bp[(int)((char *)&B.c3 - (char *)&B)]);
    nl();
  }
  total = (int)(sizeof A + sizeof B + sizeof C + sizeof D + sizeof E + sizeof F + sizeof G);
  show("total", total);
  return total;
}
