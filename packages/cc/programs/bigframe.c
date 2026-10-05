#include "prelude.h"
struct big { int v[700]; };
static struct big make(int k) { struct big b; int i; for (i = 0; i < 700; i++) b.v[i] = i * k; return b; }
static int total(struct big b) { int s = 0, i; for (i = 0; i < 700; i++) s += b.v[i]; return s; }
static int deep(int n) {
  int local[600];
  int i;
  for (i = 0; i < 600; i++) local[i] = n + i;
  if (n > 0) local[599] += deep(n - 1);
  return local[599] + local[0];
}
int main(void) {
  int arr[3000];
  char chars[5000];
  long long lls[600];
  int i, s = 0;
  struct big b;
  for (i = 0; i < 3000; i++) arr[i] = i;
  for (i = 0; i < 5000; i++) chars[i] = (char)i;
  for (i = 0; i < 600; i++) lls[i] = (long long)i << 33;
  for (i = 0; i < 3000; i += 7) s += arr[i];
  for (i = 0; i < 5000; i += 13) s += chars[i];
  for (i = 0; i < 600; i += 5) s += (int)(lls[i] >> 30);
  show("sum", s);
  show("last", arr[2999] + chars[4999] + (int)(lls[599] >> 33));
  b = make(3);
  show("total", total(b));
  show("bv", b.v[699]);
  show("deep", deep(5));
  return 0;
}
