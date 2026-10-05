#include "prelude.h"
typedef struct node node;
struct node { int v; node *next; };
typedef int (*op_t)(int);
static int neg_(int x) { return -x; }
static op_t pickop(void) { return neg_; }
static int (*pickop2(void))(int) { return &neg_; }
extern int late[];
int late[3] = { 7, 8, 9 };
static long int li = -3;
static long unsigned lu = 5;
static short int si = -2;
static unsigned un = 4000000000u;
static int const ci = 11;
static char *const cp = "const pointer";
static int bin = 0b101101;
static unsigned long long big = 0xFFFFFFFFFFFFFFFFULL;
struct S { char name[8]; int vals[3]; };
static struct S table[] = { { "ab", { 1 } }, { "cdef", { 2, 3, 4 } } };
static int sumarr(int a[], int n) { int s = 0; while (n--) s += *a++; return s; }
static void voidret(int *p) { if (*p > 5) return; *p += 100; }
int main(void) {
  node a, b;
  int arr[] = { 5, 6, 7 }, *ap = &arr[1], x = 3;
  char s[16] = "hey";
  unsigned char uc = 0;
  a.v = 1; a.next = &b; b.v = 2; b.next = 0;
  show("list", a.next->v + a.v);
  show("ops", pickop()(5) + (*pickop2())(6));
  show("late", late[2]);
  show("types", (int)(li + lu + si) + (un > 3000000000u) + ci);
  puts_(cp); nl();
  show("bin", bin);
  showll("big", (long long)big);
  show("table", table[1].vals[2] + table[0].name[1] + (int)sizeof table);
  show("sumarr", sumarr(arr, 3));
  show("&*", *&*ap + (int)(&*ap - arr));
  show("sizeof type", (int)(sizeof(int[10]) + sizeof(char *[3]) + sizeof(struct S)));
  show("s tail", s[3] + s[15] + s[0]);
  voidret(&x); voidret(&arr[2]);
  show("voidret", x + arr[2]);
  do { uc--; } while (0);
  show("uc", uc);
  {
    int i = 0, n = 0;
    goto mid;
    for (; i < 5; i++) {
      n += 10;
    mid:
      n++;
    }
    show("goto into loop", n);
  }
  {
    int m[2][3], (*row)[3] = m, *cell;
    int i, j;
    for (i = 0; i < 2; i++) for (j = 0; j < 3; j++) m[i][j] = i * 10 + j;
    cell = &row[1][2];
    show("2d", *cell + **m + (int)(sizeof m / sizeof m[0]));
  }
  {
    const char *msgs[] = { "zero", "one", "two" };
    int idx = 2;
    puts_(idx < 3 ? msgs[idx] : "?"); nl();
  }
  return 0;
}
