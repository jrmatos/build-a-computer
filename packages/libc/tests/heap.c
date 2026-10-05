#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern char _end[];

static void check(int ok, const char *what)
{
    printf("%s: %s\n", ok ? "ok" : "FAIL", what);
}

int main(void)
{
    char *a;
    char *b;
    char *c;
    char *d;
    int *nums;
    int *more;
    int i;
    int sum;
    int count;
    void *blocks[64];

    a = malloc(10);
    b = malloc(10);
    c = malloc(100);
    check(a != NULL && b != NULL && c != NULL, "three blocks");
    check(a >= _end, "heap starts after the globals");
    check(((unsigned int)a & 7) == 0 && ((unsigned int)b & 7) == 0, "8-byte aligned");
    check(b >= a + 10 && c >= b + 10, "blocks do not overlap");
    strcpy(a, "123456789");
    strcpy(b, "abcdefghi");
    check(strcmp(a, "123456789") == 0, "writing b leaves a alone");

    free(b);
    d = malloc(8);
    check(d == b, "first fit reuses the freed block");
    free(d);

    free(a);
    d = malloc(30);
    check(d == a, "a and b merged into one free block");
    free(d);

    free(c);
    d = malloc(150);
    check(d == a, "everything merged back together");
    free(d);
    free(NULL);

    nums = calloc(10, sizeof(int));
    sum = 0;
    for (i = 0; i < 10; i++)
        sum = sum + nums[i];
    check(sum == 0, "calloc zeroes");
    for (i = 0; i < 10; i++)
        nums[i] = i;
    more = realloc(nums, 1000 * sizeof(int));
    sum = 0;
    for (i = 0; i < 10; i++)
        sum = sum + more[i];
    check(sum == 45, "realloc keeps the contents");
    free(more);

    check(malloc(0) == NULL, "malloc(0) is NULL");
    check(malloc(0x7fffffff) == NULL, "too big is NULL");
    check(calloc(0x10000, 0x10000) == NULL, "calloc overflow is NULL");

    /* Fill the heap until malloc gives up, then give it all back. */
    count = 0;
    while (count < 64) {
        blocks[count] = malloc(20000);
        if (blocks[count] == NULL)
            break;
        count++;
    }
    check(count > 10 && count < 64, "the heap runs out before the stack");
    for (i = 0; i < count; i++)
        free(blocks[i]);
    d = malloc(20000 * 10);
    check(d == a, "all of it can be used again");
    return 0;
}
