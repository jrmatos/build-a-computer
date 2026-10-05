#include <stdio.h>
#include <string.h>

enum dept { ENG, OPS, SALES, NDEPT };
static const char *dept_names[NDEPT] = { "eng", "ops", "sales" };

struct employee {
  int id;
  const char *name;
  enum dept dept;
  unsigned salary;
  int delta;
  char grade;
};

static struct employee staff[] = {
  { 101, "Ada", ENG, 120000u, 5, 'A' },
  { 102, "Grace", ENG, 135000u, -2, 'A' },
  { 203, "Linus", OPS, 99000u, 0, 'B' },
  { 204, "Ken", OPS, 87000u, 12, 'C' },
  { 305, "Barbara", SALES, 76000u, -7, 'B' },
  { 306, "Dennis", SALES, 81000u, 3, 'B' },
  { 107, "Margaret", ENG, 142000u, 8, 'A' },
};
#define NSTAFF ((int)(sizeof(staff) / sizeof(staff[0])))

static void pad(const char *s, int width) {
  int n = (int)strlen(s);
  printf("%s", s);
  while (n++ < width) putchar(' ');
}
static void sort_by_salary(struct employee *e, int n) {
  int i, j;
  for (i = 1; i < n; i++) {
    struct employee k = e[i];
    for (j = i - 1; j >= 0 && e[j].salary < k.salary; j--) e[j + 1] = e[j];
    e[j + 1] = k;
  }
}

int main(void) {
  int i;
  unsigned totals[NDEPT];
  int counts[NDEPT];
  unsigned grand = 0;
  memset(totals, 0, sizeof(totals));
  memset(counts, 0, sizeof(counts));
  printf("id   name      dept   salary  delta grade\n");
  printf("---- --------- ------ ------- ----- -----\n");
  for (i = 0; i < NSTAFF; i++) {
    const struct employee *e = &staff[i];
    printf("%d  ", e->id);
    pad(e->name, 10);
    pad(dept_names[e->dept], 7);
    printf("%u  %d%% %c\n", e->salary, e->delta, e->grade);
    totals[e->dept] += e->salary;
    counts[e->dept]++;
    grand += e->salary;
  }
  printf("\nper department:\n");
  for (i = 0; i < NDEPT; i++)
    printf("%s: n=%d total=%u avg=%u hex=%x\n", dept_names[i], counts[i], totals[i],
           counts[i] ? totals[i] / (unsigned)counts[i] : 0u, totals[i]);
  sort_by_salary(staff, NSTAFF);
  printf("\nby salary:\n");
  for (i = 0; i < NSTAFF; i++) printf("%d. %s (%s) %u\n", i + 1, staff[i].name, dept_names[staff[i].dept], staff[i].salary);
  printf("grand total %u, struct copy check %s\n", grand, staff[0].grade == 'A' ? "ok" : "bad");
  return (int)(grand / 1000u % 256u);
}
