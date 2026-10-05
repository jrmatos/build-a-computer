/**
 * Shared pieces of the Phase 7 (Devices and interrupts) code levels: device
 * addresses (as implemented in packages/rv32, documented for players in
 * docs/devices.md), the read-only library files some levels assemble with
 * the player's source, and test-data helpers. Machine conventions (RAM base,
 * sp, exit) follow docs/code-levels.md.
 */

/** Id of the last required (non-optional) Phase 6 level; Phase 7 starts after it. */
export const PHASE6_LAST_REQUIRED_ID = 'strings-uart';

/** UART 16550 subset: transmit/receive register; line status is at +5. */
export const UART = 0x1000_0000;
/** Keyboard: status at +0 (bit 0 = key waiting), data at +4. */
export const KEYBOARD = 0x1000_1000;
/** Block device: sector +0, command +4, status +8, count +0xc, buffer +0x200. */
export const BLOCK = 0x1000_2000;
/** Framebuffer control: width +0, height +4, enable +8, frame +0xc, palette +0x400. */
export const FB_CONTROL = 0x1000_3000;
/** Framebuffer pixels: 320 x 200 bytes, one palette index each. */
export const FB_PIXELS = 0x2000_0000;
export const FB_WIDTH = 320;
export const FB_HEIGHT = 200;
/** CLINT registers. */
export const MTIMECMP = 0x0200_4000;
export const MTIME = 0x0200_bff8;

/** misa of this machine: RV32 with I, M, A, S and U. */
export const MISA = 0x4014_1101;

/** Ticks between timer interrupts in the timer-interrupt level. */
export const TIMER_PERIOD = 10_000;

/** Where a block-device test puts its disk image in RAM before the library copies it to disk. */
export const DISK_IMAGE = 0x8008_0000;
export const SECTOR_SIZE = 512;

/** The ASCII bytes of a string (Latin-1, one byte per character). */
export const bytesOf = (s: string): number[] => [...s].map((c) => c.charCodeAt(0) & 0xff);

/** Bytes as a hex string, two digits each. */
export const hexOf = (bytes: readonly number[]): string =>
  bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join('');

/** Little-endian bytes of a 32-bit word. */
export const le32 = (w: number): number[] => [0, 8, 16, 24].map((s) => (w >>> s) & 0xff);

/**
 * A disk image for the block-device level, laid out as the library expects
 * at DISK_IMAGE: one word with the sector count, then the sectors.
 * `sectors[i]` is padded with zeros to 512 bytes.
 */
export function diskImageHex(sectors: readonly (readonly number[])[]): string {
  const out: number[] = le32(sectors.length);
  for (const s of sectors) {
    if (s.length > SECTOR_SIZE) throw new Error('sector longer than 512 bytes');
    out.push(...s, ...new Array<number>(SECTOR_SIZE - s.length).fill(0));
  }
  return hexOf(out);
}

/** UART helpers shared by several levels: putc, puts and print_uint. */
export const UART_LIBRARY = `# uart.s: provided by the level (read only).
#   putc(a0)        print the byte in a0
#   puts(a0)        print the 0-terminated string at a0
#   print_uint(a0)  print a0 as an unsigned decimal number
# They change only a0 and t0-t3, like any function may.
    .equ UART_THR, 0x10000000
    .text
    .globl putc
putc:
    li   t0, UART_THR
    sb   a0, 0(t0)
    ret

    .globl puts
puts:
    li   t0, UART_THR
1:  lbu  t1, 0(a0)
    beqz t1, 2f
    sb   t1, 0(t0)
    addi a0, a0, 1
    j    1b
2:  ret

    .globl print_uint
print_uint:
    addi sp, sp, -16        # up to 10 digits, built backwards on the stack
    addi t1, sp, 12
    li   t2, 10
3:  remu t3, a0, t2
    divu a0, a0, t2
    addi t3, t3, '0'
    addi t1, t1, -1
    sb   t3, 0(t1)
    bnez a0, 3b
    li   t0, UART_THR
    addi t2, sp, 12
4:  lbu  t3, 0(t1)
    sb   t3, 0(t0)
    addi t1, t1, 1
    bne  t1, t2, 4b
    addi sp, sp, 16
    ret
`;

/**
 * The program the trap-handler level's handler must survive. It reads
 * characters from the UART until there are none left and, for each one:
 * '!' runs the all-zero word, '~' runs 0xffffffff, '#' writes the read-only
 * cycle CSR (all illegal instructions), '%' loads a word from an odd address
 * (misaligned), anything else is printed with ecall (a7 = 1). After every
 * trap it checks that no register changed. Returns a0 = characters read.
 */
export const TRAP_LIBRARY = `# program.s: provided by the level (read only). Your handler must survive it.
    .equ UART, 0x10000000
    .text
    .globl run_program
run_program:
    addi sp, sp, -16
    sw   ra, 12(sp)
    sw   s0, 8(sp)
    li   s0, 0               # characters read
    li   t6, 0x5a5a5a5a      # canary: no trap may change it
    li   t4, UART
next:
    lbu  t0, 5(t4)           # line status: bit 0 = a byte is waiting
    andi t0, t0, 1
    beqz t0, finished
    lbu  a0, 0(t4)           # read the byte
    addi s0, s0, 1
    mv   t3, a0              # copy: a0 must survive the trap too
    li   t1, '!'
    beq  a0, t1, zero_word
    li   t1, '~'
    beq  a0, t1, ones_word
    li   t1, '#'
    beq  a0, t1, csr_write
    li   t1, '%'
    beq  a0, t1, misaligned
    li   a7, 1               # system call 1: print the byte in a0
    ecall
    j    check
zero_word:
    .word 0x00000000         # E-CPU-08: the all-zero word is illegal
    j    check
ones_word:
    .word 0xffffffff         # also illegal
    j    check
csr_write:
    csrw cycle, zero         # cycle is read-only: illegal
    j    check
misaligned:
    addi t5, sp, 1           # E-CPU-05: lw from an odd address
    lw   t5, 0(t5)
    j    check
check:
    li   t1, 0x5a5a5a5a
    bne  t6, t1, clobbered
    bne  a0, t3, clobbered
    li   t1, UART
    bne  t4, t1, clobbered
    j    next
clobbered:
    la   t0, msg
    li   t1, UART
1:  lbu  t2, 0(t0)
    beqz t2, finished
    sb   t2, 0(t1)
    addi t0, t0, 1
    j    1b
finished:
    mv   a0, s0
    lw   s0, 8(sp)
    lw   ra, 12(sp)
    addi sp, sp, 16
    ret

    .section .rodata
msg:
    .asciz "\\n[a register changed during a trap]\\n"
`;

/**
 * Runs first in the block-device level: copies the test's disk image from
 * RAM (DISK_IMAGE) onto the disk with write commands, wipes the RAM copy,
 * resets the device registers, then calls the player's main and exits with
 * its a0.
 */
export const DISK_LIBRARY = `# boot.s: provided by the level (read only). Runs first, then calls your main.
    .equ BLK, 0x10002000
    .equ IMAGE, 0x${DISK_IMAGE.toString(16)}
    .text
    .globl _start
_start:
    li   s0, IMAGE
    lw   s1, 0(s0)           # number of sectors in the test's disk image
    addi s2, s0, 4           # first sector's bytes
    li   s3, BLK
    li   s4, 0               # sector number
1:  bgeu s4, s1, 3f
    sw   s4, 0(s3)           # SECTOR
    li   t0, 0
2:  add  t1, s2, t0
    lw   t2, 0(t1)
    sw   zero, 0(t1)         # wipe the RAM copy: the disk is the only copy
    add  t3, s3, t0
    sw   t2, 0x200(t3)       # buffer
    addi t0, t0, 4
    li   t4, 512
    bltu t0, t4, 2b
    li   t0, 2
    sw   t0, 4(s3)           # COMMAND = 2: write the buffer to the sector
    addi s2, s2, 512
    addi s4, s4, 1
    j    1b
3:  sw   zero, 0(s0)
    li   t0, 0               # clear the buffer so main starts from a clean device
4:  add  t1, s3, t0
    sw   zero, 0x200(t1)
    addi t0, t0, 4
    li   t4, 512
    bltu t0, t4, 4b
    sw   zero, 0(s3)
    li   s0, 0
    li   s1, 0
    li   s2, 0
    li   s3, 0
    li   s4, 0
    call main                # your function: a0 out
    li   a7, 93              # exit with main's a0
    ecall
`;
