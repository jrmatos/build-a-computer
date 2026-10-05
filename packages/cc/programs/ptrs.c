#include "prelude.h"
typedef int fn_t(int);
static int inc(int x) { return x + 1; }
static int dbl(int x) { return x * 2; }
static fn_t *fns[] = { inc, dbl };
static int sum2d(int m[][3], int rows) { int s = 0, i, j; for (i = 0; i < rows; i++) for (j = 0; j < 3; j++) s += m[i][j] * (i + 1); return s; }
static int sumrow(int (*row)[3]) { return (*row)[0] + (*row)[1] + (*row)[2]; }
static void fill(char *buf, int n, char c) { while (n-- > 0) *buf++ = c; *buf = 0; }
struct vtable { int (*get)(void *); void (*set)(void *, int); };
struct obj { const struct vtable *vt; int val; };
static int oget(void *o) { return ((struct obj *)o)->val; }
static void oset(void *o, int v) { ((struct obj *)o)->val = v * 3; }
static const struct vtable VT = { oget, oset };
struct pair { int a, b; };
static struct pair mkpair(int a, int b) { struct pair p = { a, b }; return p; }
static struct pair swap(struct pair p) { int t = p.a; p.a = p.b; p.b = t; return p; }
union shape { struct { int kind; int r; } circle; struct { int kind; int w, h; } rect; int kind; };
static int area(union shape s) { return s.kind == 1 ? 3 * s.circle.r * s.circle.r : s.rect.w * s.rect.h; }
int main(void) {
  int m[3][3] = { { 1, 2, 3 }, { 4, 5, 6 }, { 7, 8, 9 } };
  int (*rp)[3] = m;
  int *flat = &m[0][0];
  char buf[16];
  const char *const words[] = { "a", "bb", "ccc" };
  const char *const *wp = words;
  struct obj o = { &VT, 0 };
  int *lit = (int[]){ 10, 20, 30 };
  union shape sh[2] = { { .circle = { 1, 2 } }, { .rect = { 2, 3, 4 } } };
  int i;
  show("sum2d", sum2d(m, 3));
  show("sumrow", sumrow(rp + 1) + sumrow(&m[2]));
  show("rp", rp[2][1] + (*(rp + 1))[2]);
  show("flat", flat[4] + flat[8]);
  show("neg idx", (&m[1][0])[-1]);
  fill(buf, 5, 'z'); puts_(buf); nl();
  show("wp", wp[2][1] + (int)(*(wp + 1))[0]);
  o.vt->set(&o, 7);
  show("vt", o.vt->get(&o));
  show("lit", lit[0] + lit[2]);
  show("fns", fns[0](5) + fns[1](5) + (*fns[1])(1));
  show("swap", swap(mkpair(1, 2)).a * 10 + swap(mkpair(3, 4)).b);
  show("area", area(sh[0]) + area(sh[1]) * 100);
  {
    struct pair ps[4];
    struct pair *pp;
    for (i = 0; i < 4; i++) ps[i] = mkpair(i, i * i);
    pp = &ps[3];
    show("pp", pp->b - (pp - 1)->b + (int)(pp - ps));
    pp--; pp->a = 50;
    show("ps", ps[2].a);
  }
  {
    unsigned char bytes[300];
    unsigned char k;
    int n = 0;
    for (i = 0; i < 300; i++) bytes[i] = (unsigned char)i;
    for (k = 250; k != 4; k++) n += bytes[k];
    show("uchar loop", n);
  }
  {
    static int counts[5];
    int vals[] = { 1, 3, 3, 4, 1, 1 };
    for (i = 0; i < 6; i++) counts[vals[i]]++;
    show("counts", counts[1] * 100 + counts[3] * 10 + counts[4]);
  }
  {
    void *vp = buf;
    char *cp = (char *)vp + 2;
    long addr = (long)cp - (long)vp;
    show("void*", (int)addr);
    vp = (char *)vp + 1;
    show("void* arith", *(char *)vp);
  }
  {
    int x = 5, y = 6, *px = &x, **ppx = &px;
    **ppx = 9; *ppx = &y; **ppx += 1;
    show("pp", x * 10 + y);
  }
  {
    extern int ext_counter;
    ext_counter += 5;
    show("extern", ext_counter);
  }
  return 0;
}
int ext_counter = 37;
