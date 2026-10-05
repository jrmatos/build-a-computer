#include <stdio.h>
#include <stdlib.h>

static int **mat_alloc(int rows, int cols) {
  int i;
  int **m = (int **)malloc((unsigned)rows * sizeof(int *));
  if (!m) return 0;
  for (i = 0; i < rows; i++) m[i] = (int *)malloc((unsigned)cols * sizeof(int));
  return m;
}
static void mat_free(int **m, int rows) {
  int i;
  for (i = 0; i < rows; i++) free(m[i]);
  free(m);
}
static void mat_mul(int **a, int **b, int **c, int n, int k, int p) {
  int i, j, x;
  for (i = 0; i < n; i++)
    for (j = 0; j < p; j++) {
      int s = 0;
      for (x = 0; x < k; x++) s += a[i][x] * b[x][j];
      c[i][j] = s;
    }
}
static void mat_print(const char *name, int **m, int rows, int cols) {
  int i, j;
  printf("%s (%dx%d):\n", name, rows, cols);
  for (i = 0; i < rows; i++) {
    for (j = 0; j < cols; j++) printf(j ? " %d" : "%d", m[i][j]);
    printf("\n");
  }
}
static unsigned mat_sum(int **m, int rows, int cols) {
  unsigned s = 0;
  int i, j;
  for (i = 0; i < rows; i++) for (j = 0; j < cols; j++) s += (unsigned)m[i][j] * (unsigned)(i + 2 * j + 1);
  return s;
}

int main(void) {
  int n = 4, k = 5, p = 3, i, j, step;
  int **a = mat_alloc(n, k);
  int **b = mat_alloc(k, p);
  int **c = mat_alloc(n, p);
  int **sq, **sq2, **tmp;
  unsigned check;
  for (i = 0; i < n; i++) for (j = 0; j < k; j++) a[i][j] = (i + 1) * (j - 2);
  for (i = 0; i < k; i++) for (j = 0; j < p; j++) b[i][j] = (i * 3 + j) % 5 - 1;
  mat_mul(a, b, c, n, k, p);
  mat_print("A", a, n, k);
  mat_print("B", b, k, p);
  mat_print("C=A*B", c, n, p);
  check = mat_sum(c, n, p);
  mat_free(a, n);
  mat_free(b, k);
  mat_free(c, n);
  /* repeated squaring of a 6x6 matrix (fibonacci-like growth, kept small) */
  n = 6;
  sq = mat_alloc(n, n);
  sq2 = mat_alloc(n, n);
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) sq[i][j] = (j == i + 1) || (i == n - 1 && j == 0) || (i == j && i % 2);
  for (step = 0; step < 4; step++) {
    mat_mul(sq, sq, sq2, n, n, n);
    tmp = sq; sq = sq2; sq2 = tmp;
  }
  mat_print("M^16", sq, n, n);
  check ^= mat_sum(sq, n, n);
  mat_free(sq, n);
  mat_free(sq2, n);
  printf("check=%u\n", check);
  return (int)(check & 0xff);
}
