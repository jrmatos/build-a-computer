#include <stdio.h>
#include <limits.h>

int main(void)
{
    int n;
    printf("plain text\n");
    printf("%d %i %d %d\n", 0, 42, -42, 2147483647);
    printf("%d\n", INT_MIN);
    printf("%u %u\n", 3000000000u, 4294967295u);
    printf("%x %X %o\n", 255, 0xbeef, 8);
    printf("%c%c%c\n", 'a', 'b', 'c');
    printf("[%s] [%s]\n", "hello", "");
    printf("100%%\n");
    printf("[%5d] [%-5d] [%05d] [%-05d]\n", 42, 42, 42, 42);
    printf("[%05d] [%5d] [%08x]\n", -42, -42, 0xabc);
    printf("[%8s] [%-8s] [%.3s] [%5.2s]\n", "abc", "abc", "abcdef", "xyz");
    printf("[%3c] [%-3c]\n", 'x', 'y');
    printf("[%*d] [%-*d]\n", 4, 7, 4, 7);
    printf("%ld %lu %hd %lx\n", 5L, 6UL, 7, 0x10L);
    printf("%p %p\n", (void *)0x80001234, (void *)0);
    printf("%s\n", (char *)0);
    printf("%q\n");
    n = printf("count me\n");
    printf("%d\n", n);
    return 0;
}
