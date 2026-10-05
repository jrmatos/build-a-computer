#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { int *data; int len; int cap; int grows; } vec;

static void vec_init(vec *v) { v->data = 0; v->len = 0; v->cap = 0; v->grows = 0; }
static int vec_push(vec *v, int x) {
  if (v->len == v->cap) {
    int ncap = v->cap ? v->cap * 2 : 4;
    int *nd = (int *)malloc((unsigned)ncap * sizeof(int));
    if (!nd) return 0;
    if (v->data) { memcpy(nd, v->data, (unsigned)v->len * sizeof(int)); free(v->data); }
    v->data = nd;
    v->cap = ncap;
    v->grows++;
  }
  v->data[v->len++] = x;
  return 1;
}
static int vec_pop(vec *v) { return v->data[--v->len]; }
static void vec_insert(vec *v, int at, int x) {
  int i;
  vec_push(v, 0);
  for (i = v->len - 1; i > at; i--) v->data[i] = v->data[i - 1];
  v->data[at] = x;
}
static void vec_remove(vec *v, int at) {
  int i;
  for (i = at; i < v->len - 1; i++) v->data[i] = v->data[i + 1];
  v->len--;
}
static void vec_free(vec *v) { free(v->data); vec_init(v); }
static unsigned vec_hash(const vec *v) {
  unsigned h = 2166136261u;
  int i;
  for (i = 0; i < v->len; i++) h = (h ^ (unsigned)v->data[i]) * 16777619u;
  return h;
}
static void vec_print(const vec *v, int max) {
  int i;
  printf("[");
  for (i = 0; i < v->len && i < max; i++) printf(i ? ", %d" : "%d", v->data[i]);
  if (v->len > max) printf(", ...");
  printf("] len=%d cap=%d\n", v->len, v->cap);
}

int main(void) {
  vec a, b;
  int i, s = 0;
  unsigned h;
  vec_init(&a);
  vec_init(&b);
  for (i = 0; i < 1000; i++) vec_push(&a, i * 3 - 500);
  vec_print(&a, 8);
  printf("grows=%d last=%d\n", a.grows, a.data[a.len - 1]);
  for (i = 0; i < 500; i++) s += vec_pop(&a);
  printf("popped sum=%d len=%d\n", s, a.len);
  for (i = 0; i < a.len; i++) if (a.data[i] % 2 == 0) vec_push(&b, a.data[i]);
  vec_print(&b, 6);
  vec_insert(&b, 0, 7777);
  vec_insert(&b, 3, -1);
  vec_insert(&b, b.len, 9999);
  vec_remove(&b, 1);
  vec_print(&b, 6);
  printf("b last=%d\n", b.data[b.len - 1]);
  h = vec_hash(&a) ^ vec_hash(&b);
  vec_free(&a);
  vec_free(&b);
  printf("after free len=%d cap=%d\n", a.len, a.cap);
  for (i = 0; i < 50; i++) vec_push(&a, i * i);
  vec_print(&a, 10);
  h += vec_hash(&a);
  vec_free(&a);
  printf("hash=%x\n", h);
  return (int)(h & 0xff);
}
