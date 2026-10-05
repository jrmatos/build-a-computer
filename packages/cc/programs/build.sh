#!/bin/sh
# Runs inside the build-a-computer-cc-golden container (tools/cc-diff/Dockerfile).
# Builds every <name>.c listed in manifest.txt at -O0 and -O2 into out/.
set -u
mkdir -p out obj
CC=riscv64-unknown-elf-gcc
BASE="-march=rv32im -mabi=ilp32 -mno-relax -std=gnu99 -ffreestanding -nostdlib -fno-pic -fno-tree-loop-distribute-patterns -fno-builtin -w -I."
$CC --version | head -1 > out/version.txt
$CC -c $BASE -o obj/crt0.o crt0.s
while read -r name; do
  [ -n "$name" ] || continue
  : > "out/$name.err"
  for opt in O0 O2; do
    $CC -c $BASE -$opt -o "obj/$name.$opt.o" "$name.c" 2>> "out/$name.err" \
      && $CC $BASE -Wl,--no-relax,--no-warn-rwx-segments -T link.ld -o "obj/$name.$opt.elf" obj/crt0.o "obj/$name.$opt.o" -lgcc 2>> "out/$name.err" \
      && riscv64-unknown-elf-objcopy -O binary "obj/$name.$opt.elf" "out/$name.$opt.bin" 2>> "out/$name.err"
  done
done < manifest.txt
