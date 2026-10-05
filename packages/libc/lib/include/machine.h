/*
 * machine.h: talking to the hardware directly (docs/devices.md).
 *
 * Devices are memory-mapped: their registers live at fixed addresses, and
 * reading or writing them is an ordinary load or store. `volatile` tells the
 * compiler every access matters, so it never skips or merges one.
 */
#ifndef _MACHINE_H
#define _MACHINE_H

/* Read or write a device register of 1 or 4 bytes. */
#define mmio_read8(addr) (*(volatile unsigned char *)(addr))
#define mmio_write8(addr, value) (*(volatile unsigned char *)(addr) = (value))
#define mmio_read32(addr) (*(volatile unsigned int *)(addr))
#define mmio_write32(addr, value) (*(volatile unsigned int *)(addr) = (value))

/* UART (16550 subset): byte registers. */
#define UART_BASE 0x10000000
#define UART_THR (UART_BASE + 0)  /* write: send a byte */
#define UART_RBR (UART_BASE + 0)  /* read: next received byte */
#define UART_IER (UART_BASE + 1)  /* interrupt enable */
#define UART_LSR (UART_BASE + 5)  /* line status */
#define UART_LSR_DATA_READY 0x01  /* a received byte is waiting */
#define UART_LSR_THR_EMPTY 0x20   /* ready to send */

/* Keyboard: word registers. */
#define KBD_BASE 0x10001000
#define KBD_STATUS (KBD_BASE + 0x0) /* bit 0: a key is waiting */
#define KBD_DATA (KBD_BASE + 0x4)   /* next key code */
#define KBD_CONTROL (KBD_BASE + 0x8) /* bit 0: interrupt enable */

/* CLINT timer. */
#define CLINT_MSIP 0x02000000
#define CLINT_MTIMECMP 0x02004000
#define CLINT_MTIME 0x0200BFF8

/* Framebuffer: 320 x 200 pixels, one palette index per byte. */
#define FB_PIXELS 0x20000000
#define FB_WIDTH 320
#define FB_HEIGHT 200

/* Block device and RAM. */
#define BLOCK_BASE 0x10002000
#define RAM_BASE 0x80000000

/*
 * Control and status registers, by name: csr_read(mstatus),
 * csr_write(mtvec, handler), csr_set(mie, 1 << 7), csr_clear(mstatus, 8).
 * The name is pasted into the instruction text, so it must be a CSR name.
 */
#define csr_read(csr) ({ unsigned int __v; __asm__ volatile("csrr %0, " #csr : "=r"(__v)); __v; })
#define csr_write(csr, value) __asm__ volatile("csrw " #csr ", %0" : : "r"(value))
#define csr_set(csr, bits) __asm__ volatile("csrs " #csr ", %0" : : "r"(bits))
#define csr_clear(csr, bits) __asm__ volatile("csrc " #csr ", %0" : : "r"(bits))

/* Single instructions. */
#define wfi() __asm__ volatile("wfi")
#define ebreak() __asm__ volatile("ebreak")

#endif
