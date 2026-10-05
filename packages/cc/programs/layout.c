/* CC-04: struct layouts must match riscv gcc (30 structs). */
#include "prelude.h"
#include <stddef.h>
#define L(T, m) do { puts_(#T "." #m); show("", (int)offsetof(T, m)); } while (0)
#define S(T) do { puts_(#T); show(" size", (int)sizeof(T)); show(" align", (int)_Alignof(T)); } while (0)
struct s01 { char a; };
struct s02 { char a; int b; };
struct s03 { int a; char b; };
struct s04 { char a; short b; char c; };
struct s05 { char a; long long b; };
struct s06 { long long a; char b; };
struct s07 { short a; char b[3]; };
struct s08 { char a[5]; int b; };
struct s09 { struct s03 a; char b; };
struct s10 { char a; struct s05 b; };
struct s11 { int *p; char c; void (*f)(void); };
union u12 { char a; int b; short c[3]; };
struct s13 { char a; union u12 b; };
struct s14 { unsigned a : 3; unsigned b : 7; };
struct s15 { char a; unsigned b : 4; char c; };
struct s16 { unsigned a : 30; unsigned b : 4; };
struct s17 { char a; int b : 3; };
struct s18 { short a : 9; short b : 9; char c; };
struct s19 { char a; int : 0; char b; };
struct s20 { unsigned short a : 12; unsigned char b : 6; unsigned c : 20; };
struct s21 { int a; int data[]; };
struct s22 { char c; struct { short x; char y; } in; long long z; };
struct s23 { char a; union { int i; char c; }; char b; };
struct s24 { _Bool a; _Bool b; int c; _Bool d; };
struct s25 { char a; long b; short c; };
struct s26 { char a; __attribute__((aligned(16))) int b; };
struct __attribute__((packed)) s27 { char a; int b; short c; };
struct s28 { char a[3]; struct s01 b; short c; };
struct s29 { struct s14 a; char b; struct s16 c; };
struct s30 { long long a[2]; char b; int c[0]; };
int main(void) {
  S(struct s01); S(struct s02); L(struct s02, b);
  S(struct s03); L(struct s03, b);
  S(struct s04); L(struct s04, b); L(struct s04, c);
  S(struct s05); L(struct s05, b);
  S(struct s06); S(struct s07); L(struct s07, b);
  S(struct s08); L(struct s08, b);
  S(struct s09); L(struct s09, b);
  S(struct s10); L(struct s10, b);
  S(struct s11); L(struct s11, c); L(struct s11, f);
  S(union u12); S(struct s13); L(struct s13, b);
  S(struct s14); S(struct s15); L(struct s15, c);
  S(struct s16); S(struct s17); S(struct s18); L(struct s18, c);
  S(struct s19); L(struct s19, b);
  S(struct s20); S(struct s21); L(struct s21, data);
  S(struct s22); L(struct s22, in); L(struct s22, in.y); L(struct s22, z);
  S(struct s23); L(struct s23, i); L(struct s23, b);
  S(struct s24); L(struct s24, c); L(struct s24, d);
  S(struct s25); L(struct s25, c);
  S(struct s26); L(struct s26, b);
  S(struct s27); L(struct s27, b); L(struct s27, c);
  S(struct s28); L(struct s28, b); L(struct s28, c);
  S(struct s29); L(struct s29, b); L(struct s29, c);
  S(struct s30); L(struct s30, b); L(struct s30, c);
  {
    struct s15 v; struct s18 w; struct s29 x; struct s20 y;
    memset(&v, 0, sizeof v); memset(&w, 0, sizeof w); memset(&x, 0, sizeof x); memset(&y, 0, sizeof y);
    v.b = 9; w.b = -100; w.a = 200; x.c.b = 5; x.a.b = 99; y.b = 63; y.a = 0xabc; y.c = 0x12345;
    {
      unsigned char *p = (unsigned char *)&v; int i;
      for (i = 0; i < (int)sizeof v; i++) mix(p[i]);
      p = (unsigned char *)&w; for (i = 0; i < (int)sizeof w; i++) mix(p[i]);
      p = (unsigned char *)&x; for (i = 0; i < (int)sizeof x; i++) mix(p[i]);
      p = (unsigned char *)&y; for (i = 0; i < (int)sizeof y; i++) mix(p[i]);
    }
    show("w.a", w.a); show("w.b", w.b); show("y.b", y.b);
    showu("bits hash", hash_);
  }
  return 0;
}
