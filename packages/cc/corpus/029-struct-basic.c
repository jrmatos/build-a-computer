/* 029-struct-basic: member access, -> through pointers, nested structs, struct assignment */
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

struct point { int x, y; };
struct rect { struct point tl, br; char name[8]; };
struct person { char initial; int age; struct point home; };

static struct point origin = { 0, 0 };
static struct rect grect = { { 1, 2 }, { 11, 22 }, "glob" };

static int area(const struct rect *r) { return (r->br.x - r->tl.x) * (r->br.y - r->tl.y); }
static void move(struct rect *r, int dx, int dy) {
  r->tl.x += dx; r->tl.y += dy;
  r->br.x += dx; r->br.y += dy;
}
static void show_pt(const char *l, struct point *p) {
  puts_(l); puts_(" = ("); puti(p->x); putch(','); puti(p->y); putch(')'); nl();
}

int main(void) {
  struct point p, q;
  struct rect r, r2;
  struct person who;
  struct person *pp = &who;
  struct point *ptp;
  int i;

  p.x = 3; p.y = -4;
  q = p;
  q.x = 99;
  show_pt("p", &p);
  show_pt("q", &q);
  show_pt("origin", &origin);

  r.tl = p;
  r.br.x = 13; r.br.y = 6;
  for (i = 0; i < 7; i++) r.name[i] = (char)('r' + (i & 1));
  r.name[7] = 0;
  show("area r", area(&r));
  r2 = r;
  move(&r2, 5, -5);
  show_pt("r.tl", &r.tl);
  show_pt("r2.tl", &r2.tl);
  show_pt("r2.br", &r2.br);
  show("area r2", area(&r2));
  r2.name[0] = 'X';
  puts_(r.name); putch(' '); puts_(r2.name); nl();

  show("grect area", area(&grect));
  puts_(grect.name); nl();
  move(&grect, -1, -2);
  show_pt("grect.tl", &grect.tl);

  pp->initial = 'Z';
  pp->age = 37;
  pp->home = r.br;
  (*pp).age += 1;
  ptp = &pp->home;
  ptp->y *= 3;
  putch(who.initial); nl();
  show("who.age", who.age);
  show_pt("who.home", &who.home);
  show("r.br.y unchanged", r.br.y);

  {
    struct person twin = who;
    twin.home.x = -1;
    show("twin.home.x", twin.home.x);
    show("who.home.x", who.home.x);
    show("twin.age", twin.age);
  }
  return (area(&r) + who.age + grect.tl.x) & 0xff;
}
