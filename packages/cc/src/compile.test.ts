/**
 * Unit tests: preprocessor, types and layout, constant folding, line map,
 * debug info, and execution of small programs (exit codes / UART).
 */
import { describe, expect, it } from 'vitest';
import { compile } from './index';
import { Diags } from './diag';
import { tokenize } from './lexer';
import { Preprocessor } from './preprocess';
import { compileOk, exitOf, run } from './test/harness';

function pp(src: string, headers: Record<string, string> = {}): string {
  const d = new Diags();
  const p = new Preprocessor(d, { file: 'main.c', headers, charSigned: false });
  const toks = p.run(src);
  if (d.list.length) throw new Error(d.list.map((x) => x.message).join('; '));
  return toks
    .filter((t) => t.kind !== 'eof')
    .map((t) => t.text)
    .join(' ');
}

describe('lexer', () => {
  it('tokenizes with 1-based ranges, end exclusive', () => {
    const toks = tokenize('int x;\n  y += 0x1f;', 'f.c', new Diags());
    expect(toks.map((t) => t.text)).toEqual(['int', 'x', ';', 'y', '+=', '0x1f', ';', '']);
    const y = toks[3];
    expect(y && [y.line, y.col, y.endLine, y.endCol]).toEqual([2, 3, 2, 4]);
    const n = toks[5];
    expect(n && [n.line, n.col, n.endCol]).toEqual([2, 8, 12]);
  });

  it('splices backslash-newline and skips comments', () => {
    const toks = tokenize('a /* x */ b // c\nd\\\ne', 'f.c', new Diags());
    expect(toks.map((t) => t.text)).toEqual(['a', 'b', 'de', '']);
  });
});

describe('preprocessor', () => {
  it('expands object and function-like macros', () => {
    expect(pp('#define N 3\n#define SQ(x) ((x)*(x))\nN SQ(N+1)')).toBe('3 ( ( 3 + 1 ) * ( 3 + 1 ) )');
  });

  it('stringizes and pastes', () => {
    expect(pp('#define S(x) #x\n#define C(a,b) a##b\nS(a + "b") C(x, 1)')).toBe('"a + \\"b\\"" x1');
  });

  it('does not expand a macro inside itself', () => {
    expect(pp('#define f(x) x + f(x)\n#define g g\nf(1) g')).toBe('1 + f ( 1 ) g');
  });

  it('handles variadic macros and the GNU comma swallow', () => {
    expect(pp('#define P(f, ...) p(f, ##__VA_ARGS__)\nP(a) P(a, b, c)')).toBe('p ( a ) p ( a , b , c )');
    expect(pp('#define Q(args...) q(args)\nQ(1, 2)')).toBe('q ( 1 , 2 )');
  });

  it('evaluates #if expressions with defined()', () => {
    const src = '#define A 2\n#if defined(A) && A * 2 == 4 && !defined B\nyes\n#elif 1\nno\n#else\nno\n#endif';
    expect(pp(src)).toBe('yes');
    expect(pp('#if 0\n#if garbage (\n#endif\nno\n#else\nyes\n#endif')).toBe('yes');
    expect(pp('#ifdef X\nno\n#elif defined X\nno\n#else\nyes\n#endif')).toBe('yes');
  });

  it('includes headers once with guards or #pragma once', () => {
    const headers = {
      'a.h': '#ifndef A_H\n#define A_H\nint a;\n#endif\n',
      'b.h': '#pragma once\nint b;\n',
    };
    expect(pp('#include "a.h"\n#include "a.h"\n#include <b.h>\n#include "b.h"\nend', headers)).toBe('int a ; int b ; end');
  });

  it('provides __LINE__, __FILE__ and freestanding headers', () => {
    expect(pp('\n__LINE__ __FILE__')).toBe('2 "main.c"');
    expect(pp('#include <stdint.h>\n#include <limits.h>\nINT32_MAX CHAR_MAX')).toContain('255');
  });
});

describe('types and layout', () => {
  it('char is unsigned by default (RISC-V psABI) and configurable', () => {
    expect(exitOf('int main(void) { char c = -1; return c > 0; }')).toBe(1);
    expect(exitOf('int main(void) { char c = -1; return c < 0; }', { charSigned: true })).toBe(1);
  });

  it('applies integer promotions and usual arithmetic conversions', () => {
    expect(exitOf('int main(void) { unsigned u = 1; int i = -1; return i < u; }')).toBe(0);
    expect(exitOf('int main(void) { unsigned short a = 65535; return a * a < 0; }')).toBe(1);
    expect(exitOf('int main(void) { long long x = -1; unsigned y = 1; return x < y; }')).toBe(1);
    expect(exitOf('int main(void) { return sizeof(1 ? (char)1 : (char)1); }')).toBe(4);
  });

  it('lays out structs with natural alignment', () => {
    expect(exitOf('struct s { char a; int b; short c; }; int main(void) { return sizeof(struct s); }')).toBe(12);
    expect(exitOf('struct s { char a; long long b; }; int main(void) { return sizeof(struct s) + _Alignof(struct s); }')).toBe(24);
    expect(exitOf('union u { char a[5]; int b; }; int main(void) { return sizeof(union u); }')).toBe(8);
  });

  it('folds constant expressions for array sizes, enums and case labels', () => {
    expect(exitOf('enum { A = 1 << 3, B = A * 2 - 1 }; int arr[B + (int)sizeof(long long)]; int main(void) { return sizeof arr / sizeof arr[0]; }')).toBe(23);
  });
});

describe('execution', () => {
  it('divides like RV32 (truncation toward zero)', () => {
    expect(exitOf('int main(void) { int a = -7, b = 2; return (a / b) * 10 + (a % b) + 100; }')).toBe(69);
  });

  it('short-circuits && and ||', () => {
    expect(exitOf('int n; int f(void) { n++; return 1; } int main(void) { if (0 && f()) {} if (1 || f()) {} return n; }')).toBe(0);
  });

  it('recurses', () => {
    expect(exitOf('int fact(int n) { return n < 2 ? 1 : n * fact(n - 1); } int main(void) { return fact(5); }')).toBe(120);
  });

  it('returns 0 from main by default', () => {
    expect(exitOf('int main(void) { }')).toBe(0);
  });

  it('prints through the UART', () => {
    expect(run('int puts(const char *); int main(void) { puts("hi"); return 0; }').uart).toBe('hi\n');
  });

  it('runs 64-bit division through the runtime helpers', () => {
    expect(exitOf('int main(void) { long long a = 100000000000LL; unsigned long long b = 7; return (int)(a / 3 % 100) + (int)(b % 4); }')).toBe(36);
  });
});

describe('output contract', () => {
  it('maps every instruction line to a C line of the main file', () => {
    const src = 'int add(int a, int b) {\n  int c = a + b;\n  return c;\n}\nint main(void) {\n  return add(1, 2);\n}\n';
    const r = compileOk(src);
    const lines = r.asm.split('\n');
    expect(r.lineMap.length).toBe(lines.length - 1); // the text ends with a newline
    lines.forEach((l, i) => {
      if (/^\t[a-z]/.test(l) && !/^\t\./.test(l)) expect(r.lineMap[i], l).toBeGreaterThan(0);
    });
    const addLine = lines.findIndex((l) => /\tadd [ast]\d+, [ast]\d+, [ast]\d+/.test(l));
    expect(r.lineMap[addLine]).toBe(2);
    const call = lines.findIndex((l) => l.includes('call add'));
    expect(r.lineMap[call]).toBe(6);
  });

  it('maps header code to line 0', () => {
    const r = compileOk('#include "h.h"\nint main(void) { return f(); }', { headers: { 'h.h': 'static int f(void) { return 3; }\n' } });
    const lines = r.asm.split('\n');
    const i = lines.indexOf('f:');
    expect(r.lineMap[i + 1]).toBe(0);
  });

  it('describes functions and locals for the debugger', () => {
    const r = compileOk('int f(int x) {\n  int y = x * 2;\n  char buf[8];\n  return y + buf[0];\n}\n');
    const f = r.functions.find((x) => x.name === 'f');
    expect(f?.line).toBe(1);
    expect(f?.endLine).toBe(5);
    expect(f?.locals.map((l) => [l.name, l.type, l.size])).toEqual([
      ['x', 'int', 4],
      ['y', 'int', 4],
      ['buf', 'char [8]', 8],
    ]);
    // f makes no calls: x stays in a0 where it arrived, y gets a1; buf is in the frame
    expect(f?.locals.map((l) => l.reg ?? l.offset)).toEqual(['a0', 'a1', expect.any(Number)]);
    expect(f?.locals[2]?.offset).toBeLessThan(0);
  });

  it('keeps every local in the frame with noRegisterVariables', () => {
    const r = compileOk('int f(int x) {\n  int y = x * 2;\n  return y;\n}\n', { noRegisterVariables: true });
    for (const l of r.functions[0]?.locals ?? []) {
      expect(l.reg).toBeUndefined();
      expect(l.offset).toBeLessThan(0);
    }
  });

  it('emits globals into .data, .bss and .rodata', () => {
    const r = compileOk('int a = 1; int b; const int c = 2; static int d; char *s = "x"; int main(void) { return d; }');
    expect(r.asm).toMatch(/\.data\n\t\.globl a\n\t\.align 2\na:\n\t\.word 1/);
    expect(r.asm).toMatch(/\.bss\n\t\.globl b/);
    expect(r.asm).toMatch(/\.section \.rodata\n\t\.globl c/);
    expect(r.asm).toMatch(/s:\n\t\.word \.LC0/);
  });

  it('does not emit unused static functions', () => {
    const r = compileOk('static int unused(void) { return 1; } static int used(void) { return 2; } int main(void) { return used(); }');
    expect(r.asm).not.toContain('unused:');
    expect(r.asm).toContain('used:');
  });

  it('renames globals that clash with register names', () => {
    expect(exitOf('int a0 = 3, gp = 4; int sp(void) { return a0 + gp; } int main(void) { return sp(); }')).toBe(7);
  });

  it('never throws on garbage', () => {
    for (const src of ['}{', '#define', 'int (((', '"', "'", 'struct { int', '#if', 'int f() { return ((((1); }', '\u0000\u0001']) {
      const r = compile(src);
      expect(r.ok).toBe(false);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
