# Builds the official riscv-tests (rv32ui, rv32um, rv32mi, plus rv32ua/rv32si
# and the Sv32 "v" variants
# as extras) for the build-a-computer emulator, with the standard "p" environment.
#
# The standard env links at 0x8000_0000, which is the start of our RAM, and
# reports results through the `tohost` symbol (1 = pass, (n << 1) | 1 = fail
# test n). Output: /out/<name>.bin flat images + /out/manifest.json.
#
# riscv-tests and riscv-test-env are BSD-3-Clause (see LICENSE in each repo);
# the binaries are build artifacts and are never committed.
#
#   docker build -t build-a-computer/riscv-toolchain docker/riscv-toolchain
#   docker run --rm -v "$PWD/out:/out" build-a-computer/riscv-toolchain
FROM debian:trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      gcc-riscv64-unknown-elf binutils-riscv64-unknown-elf picolibc-riscv64-unknown-elf \
      make git ca-certificates python3 \
 && rm -rf /var/lib/apt/lists/*

# Pinned upstream commits (verified with `git ls-remote` on 2026-10-04).
ARG RISCV_TESTS_COMMIT=bcffa2b3188b040c611f90dc0b6e422f54775a09
ARG RISCV_TEST_ENV_COMMIT=a1c373ec89a3500630bafabf406108a8fc568bcc

WORKDIR /src
RUN git clone https://github.com/riscv-software-src/riscv-tests.git \
 && cd riscv-tests \
 && git checkout "$RISCV_TESTS_COMMIT" \
 && git submodule update --init env \
 && cd env && git checkout "$RISCV_TEST_ENV_COMMIT"

COPY build-tests.sh /usr/local/bin/build-tests.sh
RUN chmod +x /usr/local/bin/build-tests.sh && /usr/local/bin/build-tests.sh /artifacts

# Copy artifacts out to a bind-mounted /out.
CMD ["sh", "-c", "mkdir -p /out && cp -r /artifacts/. /out/ && ls /out | wc -l"]
