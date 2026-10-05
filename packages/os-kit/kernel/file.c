/*
 * file.c: open files, as system calls see them. A file descriptor is a
 * small number naming a slot in the process's open-file table: fd 3 is
 * files[0], fd 4 is files[1], and so on (0, 1 and 2 are the console).
 */
#include "kernel.h"

static struct ofile *fd_slot(int fd) {
  if (fd < FD_FIRST || fd >= FD_FIRST + NFILE)
    return 0;
  if (current->files[fd - FD_FIRST].inum == 0)
    return 0;
  return &current->files[fd - FD_FIRST];
}

/* open(path): returns a new file descriptor, or -1. */
int file_open(uint path_uva) {
  char path[DIRSIZ + 1];
  uint inum;
  int i;
  if (copyinstr(path, path_uva, DIRSIZ + 1) < 0)
    return -1;
  inum = dir_lookup(path);
  if (inum == 0)
    return -1;
  for (i = 0; i < NFILE; i++) {
    if (current->files[i].inum == 0) {
      current->files[i].inum = inum;
      current->files[i].off = 0;
      return FD_FIRST + i;
    }
  }
  return -1;
}

/* read(fd, buf, n) for a file: returns the bytes read, 0 at the end of the file. */
int file_read(int fd, uint uva, uint n) {
  struct ofile *f = fd_slot(fd);
  struct dinode ip;
  char buf[128];
  uint done = 0;
  int k;
  if (f == 0 || inode_read(f->inum, &ip) < 0)
    return -1;
  while (done < n) {
    k = n - done;
    if (k > 128)
      k = 128;
    k = readi(&ip, buf, f->off, k);
    if (k < 0)
      return -1;
    if (k == 0)
      break;
    if (copyout(uva + done, buf, k) < 0)
      return -1;
    f->off = f->off + k;
    done = done + k;
  }
  return done;
}

int file_close(int fd) {
  struct ofile *f = fd_slot(fd);
  if (f == 0)
    return -1;
  f->inum = 0;
  return 0;
}

/* readdir(i, &st): fill st with the i-th file of the root directory; -1 past the end. */
int file_readdir(uint index, uint out_uva) {
  struct dinode root;
  struct dinode ip;
  struct dirent de;
  struct ustat st;
  uint off;
  uint n = 0;
  int i;
  if (inode_read(ROOT_INUM, &root) < 0)
    return -1;
  for (off = 0; off < root.size; off = off + sizeof(struct dirent)) {
    if (readi(&root, (char *)&de, off, sizeof(struct dirent)) != sizeof(struct dirent))
      return -1;
    if (de.inum == 0)
      continue;
    if (n == index) {
      if (inode_read(de.inum, &ip) < 0)
        return -1;
      kmemset(&st, 0, sizeof(struct ustat));
      for (i = 0; i < DIRSIZ && de.name[i]; i++)
        st.name[i] = de.name[i];
      st.size = ip.size;
      st.type = ip.type;
      return copyout(out_uva, &st, sizeof(struct ustat));
    }
    n++;
  }
  return -1;
}
