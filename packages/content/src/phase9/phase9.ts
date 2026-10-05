import type { Level } from '@build-a-computer/schema';
import { defineLevel } from '../define';
import {
  BIG_TEXT,
  LONG_KERNEL_TEXT,
  PHASE8_LAST_REQUIRED_ID,
  README,
  base,
  hex8,
  kit,
  osCode,
  osTest,
} from './common';
import { SNAKE_SHA256 } from './os.data';
import { SNAKE_CASES, snakeModel } from './snake';

/**
 * Phase 9, Operating system: ten levels that build a small Unix-like kernel
 * piece by piece, then run a shell and a game on it. Each level gives the
 * player one piece (their main.c or main.s); the level's read-only library
 * files are the rest of the kernel at that stage (packages/os-kit, generated
 * into os.data.ts). docs/os.md describes the design. DRAFT text (owner
 * approves). CNT-11.
 */

const C = (s: string): string => '```c\n' + s + '\n```';
const ASM = (s: string): string => '```asm\n' + s + '\n```';

// ------------------------------------------------------------------ level 1

const BOOT = 'os-bootloader';
const bootFacts = kit(BOOT).facts;
const bootLine = (disk: string): string =>
  `boot: loaded ${bootFacts[`${disk}.size`]} bytes at ${hex8(bootFacts[`${disk}.load`]!)}, jumping to ${hex8(bootFacts[`${disk}.entry`]!)}\n`;

// ------------------------------------------------------------------ level 8

/** What fscat prints for big.txt: its length and a rolling checksum. */
function bigChecksum(): number {
  let sum = 0;
  for (const c of BIG_TEXT) sum = (Math.imul(sum, 31) + c.charCodeAt(0)) >>> 0;
  return sum;
}

const FS = 'os-file-system';
const fsSize = (disk: string, file: string): number => {
  const n = kit(FS).sizes[`${disk}/${file}`];
  if (n === undefined) throw new Error(`no size for ${disk}/${file}`);
  return n;
};

// ------------------------------------------------------------------ level 9

const SHELL = 'os-shell';
const lsLine = (name: string): string => {
  const n = kit(SHELL).sizes[name];
  if (n === undefined) throw new Error(`no size for ${name}`);
  return name.padEnd(14, ' ') + n + '\n';
};
const SHELL_LS = ['ls', 'cat', 'echo', 'hello', 'readme.txt', 'kernel'].map(lsLine).join('');

// ------------------------------------------------------------------ levels

export const PHASE9: Level[] = [
  defineLevel({
    ...base,
    id: BOOT,
    order: 1,
    title: 'Bootloader',
    goal:
      'The kernel is on the disk, not in RAM. Read the boot header from sector 0, copy the kernel image into RAM, ' +
      'check its checksum, print the "boot: loaded" line and jump to its entry point. Report a disk with no kernel ' +
      'or a bad checksum.',
    tutorial: [
      'When a computer powers on, the operating system is not running yet: it is just bytes on a disk. Something small has to copy it into memory and start it. That something is the **bootloader**, and it is the first program of this phase.',
      '',
      'Sector 0 of a bootable disk is the **boot block**. It starts with a header (`struct boothdr` in boot.h):',
      '',
      '| Offset | Field | Meaning |',
      '| --- | --- | --- |',
      '| 0 | magic | `0x544F4F42` ("BOOT") or this is not a boot disk |',
      '| 4 | load | RAM address the image must be copied to |',
      '| 8 | entry | address to jump to once it is there |',
      '| 12 | start | first sector of the image |',
      '| 16 | count | number of sectors |',
      '| 20 | size | bytes of image (the last sector may be partly used) |',
      '| 24 | checksum | sum of the image bytes, modulo 2^32 |',
      '',
      'The block device (Phase 7) reads one 512-byte sector per command:',
      '',
      C(
        [
          '*(volatile uint *)BLK_SECTOR = sector;   /* which sector */',
          '*(volatile uint *)BLK_COMMAND = 1;       /* 1 = read it into the buffer */',
          'if (*(volatile uint *)BLK_STATUS != 0)   /* 0 = done */',
          '  return -1;',
          '/* the bytes are now at BLK_BUFFER .. BLK_BUFFER + 511 */',
        ].join('\n'),
      ),
      '',
      'Read sector 0 into a local array and look at it through a `struct boothdr *`. Then copy sector `start + i` to `load + i * 512` for each of the `count` sectors: the image lands exactly where it was linked to run. A kernel is linked for one address; copied anywhere else, its jumps and data addresses would be wrong.',
      '',
      'The checksum catches a damaged disk before the CPU runs garbage. Add up the `size` bytes you copied (unsigned, so it wraps) and compare.',
      '',
      "Finally, print what you did and jump. C cannot jump to a number, so boot.h gives you `boot_jump(entry, a0, a1, a2)`, an assembly helper that sets the kernel's first registers and jumps. Use 0 for all three arguments. Note that the entry point is not always the load address.",
      '',
      '| Case | Print (exactly) | Then |',
      '| --- | --- | --- |',
      '| no magic | `boot: no kernel on this disk\\n` | `return 1` |',
      '| bad checksum | `boot: bad checksum\\n` | `return 2` |',
      '| good | `boot: loaded <size> bytes at <load>, jumping to <entry>\\n` | `boot_jump(entry, 0, 0, 0)` |',
      '',
      'Print the size with `boot_print_dec` and the addresses with `boot_print_hex` (0x and 8 digits). Returning from `main` ends the machine with that exit code.',
    ].join('\n'),
    hints: [
      'read_sector is four steps: write SECTOR, write 1 to COMMAND, check STATUS, then copy BUFFER byte by byte into dst (a volatile uchar pointer at BLK_BUFFER + i).',
      'Make the destination a byte pointer: uchar *image = (uchar *)h->load; then sector i goes to image + i * SECTOR_SIZE.',
      'Do the checksum over h->size bytes, not count * 512: the end of the last sector is padding.',
      'The entry point can differ from the load address (one test kernel starts with data). Jump to h->entry and print it.',
      'for (i = 0; i < h->count; i++) read_sector(h->start + i, image + i * SECTOR_SIZE); then sum += image[i] for i < h->size; compare; print; boot_jump(h->entry, 0, 0, 0);',
    ],
    afterword:
      'Real machines boot in more stages (firmware, then a bootloader, then the kernel), but each stage does what yours does: find the next stage, copy it, check it, jump. ' +
      'From here on the kernel is in memory and every level adds a piece of it. In the shell and game levels this very bootloader starts the full kernel from the disk.',
    code: osCode(BOOT, ['uart', 'disk']),
    tests: [
      osTest(BOOT, 'hello kernel', {
        disk: 'hello',
        uart: bootLine('hello') + 'Hello from the kernel!\n',
        exitCode: 0,
      }),
      osTest(BOOT, 'a kernel several sectors long', {
        disk: 'long',
        uart: bootLine('long') + LONG_KERNEL_TEXT,
        exitCode: 7,
      }),
      osTest(BOOT, 'the entry point is not the load address', {
        disk: 'entry',
        uart: bootLine('entry') + 'Started at the entry point.\n',
        exitCode: 0,
      }),
      osTest(BOOT, 'a kernel far into the disk', {
        disk: 'far',
        uart: bootLine('far') + 'Hello from the kernel!\n',
        exitCode: 0,
      }),
      osTest(BOOT, 'a damaged kernel', {
        disk: 'corrupt',
        uart: 'boot: bad checksum\n',
        exitCode: 2,
      }),
      osTest(BOOT, 'a blank disk', {
        disk: 'blank',
        uart: 'boot: no kernel on this disk\n',
        exitCode: 1,
      }),
    ],
    requires: [PHASE8_LAST_REQUIRED_ID],
  }),

  defineLevel({
    ...base,
    id: 'os-trap-vector',
    order: 2,
    title: 'Into the kernel and back',
    goal:
      'Write trap_vector: save all 31 registers of the interrupted program in its trap frame, switch to the kernel stack and call trap(). ' +
      'Then write trap_return: load every register back from a trap frame and return to the program with mret.',
    tutorial: [
      'From now on there are two worlds. The **kernel** runs in machine mode and may do anything. **Programs** run in user mode: no CSRs, and later no memory they do not own. The only way from a program into the kernel is a **trap**: an `ecall` (the program asks for something), a fault (it did something wrong) or an interrupt (a device needs attention).',
      '',
      "On a trap the CPU jumps to the address in `mtvec`, in machine mode, with mepc = where the program was and mcause = why. Every register still holds the *program's* value, and the kernel's C code will overwrite them. So the very first instructions must save all of them. That is your job.",
      '',
      'Each program has a **trap frame** (kernel.h):',
      '',
      C(
        [
          'struct trapframe {',
          '  uint regs[32];  /* regs[i] = register xi, at byte offset 4*i (regs[0] unused) */',
          '  uint epc;       /* offset 128: where the program resumes */',
          '  uint kstack;    /* offset 132: the kernel stack pointer to use */',
          '};',
        ].join('\n'),
      ),
      '',
      "The kernel keeps the address of the running program's frame in the `mscratch` CSR. But to store anything you need a register holding that address, and every register is taken. The trick is one instruction that swaps a register with a CSR:",
      '',
      ASM(
        [
          'trap_vector:',
          "    csrrw t6, mscratch, t6   # t6 = frame, mscratch = the program's t6",
          '    sw   x1, 4(t6)           # ra',
          '    sw   x2, 8(t6)           # sp',
          '    # ... x3 to x30 ...',
          "    csrr t5, mscratch        # the program's t6 (t5 is saved already)",
          '    sw   t5, 124(t6)',
          '    csrr t5, mepc',
          '    sw   t5, 128(t6)',
          "    lw   sp, 132(t6)         # the kernel's own stack",
          '    mv   a0, t6',
          '    call trap                # returns the frame to resume in a0',
        ].join('\n'),
      ),
      '',
      "Why switch stacks? The program's sp is just a number the program chose. It might be garbage, and one of the tests sets it to garbage on purpose. The kernel never trusts it.",
      '',
      '`trap(tf)` (trap.c) handles the trap and returns the frame to resume. Right after `call trap`, fall through into `trap_return`, which does the opposite: point mscratch at the frame (so the *next* trap saves there), set mepc from `epc`, load x1 to x30, load t6 last (it holds the frame address until then), and `mret`. mret jumps to mepc and drops back to user mode.',
      '',
      "This level's kernel answers three early system calls (trap.c): `a7 = 1` prints a0, `a7 = 2` returns a0 + a1, `a7 = 93` stops. The test program (user.s) fills all 31 registers, traps, and checks that every one survived.",
    ].join('\n'),
    hints: [
      'Every register from x1 to x30 gets one sw at offset 4*i of the frame: sw x5, 20(t6), sw x17, 68(t6), and so on. x31 (t6) is special in both directions.',
      'Do not use any register before you have saved it. After the first csrrw, t6 is the only free register; once t5 is saved (sw x30, 120(t6)) you may use t5 as scratch.',
      'In trap_return, keep the frame address in t6 and load t6 itself last: lw x31, 124(t6).',
      "If the second trap breaks, check that trap_return writes the frame address back to mscratch (csrw mscratch, t6). The swap at the start left the program's t6 there.",
      'trap_return: mv t6, a0 / csrw mscratch, t6 / lw t5, 128(t6) / csrw mepc, t5 / lw x1, 4(t6) ... lw x30, 120(t6) / lw x31, 124(t6) / mret',
    ],
    afterword:
      'This is the narrowest and most important doorway of the system: every system call, page fault and timer tick goes through these 70 instructions. ' +
      "Notice what trap() returns: a trap frame. Return a different process's frame and trap_return resumes *that* process. Two levels from now, that is the whole context switch.",
    code: osCode('os-trap-vector', ['uart']),
    tests: [
      osTest('os-trap-vector', 'hello through ecall', {
        a0: 0,
        uart: 'Hello from user mode!\n',
        exitCode: 0,
      }),
      osTest('os-trap-vector', 'all 31 registers survive', {
        a0: 1,
        uart: 'registers ok\n',
        exitCode: 0,
      }),
      osTest('os-trap-vector', '1000 traps in a row', { a0: 2, uart: '..........\n', exitCode: 0 }),
      osTest('os-trap-vector', 'an illegal instruction', {
        a0: 3,
        uart: 'trap: illegal instruction, program killed\n',
        exitCode: 255,
      }),
      osTest('os-trap-vector', 'a load from nowhere', {
        a0: 4,
        uart: 'trap: access fault, program killed\n',
        exitCode: 255,
      }),
    ],
    requires: [BOOT],
  }),

  defineLevel({
    ...base,
    id: 'os-system-calls',
    order: 3,
    title: 'System calls',
    goal:
      'Write syscall(): dispatch on the call number in a7 and implement write, read, exit and getpid, with the result in a0. ' +
      'Copy every user buffer through copyin/copyout and refuse bad pointers and bad file descriptors with -1.',
    tutorial: [
      'A program in user mode cannot touch a device. To print, it asks the kernel: arguments in a0 to a2, the call number in a7, then `ecall`. The trap lands in your trap vector, trap() sees mcause = 8 (ecall from user mode), moves epc past the ecall and calls `syscall(tf)`. Whatever you put in `tf->regs[REG_A0]` is what the program gets back.',
      '',
      '| a7 | Call | Does | Returns |',
      '| --- | --- | --- | --- |',
      '| 64 | write(fd, buf, n) | fd 1 or 2: print n bytes from buf | n, or -1 |',
      '| 63 | read(fd, buf, n) | fd 0: `console_read(buf, n)` | bytes read, 0 at the end of input, -1 |',
      '| 93 | exit(code) | stop: `halt(code)` (there is only one program) | — |',
      '| 172 | getpid() | | 1 |',
      '| other | | print `unknown system call <num>\\n` | -1 |',
      '',
      'The user library (usys.s) wraps each call in a C function:',
      '',
      '```asm\nwrite:\n    li   a7, 64\n    ecall\n    ret\n```',
      '',
      "The golden rule: **a user pointer is just a number the program chose.** It may point at the kernel, at a device, at nothing, or run off the end of memory. The kernel never dereferences it directly. It copies through `copyin(dst, uva, n)` and `copyout(uva, src, n)` (uaccess.c), which check the range first and return -1 when it is not the program's. A length can lie too: `uva + n` may wrap around past 0xffffffff, so check that `uva + n >= uva` before anything else.",
      '',
      'Copy a big buffer in small pieces through a local array (64 bytes is plenty) so the kernel stack stays small:',
      '',
      C(
        [
          'while (done < n) {',
          '  k = n - done;',
          '  if (k > CHUNK) k = CHUNK;',
          '  if (copyin(buf, uva + done, k) < 0) return -1;',
          '  /* print buf[0 .. k-1] with kputc */',
          '  done = done + k;',
          '}',
        ].join('\n'),
      ),
      '',
      '`console_read` reads like a terminal: take bytes with `kgetc()` (-1 when nothing is waiting) until n bytes, a newline (keep it), or the end of the input. Store each byte with copyout, then echo it with kputc so the person sees what they typed.',
    ].join('\n'),
    hints: [
      'Start with getpid and exit: tf->regs[REG_A0] = 1 for one, halt(tf->regs[REG_A0]) for the other. Then write, then read.',
      'In sys_write, return -1 first for any fd other than 1 and 2, and for a buffer that wraps (uva + n < uva).',
      'console_read: loop while i < n; ch = kgetc(); stop if ch < 0; c = ch; copyout(uva + i, &c, 1) (return -1 if it fails); kputc(ch); i++; stop after a newline.',
      'Unknown numbers: kputs("unknown system call "); kputu(num); kputc(\'\\n\'); and -1.',
    ],
    afterword:
      'Every operating system draws this same line. Linux on RISC-V uses these very numbers (64 for write, 93 for exit). The checks you wrote are its security: ' +
      'a kernel that trusted one user pointer would let any program read or overwrite anything.',
    code: osCode('os-system-calls', ['uart']),
    tests: [
      osTest('os-system-calls', 'write', {
        a0: 0,
        uart: 'Hello from user mode!\nwrite returned 22\n',
        exitCode: 0,
      }),
      osTest('os-system-calls', 'getpid and exit', { a0: 1, uart: 'my pid is 1\n', exitCode: 42 }),
      osTest('os-system-calls', 'bad pointers and descriptors', {
        a0: 2,
        uart: 'null: -1\nbelow RAM: -1\npast the end of RAM: -1\nwrapping around: -1\nfd 7: -1\nstill alive\n',
        exitCode: 0,
      }),
      osTest('os-system-calls', 'an unknown call', {
        a0: 3,
        uart: 'unknown system call 999\nsystem call 999 returned -1\n',
        exitCode: 0,
      }),
      osTest('os-system-calls', 'read lines', {
        a0: 4,
        input: 'hi\nthere\n',
        uart: 'hi\n[3 bytes]\nthere\n[6 bytes]\nread returned 0 after 2 lines\n',
        exitCode: 2,
      }),
      osTest('os-system-calls', 'read into a small buffer', {
        a0: 5,
        input: 'abcdef\n',
        uart: 'abc\nfirst read: 3def\nsecond read: 3\n',
        exitCode: 0,
      }),
    ],
    requires: ['os-trap-vector'],
  }),

  defineLevel({
    ...base,
    id: 'os-context-switch',
    order: 4,
    title: 'Processes',
    goal:
      'Write the process table: proc_alloc, proc_create, schedule (round robin), proc_yield and proc_exit. ' +
      "Switching processes is returning the next process's trap frame. When every process has exited, halt with pid 1's exit code.",
    tutorial: [
      'One program at a time is a calculator. An operating system runs many, taking turns on the one CPU. Each running program is a **process**: its registers (a trap frame), a pid, a state and, for now, its own stack.',
      '',
      C(
        [
          'struct proc {',
          '  struct trapframe tf;  /* its registers while it is not running */',
          '  int pid;',
          '  int state;            /* UNUSED, RUNNABLE, RUNNING, ZOMBIE ... */',
          '  int exitcode;',
          '  char name[16];',
          '};',
          'struct proc procs[NPROC];  /* NPROC = 8 */',
          'struct proc *current;      /* the one on the CPU */',
        ].join('\n'),
      ),
      '',
      "Here is the beautiful part. When a process traps, your trap vector has already saved all its registers in its frame (mscratch points at `current->tf`). To switch to another process you do not need to save anything more: just **return the other process's trap frame** from trap(). trap_return loads those registers, mscratch now points at that frame, and the other process continues exactly where it stopped. A context switch is a `return`.",
      '',
      '| Function | Does |',
      '| --- | --- |',
      '| `proc_alloc()` | first UNUSED slot: zero it, next pid (1, 2, 3 ...), `tf.kstack = KSTACK_TOP`; 0 when full |',
      '| `proc_create(name, entry, arg)` | a process that runs `entry(arg)`: epc = entry, regs[REG_A0] = arg, regs[REG_SP] = top of its stack in `ustacks`, RUNNABLE |',
      "| `schedule()` | round robin: look at the slots after current's, wrapping around; make the first RUNNABLE one current and RUNNING; return its `&p->tf` |",
      '| `proc_yield(tf)` | current becomes RUNNABLE; `return schedule();` |',
      '| `proc_exit(code)` | remember the code if pid is 1; free the slot; `return schedule();` |',
      '',
      'Round robin means fair turns: after process 2 yields, the search starts at slot 3, then 4, ..., 7, 0, 1, 2. A process that yields and is the only runnable one gets the CPU straight back. When no process is runnable at all, they have all exited: `halt(init_exitcode)`.',
      '',
      "Each process needs its own stack, or one would scribble over another's locals. Without paging they all share memory, so carve one big array into NPROC stacks: slot s owns `ustacks[s * USTACK_WORDS]` up to `ustacks[(s + 1) * USTACK_WORDS]`, and its sp starts at the top (stacks grow down).",
      '',
      'The test scenarios (programs.c) create two to nine processes that print and `yield()`.',
    ].join('\n'),
    hints: [
      "A helper that finds a process's slot number helps twice: for its stack and for where round robin starts. Loop i over 0..NPROC-1 and compare &procs[i] == p.",
      "proc_create: copy at most 15 characters of name (name[15] stays 0 from proc_alloc's kmemset), then epc, a0, sp, state.",
      'schedule: start = current ? slot(current) + 1 : 0; for k in 0..NPROC-1: i = (start + k) % NPROC; if procs[i] is RUNNABLE, switch to it.',
      'proc_exit runs while current is the exiting process: set its state UNUSED, then schedule() picks the next one after its slot.',
      'switch: current = p; p->state = RUNNING; return &p->tf; and when the loop finds nobody, halt(init_exitcode).',
    ],
    afterword:
      'This kernel switches processes only when they ask (yield, exit): cooperative multitasking, like early Mac OS and Windows 3.1. One process stuck in a loop freezes everything. ' +
      'Next level, the timer takes the CPU away whether the process likes it or not.',
    code: osCode('os-context-switch', ['uart']),
    tests: [
      osTest('os-context-switch', 'ping and pong take turns', {
        a0: 0,
        uart: 'ping 0\npong 0\nping 1\npong 1\nping 2\npong 2\n',
        exitCode: 0,
      }),
      osTest('os-context-switch', 'three processes, different lengths', {
        a0: 1,
        uart: '[1] 1/1\n[2] 1/3\n[3] 1/2\n[2] 2/3\n[3] 2/2\n[2] 3/3\n',
        exitCode: 0,
      }),
      osTest('os-context-switch', 'pids', {
        a0: 2,
        uart: 'I am pid 1\nI am pid 2\nI am pid 3\npid 1 again\npid 2 again\npid 3 again\n',
        exitCode: 0,
      }),
      osTest('os-context-switch', 'a full table', {
        a0: 3,
        uart: 'process 9: the table is full\nABCDEFGHabcdefgh',
        exitCode: 0,
      }),
      osTest('os-context-switch', "pid 1's exit code wins", {
        a0: 4,
        uart: 'pid 1 exits with 7\n[2] 1/2\n[2] 2/2\n',
        exitCode: 7,
      }),
    ],
    requires: ['os-system-calls'],
  }),

  defineLevel({
    ...base,
    id: 'os-preemption',
    order: 5,
    title: 'Preemption',
    goal:
      'Write timer.c: arm the CLINT timer, take a time slice away from the running process on each timer interrupt, ' +
      'and implement sleep(n) with an idle loop that waits (wfi) for the earliest sleeper.',
    tutorial: [
      'With yield alone, a process that never yields owns the machine. The fix is the timer interrupt (Phase 7): the kernel sets an alarm before running a process, and when it rings the CPU traps into the kernel, which simply switches to the next process. That is **preemption**, and each run between alarms is a **time slice**.',
      '',
      '| Address | Register | Use |',
      '| --- | --- | --- |',
      '| `0x0200BFF8` | mtime (low; high at +4) | counts up one per tick (one instruction here) |',
      '| `0x02004000` | mtimecmp (low; high at +4) | interrupt when mtime >= mtimecmp |',
      '',
      '`timer_arm(delay)` sets mtimecmp = mtime + delay. Both are 64 bits, written as two words, so write in an order that can never ask for an early interrupt: low word `0xffffffff` first, then the high word, then the real low word. When the low word wraps, carry one into the high word.',
      '',
      'Timer interrupts must be enabled in `mie` (bit 7, MIE_MTIE): `w_mie(r_mie() | MIE_MTIE)`. The kernel itself runs with interrupts off (mstatus.MIE = 0), but in user mode machine interrupts are always taken. So a timer that fires while the kernel works just waits, pending in `mip`, until the kernel returns to a program.',
      '',
      'proc.c already calls `timer_arm(QUANTUM)` each time it switches to a process, so every process starts with a fresh slice of 100,000 ticks. trap() sends interrupt 7 to `timer_interrupt(tf)`: count it in `ticks`, wake sleepers whose time has come, and `return proc_yield(tf);`.',
      '',
      '**Sleep.** `sleep(n)`: set `current->wake = timer_now() + n`, state SLEEPING, a0 = 0, and `return schedule();`. Compare times as `(int)(now - wake) >= 0`: it stays right when the 32-bit clock wraps around.',
      '',
      '**Idle.** When everyone is asleep, schedule() calls `timer_idle()`. Find the earliest wake time, arm the timer for it, then wait:',
      '',
      C('while ((r_mip() & MIP_MTIP) == 0)\n  wfi();   /* sleep until the timer is pending */'),
      '',
      'Then wake the sleepers and `return schedule();` (loop if nobody woke). wfi stops the CPU until an interrupt is pending, even with interrupts off; the emulator skips the idle time, so waiting costs nothing.',
    ].join('\n'),
    hints: [
      'timer_arm: lo = mtime low, hi = mtime high, when = lo + delay; if (when < lo) hi++; then the three stores to MTIMECMP, MTIMECMP + 4, MTIMECMP.',
      'timer_init is two lines: timer_arm(QUANTUM); w_mie(r_mie() | MIE_MTIE);',
      'wake_sleepers: for every SLEEPING proc with (int)(now - p->wake) >= 0, state = RUNNABLE.',
      'timer_idle: loop over procs to find the SLEEPING one with the earliest wake; if it is still in the future, timer_arm(wake - now) and wfi until MIP_MTIP; wake_sleepers(); if any proc is RUNNABLE, return schedule().',
    ],
    afterword:
      'Every modern kernel works like this, with smarter choices of who runs next (priorities, fairness over time) and slices of a few milliseconds. ' +
      'The token test is the proof: three processes spin without ever giving up the CPU, and still take perfect turns.',
    code: osCode('os-preemption', ['uart', 'timer']),
    tests: [
      osTest('os-preemption', 'three spinning processes pass a token', {
        a0: 0,
        uart: 'A0 B0 C0 A1 B1 C1 A2 B2 C2 A3 B3 C3 \n',
        exitCode: 0,
      }),
      osTest('os-preemption', 'sleepers wake in order', {
        a0: 1,
        uart: 'slept 20000\nslept 40000\nslept 60000\n',
        exitCode: 0,
      }),
      osTest('os-preemption', 'a hog cannot starve the others', {
        a0: 2,
        uart: 'tick 0\ntick 1\ntick 2\nhog done\n',
        exitCode: 0,
        maxSteps: 50_000_000,
      }),
      osTest('os-preemption', 'sleep and uptime', {
        a0: 3,
        uart: 'slept at least 10000 ticks\nand not much longer\n',
        exitCode: 0,
      }),
    ],
    requires: ['os-context-switch'],
  }),

  defineLevel({
    ...base,
    id: 'os-virtual-memory',
    order: 6,
    title: 'Virtual memory',
    goal:
      'Write Sv32 page tables: walk (find, or make, the leaf entry for an address), map_page and va2pa. ' +
      'Each program then gets its own address space: same addresses, different memory, and a page fault for anything it does not own.',
    tutorial: [
      'So far every process could read and write all of memory, the kernel included. **Virtual memory** fixes that: each process gets its own **page table**, a map from the addresses it uses (virtual) to real RAM (physical), page by page (4096 bytes). Addresses it has no mapping for do not exist for it. Two processes can both use address 0x10000 and never meet.',
      '',
      'In **Sv32** a 32-bit virtual address splits in three:',
      '',
      '| Bits | Name | Use |',
      '| --- | --- | --- |',
      '| 31-22 | VPN[1] | index into the root table (1024 entries, one page) |',
      '| 21-12 | VPN[0] | index into a leaf table |',
      '| 11-0 | offset | byte within the page |',
      '',
      'A page table entry (PTE) is a word: the physical page number in bits 31-10 (`PA2PTE(pa)` / `PTE2PA(pte)`), and flags: V valid, R read, W write, X execute, U user, A accessed, D dirty. A root entry with only V set points to a leaf table; a leaf entry with R/W/X maps a page.',
      '',
      C(
        [
          'uint *walk(uint *pagetable, uint va, int alloc) {',
          '  uint *pte = &pagetable[VPN1(va)];',
          '  /* valid? the leaf table is at PTE2PA(*pte).',
          '     not valid? with alloc, kalloc() a zeroed page and point *pte at it */',
          '  return &table[VPN0(va)];',
          '}',
        ].join('\n'),
      ),
      '',
      '`map_page(pt, va, pa, perm)` walks with alloc and fills the leaf: `PA2PTE(pa) | perm | PTE_V | PTE_A | PTE_D` (setting A and D up front saves the CPU writing them later). It fails with -1 if the page is already mapped. `va2pa(pt, va)` walks without alloc and returns the physical address, or 0 unless the entry is valid *and* has U: that is how system calls check user pointers now (uaccess.c).',
      '',
      "The rest is done for you. The loader (exec.c) gives each program a root table, maps its code at USER_BASE (0x10000) read and execute only, its data read and write, a stack below 0x01000000, and under the stack a guard page mapped *without* U, so a stack overflow faults. proc.c writes the root table's page number to `satp` (mode Sv32) on every switch. One simplification to know: the kernel runs in machine mode, which ignores satp, so the kernel sees physical memory and the tables only need to map the program.",
      '',
      'Programs are now separate files linked at USER_BASE (built into the kernel as programs.s until there is a file system). A bad access becomes a **page fault** (mcause 12, 13 or 15) and trap() kills the program: `trap: load page fault at 0x00000000 in pid 2 (nullread), killed`.',
    ].join('\n'),
    hints: [
      'In walk, the root entry is valid when (*pte & PTE_V); then table = (uint *)PTE2PA(*pte). Otherwise, if alloc: table = kalloc(); if it is 0 return 0; *pte = PA2PTE((uint)table) | PTE_V.',
      'A root entry for a leaf table has V only: no R, W or X (those would make it a 4 MiB "megapage").',
      'map_page: pte = walk(pt, va, 1); if (!pte || (*pte & PTE_V)) return -1; *pte = PA2PTE(pa) | perm | PTE_V | PTE_A | PTE_D; return 0;',
      'va2pa: pte = walk(pt, va, 0); return 0 unless pte, V and U are all there; else PTE2PA(*pte) | (va & (PGSIZE - 1)).',
    ],
    afterword:
      'Virtual memory is why a crashing program cannot take the system down, why every program can be linked at the same address, and (with pages on disk) why programs can use more memory than the machine has. ' +
      'Real kernels also map themselves into every address space, in supervisor mode with the U bit off; this machine-mode kernel can skip that.',
    code: osCode('os-virtual-memory', ['uart', 'timer']),
    tests: [
      osTest('os-virtual-memory', 'a program in its own address space', {
        a0: 0,
        uart: 'hello from pid 1, argv[0] = hello\n',
        exitCode: 0,
      }),
      osTest('os-virtual-memory', 'same address, different memory', {
        a0: 1,
        uart:
          'pid 1: value 100\npid 2: value 200\npid 3: value 300\n' +
          'pid 1: value still 100\npid 2: value still 200\npid 3: value still 300\n',
        exitCode: 0,
      }),
      osTest('os-virtual-memory', 'a null pointer', {
        a0: 2,
        uart:
          'hello from pid 1, argv[0] = hello\nreading address 0...\n' +
          'trap: load page fault at 0x00000000 in pid 2 (nullread), killed\nhello from pid 3, argv[0] = hello\n',
        exitCode: 0,
      }),
      osTest('os-virtual-memory', 'code is read-only, the kernel is invisible', {
        a0: 3,
        uart:
          'writing over my own code...\ntrap: store page fault at 0x00010000 in pid 1 (rotext), killed\n' +
          'peeking at the kernel...\ntrap: load page fault at 0x80000000 in pid 2 (peek), killed\n' +
          'hello from pid 3, argv[0] = hello\n',
        exitCode: -1,
      }),
      osTest('os-virtual-memory', 'system calls check user pointers', {
        a0: 4,
        input: 'z',
        uart: 'kernel address: -1\nunmapped: -1\nnull: -1\nstack guard page: -1\nread-only page: -1\nmy own string: ok2\n',
        exitCode: 0,
      }),
    ],
    requires: ['os-preemption'],
  }),

  defineLevel({
    ...base,
    id: 'os-page-allocator',
    order: 7,
    title: 'Page allocator',
    goal:
      'Write the page frame allocator: kinit puts every free page on a free list, kalloc takes one (zeroed), kfree gives one back. ' +
      'Processes come and go, memory runs out and comes back, and no page may leak or carry old data.',
    tutorial: [
      'Page tables, program images, stacks, heaps: the kernel hands out memory one 4096-byte page at a time. The **page frame allocator** keeps track of which physical pages are free.',
      '',
      "The classic design costs no memory at all: a free page is unused, so store the bookkeeping *in the page itself*. Each free page's first word points to the next free page, making a linked list:",
      '',
      C(
        [
          'struct run { struct run *next; };',
          'static struct run *freelist;   /* the first free page, or 0 */',
          '',
          'void kfree(void *pa) {',
          '  struct run *r = pa;',
          '  r->next = freelist;          /* push */',
          '  freelist = r;',
          '}',
        ].join('\n'),
      ),
      '',
      '| Function | Does |',
      '| --- | --- |',
      '| `kinit(start, end)` | round start up to a page boundary; remember the range; `kfree` every whole page in [start, end) |',
      '| `kalloc()` | pop the first free page, fill it with zeros, return it (0 when none is left) |',
      '| `kfree(pa)` | `panic` unless pa is page-aligned and inside the range; push it |',
      '| `kfree_count()` | how many pages are free (keep a counter) |',
      '',
      'kmain calls `kinit(kernel_end, KSTACK_TOP - KSTACK_SIZE)`: everything between the end of the kernel image and its stack.',
      '',
      '**Zero every page you hand out.** A page a dead process freed still holds its data: a password, a key. Giving it to the next process unwiped leaks that data. Page tables need zeros too: a stale entry would map random memory.',
      '',
      'The tests count pages with the `freemem()` system call: a child process must cost an exact number of pages and give every one back, and a program that grows its heap with `sbrk` until memory runs out must make sbrk fail cleanly, not crash the kernel.',
    ].join('\n'),
    hints: [
      'kinit: start = (start + PGSIZE - 1) & ~(PGSIZE - 1); then for (pa = start; pa + PGSIZE <= end; pa += PGSIZE) kfree((void *)pa); Set mem_start and mem_end before the loop, since kfree checks them.',
      'kfree: if ((a & (PGSIZE - 1)) != 0 || a < mem_start || a >= mem_end) panic("kfree"); then push and nfree++.',
      'kalloc: r = freelist; if r is 0 return 0; freelist = r->next; nfree--; kmemset(r, 0, PGSIZE); return r;',
      'If the leak test reports lost pages, look for a page that kalloc counts out but kfree does not count back (or the reverse): nfree must match the list length.',
    ],
    afterword:
      'Linux\'s page allocator ("buddy allocator") keeps lists of blocks of 1, 2, 4, ... pages so it can hand out large contiguous runs, and builds small-object allocators (slabs) on top. ' +
      'The free list threaded through free memory is the same trick malloc used in Phase 8.',
    code: osCode('os-page-allocator', ['uart', 'timer']),
    tests: [
      osTest('os-page-allocator', 'no page leaks', {
        a0: 0,
        uart: `a child uses ${kit('os-page-allocator').facts['child.pages']} pages\nafter 10 children: 0 pages lost\n`,
        exitCode: 0,
      }),
      osTest('os-page-allocator', 'fresh pages are zero', {
        a0: 1,
        uart: 'fresh pages are zero: yes\n',
        exitCode: 0,
      }),
      osTest('os-page-allocator', 'out of memory, then back', {
        a0: 2,
        uart:
          'got over 100 pages, then sbrk failed\nfree pages now: almost none\nspawn now: -1\n' +
          'hog exited with 3\nall pages back: yes\n',
        exitCode: 0,
        maxSteps: 100_000_000,
      }),
      osTest('os-page-allocator', 'sbrk grows the heap', {
        a0: 3,
        uart: 'sbrk(12288) used 3 pages and moved the end by 12288\nfirst and last byte: 3\nsbrk(-1): -1\n',
        exitCode: 0,
      }),
    ],
    requires: ['os-virtual-memory'],
  }),

  defineLevel({
    ...base,
    id: FS,
    order: 8,
    title: 'File system',
    goal:
      'Write the file system reader: fs_init (superblock), inode_read, bmap (direct and indirect blocks), readi and dir_lookup. ' +
      'The kernel then starts init from the disk, and programs open, read and list files.',
    tutorial: [
      'A disk is just numbered sectors. A **file system** is the agreement that turns them into named files. This one is a tiny cousin of the classic Unix design:',
      '',
      '| Sectors | Holds |',
      '| --- | --- |',
      "| 0 | boot block (the bootloader's) |",
      '| 1 | superblock: magic `0x53464342` ("BCFS"), nsectors, ninodes, inodestart, datastart |',
      '| inodestart ... | inode table: 64-byte inodes, 8 per sector |',
      '| datastart ... | file contents, directories, indirect sectors |',
      '',
      'An **inode** describes one file: its type, its size in bytes, and where its bytes are. Its number is its index in the table (inode 0 is never used).',
      '',
      C(
        [
          'struct dinode {',
          '  uint type;          /* 0 free, T_FILE, T_DIR */',
          '  uint size;          /* bytes */',
          '  uint addrs[13];     /* 12 direct sector numbers, then 1 indirect sector */',
          '  uint pad;',
          '};',
        ].join('\n'),
      ),
      '',
      'Block `bn` of a file (bytes `bn * 512` to `bn * 512 + 511`) is in sector `addrs[bn]` when bn < 12. A bigger file uses the **indirect sector** `addrs[12]`: a whole sector of 128 more sector numbers, so block bn is entry `bn - 12` of it. That is `bmap`.',
      '',
      'Inode `inum` is in sector `sb.inodestart + inum / 8`, at byte `(inum % 8) * 64` of it. `readi(ip, dst, off, n)` copies bytes `off` to `off + n` of the file, sector by sector: find the sector with bmap, read it with `disk_read`, copy the part you need. Stop at the end of the file and return how many bytes you copied.',
      '',
      "A **directory** is a file too: an array of 16-byte entries `{ uint inum; char name[12]; }`. Inode 1 is the root directory (the only one here). `dir_lookup(name)` reads the root's entries with readi and returns the inum of the entry called name (0 if none). An entry with inum 0 is empty. A 12-character name fills the field with no 0 at the end, so compare at most 12 characters.",
      '',
      'Above your functions, file.c gives programs `open(name)`, `read(fd, buf, n)`, `close(fd)` and `readdir(i, &st)`, and exec.c loads programs from files: at boot the kernel runs the file called `init`.',
    ].join('\n'),
    hints: [
      'fs_init: uint buf[SECTOR / 4]; disk_read(SUPER_SECTOR, buf); kmemcpy(&sb, buf, sizeof(struct superblock)); then check sb.magic.',
      'inode_read: read sector sb.inodestart + inum / IPS into a buffer, then kmemcpy(ip, (char *)buf + (inum % IPS) * sizeof(struct dinode), sizeof(struct dinode)).',
      'bmap: if bn < NDIRECT return ip->addrs[bn]; bn -= NDIRECT; if it is < NINDIRECT and addrs[NDIRECT] is not 0, read that sector as 128 uints and return entry bn.',
      'readi: clamp n to size - off first. Then while done < n: sector = bmap(ip, (off + done) / SECTOR); read it; k = SECTOR - (off + done) % SECTOR, at most n - done; copy k bytes from buf + (off + done) % SECTOR.',
      'dir_lookup: inode_read(ROOT_INUM, &root); for off from 0 to root.size step 16: readi one struct dirent; if de.inum and the names match (12 characters at most), return de.inum.',
    ],
    afterword:
      'This is the shape of the Unix file system from the 1970s, still recognizable in ext4: a superblock, an inode table, direct and indirect blocks, directories as files of name-to-inode entries. ' +
      'Writing files (allocating blocks, a free bitmap, crash safety) is the next chapter of any OS book.',
    code: osCode(FS, ['uart', 'timer', 'disk']),
    tests: [
      osTest(FS, 'list the root directory', {
        disk: 'ls',
        uart:
          `init ${fsSize('ls', 'init')}\nreadme.txt ${fsSize('ls', 'readme.txt')}\n` +
          `hello ${fsSize('ls', 'hello')}\nbig.txt ${fsSize('ls', 'big.txt')}\n.\n`,
        exitCode: 4,
      }),
      osTest(FS, 'read a small and a big file', {
        disk: 'cat',
        uart: `${README}big.txt: ${BIG_TEXT.length} bytes, checksum ${hex8(bigChecksum())}\n`,
        exitCode: 0,
        maxSteps: 50_000_000,
      }),
      osTest(FS, 'run programs from the disk', {
        disk: 'run',
        uart:
          'Hello from pid 2!\n  argv[0] = hello\n  argv[1] = from\n  argv[2] = disk\n' +
          'hello was pid 2, exit 0\nnosuch: -1\nreadme.txt: -1\n',
        exitCode: 0,
      }),
      osTest(FS, 'offsets, end of file, bad descriptors', {
        disk: 'edges',
        uart:
          'fds 3 4\nWelcoWelme to\nat the end: 0\nmissing file: -1\nclose: 0 then -1\n' +
          'read closed fd: -1\nempty file: 0\nprefix of a name: -1\n12-character name: found\n',
        exitCode: 0,
      }),
      osTest(FS, 'a disk with no file system', {
        disk: 'blank',
        uart: 'panic: no file system on the disk\n',
        exitCode: 255,
      }),
    ],
    requires: ['os-page-allocator'],
  }),

  defineLevel({
    ...base,
    id: SHELL,
    order: 9,
    title: 'Shell',
    goal:
      'Write the shell, a user program: print "$ ", read a line, split it into words, run the program named by the first word ' +
      'with spawn and wait for it, and repeat until the input ends or the line is "exit".',
    tutorial: [
      'Everything so far was kernel. Now you write a **program** for your operating system, the one people actually talk to: the **shell**.',
      '',
      'This level boots for real. The machine starts your bootloader (from the first level), which loads the full kernel from the disk to 0x80200000 and jumps to it, passing along where your program is in memory. The kernel maps your program into a fresh address space and runs it in user mode as pid 1. The disk also holds the programs `ls`, `cat`, `echo`, `hello` and a `readme.txt`.',
      '',
      'Your program uses only system calls (user.h):',
      '',
      '| Call | Does |',
      '| --- | --- |',
      '| `read(0, buf, n)` | one line from the console, newline included, echoed; 0 when the input is over |',
      '| `spawn(name, argv)` | start the program file called name with arguments argv (ending with a 0 pointer); its pid, or -1 |',
      '| `wait(&status)` | wait for a child to exit; its pid, and its exit code in status |',
      '| `print(s)`, `printint(n)` | ulib.c helpers over write(1, ...) |',
      '',
      'The loop:',
      '',
      C(
        [
          'for (;;) {',
          '  print("$ ");',
          '  n = read(0, line, MAXLINE - 1);',
          '  if (n <= 0) return 0;          /* no more input */',
          '  /* end the string; drop the newline; split into words */',
          '  /* "exit" or "exit 7": return 0 or 7 */',
          '  /* else spawn(words[0], words) and wait */',
          '}',
        ].join('\n'),
      ),
      '',
      'Split in place: walk the line, skip spaces, remember where each word starts in `words[]`, and write a 0 over the space that ends it. Several spaces in a row separate words just like one. Put a 0 pointer after the last word: that is how argv ends.',
      '',
      'Exact output (the kernel already echoes what is typed):',
      '',
      '| Situation | Print |',
      '| --- | --- |',
      '| empty line | nothing, prompt again |',
      '| spawn fails | `sh: command not found: <word>\\n` |',
      '| exit status not 0 | `sh: <word> exited with <status>\\n` |',
    ].join('\n'),
    hints: [
      'After read, line[n] = 0; then if line[n - 1] is a newline, overwrite it with 0.',
      "Splitting: p = line; while (*p) { while (*p == ' ') p++; if (!*p) break; words[count++] = p; while (*p && *p != ' ') p++; if (*p) *p++ = 0; } words[count] = 0;",
      'Compare with strcmp(words[0], "exit") == 0; the code is atoi(words[1]) when words[1] is not 0.',
      'pid = spawn(words[0], words); if (pid < 0) report it and prompt again; else wait(&status) and report a non-zero status.',
    ],
    afterword:
      'A Unix shell is this loop plus pipes, redirection, variables and job control, and it is still an ordinary program. ' +
      "Look at the first test's output: your bootloader, your kernel's traps, system calls, processes, page tables, allocator and file system all ran to print it.",
    code: osCode(SHELL, ['uart', 'timer', 'disk']),
    tests: [
      osTest(SHELL, 'echo', {
        disk: 'os',
        input: 'echo hello   there world\n',
        uart: '$ echo hello   there world\nhello there world\n$ ',
        exitCode: 0,
        maxSteps: 50_000_000,
      }),
      osTest(SHELL, 'ls', {
        disk: 'os',
        input: 'ls\n',
        uart: `$ ls\n${SHELL_LS}$ `,
        exitCode: 0,
        maxSteps: 50_000_000,
      }),
      osTest(SHELL, 'cat and arguments', {
        disk: 'os',
        input: 'cat readme.txt\nhello a b\n',
        uart: `$ cat readme.txt\n${README}$ hello a b\nHello from pid 3!\n  argv[0] = hello\n  argv[1] = a\n  argv[2] = b\n$ `,
        exitCode: 0,
        maxSteps: 50_000_000,
      }),
      osTest(SHELL, 'mistakes', {
        disk: 'os',
        input: 'nosuch\ncat missing\n\n   \n',
        uart:
          '$ nosuch\nsh: command not found: nosuch\n$ cat missing\ncat: cannot open missing\nsh: cat exited with 1\n' +
          '$ \n$    \n$ ',
        exitCode: 0,
        maxSteps: 50_000_000,
      }),
      osTest(SHELL, 'exit with a code', {
        disk: 'os',
        input: 'echo bye\nexit 7\necho never\n',
        uart: '$ echo bye\nbye\n$ exit 7\n',
        exitCode: 7,
        maxSteps: 50_000_000,
      }),
    ],
    requires: [FS],
  }),

  defineLevel({
    ...base,
    id: 'os-final-game',
    order: 10,
    title: 'Final project: a game',
    goal:
      'Write snake as a program for your operating system: map the framebuffer with fbmap(), read keys with getkey(), ' +
      'and follow the rules exactly, so the final picture and the score match.',
    tutorial: [
      'The last level: a game running on your operating system, on the CPU you built from NAND gates. It boots like the shell level: your bootloader, the full kernel, your program in user mode. Two more system calls:',
      '',
      '| Call | Does |',
      '| --- | --- |',
      '| `fbmap()` | maps the 320 x 200 framebuffer into your address space, turns the screen on, returns its address (one byte per pixel: pixel (x, y) is `fb[y * 320 + x]`) |',
      '| `getkey()` | the next key from the keyboard, or -1 when none is waiting |',
      '',
      'The tests type keys and compare the final picture (a SHA-256 of all 64,000 pixels), the output and the exit code, so follow the rules exactly. Each key is one step of the game: there is no clock.',
      '',
      '**The board** is 32 x 20 cells of 10 x 10 pixels: cell (x, y) covers pixels x\\*10 to x\\*10+9 and y\\*10 to y\\*10+9. Colors (palette indexes): background 0, snake body 10, head 14, food 12.',
      '',
      '**Start.** Clear the screen to 0. The snake is 3 cells, head first: (5, 10), (4, 10), (3, 10), moving right. Draw the body cells, then the head. Place the first food, then print `snake! w a s d to turn, q to quit\\n`.',
      '',
      '**Food** comes from this generator (seed starts at 12345). Draw x then y, and draw again while the cell is on the snake:',
      '',
      C(
        [
          'uint next_random(void) {',
          '  seed = seed * 1103515245 + 12345;',
          '  return (seed >> 16) & 0x7fff;',
          '}',
          '/* foodx = next_random() % 32; foody = next_random() % 20; */',
        ].join('\n'),
      ),
      '',
      '**Each key:**',
      '',
      '1. `q`: print `bye! score <n>\\n` and return the score.',
      '2. `w` `a` `s` `d` turn up, left, down, right, unless that is straight back (ignored). Any other key changes nothing.',
      '3. Step: the new head is the head plus the direction. Off the board, or onto any snake cell except the last (the tail moves away), is a crash: print `game over! score <n>\\n` and return the score, leaving the picture as it was.',
      '4. If the new head is on the food, the snake grows by one (the tail stays). Otherwise erase the tail cell to 0 and drop it.',
      '5. Repaint the old head as body, then the new head as head. If it ate: score + 1, then place new food.',
      '',
      'Draw only the cells that change: a whole-screen redraw is 64,000 stores per key.',
    ].join('\n'),
    hints: [
      'Keep the snake in two arrays xs[] and ys[] (head at index 0) and a length. Moving is shifting everything one place toward the tail, then writing the new head at 0.',
      'fill_cell: row = fb + (y * CELL) * 320 + x * CELL; ten times: set row[0..9] = color; row += 320.',
      'Straight back means: w while dy == 1, s while dy == -1, a while dx == 1, d while dx == -1.',
      'Order matters for the picture: when not growing, erase the tail before moving; repaint the old head as BODY before painting the new head; place food after painting the head.',
      'getkey() returns -1 until a key arrives: loop on it (continue) instead of treating -1 as a key.',
    ],
    afterword:
      "You started with a NAND gate. You built logic, arithmetic, memory, a CPU, an assembler's worth of programs, devices, C, and an operating system with processes, virtual memory and files, and now a game runs on all of it. " +
      'Every computer you will ever use is these same ideas, made faster and bigger. Congratulations.',
    code: osCode('os-final-game', ['uart', 'keyboard', 'framebuffer', 'timer', 'disk']),
    tests: SNAKE_CASES.map((c) => {
      const m = snakeModel(c.keys);
      return osTest('os-final-game', c.name, {
        disk: 'os',
        input: c.keys,
        uart: m.uart,
        exitCode: m.score,
        framebufferSha256: SNAKE_SHA256[c.name]!,
        maxSteps: 60_000_000,
      });
    }),
    requires: [SHELL],
  }),
];
