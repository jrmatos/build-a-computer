#include "prelude.h"
typedef long long ll;
typedef unsigned long long ull;

static ll gl = -1234567890123LL;
static ull gu = 0xfedcba9876543210ULL;
static ll arr[4] = { 1, -1, 0x7fffffffffffffffLL, -0x7fffffffffffffffLL - 1 };

ll add(ll a, ll b) { return a + b; }
ull mulu(ull a, ull b) { return a * b; }
ll divs(ll a, ll b) { return a / b; }
ll mods(ll a, ll b) { return a % b; }
ull divu(ull a, ull b) { return a / b; }
ull modu(ull a, ull b) { return a % b; }
ll shl(ll a, int n) { return (ll)((ull)a << n); }
ll sar(ll a, int n) { return a >> n; }
ull shr(ull a, int n) { return a >> n; }
int mixed(int a, ll b, int c, ll d, int e, ll f) { return (int)(a + b + c + d + e + f); }
ll seven(int a, int b, int c, int d, int e, int f, int g, ll h) { return a + b + c + d + e + f + g + h; }

int main(void) {
  ll vals[] = { 0, 1, -1, 2, -2, 3, 1000000007LL, -999999999999LL, 0x123456789abcdefLL, -0x7fffffffffffffffLL,
                0x100000000LL, 0xffffffffLL, 0x80000000LL, -0x80000000LL, 12345, -77 };
  int n = sizeof vals / sizeof vals[0];
  int i, j, k;
  for (i = 0; i < n; i++) {
    for (j = 0; j < n; j++) {
      ll a = vals[i], b = vals[j];
      mixll((ull)add(a, b));
      mixll((ull)a - (ull)b);
      mixll(mulu((ull)a, (ull)b));
      mix(a < b); mix(a <= b); mix(a > b); mix(a >= b); mix(a == b); mix(a != b);
      mix((ull)a < (ull)b); mix((ull)a >= (ull)b);
      if (b != 0 && !(a == -0x7fffffffffffffffLL - 1 && b == -1)) {
        mixll((ull)divs(a, b));
        mixll((ull)mods(a, b));
      }
      if (b != 0) {
        mixll(divu((ull)a, (ull)b));
        mixll(modu((ull)a, (ull)b));
      }
      mixll((ull)(a & b)); mixll((ull)(a | b)); mixll((ull)(a ^ b));
    }
    for (k = 0; k < 64; k += 7) {
      mixll((ull)shl(vals[i], k));
      mixll((ull)sar(vals[i], k));
      mixll(shr((ull)vals[i], k));
    }
    mixll((ull)-vals[i]);
    mixll((ull)~vals[i]);
    mix(!vals[i]);
    mix((int)vals[i]);
    mix((unsigned)(vals[i] >> 32));
  }
  showu("hash", hash_);
  showll("gl", gl);
  showll("gu", (ll)gu);
  for (i = 0; i < 4; i++) showll("arr", arr[i]);
  {
    int x = -5;
    unsigned ux = 0xfffffff0u;
    signed char sc = -3;
    unsigned char uc = 200;
    short s = -300;
    unsigned short us = 65000;
    ll a = x, b = ux, c = sc, d = uc, e = s, f = us;
    showll("conv", a); showll("conv", b); showll("conv", c); showll("conv", d); showll("conv", e); showll("conv", f);
    a += 5; b -= 1; c *= -7; d <<= 33; e >>= 2; f |= 1ULL << 40;
    showll("ca", a); showll("ca", b); showll("ca", c); showll("ca", d); showll("ca", e); showll("ca", f);
    a = 10; showll("pre", ++a); showll("post", a++); showll("now", a); showll("dec", --a);
    show("mixed", mixed(1, 2LL, 3, 4LL, 5, 0x100000000LL + 6));
    showll("seven", seven(1, 2, 3, 4, 5, 6, 7, 0x1000000000LL));
    show("ll to char", (signed char)(ll)0x1234567890ffLL);
    show("bool", (_Bool)0x100000000LL);
    show("ternary", (int)(x > 0 ? a : (ll)x * 1000000000LL / 1000000000LL));
  }
  return (int)(hash_ & 0x7f);
}
