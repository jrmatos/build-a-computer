/* stdlib.h: heap memory, number conversion, random numbers and exit. */
#ifndef _STDLIB_H
#define _STDLIB_H

#include <stddef.h>

#define EXIT_SUCCESS 0
#define EXIT_FAILURE 1
#define RAND_MAX 32767

void *malloc(size_t size);
void free(void *ptr);
void *calloc(size_t count, size_t size);
void *realloc(void *ptr, size_t size);

int atoi(const char *s);
int abs(int x);
int rand(void);
void srand(unsigned int seed);

void exit(int code);
void abort(void);

#endif
