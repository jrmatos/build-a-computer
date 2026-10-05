/* assert.h: assert(condition) prints a message and exits with code 134 when the condition is false. */
#ifndef _ASSERT_H
#define _ASSERT_H

void __assert_fail(const char *expr, const char *file, int line);

#ifdef NDEBUG
#define assert(e) ((void)0)
#else
#define assert(e) ((e) ? (void)0 : __assert_fail(#e, __FILE__, __LINE__))
#endif

#endif
