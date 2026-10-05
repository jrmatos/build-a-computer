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

enum tok { T_IDENT, T_KEYWORD, T_NUMBER, T_STRING, T_CHAR, T_OP, T_PUNCT, T_COMMENT, T_ERROR, T_COUNT };
enum state { S_START, S_IDENT, S_NUMBER, S_HEX, S_STRING, S_STR_ESC, S_CHAR, S_SLASH, S_LINE_COMMENT,
             S_BLOCK_COMMENT, S_BLOCK_STAR };

static const char *tok_names[T_COUNT] = { "ident", "keyword", "number", "string", "char", "op", "punct", "comment", "error" };
static const char *keywords[] = { "int", "char", "if", "else", "while", "for", "return", "static", "unsigned", "struct" };

static const char source[] =
  "/* sample */\n"
  "static int count = 0x1F;\n"
  "int main(void) {\n"
  "  char c = 'x'; char *s = \"hi \\\"there\\\"\\n\";\n"
  "  // line comment\n"
  "  for (int i = 0; i < 10; i++) { count += i * 2; }\n"
  "  if (count >= 100 && s[0] != '\\0') return count - 1;\n"
  "  else return @;\n"
  "}\n";

static int counts[T_COUNT];
static int total;

static int is_alpha(int c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_'; }
static int is_digit(int c) { return c >= '0' && c <= '9'; }
static int is_hex(int c) { return is_digit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
static int is_space(int c) { return c == ' ' || c == '\n' || c == '\t'; }

static int is_keyword(const char *s, int n) {
  unsigned k;
  for (k = 0; k < sizeof(keywords) / sizeof(keywords[0]); k++) {
    const char *w = keywords[k];
    int i = 0;
    while (i < n && w[i] == s[i]) i++;
    if (i == n && w[i] == 0) return 1;
  }
  return 0;
}
static void emit(enum tok t, const char *s, int n) {
  counts[t]++;
  total++;
  if (t == T_KEYWORD || t == T_NUMBER || t == T_ERROR) {
    int i;
    putch('['); puts_(tok_names[t]); putch(' ');
    for (i = 0; i < n; i++) putch(s[i]);
    putch(']');
  }
}

static void lex(const char *p) {
  enum state st = S_START;
  const char *start = p;
  for (;;) {
    char c = *p;
    switch (st) {
    case S_START:
      if (!c) return;
      start = p;
      if (is_space(c)) { p++; break; }
      if (is_alpha(c)) { st = S_IDENT; p++; break; }
      if (c == '0' && (p[1] == 'x' || p[1] == 'X')) { st = S_HEX; p += 2; break; }
      if (is_digit(c)) { st = S_NUMBER; p++; break; }
      if (c == '"') { st = S_STRING; p++; break; }
      if (c == '\'') { st = S_CHAR; p++; break; }
      if (c == '/') { st = S_SLASH; p++; break; }
      if (c == '(' || c == ')' || c == '{' || c == '}' || c == ';' || c == ',' || c == '[' || c == ']') {
        emit(T_PUNCT, p, 1); p++; break;
      }
      if (c == '+' || c == '-' || c == '*' || c == '<' || c == '>' || c == '=' || c == '!' || c == '&' || c == '|') {
        int n = 1;
        if (p[1] == '=' || (p[1] == c && (c == '+' || c == '-' || c == '&' || c == '|'))) n = 2;
        emit(T_OP, p, n); p += n; break;
      }
      emit(T_ERROR, p, 1); p++; break;
    case S_IDENT:
      if (is_alpha(c) || is_digit(c)) { p++; break; }
      emit(is_keyword(start, (int)(p - start)) ? T_KEYWORD : T_IDENT, start, (int)(p - start));
      st = S_START; break;
    case S_NUMBER:
      if (is_digit(c)) { p++; break; }
      emit(T_NUMBER, start, (int)(p - start)); st = S_START; break;
    case S_HEX:
      if (is_hex(c)) { p++; break; }
      emit(T_NUMBER, start, (int)(p - start)); st = S_START; break;
    case S_STRING:
      if (!c) { emit(T_ERROR, start, (int)(p - start)); return; }
      p++;
      if (c == '\\') st = S_STR_ESC;
      else if (c == '"') { emit(T_STRING, start, (int)(p - start)); st = S_START; }
      break;
    case S_STR_ESC:
      if (!c) { emit(T_ERROR, start, (int)(p - start)); return; }
      p++; st = S_STRING; break;
    case S_CHAR:
      if (c == '\\') { p += 2; break; }
      if (c == '\'') { p++; emit(T_CHAR, start, (int)(p - start)); st = S_START; break; }
      if (!c) { emit(T_ERROR, start, (int)(p - start)); return; }
      p++; break;
    case S_SLASH:
      if (c == '/') { st = S_LINE_COMMENT; p++; }
      else if (c == '*') { st = S_BLOCK_COMMENT; p++; }
      else { emit(T_OP, start, 1); st = S_START; }
      break;
    case S_LINE_COMMENT:
      if (!c || c == '\n') { emit(T_COMMENT, start, (int)(p - start)); st = S_START; }
      else p++;
      break;
    case S_BLOCK_COMMENT:
      if (!c) { emit(T_ERROR, start, (int)(p - start)); return; }
      if (c == '*') st = S_BLOCK_STAR;
      p++; break;
    case S_BLOCK_STAR:
      if (!c) { emit(T_ERROR, start, (int)(p - start)); return; }
      p++;
      if (c == '/') { emit(T_COMMENT, start, (int)(p - start)); st = S_START; }
      else if (c != '*') st = S_BLOCK_COMMENT;
      break;
    }
  }
}

int main(void) {
  int i;
  unsigned h = 0;
  lex(source);
  nl();
  for (i = 0; i < T_COUNT; i++) {
    show(tok_names[i], counts[i]);
    h = h * 17u + (unsigned)counts[i];
  }
  show("total", total);
  showu("h", h);
  return total;
}
