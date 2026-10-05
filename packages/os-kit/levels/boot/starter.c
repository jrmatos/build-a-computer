/*
 * The bootloader. The machine starts here with the kernel still on the
 * disk. Copy it into RAM and jump to it.
 *
 * Sector 0 holds struct boothdr (boot.h). Print exactly:
 *   no BOOT magic        "boot: no kernel on this disk\n", return 1
 *   checksum mismatch    "boot: bad checksum\n",           return 2
 *   otherwise            "boot: loaded <size> bytes at <load>, jumping to <entry>\n"
 *                        (boot_print_dec for size, boot_print_hex for the
 *                        addresses), then boot_jump(entry, 0, 0, 0).
 */
#include "boot.h"

/* Read one sector into dst (512 bytes). Returns 0, or -1 on a disk error. */
int read_sector(uint sector, uchar *dst) {
  /* TODO: write the sector number to BLK_SECTOR and 1 to BLK_COMMAND,
     check BLK_STATUS, then copy the 512 bytes from BLK_BUFFER. */
  return -1;
}

int main(void) {
  uchar block[SECTOR_SIZE];
  struct boothdr *h = (struct boothdr *)block;

  if (read_sector(0, block) < 0 || h->magic != BOOT_MAGIC) {
    boot_print("boot: no kernel on this disk\n");
    return 1;
  }
  /* TODO: read h->count sectors, starting at sector h->start, to h->load. */
  /* TODO: add up the h->size bytes of the image and compare with h->checksum. */
  /* TODO: print the "boot: loaded" line and jump to h->entry. */
  return 0;
}
