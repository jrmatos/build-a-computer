#include "prelude.h"
typedef int (*binop)(int, int);
static int add(int a, int b) { return a + b; }
static int sub(int a, int b) { return a - b; }
static int mul(int a, int b) { return a * b; }
static binop table[] = { add, sub, mul };
static binop pick(int i) { return table[i % 3]; }
static int apply(binop f, int a, int b) { return f(a, b); }
static int fold(int (*f)(int, int), const int *v, int n, int acc) { int i; for (i = 0; i < n; i++) acc = f(acc, v[i]); return acc; }
struct ops { const char *name; int (*fn)(int, int); };
static struct ops opstab[] = { { "add", add }, { "sub", sub }, { "mul", &mul } };
static void (*hook)(const char *) = 0;
static void say(const char *s) { puts_("say: "); puts_(s); nl(); }
static int (*(*getter(void))(int, int))(int, int) { return 0; }
static int cmp_int(const void *a, const void *b) { return *(const int *)a - *(const int *)b; }
static void isort(void *base, int n, int sz, int (*cmp)(const void *, const void *)) {
  char *b = base; int i, j, k;
  for (i = 1; i < n; i++)
    for (j = i; j > 0 && cmp(b + (j - 1) * sz, b + j * sz) > 0; j--)
      for (k = 0; k < sz; k++) { char t = b[(j - 1) * sz + k]; b[(j - 1) * sz + k] = b[j * sz + k]; b[j * sz + k] = t; }
}
int main(void) {
  int v[] = { 5, 3, 9, 1, 7 };
  int i;
  show("apply", apply(add, 2, 3) + apply(sub, 10, 4) * 100 + apply(mul, 3, 3) * 10000);
  show("pick", pick(4)(10, 3));
  show("fold", fold(mul, v, 5, 1));
  show("deref call", (*table[0])(1, 2) + (**table[2])(3, 4));
  for (i = 0; i < 3; i++) { puts_(opstab[i].name); show("", opstab[i].fn(6, 3)); }
  if (!hook) hook = say;
  hook("hi");
  show("getter null", getter() == 0);
  isort(v, 5, sizeof v[0], cmp_int);
  for (i = 0; i < 5; i++) mix(v[i]);
  show("sorted", v[0] * 10000 + v[1] * 1000 + v[2] * 100 + v[3] * 10 + v[4]);
  show("fn == fn", (table[0] == add) + (table[1] != add) * 2);
  return 0;
}
