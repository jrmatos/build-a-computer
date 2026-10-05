/*
 * fs.c: reading the file system. Yours to write.
 *
 *   sector 1        superblock (struct superblock)
 *   inodestart ...  inode table: IPS (8) inodes of 64 bytes per sector
 *   datastart ...   file contents, directories, indirect sectors
 *
 * Inode 1 is the root directory: struct dirent entries of 16 bytes. An inode
 * lists its sectors: addrs[0..11] direct, addrs[12] an indirect sector
 * holding 128 more sector numbers. disk_read(sector, buf) reads 512 bytes.
 */
#include "kernel.h"

struct superblock sb;

/* Read the superblock into sb. -1 on a disk error or when sb.magic != FS_MAGIC. */
int fs_init(void) {
  /* TODO */
  return -1;
}

/* Copy inode inum into *ip. -1 for inum 0, inum >= sb.ninodes, a disk error or a free inode (type 0). */
int inode_read(uint inum, struct dinode *ip) {
  /* TODO */
  return -1;
}

/* The sector holding block bn of the file: direct, or through the indirect sector. 0 if none. */
uint bmap(struct dinode *ip, uint bn) {
  /* TODO */
  return 0;
}

/* Copy up to n bytes from byte off of the file to dst, stopping at the end of the file.
   Returns the bytes copied (0 at or past the end), or -1 on a disk error. */
int readi(struct dinode *ip, char *dst, uint off, uint n) {
  /* TODO */
  return -1;
}

/* The inode number of the root directory's entry called name, or 0. Names fill at most
   DIRSIZ (12) bytes and have no terminating 0 when they are 12 long. */
uint dir_lookup(char *name) {
  /* TODO */
  return 0;
}
