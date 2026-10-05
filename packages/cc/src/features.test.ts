/**
 * Execution tests for language features listed in README.md.
 */
import { describe, expect, it } from 'vitest';
import { compileOk, exitOf, run } from './test/harness';

describe('language features', () => {
  it('typeof, _Static_assert, _Alignas', () => {
    expect(
      exitOf(`
        _Static_assert(sizeof(int) == 4, "int is 32 bits");
        int main(void) {
          _Alignas(16) char buf[3];
          typeof(buf[0]) c = 7;
          __typeof__(&c) p = &c;
          return *p + ((unsigned)buf % 16 == 0) * 10;
        }`),
    ).toBe(17);
  });

  it('GNU ?: evaluates its condition once', () => {
    expect(exitOf('int n; int f(void) { return ++n; } int main(void) { int x = f() ?: 9; return x * 10 + n; }')).toBe(11);
    expect(exitOf('int main(void) { int z = 0; return z ?: 5; }')).toBe(5);
  });

  it('case ranges and switch on long long', () => {
    expect(
      exitOf(`
        int k(int c) { switch (c) { case 'a' ... 'z': return 1; case '0' ... '9': return 2; default: return 3; } }
        int l(long long v) { switch (v) { case 0x100000000LL: return 5; case -1: return 6; default: return 7; } }
        int main(void) { return k('q') + k('5') * 10 + k('!') * 100 + l(0x100000000LL) * 1000 + l(-1) * 10000 + l(1) * 100000; }`),
    ).toBe(765321 & 0xffffffff);
  });

  it('packed structs', () => {
    expect(exitOf('struct __attribute__((packed)) p { char a; int b; }; int main(void) { struct p x; x.b = 5; return sizeof(struct p) * 10 + x.b; }', {})).toBe(55);
  });

  it('statement expressions and compound literals', () => {
    expect(exitOf('#define MAX(a,b) ({ int _a = (a), _b = (b); _a > _b ? _a : _b; })\nint main(void) { int *p = (int[]){ 3, 4 }; return MAX(p[0], p[1]) + MAX(10, 2); }')).toBe(14);
  });

  it('designated initializers with nesting and ranges', () => {
    expect(
      exitOf(`
        struct in { int a, b; };
        struct out { int x; struct in in[2]; int y; };
        struct out g = { .in[1].b = 5, .x = 1, .y = 9 };
        int arr[10] = { [2 ... 4] = 7, [8] = 1 };
        int main(void) { return g.in[1].b + g.x + g.y + g.in[0].a + arr[3] + arr[8] + arr[5]; }`),
    ).toBe(23);
  });

  it('flexible array members', () => {
    expect(
      exitOf(`
        struct buf { int n; char data[]; };
        char storage[32];
        int main(void) {
          struct buf *b = (struct buf *)storage;
          b->n = 3; b->data[0] = 'x'; b->data[2] = 'z';
          return (int)sizeof(struct buf) + b->data[2] - 'z' + b->n;
        }`),
    ).toBe(7);
  });

  it('unions alias their members', () => {
    expect(exitOf('union u { unsigned w; unsigned char b[4]; }; int main(void) { union u x; x.w = 0x01020304; return x.b[0] * 10 + x.b[3]; }')).toBe(41);
  });

  it('volatile pointer loops re-read memory every time', () => {
    const r = compileOk('int wait(volatile int *p) { while (*p == 0) {} return *p; }');
    const body = r.asm.slice(r.asm.indexOf('wait:'));
    expect(body.match(/\blw\b/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('64-bit arithmetic, comparisons and conversions', () => {
    expect(
      exitOf(`
        int main(void) {
          unsigned long long a = 0xffffffffULL, b = 1;
          long long c = -5;
          a += b;                      /* 0x100000000 */
          if (a != 0x100000000ULL) return 1;
          if (!(c < 0) || (unsigned long long)c < a) return 2;
          if ((a >> 32) != 1 || (a << 4) != 0x1000000000ULL) return 3;
          if (c * c != 25 || c / 2 != -2 || c % 2 != -1) return 4;
          if ((int)(a - 1) != -1) return 5;
          return 42;
        }`),
    ).toBe(42);
  });

  it('passes and returns structs of every small size', () => {
    const src = `
      struct s1 { char a; }; struct s3 { char a[3]; }; struct s5 { char a[5]; }; struct s8 { short a[4]; };
      struct s12 { int a[3]; }; struct s40 { int a[10]; };
      struct s1 f1(struct s1 x) { x.a++; return x; }
      struct s3 f3(struct s3 x) { x.a[2]++; return x; }
      struct s5 f5(struct s5 x) { x.a[4]++; return x; }
      struct s8 f8(struct s8 x) { x.a[3]++; return x; }
      struct s12 f12(struct s12 x) { x.a[2]++; return x; }
      struct s40 f40(int pad, struct s40 x, int k) { x.a[9] += k + pad; return x; }
      int main(void) {
        struct s1 a = { 1 }; struct s3 b = { { 1, 2, 3 } }; struct s5 c = { { 1, 2, 3, 4, 5 } };
        struct s8 d = { { 1, 2, 3, 4 } }; struct s12 e = { { 1, 2, 3 } }; struct s40 g = { { 0 } };
        g.a[9] = 10;
        return f1(a).a + f3(b).a[2] + f5(c).a[4] + f8(d).a[3] + f12(e).a[2] + f40(1, g, 2).a[9] + g.a[9];
      }`;
    expect(exitOf(src)).toBe(2 + 4 + 6 + 5 + 4 + 13 + 10);
  });

  it('calls through many arguments with mixed sizes', () => {
    expect(
      exitOf(`
        long long f(int a, long long b, int c, long long d, int e, long long f, int g, long long h, int i) {
          return a + b + c + d + e + f + g + h + i;
        }
        int main(void) { return (int)f(1, 2, 3, 4, 5, 6, 7, 8, 9); }`),
    ).toBe(45);
  });

  it('weak symbols', () => {
    expect(compileOk('__attribute__((weak)) int hook(void) { return 0; }').asm).toContain('.weak hook');
  });

  it('runs printf-style formatting written in C', () => {
    const r = run(`
      #include <stdarg.h>
      int putchar(int c);
      static void pnum(unsigned v, int base) { char b[16]; int i = 0; do { b[i++] = "0123456789abcdef"[v % base]; v /= base; } while (v); while (i) putchar(b[--i]); }
      static void fmt(const char *f, ...) {
        va_list ap; va_start(ap, f);
        for (; *f; f++) {
          if (*f != '%') { putchar(*f); continue; }
          switch (*++f) {
            case 'd': { int v = va_arg(ap, int); if (v < 0) { putchar('-'); v = -v; } pnum(v, 10); break; }
            case 'x': pnum(va_arg(ap, unsigned), 16); break;
            case 's': { const char *s = va_arg(ap, const char *); while (*s) putchar(*s++); break; }
            case 'c': putchar(va_arg(ap, int)); break;
          }
        }
        va_end(ap);
      }
      int main(void) { fmt("%d %x %s%c\\n", -42, 255, "ok", '!'); return 0; }`);
    expect(r.uart).toBe('-42 ff ok!\n');
  });
});

describe('large functions', () => {
  it('relaxes conditional branches whose target is more than 4 KiB away', () => {
    const body = Array.from({ length: 1500 }, (_, i) => `    acc = acc * 3 + ${i};`).join('\n');
    const src = `
      volatile int sink;
      int main(void) {
        unsigned acc = 1;
        int i;
        for (i = 0; i < 3; i++) {
          if (i == 1) {
${body}
          }
          sink = acc;
        }
        return acc % 251;
      }`;
    let acc = 1;
    for (let i = 0; i < 1500; i++) acc = (Math.imul(acc, 3) + i) >>> 0;
    expect(exitOf(src)).toBe(acc % 251);
  });

  it('handles frames larger than 2 KiB (offsets beyond 12 bits)', () => {
    expect(
      exitOf(`
        int f(int k) { int big[3000]; int i; for (i = 0; i < 3000; i++) big[i] = i * k; return big[2999] - big[1]; }
        int main(void) { char pad[5000]; pad[4999] = 7; return f(2) % 256 + pad[4999]; }`),
    ).toBe(((2999 * 2 - 2) % 256) + 7);
  });
});
