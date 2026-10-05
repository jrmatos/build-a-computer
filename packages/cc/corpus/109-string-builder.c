#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { char *buf; unsigned len; unsigned cap; } sb;

static void sb_init(sb *s) { s->cap = 8; s->len = 0; s->buf = (char *)malloc(s->cap); s->buf[0] = 0; }
static void sb_reserve(sb *s, unsigned need) {
  char *nb;
  unsigned ncap = s->cap;
  if (need + 1 <= s->cap) return;
  while (ncap < need + 1) ncap *= 2;
  nb = (char *)malloc(ncap);
  memcpy(nb, s->buf, s->len + 1);
  free(s->buf);
  s->buf = nb;
  s->cap = ncap;
}
static void sb_append(sb *s, const char *t) {
  unsigned n = (unsigned)strlen(t);
  sb_reserve(s, s->len + n);
  memcpy(s->buf + s->len, t, n + 1);
  s->len += n;
}
static void sb_append_char(sb *s, char c) {
  sb_reserve(s, s->len + 1);
  s->buf[s->len++] = c;
  s->buf[s->len] = 0;
}
static void sb_append_int(sb *s, int v) {
  char tmp[12];
  int i = 0;
  unsigned u = v < 0 ? 0u - (unsigned)v : (unsigned)v;
  do { tmp[i++] = (char)('0' + u % 10u); u /= 10u; } while (u);
  if (v < 0) sb_append_char(s, '-');
  while (i > 0) sb_append_char(s, tmp[--i]);
}
static void sb_free(sb *s) { free(s->buf); s->buf = 0; s->len = s->cap = 0; }

static void reverse_range(char *a, int i, int j) {
  while (i < j) { char t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
}
/* reverse word order in place: reverse all, then each word */
static char *reverse_words(const char *src) {
  int n = (int)strlen(src), i = 0, start;
  char *out = (char *)malloc((unsigned)n + 1);
  memcpy(out, src, (unsigned)n + 1);
  reverse_range(out, 0, n - 1);
  while (i < n) {
    while (i < n && out[i] == ' ') i++;
    start = i;
    while (i < n && out[i] != ' ') i++;
    reverse_range(out, start, i - 1);
  }
  return out;
}

static const char *sentences[] = {
  "the quick brown fox jumps over the lazy dog",
  "hello",
  "  leading and trailing  ",
  "",
  "a b c d e",
};

int main(void) {
  sb s;
  int i;
  unsigned h = 0;
  sb_init(&s);
  for (i = 0; i < 20; i++) {
    sb_append(&s, "item");
    sb_append_int(&s, i * 37 - 100);
    sb_append_char(&s, i < 19 ? ',' : '.');
  }
  printf("%s\n", s.buf);
  printf("len=%u cap=%u strlen=%u\n", s.len, s.cap, (unsigned)strlen(s.buf));
  for (i = 0; i < (int)s.len; i++) h = h * 33u + (unsigned char)s.buf[i];
  sb_free(&s);
  for (i = 0; i < 5; i++) {
    char *r = reverse_words(sentences[i]);
    printf("[%s] -> [%s]\n", sentences[i], r);
    h ^= (unsigned)strlen(r) * 2654435761u;
    free(r);
  }
  sb_init(&s);
  for (i = 0; i < 5; i++) { sb_append(&s, sentences[i]); sb_append(&s, " | "); }
  sb_append_int(&s, -2147483647 - 1);
  printf("%s (%u)\n", s.buf, s.len);
  h += s.len;
  sb_free(&s);
  printf("hash=%x\n", h);
  return (int)(h & 0xff);
}
