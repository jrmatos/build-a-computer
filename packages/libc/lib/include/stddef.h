/* stddef.h: basic types. On RV32 (ilp32) int, long and pointers are 32 bits. */
#ifndef _STDDEF_H
#define _STDDEF_H

typedef unsigned int size_t;
typedef int ptrdiff_t;

#define NULL ((void *)0)

/* Byte offset of a member inside a struct (the compiler knows the layout). */
#define offsetof(type, member) __builtin_offsetof(type, member)

#endif
