#include "prelude.h"
struct pt { int x, y; };
struct rec { const char *name; int vals[3]; struct pt p; };
int g1 = 5;
int *gp = &g1;
int ga[10] = { 1, 2, 3, [7] = 7, 8 };
char gs[] = "hello";
char gs2[8] = "hi";
const char *names[] = { "zero", "one", "two", 0 };
struct rec recs[] = { { "a", { 1, 2, 3 }, { 4, 5 } }, { "b", { 6 }, { .y = 9 } }, [3] = { .name = "d", .p.x = 77 } };
struct pt gpt = { .y = 2, .x = 1 };
int matrix[2][3] = { { 1, 2, 3 }, { 4, 5, 6 } };
int flat[2][3] = { 1, 2, 3, 4 };
char *strp = gs + 1;
int *mid = &ga[5];
static int sarr[] = { 10, 20, 30 };
int nelem = sizeof sarr / sizeof sarr[0];
unsigned char bytes[] = { 255, 256 - 1, 'A', '\n' };
short shorts[3] = { -1, 0x7fff };
long long lls[] = { 1, -2, 0x123456789LL };
struct { int a; char b[3]; long long c; } mixed = { 1, "xy", -5 };
union { int i; char c; } un = { 0x41424344 };
int (*fptr)(int) = 0;
const int ci = 3 * 4 + 1;
enum { A = 3, B, C = A * 10, D } ev = D;

static int sq(int x) { return x * x; }
int (*fns[])(int) = { sq, 0 };

int counter(void) { static int n = 10; return n++; }

int main(void) {
  int i;
  show("g1", *gp);
  for (i = 0; i < 10; i++) mix(ga[i]);
  show("ga", hash_ & 0xffff);
  puts_(gs); nl();
  puts_(gs2); show(" gs2 len", sizeof gs2);
  for (i = 0; names[i]; i++) { puts_(names[i]); nl(); }
  for (i = 0; i < 4; i++) {
    puts_(recs[i].name ? recs[i].name : "(null)");
    show(" rec", recs[i].vals[0] + recs[i].vals[1] * 10 + recs[i].vals[2] * 100 + recs[i].p.x * 1000 + recs[i].p.y * 10000);
  }
  show("nrecs", sizeof recs / sizeof recs[0]);
  show("gpt", gpt.x * 10 + gpt.y);
  show("matrix", matrix[1][2] + flat[1][0] * 10 + flat[1][1] * 100);
  puts_(strp); nl();
  show("mid", *mid + mid[2]);
  show("nelem", nelem);
  for (i = 0; i < 4; i++) mix(bytes[i]);
  for (i = 0; i < 3; i++) mix(shorts[i]);
  for (i = 0; i < 3; i++) mixll(lls[i]);
  show("hash", hash_ & 0xffffff);
  show("mixed", mixed.a + mixed.b[1] + (int)mixed.c);
  show("un", un.c);
  show("fptr", fptr == 0);
  show("fns", fns[0](7) + (fns[1] == 0));
  show("ci", ci);
  show("ev", ev);
  {
    int la[5] = { 1, 2 };
    char lc[10] = "abc";
    struct pt lp = { 3 };
    struct rec lr = { "local", { [2] = 9 }, { 1, 2 } };
    int lm[2][2] = { { 1 }, { 2, 3 } };
    char *lps[] = { "x", "yy", "zzz" };
    struct pt lpts[] = { 1, 2, 3, 4, 5 };
    int n = 4;
    int dyn[3] = { n, n * 2, sq(n) };
    show("la", la[0] + la[1] + la[4]);
    show("lc", lc[2] + lc[3] + lc[9]);
    show("lp", lp.x + lp.y);
    puts_(lr.name); show(" lr", lr.vals[2] + lr.vals[0] + lr.p.y);
    show("lm", lm[0][0] + lm[0][1] + lm[1][0] * 10 + lm[1][1] * 100);
    show("lps", lps[2][2] + sizeof lps);
    show("lpts", lpts[2].x + lpts[2].y + (int)(sizeof lpts / sizeof lpts[0]));
    show("dyn", dyn[0] + dyn[1] + dyn[2]);
  }
  show("counter", counter() + counter() * 100 + counter() * 10000);
  return ga[7] + ga[8];
}
