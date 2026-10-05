# Devices

Every device in the machine is memory-mapped: its registers sit at fixed
addresses, and ordinary loads and stores talk to it. This page lists them as
implemented in `packages/rv32` (`bus.ts`, `devices.ts`, `machine.ts`). How code
levels start and stop a program (RAM base, `sp`, exit) is in
[`code-levels.md`](code-levels.md).

All values are little-endian. An access to an address no device owns raises an
access fault with the address in `mtval`.

## Memory map

| Region | Base | Size |
| --- | --- | --- |
| Boot ROM (reset vector, read only) | `0x0000_0000` | 64 KiB |
| CLINT timer | `0x0200_0000` | 64 KiB |
| PLIC (interrupt controller) | `0x0C00_0000` | 4 MiB |
| UART | `0x1000_0000` | 256 B |
| Keyboard | `0x1000_1000` | 256 B |
| Block device | `0x1000_2000` | 4 KiB |
| Framebuffer control and palette | `0x1000_3000` | 4 KiB |
| Framebuffer pixels | `0x2000_0000` | 64,000 B |
| RAM | `0x8000_0000` | 1 MiB in code levels (16 MiB default, 64 MiB max) |

## UART (16550 subset), `0x1000_0000`

Byte registers; use `lbu` and `sb`.

| Offset | Name | Read | Write |
| --- | --- | --- | --- |
| 0 | RBR / THR | next received byte (0 when none) | send a byte to the console |
| 1 | IER | interrupt enable: bit 0 data received, bit 1 transmitter empty | same |
| 2 | IIR / FCR | interrupt id: 0x04 data received, 0x02 transmitter empty, 0x01 none | FIFO control: bit 1 clears the receive queue |
| 3 | LCR | line control (bit 7 = DLAB: offsets 0 and 1 become the divisor) | same |
| 4 | MCR | modem control | same |
| 5 | LSR | bit 0 = a byte is waiting; bits 5 and 6 are always 1 (ready to send) | — |
| 6 | MSR | 0xB0 | — |
| 7 | SCR | scratch byte | same |

Sending never has to wait. The UART raises PLIC source 10 when an enabled
interrupt condition holds.

## Keyboard, `0x1000_1000`

Word registers; use `lw` and `sw`.

| Offset | Name | Read | Write |
| --- | --- | --- | --- |
| 0x0 | STATUS | bit 0 = a key is waiting | — |
| 0x4 | DATA | the next key code, removed from the queue (0 when empty) | — |
| 0x8 | CONTROL | bit 0 = interrupt enable | bit 0 |

Printable keys and Enter arrive as ASCII (Enter is 10). With CONTROL bit 0 set,
the keyboard raises PLIC source 11 while keys are waiting.

## CLINT timer, `0x0200_0000`

| Address | Name | Use |
| --- | --- | --- |
| `0x0200_0000` | msip | bit 0: software interrupt |
| `0x0200_4000` | mtimecmp (low; high at +4) | timer interrupt when mtime ≥ mtimecmp |
| `0x0200_BFF8` | mtime (low; high at +4) | counts up one per tick |

In code levels a tick is one instruction. `rdtime rd` (the `time` CSR) reads
mtime too. mtimecmp starts at all ones (never). Writing it as two words: write
the low word as `0xffffffff`, then the high word, then the real low word.

## CSRs used for traps and interrupts

| CSR | Use |
| --- | --- |
| `mstatus` | bit 3 MIE: interrupts on; bit 7 MPIE: MIE before the trap |
| `mie` | bit 3 software, bit 7 timer (MTIE), bit 11 external (PLIC) |
| `mip` | the same bits, pending |
| `mtvec` | handler address (4-byte aligned); low bits 01 = vectored interrupts |
| `mepc` | where the trap happened; `mret` returns there |
| `mcause` | bit 31 set for interrupts. Exceptions: 0 instruction misaligned, 1 instruction access fault, 2 illegal instruction, 3 breakpoint, 4 load misaligned, 5 load access fault, 6 store misaligned, 7 store access fault, 8/9/11 ecall from U/S/M mode. Interrupts: 3 software, 7 timer, 11 external |
| `mtval` | the bad address or instruction word |
| `mscratch` | free for the handler |
| `misa` | `0x40141101`: RV32 with A, I, M, S, U |

`wfi` sleeps until an enabled interrupt is pending (in `mie`), even with
`mstatus.MIE` off. When the timer is armed, the machine skips the idle time.

## PLIC, `0x0C00_0000`

QEMU virt layout, sources 1 to 31 (UART 10, keyboard 11).

| Offset | Use |
| --- | --- |
| `0x000000 + 4 × id` | priority of source id (0 to 7; 0 = never) |
| `0x001000` | pending bits |
| `0x002000` | enable bits, machine mode (supervisor at `0x002080`) |
| `0x200000` | priority threshold, machine mode |
| `0x200004` | claim (read the id) / complete (write the id back) |

An enabled source with priority above the threshold sets `mip` bit 11.

## Block device, `0x1000_2000`

512-byte sectors, programmed I/O. The disk keeps its contents across reset and
power cycles.

| Offset | Name | Use |
| --- | --- | --- |
| 0x000 | SECTOR | sector number for the next command |
| 0x004 | COMMAND | write 1: read the sector into the buffer; 2: write the buffer to the sector |
| 0x008 | STATUS | 0 = done, 1 = error (no such sector, or unknown command) |
| 0x00C | COUNT | number of sectors on the disk |
| 0x200 | BUFFER | 512 bytes; any width of load and store |

Commands finish at once: read STATUS straight after writing COMMAND.

## Framebuffer

320 × 200 pixels, one byte each, row by row from `0x2000_0000`: pixel (x, y)
is at `0x2000_0000 + y × 320 + x`. Each byte is a palette index.

Control at `0x1000_3000`:

| Offset | Name | Use |
| --- | --- | --- |
| 0x000 | WIDTH | 320 (read only) |
| 0x004 | HEIGHT | 200 (read only) |
| 0x008 | ENABLE | bit 0: show the picture |
| 0x00C | FRAME | frames presented so far |
| 0x400 | PALETTE | 256 words, `0x00RRGGBB` |

The default palette is the 16 CGA colors (0 black, 1 blue, 2 green, 3 cyan,
4 red, 5 magenta, 6 brown, 7 light gray, 8 dark gray, 9 light blue, 10 light
green, 11 light cyan, 12 light red, 13 light magenta, 14 yellow, 15 white),
then a 6 × 6 × 6 color cube (16 to 231), then 24 grays (232 to 255).
