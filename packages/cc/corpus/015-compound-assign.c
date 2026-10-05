/* 015-compound-assign: all compound assignment operators on int, unsigned, char, via pointers and array elements */
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

static int arr[6] = {1, 2, 3, 4, 5, 6};

int main(void) {
  int x = 100, *p, i = 0, s = 0;
  unsigned u = 0xf0000000u;
  char c = (char)250;
  signed char sc = 100;
  unsigned char uc = 7;
  short sh = 30000;
  x += 23; show("x+=23", x);
  x -= 200; show("x-=200", x);
  x *= -3; show("x*=-3", x);
  x /= 7; show("x/=7", x);
  x %= 9; show("x%=9", x);
  x = -77;
  x /= 4; show("-77/=4", x);
  x %= -5; show("%=-5", x);
  x = 13;
  x <<= 4; show("x<<=4", x);
  x = -200;
  x >>= 3; show("-200>>=3", x);
  x = 0x5a;
  x &= 0x0f; show("x&=0x0f", x);
  x |= 0x30; show("x|=0x30", x);
  x ^= 0xff; show("x^=0xff", x);
  u += 0x20000000u; showu("u+=", u);
  u -= 0x30000000u; showu("u-=", u);
  u *= 3u; showu("u*=3", u);
  u /= 5u; showu("u/=5", u);
  u %= 1000u; showu("u%=1000", u);
  u <<= 20; showu("u<<=20", u);
  u >>= 7; showu("u>>=7", u);
  c += 10; show("c+=10", c);
  c -= 20; show("c-=20", c);
  c *= 3; show("c*=3", c);
  sc += 100; show("sc+=100", sc);
  sc -= 100; show("sc-=100", sc);
  sc *= 2; show("sc*=2", sc);
  sc /= 3; show("sc/=3", sc);
  uc <<= 5; show("uc<<=5", uc);
  uc >>= 1; show("uc>>=1", uc);
  uc |= 0x81; show("uc|=0x81", uc);
  uc ^= 0xff; show("uc^=0xff", uc);
  sh += 10000; show("sh+=10000", sh);
  sh >>= 2; show("sh>>=2", sh);
  p = &arr[2];
  *p += 5; show("*p+=5", arr[2]);
  p[1] *= 7; show("p[1]*=7", arr[3]);
  p[-1] -= 10; show("p[-1]-=10", arr[1]);
  *(p + 2) <<= 3; show("*(p+2)<<=3", arr[4]);
  arr[5] %= 4; show("arr[5]%=4", arr[5]);
  arr[i++] += 40; show("arr[i++]+=40", arr[0]); show("i", i);
  arr[i] ^= arr[i + 1]; show("arr[1]^=arr[2]", arr[1]);
  p += 2; show("p+=2 -> *p", *p);
  p -= 3; show("p-=3 -> *p", *p);
  x = 5;
  s = (x += 3) * 2; show("(x+=3)*2", s);
  s += x -= 1; show("s+=x-=1", s);
  for (i = 0; i < 6; i++) { s *= 3; s ^= arr[i]; s &= 0xffff; }
  show("s", s);
  return (s ^ (int)u ^ c ^ uc) & 0xff;
}
