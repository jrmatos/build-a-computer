/* string.c: strings and memory blocks, one byte at a time. */
#include <string.h>

size_t strlen(const char *s)
{
    size_t n = 0;
    while (s[n] != '\0')
        n++;
    return n;
}

/* Compare as unsigned bytes: < 0, 0 or > 0 like a - b. */
int strcmp(const char *a, const char *b)
{
    while (*a != '\0' && *a == *b) {
        a++;
        b++;
    }
    return (unsigned char)*a - (unsigned char)*b;
}

int strncmp(const char *a, const char *b, size_t n)
{
    while (n > 0 && *a != '\0' && *a == *b) {
        a++;
        b++;
        n--;
    }
    if (n == 0)
        return 0;
    return (unsigned char)*a - (unsigned char)*b;
}

char *strcpy(char *dst, const char *src)
{
    char *d = dst;
    while ((*d = *src) != '\0') {
        d++;
        src++;
    }
    return dst;
}

/* Copies at most n bytes; pads with '\0' up to n. Not terminated if src is too long. */
char *strncpy(char *dst, const char *src, size_t n)
{
    size_t i = 0;
    while (i < n && src[i] != '\0') {
        dst[i] = src[i];
        i++;
    }
    while (i < n) {
        dst[i] = '\0';
        i++;
    }
    return dst;
}

char *strcat(char *dst, const char *src)
{
    strcpy(dst + strlen(dst), src);
    return dst;
}

/* First c in s, or NULL. Searching for '\0' finds the terminator. */
char *strchr(const char *s, int c)
{
    for (;;) {
        if (*s == (char)c)
            return (char *)s;
        if (*s == '\0')
            return NULL;
        s++;
    }
}

/* Last c in s, or NULL. */
char *strrchr(const char *s, int c)
{
    const char *last = NULL;
    for (;;) {
        if (*s == (char)c)
            last = s;
        if (*s == '\0')
            return (char *)last;
        s++;
    }
}

void *memcpy(void *dst, const void *src, size_t n)
{
    unsigned char *d = dst;
    const unsigned char *s = src;
    while (n > 0) {
        *d = *s;
        d++;
        s++;
        n--;
    }
    return dst;
}

/* Like memcpy, but the blocks may overlap: copy backwards when dst is after src. */
void *memmove(void *dst, const void *src, size_t n)
{
    unsigned char *d = dst;
    const unsigned char *s = src;
    if (d < s)
        return memcpy(dst, src, n);
    while (n > 0) {
        n--;
        d[n] = s[n];
    }
    return dst;
}

void *memset(void *dst, int c, size_t n)
{
    unsigned char *d = dst;
    while (n > 0) {
        *d = (unsigned char)c;
        d++;
        n--;
    }
    return dst;
}

int memcmp(const void *a, const void *b, size_t n)
{
    const unsigned char *x = a;
    const unsigned char *y = b;
    while (n > 0) {
        if (*x != *y)
            return *x - *y;
        x++;
        y++;
        n--;
    }
    return 0;
}
