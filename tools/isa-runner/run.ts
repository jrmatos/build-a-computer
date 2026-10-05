/**
 * Runs riscv-tests flat binaries (built by docker/riscv-toolchain) in the
 * @ground-up/rv32 emulator. A test passes when it writes 1 to `tohost`;
 * (n << 1) | 1 means test case n failed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Machine } from '../../packages/rv32/src/index';

export interface ManifestEntry {
  name: string;
  bin: string;
  base: string;
  entry: string;
  tohost: string;
}

export interface IsaResult {
  name: string;
  pass: boolean;
  /** Raw tohost value (0 = timed out). */
  tohost: number;
  steps: number;
  detail: string;
  /** Sv32 was on when the test finished (the "v" environment runs under paging). */
  paged: boolean;
}

export const STEP_LIMIT = 5_000_000;

export function readManifest(dir: string): ManifestEntry[] {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ManifestEntry[];
}

export function runOne(dir: string, e: ManifestEntry): IsaResult {
  // ma_data checks hardware misaligned support; our default traps (E-CPU-05),
  // so it runs with the optional 'emulate' policy. Everything else uses 'trap'.
  const misaligned = e.name.endsWith('-ma_data') ? 'emulate' : 'trap';
  const m = new Machine({ ramSize: 4 * 1024 * 1024, misaligned });
  const bytes = new Uint8Array(readFileSync(join(dir, e.bin)));
  m.load(Number(e.base), bytes);
  m.hart.pc = Number(e.entry);
  const tohost = Number(e.tohost);
  let steps = 0;
  let value = 0;
  while (steps < STEP_LIMIT) {
    const r = m.run(10_000);
    steps += r.steps;
    value = m.read32(tohost) ?? 0;
    if (value !== 0) break;
    if (r.reason === 'wfi') break;
  }
  const pass = value === 1;
  const detail = pass
    ? 'pass'
    : value === 0
      ? `no result after ${steps} steps (pc=0x${m.hart.pc.toString(16)}, mcause=${m.hart.mcause >>> 0})`
      : `failed test case ${value >>> 1}`;
  return { name: e.name, pass, tohost: value, steps, detail, paged: m.hart.satp !== 0 };
}
