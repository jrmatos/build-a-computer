/*
 * stdarg.h: functions with a variable number of arguments, like printf.
 * The compiler does the work: va_start saves the argument registers (a0-a7)
 * next to the stack arguments so va_arg can walk them as one array.
 */
#ifndef _STDARG_H
#define _STDARG_H

typedef __builtin_va_list va_list;

#define va_start(ap, last) __builtin_va_start(ap, last)
#define va_arg(ap, type) __builtin_va_arg(ap, type)
#define va_end(ap) __builtin_va_end(ap)
#define va_copy(dst, src) __builtin_va_copy(dst, src)

#endif
