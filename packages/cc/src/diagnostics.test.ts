/**
 * CC-03: malformed programs each produce one useful first error, with a
 * range pointing at the problem.
 */
import { describe, expect, it } from 'vitest';
import { compile } from './index';

interface Case {
  name: string;
  src: string;
  /** Substring of the first error message. */
  msg: string | RegExp;
  /** Expected line (and column) of the first error. */
  line: number;
  col?: number;
}

const cases: Case[] = [
  { name: 'missing semicolon after expression', src: 'int main(void) {\n  int x = 1\n  return x;\n}', msg: "expected ';'", line: 2, col: 12 },
  { name: 'missing semicolon after statement call', src: 'void f(void);\nint main(void) {\n  f()\n  return 0;\n}', msg: "expected ';' after expression", line: 3, col: 6 },
  { name: 'undeclared identifier', src: 'int main(void) {\n  return y + 1;\n}', msg: "undeclared identifier 'y'", line: 2, col: 10 },
  { name: 'undeclared function', src: 'int main(void) {\n  foo(1);\n  return 0;\n}', msg: "undeclared function 'foo'", line: 2, col: 3 },
  { name: 'unknown type name', src: 'int main(void) {\n  strng s;\n  return 0;\n}', msg: /strng/, line: 2, col: 3 },
  { name: 'missing closing brace', src: 'int main(void) {\n  return 0;\n', msg: "missing '}'", line: 1 },
  { name: 'missing closing paren in call', src: 'int f(int);\nint main(void) {\n  return f(1;\n}', msg: "expected ')'", line: 3 },
  { name: 'missing paren in if', src: 'int main(void) {\n  if (1 { return 1; }\n  return 0;\n}', msg: "expected ')'", line: 2 },
  { name: 'unterminated string', src: 'int main(void) {\n  char *s = "abc;\n  return 0;\n}', msg: 'missing closing "', line: 2, col: 13 },
  { name: 'unterminated comment', src: 'int main(void) {\n  /* oops\n  return 0;\n}', msg: 'unterminated /*', line: 2, col: 3 },
  { name: 'stray character', src: 'int main(void) {\n  int x = 1 @ 2;\n  return x;\n}', msg: "'@'", line: 2 },
  { name: 'assign to const', src: 'int main(void) {\n  const int x = 1;\n  x = 2;\n  return x;\n}', msg: "cannot modify 'x': it is const", line: 3, col: 3 },
  { name: 'assign to non-lvalue', src: 'int main(void) {\n  int x;\n  x + 1 = 2;\n  return 0;\n}', msg: 'left side of =', line: 3 },
  { name: 'too few arguments', src: 'int f(int a, int b);\nint main(void) {\n  return f(1);\n}', msg: 'too few arguments', line: 3 },
  { name: 'too many arguments', src: 'int f(int a);\nint main(void) {\n  return f(1, 2);\n}', msg: 'too many arguments', line: 3 },
  { name: 'call a non-function', src: 'int main(void) {\n  int x = 3;\n  return x(2);\n}', msg: 'not a function', line: 3 },
  { name: 'deref a non-pointer', src: 'int main(void) {\n  int x = 3;\n  return *x;\n}', msg: 'not a pointer', line: 3 },
  { name: 'member of non-struct', src: 'int main(void) {\n  int x = 3;\n  return x.y;\n}', msg: "'.' needs a struct", line: 3 },
  { name: 'unknown member', src: 'struct p { int x; };\nint main(void) {\n  struct p q;\n  return q.z;\n}', msg: "no member named 'z'", line: 4, col: 12 },
  { name: 'arrow on struct value', src: 'struct p { int x; };\nint main(void) {\n  struct p q;\n  return q->x;\n}', msg: "use '.' instead of '->'", line: 4 },
  { name: 'dot on pointer', src: 'struct p { int x; };\nint main(void) {\n  struct p *q = 0;\n  return q.x;\n}', msg: "use '->' instead of '.'", line: 4 },
  { name: 'break outside loop', src: 'int main(void) {\n  break;\n  return 0;\n}', msg: "'break' is only allowed", line: 2, col: 3 },
  { name: 'continue outside loop', src: 'int main(void) {\n  continue;\n}', msg: "'continue' is only allowed", line: 2 },
  { name: 'case outside switch', src: 'int main(void) {\n  case 1: return 0;\n}', msg: "'case' is only allowed", line: 2 },
  { name: 'duplicate case', src: 'int main(void) {\n  switch (1) { case 1: break; case 1: break; }\n  return 0;\n}', msg: 'duplicate case value 1', line: 2 },
  { name: 'non-constant case', src: 'int main(void) {\n  int x = 1;\n  switch (x) { case x: break; }\n  return 0;\n}', msg: 'constant expression', line: 3 },
  { name: 'undefined label', src: 'int main(void) {\n  goto nowhere;\n}', msg: "label 'nowhere' is used but never defined", line: 2 },
  { name: 'redefinition of local', src: 'int main(void) {\n  int x;\n  int x;\n  return 0;\n}', msg: "redefinition of 'x'", line: 3, col: 7 },
  { name: 'redefinition of function', src: 'int f(void) { return 1; }\nint f(void) { return 2; }', msg: "redefinition of function 'f'", line: 2 },
  { name: 'conflicting types', src: 'int f(int);\nchar *f(int);', msg: "conflicting types for 'f'", line: 2 },
  { name: 'void variable', src: 'int main(void) {\n  void v;\n  return 0;\n}', msg: "cannot have type 'void'", line: 2 },
  { name: 'return value from void', src: 'void f(void) {\n  return 1;\n}', msg: 'returns void', line: 2 },
  { name: 'incompatible struct assignment', src: 'struct a { int x; }; struct b { int x; };\nint main(void) {\n  struct a p; struct b q;\n  p = q;\n  return 0;\n}', msg: 'incompatible types', line: 4 },
  { name: 'struct in arithmetic', src: 'struct a { int x; };\nint main(void) {\n  struct a p;\n  return p + 1;\n}', msg: "invalid operands to '+'", line: 4 },
  { name: 'incomplete struct variable', src: 'struct nope;\nint main(void) {\n  struct nope n;\n  return 0;\n}', msg: 'incomplete type', line: 3 },
  { name: 'array size not constant', src: 'int main(void) {\n  int n = 3;\n  int a[n];\n  return 0;\n}', msg: 'variable-length arrays are not supported', line: 3 },
  { name: 'negative array size', src: 'int a[-1];', msg: 'array size is negative', line: 1 },
  { name: 'float is unsupported', src: 'int main(void) {\n  float f = 1;\n  return 0;\n}', msg: 'floating-point', line: 2 },
  { name: 'float literal is unsupported', src: 'int main(void) {\n  int x = 1.5;\n  return x;\n}', msg: 'floating-point numbers are not supported', line: 2 },
  { name: 'bad octal digit', src: 'int x = 09;', msg: 'invalid digit in octal', line: 1, col: 9 },
  { name: 'missing #endif', src: '#ifdef X\nint x;\n', msg: 'unterminated #ifdef', line: 1 },
  { name: 'stray #endif', src: '#endif\nint x;', msg: '#endif without a matching #if', line: 1 },
  { name: 'missing header', src: '#include "nothere.h"\nint x;', msg: "cannot find header 'nothere.h'", line: 1, col: 10 },
  { name: '#error directive', src: '#error stop here\nint x;', msg: '#error stop here', line: 1 },
  { name: 'macro argument count', src: '#define ADD(a, b) ((a) + (b))\nint x = ADD(1);', msg: "macro 'ADD' takes 2 arguments but got 1", line: 2 },
  { name: 'keyword as variable name', src: 'int main(void) {\n  int return = 1;\n  return 0;\n}', msg: "'return' is a keyword", line: 2 },
  { name: 'else without if', src: 'int main(void) {\n  else return 0;\n}', msg: "'else' without a matching 'if'", line: 2 },
  { name: 'empty char constant', src: "int c = '';", msg: 'empty character constant', line: 1 },
  { name: 'address of rvalue', src: 'int main(void) {\n  int *p = &(1 + 2);\n  return 0;\n}', msg: "'&' needs", line: 2 },
  { name: 'non-constant global initializer', src: 'int f(void);\nint g = f();', msg: 'not a compile-time constant', line: 2 },
  { name: 'index a non-array', src: 'int main(void) {\n  int x = 1;\n  return x[0];\n}', msg: 'cannot index', line: 3 },
  { name: 'missing expression', src: 'int main(void) {\n  int x = ;\n  return 0;\n}', msg: 'expected an expression', line: 2, col: 11 },
  { name: 'while missing condition paren', src: 'int main(void) {\n  while 1) {}\n  return 0;\n}', msg: "expected '(' after 'while'", line: 2 },
  { name: 'do without while', src: 'int main(void) {\n  do { } (1);\n  return 0;\n}', msg: "expected 'while'", line: 2 },
  { name: 'old-style parameters', src: 'int f(a, b) { return 0; }', msg: 'old-style parameter lists are not supported', line: 1 },
  { name: 'bit-field too wide', src: 'struct s { int x : 40; };', msg: 'bit-field width 40', line: 1 },
  { name: 'sizeof incomplete', src: 'struct s;\nint n = sizeof(struct s);', msg: 'incomplete type', line: 2 },
  { name: 'va_start outside variadic', src: '#include <stdarg.h>\nint f(int n) {\n  va_list ap;\n  va_start(ap, n);\n  return 0;\n}', msg: 'va_start can only be used', line: 4 },
  { name: 'pointer minus different pointer types', src: 'int main(void) {\n  int *a = 0; char *b = 0;\n  return a - b;\n}', msg: 'subtract pointers to different types', line: 3 },
  { name: 'switch on pointer', src: 'int main(void) {\n  int *p = 0;\n  switch (p) { default: break; }\n  return 0;\n}', msg: 'switch needs an integer', line: 3 },
];

describe('CC-03: first error of malformed programs', () => {
  it('has at least 50 cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(50);
  });
  for (const c of cases) {
    it(c.name, () => {
      const r = compile(c.src, { file: 'bad.c' });
      expect(r.ok).toBe(false);
      const first = r.diagnostics.find((d) => d.severity === 'error');
      expect(first, JSON.stringify(r.diagnostics)).toBeDefined();
      if (!first) return;
      if (typeof c.msg === 'string') expect(first.message).toContain(c.msg);
      else expect(first.message).toMatch(c.msg);
      expect(first.line, first.message).toBe(c.line);
      if (c.col !== undefined) expect(first.column, first.message).toBe(c.col);
      expect(first.file).toBe('bad.c');
      expect(first.endLine >= first.line).toBe(true);
      if (first.endLine === first.line) expect(first.endColumn).toBeGreaterThan(first.column);
    });
  }
});

describe('diagnostics', () => {
  it('keeps going after an error and reports later ones', () => {
    const r = compile('int main(void) {\n  int a = b;\n  int c = d;\n  return e;\n}');
    const msgs = r.diagnostics.map((d) => d.message);
    expect(msgs).toEqual([
      "undeclared identifier 'b'",
      "undeclared identifier 'd'",
      "undeclared identifier 'e'",
    ]);
  });

  it('recovers from a syntax error in one function and checks the next', () => {
    const r = compile('int f(void) {\n  return 1 +;\n}\nint g(void) {\n  return zz;\n}');
    expect(r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.line)).toEqual([2, 5]);
  });

  it('reports an undeclared name once per function', () => {
    const r = compile('int main(void) {\n  q = 1;\n  q = 2;\n  return q;\n}');
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(1);
  });

  it('covers the whole identifier with the range', () => {
    const r = compile('int main(void) {\n  return counter;\n}');
    const d = r.diagnostics[0];
    expect(d && [d.line, d.column, d.endLine, d.endColumn]).toEqual([2, 10, 2, 17]);
  });

  it('warns without failing for gcc-style warnings', () => {
    const r = compile('int main(void) {\n  int *p = 5;\n  char *q = p;\n  return 0;\n}');
    expect(r.ok).toBe(true);
    expect(r.diagnostics.map((d) => d.severity)).toEqual(['warning', 'warning']);
    expect(r.diagnostics[0]?.message).toContain('pointer from an integer');
    expect(r.diagnostics[1]?.message).toContain('incompatible pointer types');
  });

  it('stops after too many errors', () => {
    const src = 'int main(void) {\n' + Array.from({ length: 200 }, (_, i) => `  x${i} = 1;\n`).join('') + '}';
    const r = compile(src);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.length).toBeLessThanOrEqual(50);
  });

  it('points errors in headers at the header file', () => {
    const r = compile('#include "h.h"\nint main(void) { return 0; }', { headers: { 'h.h': 'int f(void) { return nope; }\n' } });
    expect(r.diagnostics[0]?.file).toBe('h.h');
    expect(r.diagnostics[0]?.line).toBe(1);
  });

  it('points errors inside macros at the macro use', () => {
    const r = compile('#define BAD (undefined_thing + 1)\nint main(void) {\n  return BAD;\n}');
    expect(r.diagnostics[0]?.line).toBe(3);
    expect(r.diagnostics[0]?.column).toBe(10);
  });
});

describe('warnings that catch common mistakes', () => {
  const warns = (src: string): string[] =>
    compile(src, { headers: { 'stdio.h': 'int printf(const char *fmt, ...);\nint sprintf(char *b, const char *fmt, ...);\n' } })
      .diagnostics.filter((d) => d.severity === 'warning')
      .map((d) => d.message);

  it('warns about an assignment used as a condition', () => {
    expect(warns('int main(void) { int x = 0; if (x = 5) return 1; return 0; }')[0]).toContain("did you mean '=='");
    expect(warns('int main(void) { int x = 0; if ((x = 5)) return 1; while ((x = x - 1) != 0) {} return 0; }')).toEqual([]);
  });

  it('checks printf formats against the arguments', () => {
    const src = (body: string): string => `#include <stdio.h>\nint main(void) { char buf[8]; long long v = 1; ${body} return 0; }`;
    expect(warns(src('printf("%d %s %c %x %p %%\\n", 1, "s", 65, 2u, buf);'))).toEqual([]);
    expect(warns(src('printf("%d\\n", "str");'))[0]).toBe("format '%d' expects 'int', but argument 2 has type 'char *'");
    expect(warns(src('printf("%s\\n", 5);'))[0]).toContain("expects a string ('char *')");
    expect(warns(src('printf("%d %d\\n", 1);'))[0]).toContain('too few arguments for format');
    expect(warns(src('printf("%d\\n", 1, 2);'))[0]).toBe('too many arguments for format');
    expect(warns(src('printf("%d\\n", v);'))[0]).toContain("'long long'");
    expect(warns(src('printf("%lld %*d\\n", v, 3, 4);'))).toEqual([]);
    expect(warns(src('sprintf(buf, "%f", 1);'))[0]).toContain('floating point');
  });
});
