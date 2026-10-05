/**
 * Shared pieces of the Phase 9 (Operating system) levels. The kernel, the
 * programs and the disks come from packages/os-kit through the generated
 * os.data.ts; docs/os.md describes the kernel the levels build.
 */

import type { Level } from '@build-a-computer/schema';
import { NO_BOARD, type RiscvTest } from '../phase6/common';
import { OS_DATA } from './os.data';

/** Id of the last required (non-optional) Phase 8 level; Phase 9 starts after it. */
export const PHASE8_LAST_REQUIRED_ID = 'c-heap';

/** RAM in every Phase 9 level: 4 MiB (kernel.h RAM_END). */
export const OS_RAM_SIZE = 4 * 1024 * 1024;

/** The README.txt every file-system disk carries (os-kit levels.ts README). */
export const README = 'Welcome to your own operating system!\nThis file lives on the disk.\n';

/** big.txt on the file-system level's disks (os-kit levels.ts BIG_TEXT): 140 lines, 6,860 bytes. */
export const BIG_TEXT = Array.from(
  { length: 140 },
  (_, i) => `${String(i + 1).padStart(3, '0')}: the quick brown fox jumps over the lazy dog\n`,
).join('');

/** The message the multi-sector kernel of the bootloader level prints (os-kit levels/boot/long.s). */
export const LONG_KERNEL_TEXT = Array.from(
  { length: 40 },
  (_, i) =>
    `Line ${String(i + 1).padStart(2, '0')} of the kernel: every sector has to be loaded.\n`,
).join('');

/** 0x + 8 lowercase hex digits, like the kernel's kputx and the bootloader's boot_print_hex. */
export const hex8 = (n: number): string => `0x${(n >>> 0).toString(16).padStart(8, '0')}`;

/** The level's kit from os.data.ts. */
export function kit(id: string) {
  const k = OS_DATA[id];
  if (!k) throw new Error(`no os-kit data for ${id}: regenerate os.data.ts`);
  return k;
}

/** Common fields of every Phase 9 level. */
export const base = {
  track: 'nand-to-os' as const,
  phase: 9,
  palette: [] as Level['palette'],
  starter: NO_BOARD,
  mode: 'code' as const,
};

/** The level's code setup: its kit's starter and library, no libc, 4 MiB of RAM. */
export function osCode(
  id: string,
  devices: NonNullable<Level['code']>['devices'],
): NonNullable<Level['code']> {
  const k = kit(id);
  return {
    language: k.language,
    starter: k.starter,
    devices,
    ramSize: OS_RAM_SIZE,
    library: k.library,
    libc: false,
  };
}

export interface OsCase {
  /** Boot argument (a0): which scenario the level's programs.c starts. */
  a0?: number;
  /** A disk from the kit. */
  disk?: string;
  input?: string;
  uart: string;
  exitCode?: number;
  framebufferSha256?: string;
  maxSteps?: number;
}

/** A riscv test for level `id`. */
export function osTest(id: string, name: string, c: OsCase): RiscvTest {
  const setup: NonNullable<RiscvTest['setup']> = {};
  if (c.a0 !== undefined) setup.regs = { a0: c.a0 };
  if (c.disk !== undefined) {
    const d = kit(id).disks[c.disk];
    if (!d) throw new Error(`${id}: no disk ${c.disk}`);
    setup.disk = d;
  }
  const expect: RiscvTest['expect'] = { uart: c.uart };
  if (c.exitCode !== undefined) expect.exitCode = c.exitCode >>> 0;
  if (c.framebufferSha256 !== undefined) expect.framebufferSha256 = c.framebufferSha256;
  return {
    kind: 'riscv',
    name,
    ...(Object.keys(setup).length ? { setup } : {}),
    ...(c.input !== undefined ? { input: c.input } : {}),
    expect,
    maxSteps: c.maxSteps ?? 20_000_000,
  };
}
