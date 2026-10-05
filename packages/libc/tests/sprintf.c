#include <stdio.h>
#include <string.h>

int main(void)
{
    char buf[32];
    char small[6];
    int n;

    n = sprintf(buf, "x=%d y=%s", 12, "ab");
    printf("%s|%d|%d\n", buf, n, (int)strlen(buf));

    n = snprintf(small, sizeof small, "%s", "truncated");
    printf("%s|%d\n", small, n);

    n = snprintf(small, sizeof small, "%d", 12345);
    printf("%s|%d\n", small, n);

    n = snprintf(buf, 0, "%d", 99);
    printf("%d\n", n);

    sprintf(buf, "%04x-%c", 0x1f, 'z');
    puts(buf);
    return 0;
}
