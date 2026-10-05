# GNU RISC-V toolchain used only to generate golden fixtures for packages/asm.
# Build: docker build -t build-a-computer-asm-golden tools/asm-golden
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends binutils-riscv64-unknown-elf \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /work
