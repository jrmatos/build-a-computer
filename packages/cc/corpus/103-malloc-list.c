#include <stdio.h>
#include <stdlib.h>

struct node { int value; struct node *next; };

static struct node *new_node(int v, struct node *next) {
  struct node *n = (struct node *)malloc(sizeof(struct node));
  if (!n) return 0;
  n->value = v;
  n->next = next;
  return n;
}
static int list_sum(const struct node *h) { int s = 0; while (h) { s += h->value; h = h->next; } return s; }
static int list_len(const struct node *h) { int n = 0; while (h) { n++; h = h->next; } return n; }
static struct node *remove_evens(struct node *h, int *freed) {
  struct node **pp = &h;
  while (*pp) {
    if ((*pp)->value % 2 == 0) {
      struct node *d = *pp;
      *pp = d->next;
      free(d);
      (*freed)++;
    } else pp = &(*pp)->next;
  }
  return h;
}
static void free_all(struct node *h) { while (h) { struct node *n = h->next; free(h); h = n; } }
static void print_head(const struct node *h, int k) {
  while (h && k-- > 0) { printf("%d ", h->value); h = h->next; }
  printf("\n");
}

int main(void) {
  struct node *head = 0, *tail = 0;
  int i, freed = 0, round;
  unsigned check = 0;
  for (i = 1; i <= 100; i++) {
    struct node *n = new_node(i, 0);
    if (!n) { puts("oom"); return 1; }
    if (tail) tail->next = n; else head = n;
    tail = n;
  }
  printf("len=%d sum=%d\n", list_len(head), list_sum(head));
  print_head(head, 10);
  head = remove_evens(head, &freed);
  printf("freed=%d len=%d sum=%d\n", freed, list_len(head), list_sum(head));
  print_head(head, 10);
  free_all(head);
  head = 0;
  for (round = 0; round < 5; round++) {
    for (i = 0; i < 60; i++) head = new_node(i * (round + 1), head);
    check = check * 31u + (unsigned)list_sum(head);
    printf("round %d len=%d sum=%d\n", round, list_len(head), list_sum(head));
    if (round % 2) { free_all(head); head = 0; }
    else { freed = 0; head = remove_evens(head, &freed); printf("  freed %d\n", freed); }
  }
  print_head(head, 8);
  free_all(head);
  printf("check=%u\n", check);
  return (int)(check & 0xff);
}
