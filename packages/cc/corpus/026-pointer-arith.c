/* 026-pointer-arith: p+n, p-q for int/char/struct pointers, p[i]==*(p+i)==i[p], backward walks */
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

struct rec { int id; char tag; short w; int val; };

static int sum_back(const int *end, int n) {
  int s = 0;
  while (n-- > 0) s = s * 3 + *--end;
  return s;
}

int main(void) {
  int ia[10];
  char ca[16];
  struct rec ra[5];
  int *p, *q;
  char *cp, *cq;
  struct rec *rp, *rq;
  int i, ok = 1;
  unsigned chk = 0;

  for (i = 0; i < 10; i++) ia[i] = 100 + i * 7;
  for (i = 0; i < 16; i++) ca[i] = (char)('a' + i);
  for (i = 0; i < 5; i++) { ra[i].id = i; ra[i].tag = (char)('A' + i); ra[i].w = (short)(i * 10); ra[i].val = i * i; }

  p = ia; q = ia + 7;
  show("q-p", (int)(q - p));
  show("p-q", (int)(p - q));
  show("*(p+3)", *(p + 3));
  show("p[3]", p[3]);
  show("3[p]", 3[p]);
  for (i = 0; i < 10; i++) {
    int x = p[i], y = *(p + i), z = i[p];
    if (x != y || x != z) ok = 0;
  }
  show("index forms agree", ok);
  show("(char*)q-(char*)p", (int)((char *)q - (char *)p));
  q -= 2;
  show("*q after -=2", *q);
  show("*q++", *q++);
  show("*q", *q);
  show("*--q", *--q);

  cp = ca + 2; cq = &ca[13];
  show("cq-cp", (int)(cq - cp));
  putch(*cp); putch(cp[1]); putch(*(cq - 1)); putch((cq - 5)[0]); nl();
  for (cp = ca + 15; cp >= ca + 8; cp--) putch(*cp);
  nl();

  rp = ra; rq = &ra[4];
  show("rq-rp", (int)(rq - rp));
  show("bytes rq-rp", (int)((char *)rq - (char *)rp));
  show("sizeof(struct rec)", (int)sizeof(struct rec));
  show("(rp+2)->val", (rp + 2)->val);
  show("rp[3].w", rp[3].w);
  putch((rq - 1)->tag); putch(2[rp].tag); nl();
  for (rp = ra + 4; rp >= ra; rp--) chk = chk * 31u + (unsigned)rp->val + (unsigned)rp->tag;
  showu("struct back chk", chk);

  show("sum_back(ia+10,10)", sum_back(ia + 10, 10));
  show("sum_back(ia+5,3)", sum_back(ia + 5, 3));

  /* pointer moved past end then back is fine */
  p = ia + 10;
  show("p[-1]", p[-1]);
  show("*(p-10)", *(p - 10));
  {
    int *mid = ia + 5;
    show("mid[-2]+mid[2]", mid[-2] + mid[2]);
    show("&mid[2]-&mid[-2]", (int)(&mid[2] - &mid[-2]));
  }
  return (int)(chk & 0xff);
}
