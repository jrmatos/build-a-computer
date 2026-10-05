#include "prelude.h"
static int classify(int x) {
  switch (x) {
  case 0: return 100;
  case 1:
  case 2: x += 10;
  case 3: x *= 2; break;
  default: x = -x; break;
  case 10 ... 15: return 1000 + x;
  case -5: { int y = x * 3; return y; }
  }
  return x;
}
static int sw2(unsigned char c) {
  int r = 0;
  switch (c) {
    default: r += 1;
    case 'a': r += 10;
    case 'b': r += 100; break;
    case 200: r = -1;
  }
  return r;
}
static int gotos(int n) {
  int i = 0, s = 0;
again:
  if (i >= n) goto done;
  s += i;
  i++;
  goto again;
done:
  return s;
}
int main(void) {
  int i, j, s = 0;
  for (i = -6; i < 18; i++) mix(classify(i));
  show("classify", hash_ & 0xffff);
  show("sw2", sw2('a') + sw2('b') * 10 + sw2('z') * 100 + sw2(200) * 1000);
  show("gotos", gotos(10));
  for (i = 0; i < 10; i++) {
    if (i == 2) continue;
    if (i == 8) break;
    for (j = 0; j < 10; j++) {
      if (j > i) break;
      if ((i + j) % 3 == 0) continue;
      s += i * j;
    }
  }
  show("loops", s);
  i = 0; s = 0;
  do { s += i; if (s > 20) break; } while (++i < 100);
  show("do", s * 100 + i);
  i = 0;
  while (1) { if (++i == 7) break; }
  show("while1", i);
  for (i = 0, j = 10; i < j; i++, j--) s += i ^ j;
  show("comma for", s);
  for (int k = 0; k < 3; k++) for (int k2 = k; k2 < 3; k2++) s += k * k2;
  show("decl for", s);
  {
    int n = 0;
    for (;;) { n++; if (n > 5) goto out; }
  out:
    show("forever", n);
  }
  i = 5;
  if (i > 3) if (i > 10) s = 1; else s = 2; else s = 3;
  show("dangling", s);
  switch (i) { }
  switch (i) case 5: s = 55;
  show("odd switch", s);
  return 0;
}
