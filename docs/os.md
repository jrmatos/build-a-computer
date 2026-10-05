# The Phase 9 operating system

Phase 9 builds a small Unix-like kernel, one piece per level, then runs a
shell and a game on it. This page is the kernel's design, for level authors
and for anyone reading `packages/os-kit`. Machine details (devices, CSRs) are
in [`devices.md`](devices.md); how code levels build and run is in
[`code-levels.md`](code-levels.md).

## Where things live

| Path | What |
| --- | --- |
| `packages/os-kit/kernel/` | The reference kernel, one source tree with feature switches (`#ifdef CONFIG_VM` …) |
| `packages/os-kit/boot/` | The bootloader (`boot.c`) and its helpers |
| `packages/os-kit/user/` | The user library (`ucrt.s`, `usys.s`, `ulib.c`, `user.h`) and the disk programs `ls`, `cat`, `echo`, `hello` |
| `packages/os-kit/levels/<level>/` | Each level's test programs and the player's starter file; the shell and the game reference programs |
| `packages/os-kit/src/` | Disk image builder (`disk.ts`), image builder over our cc and asm (`build.ts`), the specializer (`specialize.ts`), and what each level is made of (`levels.ts`) |
| `packages/content/src/phase9/` | The ten levels; `os.data.ts` is generated from os-kit |

Everything is compiled by the game's own toolchain (`@build-a-computer/cc` and
`@build-a-computer/asm`). The C is the Phase 8 subset: no unions, function
pointers, varargs or struct copies; CSRs are reached through one-instruction
assembly helpers in `start.s` rather than inline assembly.

### Specialization

Each level ships the kernel *as it is at that stage*. `specialize(text,
features)` keeps the code of the enabled features and deletes the
`#ifdef CONFIG_X` / `#else` / `#endif` lines, so players read plain C. The
stages:

| Level | id | Player writes | Features |
| --- | --- | --- | --- |
| 1 | `os-bootloader` | `boot.c` (bootloader) | — |
| 2 | `os-trap-vector` | `trapvec.s` (save/restore, asm level) | — |
| 3 | `os-system-calls` | `syscall.c` | SYSCALL |
| 4 | `os-context-switch` | `proc.c` | + PROC |
| 5 | `os-preemption` | `timer.c` | + TIMER |
| 6 | `os-virtual-memory` | `vm.c` | + VM |
| 7 | `os-page-allocator` | `kalloc.c` | + VM |
| 8 | `os-file-system` | `fs.c` | + FS |
| 9 | `os-shell` | `sh.c` (a user program) | full kernel, on the disk |
| 10 | `os-final-game` | `snake.c` (a user program) | full kernel, on the disk |

A level's library is the kernel files of its stage minus the player's file,
plus the level's test programs, ending with `end.s` (`kernel_end`). Libraries
stay within the schema's 16 files of 200,000 characters (checked by os-kit's
tests).

Regenerate the content data after changing os-kit (or after a cc change,
which changes the compiled programs on the disks):

```sh
cd packages/content && UPDATE_OS_DATA=1 npx vitest run src/phase9
```

## Privilege and traps

The kernel runs in **machine mode**; programs run in **user mode**. There is
no supervisor mode: a teaching simplification (real kernels run in S-mode
under M-mode firmware). Machine mode ignores `satp`, so the kernel always sees
physical memory and page tables only map programs.

Every trap goes to `trap_vector` (`mtvec`). `mscratch` holds the address of
the running program's trap frame:

```c
struct trapframe {
  uint regs[32];  /* regs[i] = xi at offset 4*i; regs[0] unused */
  uint epc;       /* offset 128 */
  uint kstack;    /* offset 132: kernel stack pointer */
};
```

`trap_vector` swaps t6 with mscratch, saves x1–x30, the program's t6 and mepc,
loads `sp` from `kstack` and calls `trap(tf)`. `trap()` returns **the trap
frame to resume**; the code falls into `trap_return(tf)`, which sets mscratch
and mepc from it, restores every register (t6 last) and `mret`s. Returning a
different process's frame is the context switch; there is no separate
`swtch`. One kernel stack (16 KiB below `RAM_END`) serves every trap, because
the kernel never blocks in the middle of a trap: a process that must wait is
marked (SLEEPING, WAITING) and its system call is finished later by whoever
wakes it.

The kernel runs with interrupts off (`mstatus.MIE = 0`); machine interrupts
are always taken in user mode. A timer that expires during kernel work stays
pending in `mip` until the kernel returns to a program.

`trap()` dispatches on `mcause`: ecall from U (8) → `syscall()` with epc + 4;
timer interrupt (7) → `timer_interrupt()`; any other exception from a program
prints `trap: <fault>[ at <address>] in pid N (<name>), killed` and exits it
with -1. A trap from machine mode is a kernel bug and panics. Before the
SYSCALL stage the kernel answers three early calls (a7 = 1 print a0, 2 add, 93
exit) and before PROC a fault halts the machine with 255.

## System calls

Arguments in a0–a2, number in a7, result in a0 (-1 = failure). Numbers follow
Linux RISC-V where one exists.

| a7 | Call | Stage | Notes |
| --- | --- | --- | --- |
| 64 | `write(fd, buf, n)` | SYSCALL | fd 1, 2; rejects wrapping buffers |
| 63 | `read(fd, buf, n)` | SYSCALL | fd 0: one console line, echoed, 0 at end of input; fd ≥ 3: files (FS) |
| 93 | `exit(code)` | SYSCALL | |
| 172 | `getpid()` | SYSCALL | |
| 124 | `yield()` | PROC | |
| 101 | `sleep(ticks)` | TIMER | |
| 113 | `uptime()` | TIMER | mtime, low word |
| 220 | `spawn(path, argv)` | VM | new process from a program file; returns its pid |
| 260 | `wait(&status)` | VM | blocks until a child exits |
| 214 | `sbrk(n)` | VM | grows the heap; fails cleanly when memory is short |
| 500 | `freemem()` | VM | free pages |
| 56, 57 | `open(path)`, `close(fd)` | FS | root directory only |
| 61 | `readdir(i, &ustat)` | FS | i-th file: name, size, type |
| 501 | `fbmap()` | FS | maps the framebuffer at 0x2000_0000 and turns it on |
| 502 | `getkey()` | FS | next keyboard key or -1 |

User pointers are never dereferenced directly: `copyin`, `copyout` and
`copyinstr` (`uaccess.c`) check them: against RAM before paging, through the
process's page table afterwards (`va2pa` requires V and U; `copyout` also W).

## Processes and scheduling

`struct proc` holds the trap frame (first member), pid, state (UNUSED,
RUNNABLE, RUNNING, SLEEPING, WAITING, ZOMBIE), exit code, name, and per stage
the wake time, parent, page table, heap end and open files. `NPROC` is 8.

- `schedule()` is round robin from the slot after `current`. With nothing
  runnable it idles if someone sleeps, panics on deadlock, and otherwise halts
  the machine (`ecall` 93 in M-mode) with **pid 1's exit code**.
- Every switch arms a fresh time slice of `QUANTUM` = 100,000 ticks (one tick
  per instruction). The long slice makes output deterministic regardless of
  how fast the player's kernel code is: short bursts never get cut.
- `sleep(n)` wakes at the first timer interrupt after `mtime + n`; when
  everyone sleeps, `timer_idle()` arms the timer for the earliest wake-up and
  `wfi`s (the emulator skips idle time).
- `exit` frees the address space at once; a child whose parent is waiting
  completes the parent's `wait` immediately, otherwise it stays a ZOMBIE.
  Orphans are reparented to nobody and freed when they exit.

Before paging (levels 3–5) processes are functions in the kernel image run in
user mode, each with its own stack in a static array. Physical memory
protection is opened (`pmp_open`) so user mode can reach memory, as real
hardware requires.

## Virtual memory and the allocator

Sv32 with two levels: `walk(pt, va, alloc)`, `map_page(pt, va, pa, perm)`,
`va2pa(pt, va)`. On every switch the kernel writes `satp` (mode Sv32, root
page number) and runs `sfence.vma`.

User address space:

| Address | What |
| --- | --- |
| `0x0001_0000` | program image (USER_BASE): code pages R+X, then data R+W |
| above the image | heap (`sbrk`) |
| `0x00FF_D000` | guard page, mapped **without** U: stack overflow faults |
| `0x00FF_E000`–`0x0100_0000` | stack (2 pages) |
| `0x2000_0000` | framebuffer after `fbmap()` (not owned) |

Pages the process owns carry the software bit `PTE_OWNED` (0x100) and are
freed by `uvm_free`; mappings of memory the kernel does not own (the
framebuffer, a program loaded by the bootloader) are not. A process costs
its image pages, 2 stack pages, the guard page and 3 page tables.

The allocator (`kalloc.c`) keeps free 4 KiB pages on a list threaded through
the pages themselves, from `kernel_end` to the kernel stack. `kalloc` zeroes
every page it hands out.

## Program files

A program is linked at USER_BASE with `ucrt.s` first (`_ustart` calls
`main(argc, argv)` then `exit`). `ucrt.s` starts `.rodata` on a page boundary,
so code pages hold only code. The file is a 20-byte header and the image:

| Offset | Field |
| --- | --- |
| 0 | magic `0x45584542` ("BEXE") |
| 4 | entry |
| 8 | textsz: bytes of code, rounded up to a page |
| 12 | filesz: bytes of image that follow |
| 16 | memsz: filesz plus bss |

The loader maps `memsz` bytes of zeroed pages, copies `filesz`, and pushes the
argument strings and `argv[]` on the stack (a0 = argc, a1 = argv). Before the
file system, programs are built into the kernel (`programs.s`, a table of
name, image, size).

## On-disk format

512-byte sectors, little-endian words. Built by `buildDisk` in
`packages/os-kit/src/disk.ts` (deterministic: the same inputs give the same
bytes).

| Sector | Contents |
| --- | --- |
| 0 | **Boot block**: `magic` 0x544F4F42 ("BOOT"), `load`, `entry`, `start`, `count`, `size`, `checksum` (sum of the image bytes mod 2^32); zeros when the disk is not bootable |
| 1 | **Superblock**: `magic` 0x53464342 ("BCFS"), `nsectors`, `ninodes`, `inodestart`, `datastart` |
| 2 … | **Inode table**: 64-byte inodes, 8 per sector (32 inodes by default) |
| datastart … | **Data**: the root directory first, then each file's sectors, contiguous, followed by its indirect sector when it has one |

Inode (64 bytes): `type` (0 free, 1 file, 2 directory), `size` in bytes,
`addrs[13]` (12 direct sector numbers, then one indirect sector of 128 more:
files up to 70 KiB), `pad`. Inode 0 is never used; inode 1 is the root
directory, the only directory. A directory is a file of 16-byte entries:
`inum` (0 = empty slot) and a 12-byte name, 0-padded, with no terminator when
it is 12 long.

A bootable disk with files stores the kernel as the file `kernel`; the boot
block points at its sectors. A disk without files is just the boot block and
the raw image (from sector 1, or another start sector).

In tests a disk becomes `setup.disk`: runs of non-zero sectors as hex
(`diskSetup`).

## Booting

**Kernel levels** (2–8): the machine loads the kernel image at `0x8000_0000`
(the player's file plus the library) and starts at `_start` in `start.s`
with `a0` = the test's scenario number. `kmain` installs `mtvec`, opens PMP,
sets `MPP` = user, initializes the stage's subsystems, then starts the
scenario's programs (`programs.c`) or, with a file system, the file `init`.

**Bootloader level** (1): the image is the player's bootloader; the test disk
holds a small kernel. Messages: `boot: no kernel on this disk` (exit 1),
`boot: bad checksum` (exit 2), else `boot: loaded <size> bytes at <load>,
jumping to <entry>` and `boot_jump(entry, 0, 0, 0)`.

**Program levels** (9, 10): the image is the player's program, the user
library and the reference bootloader (`boot.c` specialized with USERBOOT, run
from `bootstart.s`). The disk holds the full kernel linked at `0x8020_0000`
and the programs. The bootloader loads the kernel and jumps to it with `a1` =
the program's entry (`_ustart`) and `a2` = the end of its image (`_end`). The
kernel maps that region (`0x8000_0000` up to `_end`) into pid 1's address
space at the same addresses, not owned, and runs it in user mode.

## Exit codes

| Event | Machine exit code |
| --- | --- |
| Every process has exited | pid 1's exit code (-1 = 4294967295 when it was killed) |
| `panic` | 255 |
| Fault before processes exist (levels 2–3) | 255 |

## Determinism

The emulator is deterministic, but a player's kernel takes a different number
of instructions than the reference. Tests are written so that the expected
output does not depend on that: per-process output happens in short bursts
inside 100,000-tick slices; preemption tests synchronize through shared
memory (a token passed between spinning processes) or use sleeps far apart;
page counts are reported as differences. The game is turn-based (one step per
key), so its final picture depends only on the keys.

## Tests

- `packages/os-kit/src/os-kit.test.ts`: the specializer, the disk builder
  (OS-02: same inputs, same hash; round trips; indirect blocks), program
  files, library limits, OS-01 (a hello kernel boots from disk) and OS-03
  (`ls`, `cat`, `echo` and running programs work in the shell, end to end).
- `packages/content/src/phase9/phase9.test.ts`: the generated data is current,
  every reference passes every test and every starter fails at least one
  (through `runRiscvTest`, the real pipeline), the snake model matches the
  expected framebuffer hashes, and OS-04: one deliberately broken kernel per
  checker (a bootloader that ignores the checksum, a trap vector that forgets
  mscratch, a scheduler that is not round robin, an allocator that hands out
  dirty pages, …) fails at least one test.
