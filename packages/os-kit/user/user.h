/*
 * user.h: what a program running on the kernel can call. The system calls
 * (usys.s) trap into the kernel with ecall; the rest (ulib.c) is ordinary
 * code in the program itself.
 */
#ifndef USER_H
#define USER_H

typedef unsigned int uint;

/* System calls. -1 means it failed. */
int write(int fd, void *buf, int n);
int read(int fd, void *buf, int n);
void exit(int code);
int getpid(void);
int yield(void);
int sleep(int ticks);
uint uptime(void);
int spawn(char *path, char **argv);
int wait(int *status);
void *sbrk(int n);
int freemem(void);
int open(char *path);
int close(int fd);
int readdir(int index, void *st);
unsigned char *fbmap(void);
int getkey(void);
int raw_syscall(int num, int a, int b, int c);

/* What readdir fills in. */
struct ustat {
  char name[16];
  uint size;
  uint type;
};

/* ulib.c */
int strlen(char *s);
int strcmp(char *a, char *b);
void *memset(void *dst, int c, int n);
void *memcpy(void *dst, void *src, int n);
int atoi(char *s);
void putchar(int c);
void print(char *s);
void printint(int n);
void printhex(uint n);

#endif
