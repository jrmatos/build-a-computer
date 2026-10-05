#include <stdio.h>
#include <ctype.h>

/* Echo a line in upper case, then report its length. */
int main(void)
{
    int c;
    int n = 0;
    c = getchar();
    while (c != '\n') {
        putchar(toupper(c));
        n++;
        c = getchar();
    }
    printf("\n%d\n", n);
    return n;
}
