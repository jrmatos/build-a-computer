/*
 * kernel.h: everything the kernel's files share. Read this first.
 *
 * The kernel runs in machine mode (M); programs run in user mode (U). Every
 * trap (system call, fault, timer interrupt) enters the kernel through
 * trap_vector, which saves the program's registers in its trap frame and
 * calls trap(). trap() returns the trap frame to resume, which may belong to
 * a different process: that is the whole context switch. docs/os.md has the
 * full design.
 */
#ifndef KERNEL_H
#define KERNEL_H

typedef unsigned int uint;
typedef unsigned char uchar;

/* ---------------------------------------------------------------- machine */

#define UART 0x10000000          /* byte registers: THR/RBR at +0, LSR at +5 */
#define KBD 0x10001000           /* STATUS +0, DATA +4 */
#define BLK 0x10002000           /* SECTOR +0, COMMAND +4, STATUS +8, BUFFER +0x200 */
#define FB_CONTROL 0x10003000    /* ENABLE at +8 */
#define FB_PIXELS 0x20000000     /* 320 x 200 bytes */
#define FB_SIZE 64000
#define MTIMECMP 0x02004000
#define MTIME 0x0200BFF8

#define RAM_BASE 0x80000000
#define RAM_END 0x80400000       /* 4 MiB of RAM */
#define KSTACK_TOP RAM_END       /* the one kernel stack grows down from here */
#define KSTACK_SIZE 0x4000       /* 16 KiB, never handed out as pages */
#define PGSIZE 4096

/* mcause values */
#define CAUSE_INTERRUPT 0x80000000
#define IRQ_TIMER 7
#define EXC_ILLEGAL 2
#define EXC_BREAKPOINT 3
#define EXC_LOAD_MISALIGNED 4
#define EXC_LOAD_FAULT 5
#define EXC_STORE_MISALIGNED 6
#define EXC_STORE_FAULT 7
#define EXC_ECALL_U 8
#define EXC_INST_PAGE_FAULT 12
#define EXC_LOAD_PAGE_FAULT 13
#define EXC_STORE_PAGE_FAULT 15

#define MSTATUS_MPP 0x1800       /* previous privilege: 0 = user, 3 = machine */
#define MIE_MTIE 0x80            /* timer interrupt enable (mie bit 7) */
#define MIP_MTIP 0x80            /* timer interrupt pending (mip bit 7) */

/* ------------------------------------------------------------- trap frame */

/*
 * A program's registers while the kernel runs. regs[i] holds register xi
 * (regs[0] is unused: x0 is always zero). trap_vector (trapvec.s) depends on
 * these byte offsets: regs[i] at 4*i, epc at 128, kstack at 132.
 */
struct trapframe {
  uint regs[32];
  uint epc;     /* where the program resumes (mepc) */
  uint kstack;  /* kernel stack pointer to use while handling its traps */
};

#define REG_RA 1
#define REG_SP 2
#define REG_A0 10
#define REG_A1 11
#define REG_A2 12
#define REG_A7 17

#ifdef CONFIG_SYSCALL
/* ------------------------------------------------------------ system calls */

/* Numbers follow Linux on RISC-V where one exists. */
#define SYS_read 63
#define SYS_write 64
#define SYS_exit 93
#define SYS_getpid 172
#ifdef CONFIG_PROC
#define SYS_yield 124
#endif
#ifdef CONFIG_TIMER
#define SYS_sleep 101
#define SYS_uptime 113
#endif
#ifdef CONFIG_VM
#define SYS_sbrk 214
#define SYS_spawn 220
#define SYS_wait 260
#define SYS_freemem 500
#endif
#ifdef CONFIG_FS
#define SYS_open 56
#define SYS_close 57
#define SYS_readdir 61
#define SYS_fbmap 501
#define SYS_getkey 502
#endif
#endif

#ifdef CONFIG_PROC
/* ------------------------------------------------------------- processes */

#define NPROC 8
#ifdef CONFIG_FS
#define NFILE 4                  /* open files per process (fd 3 to 6) */
#define FD_FIRST 3               /* 0, 1, 2 are the console */
#endif

#define UNUSED 0
#define RUNNABLE 1
#define RUNNING 2
#define SLEEPING 3
#define WAITING 4
#define ZOMBIE 5

#ifdef CONFIG_FS
/* An open file: which inode, and how far it has been read. */
struct ofile {
  uint inum;                     /* 0 = this slot is free */
  uint off;
};
#endif

struct proc {
  struct trapframe tf;           /* first, so a proc pointer is its trap frame */
  int pid;
  int state;
  int exitcode;
  char name[16];
#ifdef CONFIG_TIMER
  uint wake;                     /* SLEEPING: wake when mtime reaches this */
#endif
#ifdef CONFIG_VM
  int parent;                    /* pid of the parent, 0 = none */
  uint wait_status;              /* WAITING: user address for the child's exit code (0 = none) */
  uint *pagetable;               /* Sv32 root page table */
  uint heap_end;                 /* first byte past the program and its heap */
#endif
#ifdef CONFIG_FS
  struct ofile files[NFILE];
#endif
};

#endif

#ifdef CONFIG_VM
/* -------------------------------------------------------- virtual memory */

/* User virtual memory layout. */
#define USER_BASE 0x00010000     /* programs are linked and loaded here */
#define USER_STACK_TOP 0x01000000   /* 16 MiB: room for a big heap */
#define USER_STACK_PAGES 2
#define USER_GUARD (USER_STACK_TOP - (USER_STACK_PAGES + 1) * PGSIZE)   /* not PTE_U */
#define USER_FB 0x20000000       /* fbmap() maps the framebuffer here */

/* Sv32 page table entry bits. */
#define PTE_V 0x001
#define PTE_R 0x002
#define PTE_W 0x004
#define PTE_X 0x008
#define PTE_U 0x010
#define PTE_A 0x040
#define PTE_D 0x080
#define PTE_PPN(pte) ((pte) >> 10)          /* physical page number */
#define PA2PTE(pa) (((pa) >> 12) << 10)     /* physical address -> PTE (no flags) */
#define PTE2PA(pte) (((pte) >> 10) << 12)   /* PTE -> physical address */
#define VPN1(va) (((va) >> 22) & 0x3ff)     /* index into the root table */
#define VPN0(va) (((va) >> 12) & 0x3ff)     /* index into a leaf table */
#define SATP_SV32 0x80000000
#define MAXPATH 16               /* longest program name spawn() accepts, with its 0 */

/* Program file header (20 bytes), then the image, loaded at USER_BASE. */
#define EXE_MAGIC 0x45584542     /* "BEXE" */
struct exehdr {
  uint magic;
  uint entry;
  uint textsz;                   /* bytes of code at the start of the image */
  uint filesz;                   /* bytes of image that follow this header */
  uint memsz;                    /* filesz plus zeroed bss */
};

#endif

#ifdef CONFIG_FS
/* ------------------------------------------------------------ file system */

#define SECTOR 512
#define FS_MAGIC 0x53464342      /* "BCFS" */
#define SUPER_SECTOR 1
#define ROOT_INUM 1
#define NDIRECT 12
#define NINDIRECT (SECTOR / 4)
#define IPS (SECTOR / 64)        /* inodes per sector */
#define DIRSIZ 12
#define T_FILE 1
#define T_DIR 2

struct superblock {
  uint magic;
  uint nsectors;                 /* size of the disk */
  uint ninodes;
  uint inodestart;               /* first sector of the inode table */
  uint datastart;                /* first data sector */
};

/* On-disk inode: 64 bytes. addrs[0..11] are data sectors, addrs[12] an indirect sector. */
struct dinode {
  uint type;                     /* 0 = free, T_FILE, T_DIR */
  uint size;                     /* bytes */
  uint addrs[NDIRECT + 1];
  uint pad;
};

/* Directory entry: 16 bytes. inum 0 = empty slot. */
struct dirent {
  uint inum;
  char name[DIRSIZ];
};

/* What readdir() gives a program. */
struct ustat {
  char name[16];
  uint size;
  uint type;
};

#endif

/* ------------------------------------------------------------- functions */

/* start.s: machine helpers */
uint r_mcause(void);
uint r_mtval(void);
uint r_mstatus(void);
void w_mstatus(uint x);
void w_mtvec(uint x);
void w_mscratch(uint x);
uint r_mie(void);
void w_mie(uint x);
uint r_mip(void);
void w_satp(uint x);
void sfence_vma(void);
void wfi(void);
void pmp_open(void);
void halt(int code);

/* trapvec.s */
void trap_vector(void);
void trap_return(struct trapframe *tf);

/* console.c */
void kputc(int c);
void kputs(char *s);
void kputu(uint n);
void kputi(int n);
void kputx(uint n);
int kgetc(void);
void panic(char *msg);
uint kstrlen(char *s);
int kstreq(char *a, char *b);
void kmemcpy(void *dst, void *src, uint n);
void kmemset(void *dst, int c, uint n);

/* trap.c */
struct trapframe *trap(struct trapframe *tf);

/* kmain.c */
void kmain(uint arg, uint user_entry, uint user_end);
#ifndef CONFIG_PROC
void enter_user(uint entry, uint arg);
#endif

/* programs.c (the level's test programs): start the first program(s) */
void start_programs(uint arg);

#ifdef CONFIG_SYSCALL
/* syscall.c */
struct trapframe *syscall(struct trapframe *tf);
int console_read(uint uva, uint n);

/* uaccess.c: copy between the kernel and the current program's memory */
int copyin(void *dst, uint uva, uint n);
int copyout(uint uva, void *src, uint n);
int copyinstr(char *dst, uint uva, uint max);
#endif

#ifdef CONFIG_PROC
/* proc.c */
extern struct proc procs[NPROC];
extern struct proc *current;
struct proc *proc_alloc(void);
void proc_free(struct proc *p);
struct trapframe *schedule(void);
struct trapframe *proc_yield(struct trapframe *tf);
struct trapframe *proc_exit(int code);
#endif
#ifdef CONFIG_PROC
#ifndef CONFIG_VM
struct proc *proc_create(char *name, uint entry, uint arg);
#endif
#endif

#ifdef CONFIG_TIMER
/* timer.c */
#define QUANTUM 100000           /* ticks (instructions) per time slice */
extern uint ticks;
void timer_init(void);
void timer_arm(uint delay);
struct trapframe *timer_interrupt(struct trapframe *tf);
struct trapframe *timer_idle(void);
struct trapframe *sys_sleep(uint n);
uint timer_now(void);
#endif

#ifdef CONFIG_VM
/* proc.c */
struct trapframe *proc_wait(uint status_uva);

/* kalloc.c */
void kinit(uint start, uint end);
void *kalloc(void);
void kfree(void *pa);
uint kfree_count(void);

/* vm.c */
uint *walk(uint *pagetable, uint va, int alloc);
int map_page(uint *pagetable, uint va, uint pa, uint perm);
uint va2pa(uint *pagetable, uint va);

/* uaccess.c */
int copyin_pt(uint *pagetable, void *dst, uint uva, uint n);
int copyout_pt(uint *pagetable, uint uva, void *src, uint n);

/* exec.c */
void uvm_free(uint *pagetable);
int spawn(char *path, uint argv_uva);
uint sys_sbrk(int n);
#endif

#ifdef CONFIG_FS
/* exec.c */
struct proc *spawn_inmemory(uint entry, uint end);
uint sys_fbmap(void);

/* disk.c */
int disk_read(uint sector, void *buf);

/* fs.c */
extern struct superblock sb;
int fs_init(void);
int inode_read(uint inum, struct dinode *ip);
uint bmap(struct dinode *ip, uint bn);
int readi(struct dinode *ip, char *dst, uint off, uint n);
uint dir_lookup(char *name);

/* file.c */
int file_open(uint path_uva);
int file_read(int fd, uint uva, uint n);
int file_close(int fd);
int file_readdir(uint index, uint out_uva);
#endif

#endif
