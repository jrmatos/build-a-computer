#!/bin/sh
# Runs inside the build-a-computer-libc-gcc container. Builds libc from lib/
# and every tests/*.c against it; writes out/<name>.bin and out/<name>.nm.
set -eu
CFLAGS="-march=rv32im_zicsr -mabi=ilp32 -O2 -ffreestanding -nostdlib -nostdinc -fno-builtin \
  -fno-tree-loop-distribute-patterns -msmall-data-limit=0 -mno-relax -fno-pic -Wall -Werror \
  -Wno-format -Ilib/include"
mkdir -p out obj
riscv64-unknown-elf-gcc $CFLAGS -c lib/src/crt0.s -o obj/crt0.o
riscv64-unknown-elf-gcc $CFLAGS -c lib/src/end.s -o obj/end.o
LIBS=""
for c in lib/src/*.c; do
  n=$(basename "$c" .c)
  riscv64-unknown-elf-gcc $CFLAGS -c "$c" -o "obj/lib_$n.o"
  LIBS="$LIBS obj/lib_$n.o"
done
for t in tests/*.c; do
  n=$(basename "$t" .c)
  (cd tests && riscv64-unknown-elf-gcc $CFLAGS -I../lib/include -c "$n.c" -o "../obj/$n.o")
  riscv64-unknown-elf-ld -m elf32lriscv --no-relax --no-warn-rwx-segments -T link.ld \
    -o "obj/$n.elf" obj/crt0.o "obj/$n.o" $LIBS obj/end.o
  riscv64-unknown-elf-objcopy -O binary "obj/$n.elf" "out/$n.bin"
  riscv64-unknown-elf-nm -n "obj/$n.elf" > "out/$n.nm"
done
