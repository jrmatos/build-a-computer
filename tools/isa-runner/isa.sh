#!/bin/sh
# Build the riscv-tests image (cached), copy the binaries into the gitignored
# tools/isa-runner/dist/riscv-tests folder, then run every test in our emulator.
# Usage: pnpm --filter @ground-up/rv32 isa [name-filter]
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# dist/ is ignored by git, eslint and prettier.
OUT="$HERE/dist/riscv-tests"
IMAGE=ground-up/riscv-toolchain
NAME="ground-up-isa-$$"

if [ -z "${ISA_SKIP_BUILD:-}" ]; then
  docker build -q -t "$IMAGE" "$ROOT/docker/riscv-toolchain" >/dev/null
  rm -rf "$OUT" && mkdir -p "$OUT"
  docker create --name "$NAME" "$IMAGE" >/dev/null
  trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
  docker cp "$NAME:/artifacts/." "$OUT/"
fi
ISA_OUT="$OUT" ISA_FILTER="${1:-}" "$ROOT/node_modules/.bin/vitest" run --root "$HERE" --reporter=verbose isa.test.ts
