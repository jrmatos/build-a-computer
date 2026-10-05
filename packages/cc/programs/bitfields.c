#include "prelude.h"
struct bf { unsigned a : 3; unsigned b : 5; int c : 4; unsigned d : 20; int e : 12; };
struct pte { unsigned v : 1, r : 1, w : 1, x : 1, u : 1, g : 1, a : 1, d : 1, rsw : 2, ppn : 22; };
struct mixbf { char c; int x : 7; short s; unsigned y : 9; };
static struct bf gb = { 5, 17, -3, 0xabcde, -100 };

int main(void) {
  struct bf b = { 1, 2, 3, 4, 5 };
  struct pte p;
  struct mixbf m;
  unsigned raw;
  show("size bf", sizeof(struct bf));
  show("size pte", sizeof(struct pte));
  show("size mixbf", sizeof(struct mixbf));
  show("gb.a", gb.a); show("gb.b", gb.b); show("gb.c", gb.c); show("gb.d", gb.d); show("gb.e", gb.e);
  b.a = 9;  /* truncates to 1 */
  b.c = 7; b.c += 3; /* wraps to -6 */
  b.e = 2047; b.e++;
  b.d = 0xfffff; b.d++;
  show("b.a", b.a); show("b.b", b.b); show("b.c", b.c); show("b.d", b.d); show("b.e", b.e);
  show("assign value", (b.b = 40));
  memset(&p, 0, sizeof p);
  p.v = 1; p.w = 1; p.x = 1; p.ppn = 0x3abcd;
  memcpy(&raw, &p, 4);
  showu("pte raw", raw);
  raw = 0xffffffffu;
  memcpy(&p, &raw, 4);
  show("pte r", p.r); show("pte ppn", p.ppn); show("pte rsw", p.rsw);
  m.c = 'm'; m.x = -20; m.s = 1234; m.y = 300;
  show("m", m.c + m.x + m.s + m.y);
  m.x--;
  show("m.x", m.x);
  {
    int i, s = 0;
    for (i = 0; i < 40; i++) { b.a = i; s += b.a; b.c = i; s += b.c; }
    show("loop", s);
  }
  return gb.c & 0xff;
}
