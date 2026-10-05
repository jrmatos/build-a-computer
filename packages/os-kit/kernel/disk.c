/*
 * disk.c: the block device driver (docs/devices.md). Commands finish at
 * once, so reading a sector is: say which, say "read", copy the buffer.
 */
#include "kernel.h"

int disk_read(uint sector, void *buf) {
  uint *dst = buf;
  int i;
  *(volatile uint *)BLK = sector;
  *(volatile uint *)(BLK + 4) = 1;              /* COMMAND: read */
  if (*(volatile uint *)(BLK + 8) != 0)         /* STATUS: 0 = done */
    return -1;
  for (i = 0; i < SECTOR / 4; i++)
    dst[i] = *(volatile uint *)(BLK + 0x200 + 4 * i);
  return 0;
}
