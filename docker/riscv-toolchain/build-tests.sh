#!/bin/sh
# Compile rv32 riscv-tests (p env) and emit flat binaries plus a manifest
# holding each test's load base, entry point and tohost address.
set -eu
OUT="$1"
mkdir -p "$OUT"
cd /src/riscv-tests/isa
# Some suites (float, compressed, bit-manip) may not build with every gcc;
# -k keeps going and we only collect the suites we need.
# The "v" (virtual memory) env needs string.h: take it from picolibc.
OPTS="-static -mcmodel=medany -fvisibility=hidden -nostdlib -nostartfiles -isystem /usr/lib/picolibc/riscv64-unknown-elf/include/release"
make -k -j"$(nproc)" XLEN=32 RISCV_PREFIX=riscv64-unknown-elf- RISCV_GCC_OPTS="$OPTS" >/tmp/make.log 2>&1 || true
P=riscv64-unknown-elf-
# rv32ua's Makefrag asks for zacas/zabha, which this gcc may lack; build the
# plain RV32A tests (LR/SC and AMO*.W) with -march=rv32g instead.
for src in rv32ua/*_w.S rv32ua/lrsc.S; do
  t=$(basename "$src" .S)
  case "$t" in amocas*) continue ;; esac
  ${P}gcc -march=rv32g -mabi=ilp32 -static -mcmodel=medany -fvisibility=hidden \
    -nostdlib -nostartfiles -I../env/p -Imacros/scalar -T../env/p/link.ld "$src" \
    -o "rv32ua-p-$t" || true
done
echo "[" > "$OUT/manifest.json"
first=1
for f in rv32ui-p-* rv32um-p-* rv32mi-p-* rv32ua-p-* rv32si-p-* rv32ui-v-* rv32um-v-* rv32ua-v-*; do
  case "$f" in *.dump|*.bin|*'*'*) continue ;; esac
  [ -f "$f" ] || continue
  ${P}objcopy -O binary "$f" "$OUT/$f.bin"
  tohost=$(${P}nm "$f" | awk '$3=="tohost"{print $1}')
  entry=$(${P}readelf -h "$f" | awk '/Entry point/{print $4}')
  base=$(${P}readelf -lW "$f" | awk '$1=="LOAD"{print $4; exit}')
  [ $first -eq 1 ] || echo "," >> "$OUT/manifest.json"
  first=0
  printf '{"name":"%s","bin":"%s.bin","base":"%s","entry":"%s","tohost":"0x%s"}' \
    "$f" "$f" "$base" "$entry" "$tohost" >> "$OUT/manifest.json"
done
echo "]" >> "$OUT/manifest.json"
echo "built $(ls "$OUT"/*.bin | wc -l) binaries"
