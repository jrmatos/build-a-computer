#!/bin/sh
# Runs inside the build-a-computer-cc-golden container. Reads manifest.txt
# ("<name> <group>" per line, group = free | libc), <name>.c, ref/ and link.ld
# from the current directory; writes out/<name>.O0.bin, out/<name>.O2.bin,
# out/<name>.err (warnings and errors) and out/version.txt.
set -u
mkdir -p out obj
CC=riscv64-unknown-elf-gcc
GCCINC="$($CC -print-file-name=include)"
BASE="-march=rv32im -mabi=ilp32 -mno-relax -std=c99 -ffreestanding -nostdlib -fno-pic -fno-tree-loop-distribute-patterns -Wall -Wno-unused-function"
$CC --version | head -1 > out/version.txt
$CC -c $BASE -o obj/crt0.o ref/crt0.s
for opt in O0 O2; do
  $CC -c $BASE -$opt -o obj/support.$opt.o ref/support.c
  $CC -c $BASE -$opt -nostdinc -isystem ref/include -isystem "$GCCINC" -o obj/libc.$opt.o ref/libc.c
done
while read -r name group; do
  [ -n "$name" ] || continue
  : > "out/$name.err"
  for opt in O0 O2; do
    if [ "$group" = libc ]; then
      extra="-nostdinc -isystem ref/include -isystem $GCCINC"
      lib=obj/libc.$opt.o
    else
      extra=""
      lib=obj/support.$opt.o
    fi
    if $CC -c $BASE -$opt $extra -o "obj/$name.$opt.o" "$name.c" 2>> "out/$name.err" \
      && $CC $BASE -Wl,--no-relax,--no-warn-rwx-segments -T link.ld -o "obj/$name.$opt.elf" obj/crt0.o "obj/$name.$opt.o" "$lib" -lgcc 2>> "out/$name.err" \
      && riscv64-unknown-elf-objcopy -O binary "obj/$name.$opt.elf" "out/$name.$opt.bin" 2>> "out/$name.err"; then
      riscv64-unknown-elf-nm "obj/$name.$opt.elf" | awk '$3 == "_start" || $3 == "_end" { print $3, $1 }' > "out/$name.$opt.sym"
    fi
  done
done < manifest.txt
