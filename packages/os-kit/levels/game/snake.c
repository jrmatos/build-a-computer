/*
 * snake: the final project. A snake on a 32 x 20 grid of 10 x 10 pixel
 * cells. Every key is one step: w a s d turn (a turn straight back is
 * ignored), any other key goes straight on, q quits. Eating food grows the
 * snake by one and scores a point.
 */
#include "user.h"

#define W 32
#define H 20
#define CELL 10
#define BACKGROUND 0
#define BODY 10
#define HEAD 14
#define FOOD 12
#define MAXLEN (W * H)

unsigned char *fb;
int xs[MAXLEN];                  /* xs[0], ys[0] is the head */
int ys[MAXLEN];
int len;
int dx = 1;
int dy = 0;
int foodx;
int foody;
int score;
uint seed = 12345;

uint next_random(void) {
  seed = seed * 1103515245 + 12345;
  return (seed >> 16) & 0x7fff;
}

void fill_cell(int x, int y, int color) {
  unsigned char *row = fb + (y * CELL) * 320 + x * CELL;
  int i;
  int j;
  for (i = 0; i < CELL; i++) {
    for (j = 0; j < CELL; j++)
      row[j] = color;
    row = row + 320;
  }
}

int on_snake(int x, int y) {
  int i;
  for (i = 0; i < len; i++)
    if (xs[i] == x && ys[i] == y)
      return 1;
  return 0;
}

void place_food(void) {
  do {
    foodx = next_random() % W;
    foody = next_random() % H;
  } while (on_snake(foodx, foody));
  fill_cell(foodx, foody, FOOD);
}

/* One step. Returns 0 when the snake crashed. */
int step(void) {
  int nx = xs[0] + dx;
  int ny = ys[0] + dy;
  int i;
  int grow;
  if (nx < 0 || nx >= W || ny < 0 || ny >= H)
    return 0;
  for (i = 0; i < len - 1; i++)  /* the tail moves away, so it does not count */
    if (xs[i] == nx && ys[i] == ny)
      return 0;
  grow = nx == foodx && ny == foody;
  if (!grow)
    fill_cell(xs[len - 1], ys[len - 1], BACKGROUND);
  else
    len++;
  for (i = len - 1; i > 0; i--) {
    xs[i] = xs[i - 1];
    ys[i] = ys[i - 1];
  }
  fill_cell(xs[0], ys[0], BODY);
  xs[0] = nx;
  ys[0] = ny;
  fill_cell(nx, ny, HEAD);
  if (grow) {
    score++;
    place_food();
  }
  return 1;
}

int main(void) {
  int key;
  int i;
  fb = fbmap();
  for (i = 0; i < 320 * 200; i++)
    fb[i] = BACKGROUND;
  len = 3;
  for (i = 0; i < len; i++) {
    xs[i] = 5 - i;
    ys[i] = 10;
    fill_cell(xs[i], ys[i], BODY);
  }
  fill_cell(xs[0], ys[0], HEAD);
  place_food();
  print("snake! w a s d to turn, q to quit\n");
  for (;;) {
    key = getkey();
    if (key < 0)
      continue;                  /* no key yet */
    if (key == 'q') {
      print("bye! score ");
      printint(score);
      print("\n");
      return score;
    }
    if (key == 'w' && dy != 1) {
      dx = 0;
      dy = -1;
    } else if (key == 's' && dy != -1) {
      dx = 0;
      dy = 1;
    } else if (key == 'a' && dx != 1) {
      dx = -1;
      dy = 0;
    } else if (key == 'd' && dx != -1) {
      dx = 1;
      dy = 0;
    }
    if (!step()) {
      print("game over! score ");
      printint(score);
      print("\n");
      return score;
    }
  }
}
