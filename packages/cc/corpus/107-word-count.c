#include <stdio.h>
#include <string.h>

static const char text[] =
  "It was the best of times, it was the worst of times,\n"
  "it was the age of wisdom, it was the age of foolishness,\n"
  "it was the epoch of belief, it was the epoch of incredulity,\n"
  "it was the season of Light, it was the season of Darkness,\n"
  "it was the spring of hope, it was the winter of despair.\n";

static int is_letter(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
static char lower(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c - 'A' + 'a') : c; }

#define MAXW 64
static char words[MAXW][16];
static int wcount[MAXW];
static int nuniq;

static void add_word(const char *w) {
  int i;
  for (i = 0; i < nuniq; i++) if (strcmp(words[i], w) == 0) { wcount[i]++; return; }
  if (nuniq < MAXW) { memcpy(words[nuniq], w, strlen(w) + 1); wcount[nuniq++] = 1; }
}

int main(void) {
  int letters[26];
  int i, lines = 0, nwords = 0, chars = 0, longest = 0, wl = 0, best = 0;
  char cur[16];
  char longest_word[16];
  memset(letters, 0, sizeof(letters));
  longest_word[0] = 0;
  for (i = 0; text[i]; i++) {
    char c = text[i];
    chars++;
    if (c == '\n') lines++;
    if (is_letter(c)) {
      letters[lower(c) - 'a']++;
      if (wl < 15) cur[wl++] = lower(c);
    } else if (wl) {
      cur[wl] = 0;
      nwords++;
      add_word(cur);
      if (wl > longest) { longest = wl; memcpy(longest_word, cur, (unsigned)wl + 1); }
      wl = 0;
    }
  }
  printf("lines=%d words=%d chars=%d strlen=%u\n", lines, nwords, chars, (unsigned)strlen(text));
  printf("longest word: %s (%d)\n", longest_word, longest);
  printf("unique words: %d\n", nuniq);
  for (i = 0; i < nuniq; i++) {
    printf("%s:%d ", words[i], wcount[i]);
    if (wcount[i] > wcount[best]) best = i;
  }
  printf("\nmost common: %s x%d\n", words[best], wcount[best]);
  for (i = 0; i < 26; i++) {
    if (letters[i]) printf("%c=%d%c", 'a' + i, letters[i], i % 8 == 7 ? '\n' : ' ');
  }
  printf("\n");
  return (nwords + nuniq) & 0xff;
}
