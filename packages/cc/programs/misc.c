#include "prelude.h"
#include <stddef.h>
struct s { char c; int i; long long l; short arr[3]; };
typedef struct node { int v; struct node *next; } node;
typedef int arr3[3];
enum color { RED, GREEN = 5, BLUE };
static int global_counter;
static inline int twice(int x) { return 2 * x; }
static int volatile vol;
static const char *const words[] = { "alpha", "beta" };
static int rec(int n) { return n <= 1 ? 1 : n * rec(n - 1); }
static int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
static int ack(int m, int n) { return m == 0 ? n + 1 : n == 0 ? ack(m - 1, 1) : ack(m - 1, ack(m, n - 1)); }
static int even(int n);
static int odd(int n) { return n == 0 ? 0 : even(n - 1); }
static int even(int n) { return n == 0 ? 1 : odd(n - 1); }
int main(void) {
  node a = { 1, 0 }, b = { 2, &a };
  arr3 x = { 1, 2, 3 };
  enum color c = BLUE;
  int i;
  show("offsetof", (int)(offsetof(struct s, l) * 100 + offsetof(struct s, arr)));
  show("sizeof s", sizeof(struct s));
  show("alignof", (int)_Alignof(long long) * 10 + (int)_Alignof(struct s));
  show("list", b.next->v + b.v * 10);
  show("arr3", x[0] + x[2] + (int)sizeof(arr3));
  show("enum", c + GREEN * 10);
  show("inline", twice(21));
  vol = 3; vol += 4; show("vol", vol);
  puts_(words[1]); nl();
  show("rec", rec(10));
  show("fib", fib(20));
  show("ack", ack(2, 3));
  show("even", even(10) * 10 + odd(7));
  show("stmt expr", ({ int t = 5; t * t; }));
  {
    typeof(c) d = RED;
    __typeof__(x[0]) e = 9;
    show("typeof", d + e);
  }
  {
    int n = 0;
    for (i = 0; i < 100; i++) n += i & 1 ? i : -i;
    show("n", n);
  }
  {
    const char *s = "abc" "def" "\x41\101\n";
    puts_(s);
    show("strlen", (int)sizeof("abc" "def"));
  }
  {
    char buf[16];
    int k = 0;
    char *q = buf;
    while ((*q++ = "copy me"[k++]) != 0) {}
    puts_(buf); nl();
  }
  {
    int shadow = 1;
    { int shadow = 2; global_counter += shadow; }
    global_counter += shadow;
    show("shadow", global_counter);
  }
  {
    _Bool t = 5, f = 0;
    show("bool", t + f * 2 + (t == 1) * 4);
    t = 2 == 2;
    show("bool2", t);
  }
  return rec(5);
}
