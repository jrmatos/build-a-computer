#include <stdio.h>
#include <stdlib.h>

struct tree { int key; int count; struct tree *left, *right; };

static unsigned seed = 7u;
static unsigned lcg(void) { seed = seed * 1103515245u + 12345u; return (seed >> 16) & 0x7fffu; }

static int live_nodes;

static struct tree *insert(struct tree *t, int key) {
  if (!t) {
    t = (struct tree *)malloc(sizeof(struct tree));
    if (!t) return 0;
    t->key = key; t->count = 1; t->left = 0; t->right = 0;
    live_nodes++;
    return t;
  }
  if (key < t->key) t->left = insert(t->left, key);
  else if (key > t->key) t->right = insert(t->right, key);
  else t->count++;
  return t;
}
static int height(const struct tree *t) {
  int l, r;
  if (!t) return 0;
  l = height(t->left);
  r = height(t->right);
  return 1 + (l > r ? l : r);
}
static int size(const struct tree *t) { return t ? 1 + size(t->left) + size(t->right) : 0; }
static void inorder(const struct tree *t, unsigned *h) {
  if (!t) return;
  inorder(t->left, h);
  printf("%d ", t->key);
  *h = *h * 31u + (unsigned)t->key;
  inorder(t->right, h);
}
static struct tree *remove_key(struct tree *t, int key) {
  if (!t) return 0;
  if (key < t->key) t->left = remove_key(t->left, key);
  else if (key > t->key) t->right = remove_key(t->right, key);
  else {
    struct tree *r;
    if (!t->left || !t->right) {
      r = t->left ? t->left : t->right;
      free(t);
      live_nodes--;
      return r;
    }
    r = t->right;
    while (r->left) r = r->left;
    t->key = r->key;
    t->count = r->count;
    t->right = remove_key(t->right, r->key);
  }
  return t;
}
static int contains(const struct tree *t, int key) {
  while (t) {
    if (key == t->key) return 1;
    t = key < t->key ? t->left : t->right;
  }
  return 0;
}
static void free_tree(struct tree *t) {
  if (!t) return;
  free_tree(t->left);
  free_tree(t->right);
  free(t);
  live_nodes--;
}

int main(void) {
  struct tree *root = 0;
  int keys[50];
  int i, found = 0;
  unsigned h = 0;
  for (i = 0; i < 50; i++) {
    keys[i] = (int)(lcg() % 200u) - 50;
    root = insert(root, keys[i]);
  }
  printf("size=%d live=%d height=%d\n", size(root), live_nodes, height(root));
  inorder(root, &h);
  printf("\n");
  for (i = 0; i < 50; i += 3) root = remove_key(root, keys[i]);
  root = remove_key(root, 12345);
  printf("after delete size=%d live=%d height=%d\n", size(root), live_nodes, height(root));
  inorder(root, &h);
  printf("\n");
  for (i = -50; i < 150; i++) found += contains(root, i);
  printf("found=%d root=%d\n", found, root ? root->key : -1);
  free_tree(root);
  printf("live after free=%d hash=%u\n", live_nodes, h);
  return (int)(h % 256u);
}
