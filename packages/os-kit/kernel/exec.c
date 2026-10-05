/*
 * exec.c: building a process's address space and starting programs.
 *
 * A program file is a 20-byte header (struct exehdr) and an image linked at
 * USER_BASE. The loader gives the new process its own page table, copies
 * the image into fresh pages, maps a stack below USER_STACK_TOP, and puts
 * the arguments on that stack.
 */
#include "kernel.h"

#define PTE_OWNED 0x100          /* software bit: kalloc gave this page to the process */
#define MAXARG 8
#define MAXARGLEN 32

#ifndef CONFIG_FS
/* Without a file system, programs are built into the kernel (programs.s). */
struct progent {
  char *name;
  uchar *image;
  uint size;
};
extern struct progent programs[];

static struct progent *prog;

static int prog_open(char *path) {
  int i;
  for (i = 0; programs[i].name; i++) {
    if (kstreq(programs[i].name, path)) {
      prog = &programs[i];
      return 0;
    }
  }
  return -1;
}

static int prog_read(void *dst, uint off, uint n) {
  if (off > prog->size || n > prog->size - off)
    return -1;
  kmemcpy(dst, prog->image + off, n);
  return 0;
}
#endif

#ifdef CONFIG_FS
/* Programs are files in the root directory. */
static struct dinode prog;

static int prog_open(char *path) {
  uint inum = dir_lookup(path);
  if (inum == 0 || inode_read(inum, &prog) < 0 || prog.type != T_FILE)
    return -1;
  return 0;
}

static int prog_read(void *dst, uint off, uint n) {
  if (readi(&prog, dst, off, n) != n)
    return -1;
  return 0;
}
#endif

/* Free every page a process owns, its page tables, and the root table. */
void uvm_free(uint *pagetable) {
  uint *table;
  uint pte;
  int i;
  int j;
  if (pagetable == 0)
    return;
  for (i = 0; i < 1024; i++) {
    if (pagetable[i] & PTE_V) {
      table = (uint *)PTE2PA(pagetable[i]);
      for (j = 0; j < 1024; j++) {
        pte = table[j];
        if ((pte & PTE_V) && (pte & PTE_OWNED))
          kfree((void *)PTE2PA(pte));
      }
      kfree(table);
    }
  }
  kfree(pagetable);
}

/* Map a fresh zeroed page at va. Returns its physical address, or 0. */
static uint map_new(uint *pagetable, uint va, uint perm) {
  void *pa = kalloc();
  if (pa == 0)
    return 0;
  if (map_page(pagetable, va, (uint)pa, perm | PTE_OWNED) < 0) {
    kfree(pa);
    return 0;
  }
  return (uint)pa;
}

/*
 * Give p a page table with a stack, and below the stack a guard page mapped
 * *without* PTE_U: a program that overflows its stack faults instead of
 * running into other memory. Returns -1 when out of memory.
 */
static int new_space(struct proc *p) {
  int k;
  p->pagetable = kalloc();
  if (p->pagetable == 0)
    return -1;
  for (k = 1; k <= USER_STACK_PAGES; k++)
    if (map_new(p->pagetable, USER_STACK_TOP - k * PGSIZE, PTE_U | PTE_R | PTE_W) == 0)
      return -1;
  if (map_new(p->pagetable, USER_GUARD, PTE_R | PTE_W) == 0)
    return -1;
  p->tf.regs[REG_SP] = USER_STACK_TOP;
  return 0;
}

/* Load the program file at path into p's (new) address space. */
static int load(struct proc *p, char *path) {
  struct exehdr h;
  uint va;
  uint pa;
  uint perm;
  uint n;
  if (prog_open(path) < 0 || prog_read(&h, 0, sizeof(struct exehdr)) < 0)
    return -1;
  if (h.magic != EXE_MAGIC || h.filesz > h.memsz || h.memsz > USER_STACK_TOP - USER_BASE - 0x10000)
    return -1;
  for (va = 0; va < h.memsz; va = va + PGSIZE) {
    perm = PTE_U | PTE_R;
    if (va < h.textsz)
      perm = perm | PTE_X;       /* code */
    if (va + PGSIZE > h.textsz)
      perm = perm | PTE_W;       /* data */
    pa = map_new(p->pagetable, USER_BASE + va, perm);
    if (pa == 0)
      return -1;
    if (va < h.filesz) {
      n = h.filesz - va;
      if (n > PGSIZE)
        n = PGSIZE;
      if (prog_read((void *)pa, sizeof(struct exehdr) + va, n) < 0)
        return -1;
    }
  }
  p->heap_end = USER_BASE + ((h.memsz + PGSIZE - 1) & ~(PGSIZE - 1));
  p->tf.epc = h.entry;
  return 0;
}

/* Copy the arguments onto p's stack: the strings, then argv[] (a0 = argc, a1 = argv). */
static int push_args(struct proc *p, char *args, int argc) {
  uint sp = USER_STACK_TOP;
  uint ptrs[MAXARG + 1];
  uint len;
  int i;
  for (i = 0; i < argc; i++) {
    len = kstrlen(args + i * MAXARGLEN) + 1;
    sp = (sp - len) & ~3;
    if (copyout_pt(p->pagetable, sp, args + i * MAXARGLEN, len) < 0)
      return -1;
    ptrs[i] = sp;
  }
  ptrs[argc] = 0;
  sp = (sp - 4 * (argc + 1)) & ~15;
  if (copyout_pt(p->pagetable, sp, ptrs, 4 * (argc + 1)) < 0)
    return -1;
  p->tf.regs[REG_SP] = sp;
  p->tf.regs[REG_A0] = argc;
  p->tf.regs[REG_A1] = sp;
  return 0;
}

/*
 * Start the program at path as a child of the current process, with the
 * argument strings in the user array argv_uva (0-terminated; 0 = none, then
 * argv is just the path). Returns the child's pid, or -1.
 */
int spawn(char *path, uint argv_uva) {
  char args[MAXARG * MAXARGLEN];   /* argument i at args + i * MAXARGLEN */
  int argc = 0;
  uint ptr;
  int i;
  struct proc *p;
  if (argv_uva == 0) {
    for (i = 0; i < MAXARGLEN - 1 && path[i]; i++)
      args[i] = path[i];
    args[i] = 0;
    argc = 1;
  } else {
    for (;;) {
      if (copyin(&ptr, argv_uva + 4 * argc, 4) < 0)
        return -1;
      if (ptr == 0)
        break;
      if (argc == MAXARG || copyinstr(args + argc * MAXARGLEN, ptr, MAXARGLEN) < 0)
        return -1;
      argc++;
    }
  }
  p = proc_alloc();
  if (p == 0)
    return -1;
  if (new_space(p) < 0 || load(p, path) < 0 || push_args(p, args, argc) < 0) {
    uvm_free(p->pagetable);
    proc_free(p);
    return -1;
  }
  for (i = 0; i < 15 && path[i]; i++)
    p->name[i] = path[i];
  if (current)
    p->parent = current->pid;
  p->state = RUNNABLE;
  return p->pid;
}

#ifdef CONFIG_FS
/*
 * The first process when the bootloader brought a program along: its image
 * sits in RAM from RAM_BASE to end, linked there, so map it at the same
 * addresses (but not as owned: it is not kalloc's to free).
 */
struct proc *spawn_inmemory(uint entry, uint end) {
  struct proc *p = proc_alloc();
  uint va;
  if (p == 0 || new_space(p) < 0)
    panic("spawn_inmemory: out of memory");
  for (va = RAM_BASE; va < end; va = va + PGSIZE)
    if (map_page(p->pagetable, va, va, PTE_U | PTE_R | PTE_W | PTE_X) < 0)
      panic("spawn_inmemory: out of memory");
  kmemcpy(p->name, "init", 5);
  p->tf.epc = entry;
  p->heap_end = (end + PGSIZE - 1) & ~(PGSIZE - 1);
  p->state = RUNNABLE;
  return p;
}

/* fbmap(): map the framebuffer into the program; returns its address. */
uint sys_fbmap(void) {
  uint off;
  uint *pte;
  for (off = 0; off < FB_SIZE; off = off + PGSIZE) {
    pte = walk(current->pagetable, USER_FB + off, 0);
    if (pte && (*pte & PTE_V))
      continue;                  /* already mapped */
    if (map_page(current->pagetable, USER_FB + off, FB_PIXELS + off, PTE_U | PTE_R | PTE_W) < 0)
      return -1;
  }
  sfence_vma();
  *(volatile uint *)(FB_CONTROL + 8) = 1;      /* ENABLE: show the picture */
  return USER_FB;
}
#endif

/*
 * sbrk(n): grow the program's heap by n bytes. Returns the old end of the
 * heap (where the new bytes start), or -1 when memory is short.
 */
uint sys_sbrk(int n) {
  uint old = current->heap_end;
  uint top;
  uint va;
  uint need;
  if (n < 0 || n > 0x100000)
    return -1;
  top = old + n;
  if (top > USER_STACK_TOP - USER_STACK_PAGES * PGSIZE)
    return -1;
  /* Check first, so a failed sbrk leaves nothing half done (+1 for a page table). */
  need = (((top + PGSIZE - 1) & ~(PGSIZE - 1)) - ((old + PGSIZE - 1) & ~(PGSIZE - 1))) / PGSIZE;
  if (need > 0 && need + 1 > kfree_count())
    return -1;
  for (va = (old + PGSIZE - 1) & ~(PGSIZE - 1); va < top; va = va + PGSIZE)
    if (map_new(current->pagetable, va, PTE_U | PTE_R | PTE_W) == 0)
      return -1;
  current->heap_end = top;
  return old;
}
