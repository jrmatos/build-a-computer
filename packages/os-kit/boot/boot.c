/*
 * The bootloader: find the kernel on the disk, copy it into RAM, check it,
 * and jump to it.
 */
#include "boot.h"

#ifdef CONFIG_USERBOOT
extern char _ustart[];           /* ucrt.s: where the program starts */
extern char _end[];              /* end.s: the first byte after the program */
#endif

/* Read one sector into dst (512 bytes). Returns 0, or -1 on a disk error. */
int read_sector(uint sector, uchar *dst) {
  int i;
  *(volatile uint *)BLK_SECTOR = sector;
  *(volatile uint *)BLK_COMMAND = 1;
  if (*(volatile uint *)BLK_STATUS != 0)
    return -1;
  for (i = 0; i < SECTOR_SIZE; i++)
    dst[i] = *(volatile uchar *)(BLK_BUFFER + i);
  return 0;
}

#ifdef CONFIG_USERBOOT
int boot_main(void) {
#else
int main(void) {
#endif
  uchar block[SECTOR_SIZE];
  struct boothdr *h = (struct boothdr *)block;
  uchar *image;
  uint sum = 0;
  uint i;

  if (read_sector(0, block) < 0 || h->magic != BOOT_MAGIC) {
    boot_print("boot: no kernel on this disk\n");
    return 1;
  }
  image = (uchar *)h->load;
  for (i = 0; i < h->count; i++) {
    if (read_sector(h->start + i, image + i * SECTOR_SIZE) < 0) {
      boot_print("boot: disk error\n");
      return 3;
    }
  }
  for (i = 0; i < h->size; i++)
    sum = sum + image[i];
  if (sum != h->checksum) {
    boot_print("boot: bad checksum\n");
    return 2;
  }
#ifdef CONFIG_USERBOOT
  boot_jump(h->entry, 0, (uint)_ustart, (uint)_end);
#else
  boot_print("boot: loaded ");
  boot_print_dec(h->size);
  boot_print(" bytes at ");
  boot_print_hex(h->load);
  boot_print(", jumping to ");
  boot_print_hex(h->entry);
  boot_print("\n");
  boot_jump(h->entry, 0, 0, 0);
#endif
  return 0;
}
