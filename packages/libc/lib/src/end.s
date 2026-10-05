# end.s: marks the end of the program in memory. Link it last.
#
# _end is the first byte after every global variable. The heap (malloc)
# starts there and grows up toward the stack.

    .bss
    .globl _end
    .globl __bss_end
__bss_end:
_end:
    .zero 4               # one word, so the section is not empty and the label has an address
