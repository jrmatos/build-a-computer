#include "prelude.h"
struct c1 { char a; };
struct c3 { char a, b, c; };
struct s2 { short a; };
struct s6 { short a, b, c; };
struct i1 { int a; };
struct i2 { int a, b; };
struct mix { char c; int i; short s; };
struct big { int v[5]; char tag; };
struct ll1 { long long x; };
struct nest { struct c3 x; struct i2 y; char z[3]; };
union u { int i; char c[4]; short s[2]; unsigned u; };

static struct c1 mk1(char a) { struct c1 r; r.a = a; return r; }
static struct c3 mk3(char a, char b, char c) { struct c3 r = { a, b, c }; return r; }
static struct s6 mk6(int x) { struct s6 r; r.a = (short)x; r.b = (short)(x * 2); r.c = (short)(x * 3); return r; }
static struct i2 mki2(int a, int b) { struct i2 r = { a, b }; return r; }
static struct mix mkmix(int x) { struct mix m = { (char)x, x * 100, (short)-x }; return m; }
static struct big mkbig(int x) { struct big b; int i; for (i = 0; i < 5; i++) b.v[i] = x + i; b.tag = 'B'; return b; }
static struct ll1 mkll(long long x) { struct ll1 r = { x }; return r; }
static int sum3(struct c3 s) { return s.a + s.b + s.c; }
static int sum6(struct s6 s) { return s.a + s.b + s.c; }
static int summix(struct mix m) { return m.c + m.i + m.s; }
static int sumbig(struct big b) { int s = 0, i; for (i = 0; i < 5; i++) s += b.v[i]; b.v[0] = 999; return s + b.tag; }
static int many(int a, int b, int c, int d, int e, int f, int g, struct i2 h, struct big k, struct c3 l) {
  return a + b + c + d + e + f + g + h.a + h.b + k.v[4] + l.c;
}
static struct nest mknest(void) { struct nest n = { { 1, 2, 3 }, { 4, 5 }, "ab" }; return n; }

int main(void) {
  struct c1 a = mk1(7);
  struct c3 b = mk3(1, 2, 3);
  struct s6 c = mk6(11);
  struct i2 d = mki2(-4, 9);
  struct mix e = mkmix(5);
  struct big f = mkbig(10), g;
  struct ll1 h = mkll(-1LL << 40);
  struct nest n = mknest(), n2;
  union u un;
  show("c1", a.a);
  show("c3", sum3(b));
  show("s6", sum6(c));
  show("i2", d.a * 100 + d.b);
  show("mix", summix(e));
  show("big", sumbig(f));
  show("big after", f.v[0]);
  showll("ll1", h.x);
  g = f;
  g.v[2] = -1;
  show("copy", f.v[2] * 1000 + g.v[2]);
  show("many", many(1, 2, 3, 4, 5, 6, 7, d, f, b));
  show("nest", n.x.a + n.x.b + n.x.c + n.y.a + n.y.b + n.z[0] + n.z[1] + n.z[2]);
  n2 = n;
  n2.y = mki2(100, 200);
  show("nest2", n2.y.a + n2.y.b + n.y.a);
  show("sizes", (int)(sizeof(struct c3) * 1000 + sizeof(struct mix) * 100 + sizeof(struct big) * 10 + sizeof(struct nest)));
  un.u = 0x11223344u;
  show("union c0", un.c[0]);
  show("union s1", un.s[1]);
  un.c[3] = 0x7f;
  showu("union u", un.u);
  {
    struct big arr[3];
    struct big *p = arr;
    int i;
    for (i = 0; i < 3; i++) arr[i] = mkbig(i * 10);
    p[1].v[3] += 5;
    show("arr", arr[1].v[3] + (p + 2)->v[4] + (*p).tag);
    show("ptrdiff", (int)(&arr[2] - p));
  }
  {
    struct { int x; struct { int y, z; } in; } anon = { 1, { 2, 3 } };
    struct pt { int x, y; } pts[2] = { { 1, 2 }, { 3, 4 } };
    struct pt q = pts[1];
    show("anon", anon.x + anon.in.y * 10 + anon.in.z * 100);
    show("pts", q.x * 10 + q.y);
    q = (struct pt){ 7, 8 };
    show("compound", q.x * 10 + q.y);
    show("ternary struct", (1 ? pts[0] : pts[1]).y);
  }
  return a.a + b.c;
}
