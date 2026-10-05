#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* statements: "x = expr" or "print expr" or "print" alone prints all set vars.
   expr: term (('+'|'-') term)*, term: factor (('*'|'/'|'%') factor)*,
   factor: number | var | '(' expr ')' | '-' factor */

static const char program[] =
  "a = 5\n"
  "b = a * 3 + 2\n"
  "print b\n"
  "c = (a + b) * (b - a) / 4\n"
  "print c\n"
  "n = 10\n"
  "f = 1\n"
  "f = f * n\n"
  "n = n - 1\n"
  "f = f * n\n"
  "print f\n"
  "z = -c % 7\n"
  "print z\n"
  "q = 100 / (a - 5)\n"
  "print q + 1\n"
  "x = 65536 * 65536 - 1\n"
  "print x\n"
  "bogus line here\n"
  "print\n";

struct env { int vals[26]; char set[26]; int errors; int prints; };

static const char *p;
static struct env *env;

static void ws(void) { while (*p == ' ') p++; }
static int expr(void);
static int factor(void) {
  int v;
  ws();
  if (*p == '(') { p++; v = expr(); ws(); if (*p == ')') p++; else env->errors++; return v; }
  if (*p == '-') { p++; return (int)(0u - (unsigned)factor()); }
  if (*p >= '0' && *p <= '9') {
    unsigned u = 0;
    while (*p >= '0' && *p <= '9') u = u * 10u + (unsigned)(*p++ - '0');
    return (int)u;
  }
  if (*p >= 'a' && *p <= 'z') {
    int i = *p++ - 'a';
    if (!env->set[i]) env->errors++;
    return env->vals[i];
  }
  env->errors++;
  return 0;
}
static int term(void) {
  int v = factor();
  for (;;) {
    char op;
    int r;
    ws();
    op = *p;
    if (op != '*' && op != '/' && op != '%') return v;
    p++;
    r = factor();
    if (op == '*') v = (int)((unsigned)v * (unsigned)r);
    else if (r == 0 || (r == -1 && v == -2147483647 - 1)) { env->errors++; v = 0; }
    else v = op == '/' ? v / r : v % r;
  }
}
static int expr(void) {
  int v = term();
  for (;;) {
    char op;
    ws();
    op = *p;
    if (op != '+' && op != '-') return v;
    p++;
    if (op == '+') v = (int)((unsigned)v + (unsigned)term());
    else v = (int)((unsigned)v - (unsigned)term());
  }
}

static int starts_with_print(const char *s) {
  const char *k = "print";
  while (*k) if (*s++ != *k++) return 0;
  return *s == 0 || *s == ' ';
}
static void exec_line(const char *line, int lineno) {
  int errs = env->errors, v, i;
  p = line;
  ws();
  if (!*p) return;
  if (starts_with_print(p)) {
    p += 5;
    ws();
    if (!*p) {
      for (i = 0; i < 26; i++) if (env->set[i]) printf("%c=%d ", 'a' + i, env->vals[i]);
      printf("\n");
      env->prints++;
      return;
    }
    v = expr();
    ws();
    if (*p) env->errors++;
    if (env->errors == errs) { printf("%d\n", v); env->prints++; }
    else printf("line %d: error\n", lineno);
    return;
  }
  if (*p >= 'a' && *p <= 'z') {
    int var = *p++ - 'a';
    ws();
    if (*p == '=') {
      p++;
      v = expr();
      ws();
      if (*p) env->errors++;
      if (env->errors == errs) { env->vals[var] = v; env->set[var] = 1; return; }
    } else env->errors++;
  } else env->errors++;
  printf("line %d: error\n", lineno);
}

int main(void) {
  const char *s = program;
  int lineno = 0, i;
  unsigned h = 0;
  env = (struct env *)malloc(sizeof(struct env));
  if (!env) return 1;
  memset(env, 0, sizeof(struct env));
  while (*s) {
    const char *e = s;
    char *line;
    unsigned len;
    while (*e && *e != '\n') e++;
    len = (unsigned)(e - s);
    line = (char *)malloc(len + 1);
    memcpy(line, s, len);
    line[len] = 0;
    exec_line(line, ++lineno);
    free(line);
    s = *e ? e + 1 : e;
  }
  for (i = 0; i < 26; i++) h = h * 37u + (unsigned)env->vals[i] + env->set[i];
  printf("lines=%d prints=%d errors=%d hash=%x\n", lineno, env->prints, env->errors, h);
  i = env->errors * 16 + env->prints;
  free(env);
  return i;
}
