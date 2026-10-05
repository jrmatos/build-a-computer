/*
 * stdio.h: text in and out through the UART console.
 * printf understands %d %i %u %x %X %o %c %s %p %% with a width, '0' and '-'
 * flags and a precision for %s; the l and h size letters are accepted and ignored.
 */
#ifndef _STDIO_H
#define _STDIO_H

#include <stddef.h>
#include <stdarg.h>

#define EOF (-1)

int putchar(int c);
int puts(const char *s);
int getchar(void); /* waits for a byte from the UART; never returns EOF */

int printf(const char *fmt, ...);
int sprintf(char *buf, const char *fmt, ...);
int snprintf(char *buf, size_t size, const char *fmt, ...);
int vprintf(const char *fmt, va_list ap);
int vsnprintf(char *buf, size_t size, const char *fmt, va_list ap);

#endif
