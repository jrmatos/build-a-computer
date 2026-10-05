# GNU RISC-V C toolchain used only to build the libc golden binaries
# (packages/libc/gcc/generate.mjs). Tests never need it: the binaries are committed.
#   docker --context default build -t build-a-computer-libc-gcc packages/libc/gcc
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc-riscv64-unknown-elf binutils-riscv64-unknown-elf \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /work
