/* Shared declarations for the gcc <-> our-compiler calling convention test (CC-05). */
#include <stdarg.h>
struct c3 { char a, b, c; };
struct i2 { int a, b; };
struct i3 { int a, b, c; };
struct big { int v[10]; };
struct mixed { char c; long long x; };
typedef int (*cb_t)(int, struct i2);

/* defined by gcc (abi_gcc.c) */
struct c3 g_c3(struct c3 x, int k);
struct i2 g_i2(int a, struct i2 x, int b);
struct i3 g_i3(struct i3 x);
struct big g_big(struct big x, int k);
long long g_ll(int a, long long b, int c, long long d, int e, long long f, int g, long long h);
int g_many(int a, int b, int c, int d, int e, int f, int g, int h, int i, int j, struct i2 s);
int g_sum(int n, ...);
long long g_sumll(int n, ...);
int g_call(cb_t f, int x);
struct mixed g_mixed(struct mixed m);
unsigned char g_uchar(unsigned char a, signed char b, short c, unsigned short d);
int g_back(void);

/* defined by us (abi_ours.c), called from gcc code */
struct c3 o_c3(struct c3 x, int k);
struct i2 o_i2(int a, struct i2 x, int b);
struct big o_big(struct big x, int k);
long long o_ll(int a, long long b, int c, long long d, int e, long long f, int g, long long h);
int o_many(int a, int b, int c, int d, int e, int f, int g, int h, int i, int j, struct i2 s);
int o_sum(int n, ...);
struct mixed o_mixed(struct mixed m);
