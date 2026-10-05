#!/bin/sh
# Regenerates programs/abi/abi_gcc.s (gcc's code for the ABI test) and
# programs/abi/gcc.bin (both files built by gcc, for the expected output).
# Run from packages/cc. Uses the image from tools/cc-diff/Dockerfile.
set -eu
cp ../../tools/cc-diff/link.ld ../../tools/cc-diff/ref/crt0.s programs/abi/
tar -C programs/abi -c . | docker --context default run --rm -i build-a-computer-cc-golden sh -c '
  set -e; tar -x
  F="-march=rv32im -mabi=ilp32 -mno-relax -std=gnu99 -ffreestanding -nostdlib -fno-pic -O2 -w"
  riscv64-unknown-elf-gcc $F -S -o abi_gcc.s abi_gcc.c
  riscv64-unknown-elf-gcc $F -Wl,--no-relax -T link.ld -o abi.elf crt0.s abi_ours.c abi_gcc.c -lgcc
  riscv64-unknown-elf-objcopy -O binary abi.elf gcc.bin
  tar -c abi_gcc.s gcc.bin' | tar -C programs/abi -x
rm programs/abi/link.ld programs/abi/crt0.s
