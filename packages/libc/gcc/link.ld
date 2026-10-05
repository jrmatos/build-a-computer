/* Same flat layout as @build-a-computer/asm's linker: text, rodata, data, bss from 0x80000000.
   __bss_start and _end come from crt0.s and end.s (linked first and last), not from here. */
ENTRY(_start)
SECTIONS {
  . = 0x80000000;
  .text   : ALIGN(4) { *(.text .text.*) }
  .rodata : ALIGN(4) { *(.rodata .rodata.* .srodata .srodata.*) }
  .data   : ALIGN(4) { *(.data .data.* .sdata .sdata.*) }
  .bss    : ALIGN(4) { *(.bss .bss.* .sbss .sbss.* COMMON) }
  /DISCARD/ : { *(.riscv.attributes) *(.comment) *(.note.*) *(.eh_frame*) }
}
