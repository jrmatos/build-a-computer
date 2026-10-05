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

#define HEAP_SIZE 8192
#define ALIGN 8

static union { char bytes[HEAP_SIZE]; unsigned align; } heap_u;
#define heap (heap_u.bytes)
static unsigned heap_top;

struct block { unsigned size; struct block *next; };
static struct block *free_list;

static unsigned align_up(unsigned n) { return (n + (ALIGN - 1)) & ~(unsigned)(ALIGN - 1); }

static void *pool_alloc(unsigned n) {
  struct block **pp = &free_list;
  struct block *b;
  unsigned need = align_up(n);
  unsigned hdr = align_up((unsigned)sizeof(struct block));
  while (*pp) {
    if ((*pp)->size >= need) {
      b = *pp;
      *pp = b->next;
      return (char *)b + hdr;
    }
    pp = &(*pp)->next;
  }
  if (heap_top + hdr + need > HEAP_SIZE) return 0;
  b = (struct block *)(heap + heap_top);
  b->size = need;
  b->next = 0;
  heap_top += hdr + need;
  return (char *)b + hdr;
}
static void pool_free(void *p) {
  struct block *b;
  if (!p) return;
  b = (struct block *)((char *)p - align_up((unsigned)sizeof(struct block)));
  b->next = free_list;
  free_list = b;
}

struct node { int value; struct node *next; };

static struct node *push_front(struct node *h, int v) {
  struct node *n = (struct node *)pool_alloc(sizeof(struct node));
  if (!n) return h;
  n->value = v; n->next = h;
  return n;
}
static struct node *insert_sorted(struct node *h, int v) {
  struct node **pp = &h;
  struct node *n = (struct node *)pool_alloc(sizeof(struct node));
  if (!n) return h;
  n->value = v;
  while (*pp && (*pp)->value < v) pp = &(*pp)->next;
  n->next = *pp;
  *pp = n;
  return h;
}
static struct node *delete_if(struct node *h, int mod, int *removed) {
  struct node **pp = &h;
  while (*pp) {
    if ((*pp)->value % mod == 0) {
      struct node *d = *pp;
      *pp = d->next;
      pool_free(d);
      (*removed)++;
    } else pp = &(*pp)->next;
  }
  return h;
}
static struct node *reverse(struct node *h) {
  struct node *prev = 0;
  while (h) { struct node *nx = h->next; h->next = prev; prev = h; h = nx; }
  return prev;
}
static void print_list(const char *label, struct node *h) {
  int count = 0;
  puts_(label); puts_(":");
  while (h) { putch(' '); puti(h->value); h = h->next; count++; }
  puts_(" ("); puti(count); puts_(")"); nl();
}
static unsigned list_hash(struct node *h) {
  unsigned x = 17;
  while (h) { x = x * 33u ^ (unsigned)h->value; h = h->next; }
  return x;
}
static void free_list_all(struct node *h) {
  while (h) { struct node *nx = h->next; pool_free(h); h = nx; }
}
static int list_len(struct node *h) { int n = 0; while (h) { n++; h = h->next; } return n; }
static int free_count(void) { int c = 0; struct block *b = free_list; while (b) { c++; b = b->next; } return c; }

int main(void) {
  struct node *a = 0, *b = 0;
  int i, removed = 0;
  unsigned top1, h;
  for (i = 1; i <= 12; i++) a = push_front(a, i * 7 % 13);
  print_list("pushed", a);
  for (i = 0; i < 15; i++) b = insert_sorted(b, (i * 37 + 11) % 50 - 20);
  print_list("sorted", b);
  a = delete_if(a, 3, &removed);
  print_list("del %3", a);
  show("removed", removed);
  show("free blocks", free_count());
  top1 = heap_top;
  a = push_front(a, 100);
  a = push_front(a, 200);
  show("reused (top unchanged)", heap_top == top1);
  a = reverse(a);
  print_list("reversed", a);
  b = reverse(b);
  print_list("b reversed", b);
  h = list_hash(a) ^ list_hash(b);
  free_list_all(a);
  free_list_all(b);
  show("free blocks after", free_count());
  a = 0;
  for (i = 0; i < 600; i++) a = push_front(a, i);
  show("big list len", (int)(list_len(a)));
  show("big list head", a ? a->value : -1);
  show("heap aligned", (heap_top % ALIGN) == 0);
  showu("hash", h);
  return (int)((h ^ heap_top) & 0x7f);
}
