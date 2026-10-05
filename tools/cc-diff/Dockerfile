# GNU RISC-V C toolchain used only to generate golden outputs for the C corpus
# (packages/cc/corpus). Tests never need it: the goldens are committed.
#   docker --context default build -t build-a-computer-cc-golden tools/cc-diff
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc-riscv64-unknown-elf binutils-riscv64-unknown-elf \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /work
