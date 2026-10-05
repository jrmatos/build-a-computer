/* Flat layout used by @ground-up/asm's linker (packages/asm/src/linker.ts). */
SECTIONS {
  . = 0x80000000;
  .text   : ALIGN(4) { *(.text .text.*) }
  .rodata : ALIGN(4) { *(.rodata .rodata.*) }
  .data   : ALIGN(4) { *(.data .data.*) }
  .bss    : ALIGN(4) { *(.bss .bss.*) }
  /DISCARD/ : { *(.riscv.attributes) *(.comment) *(.note.*) }
}
