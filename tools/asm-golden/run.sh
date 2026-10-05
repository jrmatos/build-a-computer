#!/bin/sh
# Runs inside the build-a-computer-asm-golden container. Reads *.s and link.ld from
# the current directory, writes out/<name>.bin, out/<name>.nm, out/<name>.err.
set -u
mkdir -p out
for src in *.s; do
  name="${src%.s}"
  if riscv64-unknown-elf-as -march=rv32ima_zicsr_zifencei -mabi=ilp32 -mno-relax \
       -o "$name.o" "$src" 2> "out/$name.err" \
     && riscv64-unknown-elf-ld -m elf32lriscv --no-relax --no-warn-rwx-segments -T link.ld \
       -o "$name.elf" "$name.o" 2>> "out/$name.err" \
     && riscv64-unknown-elf-objcopy -O binary "$name.elf" "out/$name.bin"; then
    riscv64-unknown-elf-nm -n "$name.elf" > "out/$name.nm"
  fi
done
