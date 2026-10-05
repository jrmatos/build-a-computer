#include <stdio.h>

static const char *long_str =
  "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. "
  "Sphinx of black quartz, judge my vow!";

int main(void) {
  int n = 0;
  unsigned u = 4000000000u;
  int imin = -2147483647 - 1;
  printf("plain text line\n");
  printf("%d %d %d %d\n", 0, 1, -1, 42);
  printf("%d %d\n", 2147483647, imin);
  printf("neg: %d %d %d\n", -7, -100000, -2147483647);
  printf("%u %u %u\n", 0u, 123456789u, u);
  printf("%u\n", 4294967295u);
  printf("%u (as unsigned of -1)\n", (unsigned)-1);
  printf("%x %x %x\n", 0u, 0xdeadbeefu, 255u);
  printf("%x %x\n", 0x10u, 0xffffffffu);
  printf("[%s] [%s]\n", "", "x");
  printf("%s\n", long_str);
  printf("%c%c%c%c\n", 'a', 'B', '0', '!');
  printf("char %c in middle %c\n", 65, 'z');
  printf("100%% done, %%d literal, %d%%\n", 50);
  printf("many: %d %u %x %s %c %d %u %x %s %c %d\n",
         -1, 2u, 0xabcu, "four", '5', 6, 7u, 8u, "nine", 'X', -11);
  printf("%s=%d, %s=%d, %s=%d\n", "a", 1, "b", -2, "c", 3);
  for (n = 0; n < 5; n++) printf("%d:%x ", n * n * n, (unsigned)(n * 4096 + n));
  printf("\n");
  printf("%c", '\n');
  printf("tab\tseparated\tvalues\n");
  printf("%d%d%d%s%x\n", 1, 2, 3, "-", 0xcafeu);
  for (n = -3; n <= 3; n++) {
    printf("n=%d u=%u x=%x c=%c s=%s\n", n, (unsigned)n, (unsigned)n * 16u,
           'm' + n, n < 0 ? "neg" : (n ? "pos" : "zero"));
  }
  {
    static const char *names[] = { "alpha", "", "gamma delta", "%d not a format" };
    int i, total = 0;
    for (i = 0; i < 4; i++) {
      printf("<%s>", names[i]);
      total += i;
    }
    printf("\nindex total: %d\n", total);
  }
  printf("%x %x %x %x\n", 1u << 31, 0x7fffffffu, 0x0000abcdu, 0x10000000u);
  printf("%u%%%u%%\n", 1u, 99u);
  printf("end\n");
  return 101 % 256;
}
