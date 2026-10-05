/*
 * snake: the final project. Yours to write; the level text has the rules.
 *
 * fbmap() maps the 320 x 200 framebuffer into your program and returns its
 * address (one byte per pixel, row by row). getkey() returns the next key,
 * or -1 when none is waiting.
 */
#include "user.h"

#define W 32
#define H 20
#define CELL 10
#define BACKGROUND 0
#define BODY 10
#define HEAD 14
#define FOOD 12

unsigned char *fb;
uint seed = 12345;

uint next_random(void) {
  seed = seed * 1103515245 + 12345;
  return (seed >> 16) & 0x7fff;
}

void fill_cell(int x, int y, int color) {
  /* TODO: a CELL x CELL square at pixel (x * CELL, y * CELL) */
}

int main(void) {
  int key;
  fb = fbmap();
  /* TODO: clear the screen, draw the snake and the first food */
  print("snake! w a s d to turn, q to quit\n");
  for (;;) {
    key = getkey();
    if (key < 0)
      continue;
    if (key == 'q') {
      print("bye! score 0\n");
      return 0;
    }
    /* TODO: turn, step, eat, crash */
  }
}
