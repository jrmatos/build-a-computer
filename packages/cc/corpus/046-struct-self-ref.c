/* 046-struct-self-ref: linked list from a static node pool, BST in an array of nodes, in-order walk */
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

struct node { int val; struct node *next; };
static struct node pool[32];
static int pool_used;

static struct node *alloc(int v) { struct node *n = &pool[pool_used++]; n->val = v; n->next = 0; return n; }
static struct node *push(struct node *head, int v) { struct node *n = alloc(v); n->next = head; return n; }
static struct node *insert_sorted(struct node *head, int v) {
  struct node **pp = &head, *n = alloc(v);
  while (*pp && (*pp)->val < v) pp = &(*pp)->next;
  n->next = *pp;
  *pp = n;
  return head;
}
static struct node *reverse(struct node *h) {
  struct node *prev = 0, *nx;
  while (h) { nx = h->next; h->next = prev; prev = h; h = nx; }
  return prev;
}
static void print_list(const char *l, struct node *h) {
  puts_(l); puts_(":");
  for (; h; h = h->next) { putch(' '); puti(h->val); }
  nl();
}
static int list_len(struct node *h) { return h ? 1 + list_len(h->next) : 0; }

struct tnode { int key; int left, right; }; /* children are indices, -1 = none */
static struct tnode tree[20];
static int tcount;
static int troot = -1;

static int tinsert(int idx, int key) {
  if (idx < 0) { tree[tcount].key = key; tree[tcount].left = -1; tree[tcount].right = -1; return tcount++; }
  if (key < tree[idx].key) tree[idx].left = tinsert(tree[idx].left, key);
  else tree[idx].right = tinsert(tree[idx].right, key);
  return idx;
}
static unsigned walk_chk;
static void inorder(int idx) {
  if (idx < 0) return;
  inorder(tree[idx].left);
  puti(tree[idx].key); putch(' ');
  walk_chk = walk_chk * 31u + (unsigned)tree[idx].key;
  inorder(tree[idx].right);
}
static int height(int idx) {
  int l, r;
  if (idx < 0) return 0;
  l = height(tree[idx].left); r = height(tree[idx].right);
  return 1 + (l > r ? l : r);
}

int main(void) {
  struct node *a = 0, *b = 0, *n;
  int keys[12] = { 50, 30, 70, 20, 40, 60, 80, 35, 45, 65, 10, 75 };
  int i;

  for (i = 1; i <= 6; i++) a = push(a, i * i);
  print_list("pushed", a);
  a = reverse(a);
  print_list("reversed", a);
  for (i = 0; i < 9; i++) b = insert_sorted(b, (i * 37) % 23 - 5);
  print_list("sorted", b);
  show("len a", list_len(a));
  show("len b", list_len(b));
  show("pool_used", pool_used);
  show("b head idx", (int)(b - pool));
  for (n = b; n->next; n = n->next) ;
  show("b tail idx", (int)(n - pool));
  n->next = a;   /* splice */
  show("len spliced", list_len(b));

  for (i = 0; i < 12; i++) troot = tinsert(troot, keys[i]);
  puts_("inorder: ");
  inorder(troot);
  nl();
  show("tcount", tcount);
  show("height", height(troot));
  show("root left key", tree[tree[troot].left].key);
  show("node 7 key", tree[7].key);
  showu("walk_chk", walk_chk);
  return (int)((walk_chk + (unsigned)list_len(b)) & 0xff);
}
