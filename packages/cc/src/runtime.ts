/**
 * Runtime helpers the code generator calls for 64-bit division and modulo
 * (RV32M only divides 32-bit values). Compiled by this compiler and appended
 * to a translation unit that needs them, as file-local functions.
 */

export const RUNTIME_SOURCE = `
typedef unsigned long long __u64;
typedef long long __s64;

static __u64 __cc_udivmod(__u64 n, __u64 d, __u64 *rem) {
  __u64 q = 0, r = 0;
  int i;
  if (d == 0) { if (rem) *rem = n; return ~(__u64)0; }
  if ((d >> 32) == 0 && (n >> 32) == 0) {
    unsigned a = (unsigned)n, b = (unsigned)d;
    if (rem) *rem = a % b;
    return a / b;
  }
  for (i = 63; i >= 0; i--) {
    r = (r << 1) | ((n >> i) & 1);
    if (r >= d) { r -= d; q |= (__u64)1 << i; }
  }
  if (rem) *rem = r;
  return q;
}

__attribute__((used)) static __u64 __cc_udivdi3(__u64 a, __u64 b) { return __cc_udivmod(a, b, 0); }
__attribute__((used)) static __u64 __cc_umoddi3(__u64 a, __u64 b) { __u64 r; __cc_udivmod(a, b, &r); return r; }
__attribute__((used)) static __s64 __cc_divdi3(__s64 a, __s64 b) {
  int neg = 0;
  __u64 ua = (__u64)a, ub = (__u64)b, q;
  if (b == 0) return -1;
  if (a < 0) { ua = -ua; neg = !neg; }
  if (b < 0) { ub = -ub; neg = !neg; }
  q = __cc_udivmod(ua, ub, 0);
  return neg ? -(__s64)q : (__s64)q;
}
__attribute__((used)) static __s64 __cc_moddi3(__s64 a, __s64 b) {
  __u64 ua = (__u64)a, ub = (__u64)b, r;
  if (a < 0) ua = -ua;
  if (b < 0) ub = -ub;
  __cc_udivmod(ua, ub, &r);
  return a < 0 ? -(__s64)r : (__s64)r;
}
`;
