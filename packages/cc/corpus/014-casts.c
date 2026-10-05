/* 014-casts: integer truncation and sign/zero extension, pointer<->integer casts (relative only) */
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

static int g[8] = {10, 20, 30, 40, 50, 60, 70, 80};
struct pair { int first; int second; };
static struct pair gp = {111, 222};
static volatile int vbig = 0x12345678;

int main(void) {
  int x = vbig, n = -2;
  unsigned long ga, gb;
  int *p;
  unsigned char *bp;
  unsigned bytes = 0;
  int i;
  show("(char)x", (char)x);
  show("(signed char)x", (signed char)x);
  show("(short)x", (short)x);
  show("(unsigned short)x", (unsigned short)x);
  show("(unsigned char)0x1ff", (unsigned char)0x1ff);
  show("(signed char)0x80", (signed char)0x80);
  show("(char)0x80", (char)0x80);
  show("(short)0x8000", (short)0x8000);
  show("(unsigned short)-1", (unsigned short)-1);
  show("(int)(signed char)0xf0", (int)(signed char)0xf0);
  showu("(unsigned)(signed char)-1", (unsigned)(signed char)-1);
  showu("(unsigned)(unsigned char)(signed char)-1", (unsigned)(unsigned char)(signed char)-1);
  showu("(unsigned)(short)n", (unsigned)(short)n);
  showu("(unsigned)(unsigned short)n", (unsigned)(unsigned short)n);
  show("(int)(unsigned char)n", (int)(unsigned char)n);
  show("(short)(char)n", (short)(char)n);
  show("(signed char)(short)300", (signed char)(short)300);
  show("(unsigned char)(x>>8)", (unsigned char)(x >> 8));
  show("(signed char)(x>>4)", (signed char)(x >> 4));
  show("(short)(x*3)", (short)(x * 3));
  show("(long)n", (int)(long)n);
  ga = (unsigned long)&g[0];
  gb = (unsigned long)&g[3];
  show("addr diff g[3]-g[0]", (int)(gb - ga));
  show("addr eq", (unsigned long)(g + 3) == gb);
  show("addr aligned", (int)(ga & 3u));
  p = (int *)(ga + 5 * sizeof(int));
  show("*(int*)(ga+20)", *p);
  p = (int *)gb;
  show("((int*)gb)[2]", p[2]);
  show("struct->first via cast", *(int *)&gp);
  show("second via char* offset", *(int *)((char *)&gp + sizeof(int)));
  bp = (unsigned char *)&x;
  for (i = 0; i < 4; i++) {
    puts_("byte "); puti(i); puts_(" = "); putx(bp[i]); nl();
    bytes = (bytes << 8) | bp[i];
  }
  showu("bytes (LE reversed)", bytes);
  show("(char *)&g[2]-(char *)g", (int)((char *)&g[2] - (char *)g));
  return (int)((bytes ^ (unsigned)x) & 0xff) + 3;
}
