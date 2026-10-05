#include <assert.h>
#include <stdio.h>

int main(void)
{
    int x = 3;
    assert(x == 3);
    printf("first passed\n");
    assert(x + 1 == 5);
    printf("not reached\n");
    return 0;
}
