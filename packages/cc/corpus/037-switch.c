/* 037-switch: dense and sparse switch, fallthrough, default in middle, nested switch, switch on char */
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

static int dense(int x) {
  switch (x) {
  case 0: return 10;
  case 1: return 11;
  case 2: return 14;
  case 3: return 19;
  case 4: return 26;
  case 5: return 35;
  case 6: return 46;
  case 7: return 59;
  default: return -1;
  }
}

static int sparse(int x) {
  switch (x) {
  case -1000: return 1;
  case -3: return 2;
  case 7: return 3;
  case 100: return 4;
  case 4096: return 5;
  case 65537: return 6;
  case 2000000000: return 7;
  }
  return 0;
}

static int fall(int x) {
  int r = 0;
  switch (x) {
  case 1: r += 1;
  /* fallthrough */
  case 2: r += 20;
  /* fallthrough */
  case 3: r += 300; break;
  case 4: r = 4000;
  /* fallthrough */
  default: r += 5;
  /* fallthrough */
  case 5: r += 60000; break;
  case 6: break;
  }
  return r;
}

static int mid_default(unsigned x) {
  int r = 1;
  switch (x % 6) {
  case 0: r = 100; break;
  default: r = 200;
  /* fallthrough */
  case 3: r += 3; break;
  case 4: r = 400; break;
  }
  return r;
}

static int nested(int a, int b) {
  switch (a) {
  case 0:
    switch (b) { case 0: return 0; case 1: return 1; default: return 2; }
  case 1:
    switch (b) { case 0: return 10; default: break; }
    return 11;
  default:
    switch (b & 1) { case 0: a *= 2; break; case 1: a *= 3; break; }
    return a + 100;
  }
}

static int classify(char c) {
  switch (c) {
  case 'a': case 'e': case 'i': case 'o': case 'u': return 1;
  case ' ': case '\t': case '\n': return 2;
  case '0': case '1': case '2': case '3': case '4':
  case '5': case '6': case '7': case '8': case '9': return 3;
  case '\xe9': return 5;
  default: return (c >= 'a' && c <= 'z') ? 4 : 0;
  }
}

int main(void) {
  static const char text[] = "hello world 2024!\tok \xe9";
  int i, cnt[6] = { 0, 0, 0, 0, 0, 0 };
  unsigned chk = 0;
  int sp[9] = { -1000, -3, 7, 100, 4096, 65537, 2000000000, 8, -4 };

  for (i = -1; i <= 8; i++) { puti(dense(i)); putch(' '); chk = chk * 3u + (unsigned)dense(i); }
  nl();
  for (i = 0; i < 9; i++) { puti(sparse(sp[i])); putch(' '); chk = chk * 3u + (unsigned)sparse(sp[i]); }
  nl();
  for (i = 0; i <= 7; i++) { puti(fall(i)); putch(' '); chk = chk * 3u + (unsigned)fall(i); }
  nl();
  for (i = 0; i < 12; i++) { puti(mid_default((unsigned)i)); putch(' '); chk += (unsigned)mid_default((unsigned)i); }
  nl();
  for (i = 0; i < 9; i++) { puti(nested(i / 3 + (i == 8), i % 3)); putch(' '); chk = chk * 5u + (unsigned)nested(i / 3, i % 3); }
  nl();
  for (i = 0; text[i]; i++) cnt[classify(text[i])]++;
  for (i = 0; i < 6; i++) show("class count", cnt[i]);
  showu("chk", chk);
  return (int)((chk + (unsigned)cnt[4]) & 0xff);
}
