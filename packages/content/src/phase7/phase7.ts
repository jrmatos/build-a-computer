import type { Level } from '@build-a-computer/schema';
import { defineLevel } from '../define';
import { NO_BOARD, rv, u32 } from '../phase6/common';
import {
  DISK_IMAGE,
  DISK_LIBRARY,
  MISA,
  PHASE6_LAST_REQUIRED_ID,
  SECTOR_SIZE,
  TIMER_PERIOD,
  TRAP_LIBRARY,
  UART_LIBRARY,
  bytesOf,
  diskImageHex,
  le32,
} from './common';

/**
 * Phase 7, Devices and interrupts: memory-mapped I/O, UART output, keyboard
 * polling, CSRs and the timer, trap handler, timer interrupt, framebuffer,
 * block device. Code levels on the full machine (docs/devices.md lists every
 * register). DRAFT text (owner approves). CNT-09.
 */

const base = {
  track: 'nand-to-os' as const,
  phase: 7,
  palette: [] as Level['palette'],
  starter: NO_BOARD,
  mode: 'code' as const,
};

/** 1 MiB: the block-device level's disk image sits at RAM + 512 KiB. */
const RAM_SIZE = 1024 * 1024;

const EXIT = 'li   a7, 93          # exit: a7 = 93, code in a0\n    ecall';
const code = (
  starter: string,
  devices: NonNullable<Level['code']>['devices'],
  library: { name: string; text: string }[] = [],
) => ({
  language: 'rv32-asm' as const,
  starter,
  devices,
  ramSize: RAM_SIZE,
  library,
});

// ------------------------------------------------------------- test models

const charCase = (name: string, a0: number, input?: string) =>
  rv(
    name,
    { regs: { a0: u32(a0) } },
    { uart: String.fromCharCode(a0 & 0xff).repeat(2), regs: { a1: input ? 0x61 : 0x60 } },
    1_000,
  );
const withInput = <T extends object>(t: T, input: string | undefined): T =>
  input === undefined ? t : { ...t, input };

const helloCase = (n: number) =>
  rv(`a0 = ${n}`, { regs: { a0: u32(n) } }, { uart: `Hello, world!\n${u32(n)}\n` }, 10_000);

/** What the keyboard level prints and returns for some typed text. */
export function keyboardModel(typed: string): { uart: string; count: number } {
  const line = typed.slice(0, typed.indexOf('\n'));
  return { uart: line.replace(/[a-z]/g, (c) => c.toUpperCase()) + '\n', count: line.length };
}
const keyCase = (name: string, typed: string) => {
  const m = keyboardModel(typed);
  return { ...rv(name, undefined, { uart: m.uart, exitCode: m.count }, 100_000), input: typed };
};

const timerCase = (n: number) =>
  rv(
    `wait ${n} ticks`,
    { regs: { a0: n } },
    { regs: { a1: MISA }, exitCode: Math.floor(n / 1000) },
    2_000_000,
  );

/** What the trap-handler level prints and returns for some UART input. */
export function trapModel(input: string): { uart: string; faults: number } {
  let uart = '';
  let faults = 0;
  for (const c of input) {
    if ('!~#%'.includes(c)) faults++;
    else uart += c;
  }
  return { uart, faults };
}
const trapCase = (name: string, input: string) => {
  const m = trapModel(input);
  return withInput(
    rv(name, undefined, { uart: m.uart, exitCode: m.faults }, 200_000),
    input || undefined,
  );
};

const tickCase = (n: number) =>
  rv(
    `${n} interrupts`,
    { regs: { a0: n } },
    { uart: '.'.repeat(n) + '\n', exitCode: n, regs: { a1: n > 0 ? 0x8000_0007 : 0 } },
    1_000_000,
  );

/**
 * SHA-256 of the framebuffer after the drawing level's program, by test.
 * Computed from the reference solution and checked against a model of the
 * picture in phase7.test.ts.
 */
export const FRAMEBUFFER_SHA256: Record<string, string> = {
  'blue, 50 x 50': '8593c322758f01def54dc61e8465d03d81d9d31c937c48895b993d1facd56396',
  'black, no square': '0f97372f9e681fb12eb9794a446e7c113721e1744f48419e261976b2620d006e',
  'white on white': '8a02b6d6a09601a1ab4c3f195b70ca6ca3c2dd396a731e105b5aebd72cdee153',
  'red, biggest square': '863ac44a747085d21552b537964ee25fa8009f28f56952e7de60ac7bd75fcff2',
};
export const FRAMEBUFFER_CASES: { name: string; bg: number; size: number }[] = [
  { name: 'blue, 50 x 50', bg: 1, size: 50 },
  { name: 'black, no square', bg: 0, size: 0 },
  { name: 'white on white', bg: 15, size: 20 },
  { name: 'red, biggest square', bg: 4, size: 180 },
];
const fbCase = (c: (typeof FRAMEBUFFER_CASES)[number]) =>
  rv(
    c.name,
    { regs: { a0: c.bg, a1: c.size } },
    { framebufferSha256: FRAMEBUFFER_SHA256[c.name]! },
    2_000_000,
  );

/** A disk for the block-device level: directory in sector 0, then `sectors`. */
export function diskCase(
  name: string,
  start: number,
  message: string,
  sectors: number,
  at = start,
) {
  const bytes = bytesOf(message);
  const disk: number[][] = [[...le32(start), ...le32(bytes.length)]];
  for (let s = 1; s < sectors; s++)
    disk.push(bytesOf(`decoy sector ${s} `.repeat(20)).slice(0, SECTOR_SIZE));
  bytes.forEach((b, i) => {
    const s = at + Math.floor(i / SECTOR_SIZE);
    disk[s]![i % SECTOR_SIZE] = b;
  });
  const ok = start < sectors;
  const sum = bytes.reduce((a, b) => a + b, 0);
  return rv(
    name,
    { memory: [{ addr: DISK_IMAGE, hex: diskImageHex(disk) }] },
    ok ? { uart: message, exitCode: u32(sum) } : { uart: 'disk error\n', exitCode: 0xffff_ffff },
    300_000,
  );
}
const LONG_MESSAGE = Array.from(
  { length: 15 },
  (_, i) => `Line ${String(i + 1).padStart(2, '0')}: the disk keeps it.\n`,
)
  .join('')
  .repeat(2);

// ------------------------------------------------------------------- levels

export const PHASE7: Level[] = [
  defineLevel({
    ...base,
    id: 'mmio-basics',
    order: 1,
    title: 'Memory-mapped I/O',
    goal:
      'a0 holds a character code. Send it to the UART twice by storing it to the transmit register at 0x10000000. ' +
      'Then load the line status register (0x10000005) into a1 and stop with ebreak.',
    tutorial:
      'A CPU only knows how to load and store. So devices pretend to be memory: each one owns a range of addresses, and its registers ' +
      'sit at fixed offsets in that range. A store to such an address is a command to the device; a load asks it a question. ' +
      'No new instructions are needed.\n\n' +
      'The UART (a serial port, shown as the console) lives at 0x10000000. Its registers are one byte each:\n\n' +
      '| Address | Name | Read | Write |\n| --- | --- | --- | --- |\n' +
      '| 0x10000000 | THR / RBR | next received byte | send a byte |\n' +
      '| 0x10000005 | LSR (line status) | bit 0: a byte is waiting; bits 5, 6: ready to send | — |\n\n' +
      'Device registers are not ordinary memory. Storing to THR twice sends two bytes, and the value you read from LSR depends on what ' +
      'the outside world has typed. Use byte stores (`sb`) and byte loads (`lbu`) for byte registers.\n\n' +
      'The full machine map is in docs/devices.md.',
    hints: [
      'Put the address in a register first: li t0, 0x10000000. Then the THR is 0(t0) and the LSR is 5(t0).',
      'sb stores only the low byte of a register, which is exactly one character.',
      'lbu a1, 5(t0) reads the line status. This UART can always send, so bits 5 and 6 are set (0x60); bit 0 is set too when a byte has arrived.',
      'li t0, 0x10000000 / sb a0, 0(t0) / sb a0, 0(t0) / lbu a1, 5(t0) / ebreak',
    ],
    afterword:
      'Every device in this machine works like this, from the timer to the screen. The address map is the whole contract between the CPU and the world. ' +
      'Real hardware adds one rule you will meet later: compilers must not merge or reorder these accesses, which is what C calls `volatile`.',
    code: code(
      '# a0 = a character. Send it to the UART twice, then read the line status into a1.\n' +
        '    .equ UART, 0x10000000\n' +
        '    li   t0, UART\n' +
        '    # TODO: store a0 to the transmit register (offset 0), twice\n' +
        '    # TODO: load the line status register (offset 5) into a1\n' +
        '    ebreak\n',
      ['uart'],
    ),
    tests: [
      charCase("'A'", 0x41),
      charCase('newline', 10),
      charCase('only the low byte counts', 0x1234_562a),
      withInput(charCase('a byte is waiting', 0x23, 'z'), 'z'),
    ],
    requires: [PHASE6_LAST_REQUIRED_ID],
  }),
  defineLevel({
    ...base,
    id: 'uart-output',
    order: 2,
    title: 'Hello, world',
    goal: 'Print "Hello, world!" and a newline. Then print a0 as an unsigned decimal number, followed by a newline.',
    tutorial:
      "Text is bytes; a number is not. To print 42 you must send the characters '4' and '2': the digits of the number, as ASCII ('0' is 48).\n\n" +
      '`remu` gives the last digit (n % 10) and `divu` drops it (n / 10). That produces digits from last to first, so store them in a ' +
      'small buffer from the end backwards, then print the buffer forwards.\n\n' +
      '| Register | Address | Use |\n| --- | --- | --- |\n| THR | 0x10000000 | store a byte to print it |\n\n' +
      'Put the greeting in read-only data:\n\n' +
      '```asm\n    .section .rodata\nhello:\n    .asciz "Hello, world!\\n"\n```\n\n' +
      'a0 is unsigned: 0xffffffff prints as 4294967295.',
    hints: [
      'Two parts: a loop that prints a 0-terminated string (lbu, beqz, sb, addi), then a number printer.',
      'Reserve a buffer in .bss with .space 12 and a label after it. Start a pointer at that end label and move it down one byte per digit.',
      'Use a do-while loop for the digits (divide first, test after) so that 0 still prints "0".',
      "Digit loop: remu t2, s0, t3 / divu s0, s0, t3 / addi t2, t2, '0' / addi t1, t1, -1 / sb t2, 0(t1) / bnez s0, digit — with t3 = 10. Then print from t1 up to the end label.",
    ],
    afterword:
      'This is the heart of printf("%u"). The C library you meet later does the same divide-by-ten loop, and so do the kernel\'s log messages.',
    code: code(
      '# Print "Hello, world!\\n", then a0 in decimal and "\\n".\n' +
        '    .equ UART, 0x10000000\n' +
        '    .section .rodata\n' +
        'hello:\n' +
        '    .asciz "Hello, world!\\n"\n\n' +
        '    .text\n' +
        '    .globl _start\n' +
        '_start:\n' +
        '    li   t0, UART\n' +
        '    # TODO: print the string at hello\n' +
        '    # TODO: print a0 in decimal, then a newline\n' +
        '    ebreak\n',
      ['uart'],
    ),
    tests: [0, 7, 42, 1_000_000, 2_147_483_648, 4_294_967_295].map(helloCase),
    requires: ['mmio-basics'],
  }),
  defineLevel({
    ...base,
    id: 'keyboard-polling',
    order: 3,
    title: 'Keyboard polling',
    goal:
      'Read keys from the keyboard by polling its status register. Echo each key to the UART with a–z turned into A–Z. ' +
      'When the key is a newline (10), echo it too and exit with the number of keys before it.',
    tutorial:
      'Input is harder than output: the key arrives when the person presses it, not when your program wants it. The simplest answer ' +
      'is polling: ask the device again and again whether something is there.\n\n' +
      '| Address | Name | Read | Write |\n| --- | --- | --- | --- |\n' +
      '| 0x10001000 | STATUS | bit 0 = a key is waiting | — |\n' +
      '| 0x10001004 | DATA | the next key (ASCII), removed from the queue; 0 if none | — |\n' +
      '| 0x10001008 | CONTROL | bit 0 = interrupt enable | bit 0 |\n\n' +
      'Reading DATA takes the key out of the queue, so read it once and keep it in a register. Use word loads (`lw`) for these registers.\n\n' +
      'The library file uart.s gives you `putc` (print a0), `puts` and `print_uint`. Call them with `call putc`; they may change a0 and t0–t3.',
    hints: [
      'The polling loop is three instructions: lw t0, 0(s0) / andi t0, t0, 1 / beqz t0, wait.',
      'Keep the keyboard address and the counter in s registers: putc may change t0–t3 and a0.',
      "Uppercase only 'a' to 'z' (97 to 122) by subtracting 32. Check for the newline before converting.",
      'Echo the newline, then mv a0, s1 and exit with li a7, 93 / ecall.',
    ],
    afterword:
      'Polling burns every cycle asking "anything yet?". It is fine for a boot loader and wasteful for everything else. Two levels from now ' +
      'you will let the device interrupt the CPU instead.',
    code: code(
      '# Echo keys in uppercase until a newline; exit with the number of keys before it.\n' +
        '    .equ KBD, 0x10001000\n' +
        '    .text\n' +
        '    .globl _start\n' +
        '_start:\n' +
        '    li   s0, KBD\n' +
        '    li   s1, 0          # keys before the newline\n' +
        '    # TODO: wait for STATUS bit 0, read DATA, uppercase a-z, call putc, count\n' +
        '    mv   a0, s1\n' +
        `    ${EXIT}\n`,
      ['keyboard', 'uart'],
      [{ name: 'uart.s', text: UART_LIBRARY }],
    ),
    tests: [
      keyCase('hello', 'hello\n'),
      keyCase('just Enter', '\n'),
      keyCase('Mixed Case 42!', 'Mixed Case 42!\n'),
      keyCase('edges: `az{@AZ[', '`az{@AZ[\n'),
      keyCase('stops at the first newline', 'two\nlines\n'),
    ],
    requires: ['uart-output'],
  }),
  defineLevel({
    ...base,
    id: 'csr-timer',
    order: 4,
    title: 'CSRs and the timer',
    goal:
      'Read the misa CSR into a1. Then busy-wait until at least a0 ticks of mtime have passed since you started waiting, ' +
      'and exit with the elapsed ticks divided by 1000 (rounded down).',
    tutorial:
      'Besides the 32 registers, the CPU has control and status registers (CSRs): a separate space of 4096 numbers, read and written with ' +
      'special instructions. `csrr rd, name` reads one; `csrw name, rs` writes one; `csrs` / `csrc` set or clear bits.\n\n' +
      '| CSR | What it holds |\n| --- | --- |\n' +
      '| misa | the instruction set: a bit per extension letter (I, M, A, S, U) |\n' +
      '| mhartid | which core this is (0) |\n' +
      '| cycle / instret | cycles run / instructions retired |\n' +
      '| time | a copy of mtime, read with `rdtime rd` |\n\n' +
      'Time comes from the CLINT timer, a device:\n\n' +
      '| Address | Name | Use |\n| --- | --- | --- |\n' +
      '| 0x0200BFF8 | mtime (low word, high at +4) | counts up by one every tick |\n' +
      '| 0x02004000 | mtimecmp (low word, high at +4) | used next level |\n\n' +
      'Here a tick is one instruction. To wait, read the time, then read it again until `now − start ≥ a0`. Subtracting first and comparing ' +
      'the difference with `bltu` stays right even when the low word wraps around.',
    hints: [
      'csrr a1, misa does the first part. Do it before you start waiting.',
      'rdtime t0 reads the start time. Then loop: rdtime t1 / sub t2, t1, t0 / bltu t2, a0, spin.',
      'After the loop, t2 is the elapsed time: just past a0, by a few ticks. divu by 1000 (li it into a register) and exit with that.',
      'csrr a1, misa / rdtime t0 / spin: rdtime t1 / sub t2, t1, t0 / bltu t2, a0, spin / li t3, 1000 / divu a0, t2, t3 / li a7, 93 / ecall',
    ],
    afterword:
      'Busy-waiting works but keeps the CPU at full speed doing nothing. mtimecmp, which you have not touched yet, lets the timer wake ' +
      'the CPU instead. That needs a trap handler first.',
    code: code(
      '# a0 = ticks to wait. a1 = misa. Exit with elapsed ticks / 1000.\n' +
        '    .text\n' +
        '    .globl _start\n' +
        '_start:\n' +
        '    # TODO: read misa into a1\n' +
        '    # TODO: read the time, then spin until at least a0 ticks have passed\n' +
        '    li   a0, 0\n' +
        `    ${EXIT}\n`,
      ['timer'],
    ),
    tests: [0, 1000, 7000, 50_000].map(timerCase),
    requires: ['keyboard-polling'],
  }),
  defineLevel({
    ...base,
    id: 'trap-handler',
    order: 5,
    title: 'Trap handler',
    goal:
      'Install a trap handler, then call run_program. On ecall with a7 = 1, print the byte in a0. On any other trap, count it. ' +
      'Either way resume after the trapping instruction and change no register. When run_program returns, exit with the count.',
    tutorial:
      'Some instructions cannot finish: an ecall asks for a service, a word is not a valid instruction, a load is misaligned. ' +
      'Then the CPU traps: it saves where it was and jumps to a handler.\n\n' +
      '| CSR | On a trap |\n| --- | --- |\n' +
      '| mtvec | where to jump (set it before anything traps; 4-byte aligned) |\n' +
      '| mepc | address of the instruction that trapped |\n' +
      '| mcause | why: 2 illegal instruction, 4 misaligned load, 11 ecall from machine mode |\n' +
      '| mtval | extra detail: the bad word or address |\n' +
      '| mscratch | free for the handler: a place to park a register |\n\n' +
      '`mret` returns to mepc. For an exception, mepc points at the trapping instruction itself, so add 4 first or it traps forever.\n\n' +
      "The handler runs in the middle of someone else's code, so it must put back every register it uses, t registers included. " +
      'run_program (in program.s) checks that. Save one register to mscratch with `csrw mscratch, t0`, then use it to point at a save area.',
    hints: [
      'In _start: la t0, handler / csrw mtvec, t0 / call run_program. Put .align 2 before handler.',
      'Handler entry: csrw mscratch, t0 / la t0, save / sw t1, 0(t0) / sw t2, 4(t0). Now t0, t1, t2 are yours.',
      'csrr t1, mcause. If it is 11 and a7 is 1, store a0 to the UART. Otherwise add 1 to a counter in .data.',
      'Leaving: csrr t1, mepc / addi t1, t1, 4 / csrw mepc, t1 / reload t1, t2 / csrr t0, mscratch / mret.',
      'After run_program returns, load the counter into a0 and exit with li a7, 93 / ecall (the exit call is handled by the machine, not by your handler).',
    ],
    afterword:
      'This is how an operating system starts: one handler that every system call, fault and interrupt goes through. ' +
      'An illegal instruction is not always a bug, either: early kernels used this exact trap to emulate missing multiply instructions in software.',
    code: code(
      '# Install a trap handler, call run_program, exit with the number of non-ecall traps.\n' +
        '    .text\n' +
        '    .globl _start\n' +
        '_start:\n' +
        '    # TODO: point mtvec at handler\n' +
        '    call run_program\n' +
        '    li   a0, 0          # TODO: the number of traps you counted\n' +
        `    ${EXIT}\n\n` +
        '    .align 2\n' +
        'handler:\n' +
        '    # TODO: save registers, check mcause, print or count, mepc += 4\n' +
        '    mret\n',
      ['uart'],
      [{ name: 'program.s', text: TRAP_LIBRARY }],
    ),
    tests: [
      trapCase('only ecalls', 'hi'),
      trapCase('no input', ''),
      trapCase('E-CPU-08: all-zero and all-ones words', 'a!b~c'),
      trapCase('E-CPU-05: misaligned loads', '%x%'),
      trapCase('writing a read-only CSR', '#ok'),
      trapCase('eight faults in a row', '!!!!~~~~'),
      trapCase('everything', 'A!B~C#D%E\n'),
    ],
    requires: ['csr-timer'],
  }),
  defineLevel({
    ...base,
    id: 'timer-interrupt',
    order: 6,
    title: 'Timer interrupt',
    goal:
      `a0 = N. Make the timer interrupt every ${TIMER_PERIOD} ticks. The handler prints "." and counts. The main loop sleeps with wfi until ` +
      'N interrupts have happened, then prints a newline and exits with the count, with a1 = the last mcause seen by the handler (0 if none).',
    tutorial:
      'An interrupt is a trap that comes from outside the instruction stream. The timer raises one when mtime ≥ mtimecmp. Three switches must be on:\n\n' +
      '| Where | Bit | Meaning |\n| --- | --- | --- |\n' +
      '| mtimecmp (0x02004000) | — | when to fire |\n' +
      '| mie CSR | 7 (MTIE) | timer interrupts enabled |\n' +
      '| mstatus CSR | 3 (MIE) | interrupts enabled at all |\n\n' +
      'In the handler, mcause has bit 31 set (an interrupt) and code 7 (machine timer): 0x80000007. mepc is the instruction to resume at, ' +
      'so do not add 4. The interrupt stays pending until mtime < mtimecmp again: the handler must move mtimecmp forward.\n\n' +
      'mtimecmp is 64 bits written as two words. Write the low word as 0xffffffff first, then the high word, then the real low word, ' +
      'so it never briefly holds a value that fires early.\n\n' +
      '`wfi` sleeps until an interrupt is pending. The machine skips the idle time, so waiting costs nothing. ' +
      'If nothing can ever wake it (E-CPU-11), the test stops and says the program is waiting for an interrupt that never comes.',
    hints: [
      'Order: set mtvec, set mtimecmp = mtime + 10000, csrs mie with 0x80, csrsi mstatus, 8. Then the loop: load the count, stop if ≥ N, wfi, repeat.',
      'Write a small arm function that does mtimecmp = mtime + 10000 (with the carry into the high word) and call it from both _start and the handler.',
      'The handler uses the stack: addi sp, sp, -32 and save ra and every t register it touches, then restore them before mret.',
      "Handler body: csrr t0, mcause and store it; add 1 to the count; store '.' to the UART; call arm.",
      "When done: csrci mstatus, 8 so no more interrupts arrive, print '\\n', load the count into a0 and the saved cause into a1, and exit.",
    ],
    afterword:
      'A timer interrupt is how an operating system takes the CPU back from a program that never gives it up. ' +
      'Your handler plus a list of saved register sets is a scheduler: on each tick, save one program and resume another.',
    code: code(
      `# a0 = N. Interrupt every ${TIMER_PERIOD} ticks; the handler prints '.' and counts.\n` +
        '    .equ MTIMECMP, 0x02004000\n' +
        '    .equ MTIME, 0x0200bff8\n' +
        '    .equ UART, 0x10000000\n' +
        `    .equ PERIOD, ${TIMER_PERIOD}\n` +
        '    .text\n' +
        '    .globl _start\n' +
        '_start:\n' +
        '    mv   s0, a0         # N\n' +
        '    # TODO: mtvec, mtimecmp, mie.MTIE, mstatus.MIE; then wfi until ticks >= N\n' +
        '    la   t0, ticks\n' +
        '    lw   a0, 0(t0)\n' +
        '    la   t0, last_cause\n' +
        '    lw   a1, 0(t0)\n' +
        `    ${EXIT}\n\n` +
        '    .align 2\n' +
        'handler:\n' +
        "    # TODO: save registers, record mcause, count, print '.', move mtimecmp on\n" +
        '    mret\n\n' +
        '    .data\n' +
        'ticks:      .word 0\n' +
        'last_cause: .word 0\n',
      ['timer', 'uart'],
    ),
    tests: [0, 1, 3, 10].map(tickCase),
    requires: ['trap-handler'],
  }),
  defineLevel({
    ...base,
    id: 'draw-framebuffer',
    order: 7,
    title: 'Framebuffer',
    goal:
      'a0 = a background color, a1 = a size S (0 to 180). Fill the screen with a0. Draw a one-pixel white (15) border around the edge. ' +
      'Then draw a filled S × S square of light red (12) with its top-left corner at (10, 10). Stop with ebreak.',
    tutorial:
      'The screen is memory too: 320 × 200 pixels, one byte each, row after row starting at 0x20000000. Pixel (x, y) is at ' +
      '0x20000000 + y × 320 + x. Each byte is an index into a 256-color palette.\n\n' +
      '| Address | Name | Use |\n| --- | --- | --- |\n' +
      '| 0x10003000 | WIDTH | 320 (read only) |\n' +
      '| 0x10003004 | HEIGHT | 200 (read only) |\n' +
      '| 0x10003008 | ENABLE | write 1 to show the picture |\n' +
      '| 0x1000300C | FRAME | frames shown so far |\n' +
      '| 0x10003400 | PALETTE | 256 words, 0x00RRGGBB |\n' +
      '| 0x20000000 | PIXELS | 64,000 bytes |\n\n' +
      'The default palette starts with the 16 classic PC colors: 0 black, 1 blue, 4 red, 12 light red, 15 white. ' +
      'The test compares a fingerprint (SHA-256) of all 64,000 bytes, so every pixel counts.',
    hints: [
      'Fill: a pointer from 0x20000000 up to 0x20000000 + 64000, sb a0 each time. The assembler computes constants: li t1, FB + W*H.',
      'Border: one loop of 320 writes the top row and the bottom row (start 0x20000000 + 199 × 320) together; one loop of 200 writes x = 0 and x = 319 of each row (offsets 0 and 319, step 320).',
      'Square: two nested loops. The outer one walks rows (add 320), the inner one writes S bytes. If S is 0, draw nothing.',
      'Draw in this order: background, border, square. The square never reaches the border (10 + 180 < 199).',
    ],
    afterword:
      'Every pixel through the CPU is slow: a full-screen fill is 64,000 stores. Real graphics hardware adds blitters and then GPUs ' +
      'so the CPU can describe a picture instead of painting it. Try changing a palette entry: every pixel with that index changes at once.',
    code: code(
      '# a0 = background color, a1 = square size. Background, white border, light red square at (10, 10).\n' +
        '    .equ FB, 0x20000000\n' +
        '    .equ FBCTL, 0x10003000\n' +
        '    .equ W, 320\n' +
        '    .equ H, 200\n' +
        '    .text\n' +
        '    .globl _start\n' +
        '_start:\n' +
        '    li   t0, FBCTL\n' +
        '    li   t1, 1\n' +
        '    sw   t1, 8(t0)      # enable the screen\n' +
        '    # TODO: fill, border, square\n' +
        '    ebreak\n',
      ['framebuffer'],
    ),
    tests: FRAMEBUFFER_CASES.map(fbCase),
    requires: ['timer-interrupt'],
  }),
  defineLevel({
    ...base,
    id: 'block-device',
    order: 8,
    title: 'Block device',
    goal:
      'Write main. Read sector 0: word 0 is the first sector of a message, word 1 its length in bytes. Read the message (it may span sectors), ' +
      'print it to the UART and return the sum of its bytes. If a read fails, print "disk error\\n" and return −1.',
    tutorial:
      'A disk is too big to map into memory, so it works in blocks: you ask for a 512-byte sector and it appears in a buffer.\n\n' +
      '| Address | Name | Use |\n| --- | --- | --- |\n' +
      '| 0x10002000 | SECTOR | which sector to read or write |\n' +
      '| 0x10002004 | COMMAND | write 1 = read sector into buffer, 2 = write buffer to sector |\n' +
      '| 0x10002008 | STATUS | 0 = done, 1 = error (no such sector) |\n' +
      '| 0x1000200C | COUNT | number of sectors on the disk |\n' +
      '| 0x10002200 | BUFFER | 512 bytes |\n\n' +
      'A command finishes at once, so read STATUS right after it. Byte i of the message is byte i % 512 of sector start + i / 512.\n\n' +
      "boot.s runs first: it writes the test's disk, then calls your main and exits with the a0 you return.",
    hints: [
      'Reading a sector: sw the number to SECTOR, li t1, 1 / sw t1, COMMAND, then lw STATUS and branch to the error path if it is not 0.',
      'After reading sector 0, lw the start sector from BUFFER+0 and the length from BUFFER+4. Note that 0x200 fits in a load offset: lw a1, 0x200(t0).',
      'Keep an offset into the buffer. When it reaches 512, read the next sector and set it back to 0. Start it at 512 so the first byte triggers the first read.',
      'For each byte: lbu from 0x200(BLK + offset), sb it to the UART, add it to the sum, then offset + 1 and length − 1. A length of 0 prints nothing and returns 0.',
    ],
    afterword:
      'Files, directories and the operating system itself all live in sectors like these. Sector 0 holding "where things are" is a tiny file ' +
      'system; the boot ROM in the next phase reads a kernel from disk exactly this way.',
    code: code(
      '# main: read the directory in sector 0, print the message, return the sum of its bytes.\n' +
        '    .equ BLK, 0x10002000\n' +
        '    .equ UART, 0x10000000\n' +
        '    .text\n' +
        '    .globl main\n' +
        'main:\n' +
        '    li   t0, BLK\n' +
        '    # TODO: read sector 0, then the message sectors\n' +
        '    li   a0, 0\n' +
        '    ret\n',
      ['disk', 'uart'],
      [{ name: 'boot.s', text: DISK_LIBRARY }],
    ),
    tests: [
      diskCase('hello from disk', 1, 'Hello from the disk!\n', 2),
      diskCase('empty message', 1, '', 2),
      diskCase('starts after decoys', 3, 'third time lucky\n', 4),
      diskCase('spans two sectors', 1, LONG_MESSAGE, 3),
      diskCase('no such sector', 0x7fff_ffff, 'lost', 2, 1),
    ],
    requires: ['draw-framebuffer'],
  }),
];
