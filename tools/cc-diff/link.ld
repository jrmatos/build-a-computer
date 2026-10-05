/* Flat image at the RAM base, like @build-a-computer/asm's linker (docs/code-levels.md). */
ENTRY(_start)
SECTIONS {
  . = 0x80000000;
  .text   : ALIGN(4) { *crt0.o(.text) *(.text .text.*) }
  .rodata : ALIGN(4) { *(.rodata .rodata.* .srodata .srodata.*) }
  .data   : ALIGN(4) { *(.data .data.* .sdata .sdata.*) }
  .bss    : ALIGN(4) { *(.bss .bss.* .sbss .sbss.* COMMON) }
  . = ALIGN(16);
  _end = .;
  /DISCARD/ : { *(.riscv.attributes) *(.comment) *(.note.*) *(.eh_frame*) }
}
