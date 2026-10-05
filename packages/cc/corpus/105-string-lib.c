#include <stdio.h>
#include <string.h>

static const char *sign(int v) { return v < 0 ? "<0" : (v > 0 ? ">0" : "0"); }

static const char *strs[] = { "", "a", "abc", "abd", "ab", "ABC", "abc\xff", "zzz", "hello world" };
#define NS ((int)(sizeof(strs) / sizeof(strs[0])))

int main(void) {
  char buf[64];
  char dst[32];
  int i, j;
  unsigned check = 0;
  for (i = 0; i < NS; i++) {
    printf("strlen(\"%s\") = %u\n", strs[i], (unsigned)strlen(strs[i]));
    check += (unsigned)strlen(strs[i]);
  }
  for (i = 0; i < NS; i++) {
    for (j = 0; j < NS; j++) {
      int c = strcmp(strs[i], strs[j]);
      printf("%s ", sign(c));
      check = check * 3u + (unsigned)(c < 0 ? 0 : c > 0 ? 2 : 1);
    }
    printf("\n");
  }
  printf("high byte vs ascii: %s\n", sign(strcmp("\x80", "a")));
  memset(buf, 'x', sizeof(buf));
  buf[63] = 0;
  printf("%s\n", buf + 50);
  memset(buf, 0, 10);
  printf("after memset0 len=%u\n", (unsigned)strlen(buf));
  memcpy(buf, "copy me", 8);
  printf("%s len=%u\n", buf, (unsigned)strlen(buf));
  memcpy(dst, buf, strlen(buf) + 1);
  printf("dst=%s cmp=%s\n", dst, sign(strcmp(dst, buf)));
  dst[0] = 'C';
  printf("dst=%s cmp=%s\n", dst, sign(strcmp(dst, buf)));
  /* memcpy of non-char data */
  {
    int a[5], b[5];
    unsigned s = 0;
    for (i = 0; i < 5; i++) a[i] = i * 1000 - 2000;
    memcpy(b, a, sizeof(a));
    for (i = 0; i < 5; i++) s += (unsigned)b[i] * (unsigned)(i + 1);
    printf("int copy sum %d\n", (int)s);
    memset(b, 0xff, sizeof(b));
    printf("memset ff -> %d %x\n", b[2], (unsigned)b[4]);
    check += s;
  }
  /* return values */
  printf("memcpy ret ok %d memset ret ok %d\n",
         memcpy(dst, "zz", 3) == (void *)dst, memset(buf, 'q', 2) == (void *)buf);
  printf("%s %c%c\n", dst, buf[0], buf[1]);
  printf("check %u\n", check);
  return (int)(check % 256u);
}
