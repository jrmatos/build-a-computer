#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>

int zeroed[100];
int counter;

static int sum(int count, ...)
{
    va_list ap;
    int total = 0;
    int i;
    va_start(ap, count);
    for (i = 0; i < count; i++)
        total = total + va_arg(ap, int);
    va_end(ap);
    return total;
}

static void finish(int code)
{
    printf("bye\n");
    exit(code);
}

int main(void)
{
    int i;
    int total = 0;
    bool flag = true;
    uint8_t byte = 250;

    for (i = 0; i < 100; i++)
        total = total + zeroed[i];
    printf("bss %d %d\n", total, counter);

    printf("%d %d %d %d\n", atoi("123"), atoi("  -45x"), atoi("+7"), atoi("abc"));
    printf("%d %d %d\n", abs(-5), abs(5), abs(0));

    printf("%d%d%d%d ", isdigit('7'), isdigit('a'), isalpha('Q'), isalpha('1'));
    printf("%d%d%d%d ", isspace(' '), isspace('\n'), isspace('x'), isxdigit('F'));
    printf("%d%d%d%d ", isupper('A'), islower('A'), isalnum('_'), ispunct('!'));
    printf("%c%c%c%c\n", toupper('a'), tolower('B'), toupper('1'), tolower('z'));

    srand(1);
    printf("%d %d %d\n", rand(), rand(), rand());
    srand(42);
    printf("%d\n", rand());

    printf("%d %d %d\n", sum(0), sum(3, 1, 2, 3), sum(10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
    byte = byte + 10;
    printf("%d %d\n", flag, byte);

    finish(42);
    return 0;
}
