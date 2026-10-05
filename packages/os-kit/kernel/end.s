# end.s: marks the end of the kernel image. Linked last.
# kernel_end is the first byte after all code and data: free memory starts there.

    .bss
    .globl kernel_end
kernel_end:
