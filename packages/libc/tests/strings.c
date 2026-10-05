#include <stdio.h>
#include <string.h>

static int sign(int x)
{
    if (x < 0)
        return -1;
    if (x > 0)
        return 1;
    return 0;
}

int main(void)
{
    char buf[32];
    char pad[8];
    const char *s = "hello world";
    int i;

    printf("%d %d\n", (int)strlen(""), (int)strlen(s));
    printf("%d %d %d\n", sign(strcmp("abc", "abc")), sign(strcmp("abc", "abd")), sign(strcmp("b", "a")));
    printf("%d %d\n", sign(strcmp("ab", "abc")), sign(strcmp("\xff", "a")));
    printf("%d %d %d\n", strncmp("abcx", "abcy", 3), sign(strncmp("abcx", "abcy", 4)), strncmp("a", "b", 0));

    strcpy(buf, "foo");
    strcat(buf, "bar");
    strcat(buf, "!");
    puts(buf);

    memset(pad, 'z', sizeof pad);
    strncpy(pad, "ab", 5);
    for (i = 0; i < 8; i++)
        printf("%d ", pad[i]);
    printf("\n");

    printf("%s\n", strchr(s, 'o'));
    printf("%s\n", strrchr(s, 'o'));
    printf("%d %d\n", strchr(s, 'z') == NULL, strchr(s, '\0') == s + 11);

    strcpy(buf, "abcdefgh");
    memmove(buf + 2, buf, 4);
    puts(buf);
    strcpy(buf, "abcdefgh");
    memmove(buf, buf + 2, 4);
    puts(buf);
    memcpy(buf, "XY", 2);
    puts(buf);

    printf("%d %d %d\n", memcmp("abc", "abd", 2), sign(memcmp("abc", "abd", 3)), sign(memcmp("\x80", "\x01", 1)));
    return 0;
}
