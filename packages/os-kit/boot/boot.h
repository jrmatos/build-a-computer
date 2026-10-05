/*
 * boot.h: what the bootloader needs to know about the machine and the disk.
 *
 * Sector 0 of a bootable disk is the boot block. It starts with a header
 * (struct boothdr) that says where the kernel image is on the disk, where
 * it must go in RAM, and where to jump.
 */
#ifndef BOOT_H
#define BOOT_H

typedef unsigned int uint;
typedef unsigned char uchar;

/* Block device (docs/devices.md): word registers, then a 512-byte buffer. */
#define BLK_SECTOR 0x10002000    /* sector number for the next command */
#define BLK_COMMAND 0x10002004   /* write 1: read the sector into the buffer */
#define BLK_STATUS 0x10002008    /* 0 = done, 1 = error */
#define BLK_BUFFER 0x10002200    /* the sector's 512 bytes */
#define SECTOR_SIZE 512

#define BOOT_MAGIC 0x544F4F42    /* "BOOT" in little-endian bytes */

struct boothdr {
  uint magic;                    /* BOOT_MAGIC, or this is not a boot disk */
  uint load;                     /* RAM address to copy the image to */
  uint entry;                    /* where to jump once it is there */
  uint start;                    /* first sector of the image */
  uint count;                    /* number of sectors */
  uint size;                     /* bytes of image (the last sector may be partly used) */
  uint checksum;                 /* sum of the image's bytes, modulo 2^32 */
};

/* bootlib.c: printing on the UART */
void boot_print(char *s);
void boot_print_dec(uint n);
void boot_print_hex(uint n);

/* bootlib.s: jump to entry with a0, a1, a2 set. Never returns. */
void boot_jump(uint entry, uint a0, uint a1, uint a2);

#endif
