/*
 * Freestanding support linked into every freestanding corpus program, for
 * both compilers: compilers may lower struct copies and zeroing to calls to
 * memcpy/memset/memmove even with -ffreestanding.
 */
typedef unsigned int size_t;

void *memcpy(void *dst, const void *src, size_t n) {
  unsigned char *d = (unsigned char *)dst;
  const unsigned char *s = (const unsigned char *)src;
  while (n > 0) { *d++ = *s++; n--; }
  return dst;
}

void *memmove(void *dst, const void *src, size_t n) {
  unsigned char *d = (unsigned char *)dst;
  const unsigned char *s = (const unsigned char *)src;
  if (d < s) {
    while (n > 0) { *d++ = *s++; n--; }
  } else {
    while (n > 0) { n--; d[n] = s[n]; }
  }
  return dst;
}

void *memset(void *dst, int c, size_t n) {
  unsigned char *d = (unsigned char *)dst;
  while (n > 0) { *d++ = (unsigned char)c; n--; }
  return dst;
}
