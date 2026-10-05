/*
 * fs.c: reading the file system on the disk (docs/os.md, "On-disk format").
 *
 *   sector 0           boot block (the bootloader's; the file system ignores it)
 *   sector 1           superblock: where everything else is
 *   inodestart ...     inode table, 8 inodes of 64 bytes per sector
 *   datastart ...      data sectors: file contents, directories, indirect sectors
 *
 * Inode 1 is the root directory: an array of 16-byte entries (inode number,
 * 12-byte name). An inode lists its data sectors: 12 direct, then one
 * indirect sector holding 128 more.
 */
#include "kernel.h"

struct superblock sb;

/* Read the superblock. Returns -1 when the disk has no file system. */
int fs_init(void) {
  uint buf[SECTOR / 4];
  if (disk_read(SUPER_SECTOR, buf) < 0)
    return -1;
  kmemcpy(&sb, buf, sizeof(struct superblock));
  if (sb.magic != FS_MAGIC)
    return -1;
  return 0;
}

/* Copy inode inum from the inode table into *ip. Returns -1 for a bad or free inode. */
int inode_read(uint inum, struct dinode *ip) {
  uint buf[SECTOR / 4];
  if (inum == 0 || inum >= sb.ninodes)
    return -1;
  if (disk_read(sb.inodestart + inum / IPS, buf) < 0)
    return -1;
  kmemcpy(ip, (char *)buf + (inum % IPS) * sizeof(struct dinode), sizeof(struct dinode));
  if (ip->type == 0)
    return -1;
  return 0;
}

/* The disk sector that holds block bn of the file (0 when there is none). */
uint bmap(struct dinode *ip, uint bn) {
  uint buf[SECTOR / 4];
  if (bn < NDIRECT)
    return ip->addrs[bn];
  bn = bn - NDIRECT;
  if (bn >= NINDIRECT || ip->addrs[NDIRECT] == 0)
    return 0;
  if (disk_read(ip->addrs[NDIRECT], buf) < 0)
    return 0;
  return buf[bn];
}

/*
 * Copy up to n bytes of the file, starting at byte off, to dst. Stops at the
 * end of the file. Returns the number of bytes copied, or -1 on a disk error.
 */
int readi(struct dinode *ip, char *dst, uint off, uint n) {
  char buf[SECTOR];
  uint done = 0;
  uint sector;
  uint k;
  if (off >= ip->size)
    return 0;
  if (n > ip->size - off)
    n = ip->size - off;
  while (done < n) {
    sector = bmap(ip, (off + done) / SECTOR);
    if (sector == 0 || disk_read(sector, buf) < 0)
      return -1;
    k = SECTOR - (off + done) % SECTOR;
    if (k > n - done)
      k = n - done;
    kmemcpy(dst + done, buf + (off + done) % SECTOR, k);
    done = done + k;
  }
  return n;
}

/* Does the entry name (up to DIRSIZ bytes, maybe without a 0) equal s? */
static int name_is(char *name, char *s) {
  int i;
  for (i = 0; i < DIRSIZ; i++) {
    if (name[i] != s[i])
      return 0;
    if (s[i] == 0)
      return 1;
  }
  return s[DIRSIZ] == 0;
}

/* The inode number of the file called name in the root directory, or 0. */
uint dir_lookup(char *name) {
  struct dinode root;
  struct dirent de;
  uint off;
  if (inode_read(ROOT_INUM, &root) < 0)
    return 0;
  for (off = 0; off < root.size; off = off + sizeof(struct dirent)) {
    if (readi(&root, (char *)&de, off, sizeof(struct dirent)) != sizeof(struct dirent))
      return 0;
    if (de.inum != 0 && name_is(de.name, name))
      return de.inum;
  }
  return 0;
}
