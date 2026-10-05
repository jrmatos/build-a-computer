/* 048-scopes-shadowing: block scope, shadowing globals/params, file-scope static vs block-scope static */
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

int value = 100;
static int hidden = 7;
static int counter;

static int next_id(void) { static int id = 1000; return id++; }
static int calls(void) { static int counter = 0; counter += 2; return counter; }
static int use_global(void) { return value + hidden; }

static int shadow_param(int value) {
  int r = value;
  {
    int value = r * 2;
    r += value;
    {
      int value = 1;
      r += value;
    }
    r += value;
  }
  return r + value;
}

static int loop_scopes(int n) {
  int i, total = 0;
  for (i = 0; i < n; i++) {
    int i2 = i * i;
    static int persist = 0;
    int fresh = 5;
    persist += i2;
    fresh += i2;
    total += fresh + persist;
  }
  return total;
}

int main(void) {
  int r;
  show("value global", value);
  show("use_global", use_global());
  {
    int value = 5;
    show("value block", value);
    show("use_global sees global", use_global());
    value++;
    {
      int hidden = value * 10;
      show("hidden local", hidden);
      show("use_global hidden", use_global());
    }
  }
  value = 200;
  show("value assigned", value);
  show("use_global after", use_global());

  show("shadow_param(3)", shadow_param(3));
  show("shadow_param(value)", shadow_param(value));

  show("next_id", next_id());
  show("next_id", next_id());
  show("next_id", next_id());
  counter = 50;
  show("calls", calls());
  show("calls", calls());
  show("file counter", counter);
  counter++;
  show("calls", calls());
  show("file counter", counter);

  show("loop_scopes(5)", loop_scopes(5));
  show("loop_scopes(3)", loop_scopes(3));

  {
    int counter = -1;
    int i;
    for (i = 0; i < 3; i++) {
      int counter = i * 100;
      show("inner counter", counter);
    }
    show("block counter", counter);
  }
  show("file counter end", counter);
  r = value + hidden + counter + next_id();
  show("r", r);
  return r & 0xff;
}
