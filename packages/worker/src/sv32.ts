/**
 * OS-05: a side-effect-free Sv32 translation for the debugger. Follows the
 * emulator's walk (@build-a-computer/rv32 Hart.walk) step for step: the same
 * validity, leaf, permission and superpage checks and the same fault causes,
 * but it never sets A/D bits or fills the TLB, so inspecting an address does
 * not change the machine.
 */

import { CAUSE } from '@build-a-computer/rv32';
import type { RvTranslation } from './protocol';

export type Sv32Access = 'fetch' | 'load' | 'store';

/**
 * Translate `va` through the page table `satp` names, as an access of `kind`
 * from privilege `priv` would ('U' by default: page tables only map
 * programs). `read32` reads a physical word (undefined: access fault).
 * `mxr`/`sum` mirror mstatus.MXR/SUM. With satp's MODE bit clear the address
 * is not translated.
 */
export function sv32Translate(
  read32: (pa: number) => number | undefined,
  satp: number,
  va: number,
  kind: Sv32Access = 'load',
  priv: 'U' | 'S' | 'M' = 'U',
  flags: { mxr?: boolean; sum?: boolean } = {},
): RvTranslation {
  va >>>= 0;
  satp >>>= 0;
  const base = { va, satp, access: kind, steps: [] as RvTranslation['steps'] };
  if (!(satp & 0x8000_0000) || priv === 'M') return { ...base, ok: true, pa: va, bare: true };
  const pageFault =
    kind === 'fetch' ? CAUSE.instPageFault : kind === 'load' ? CAUSE.loadPageFault : CAUSE.storePageFault;
  const accessFault =
    kind === 'fetch' ? CAUSE.instAccessFault : kind === 'load' ? CAUSE.loadAccessFault : CAUSE.storeAccessFault;
  const fail = (cause: number, why: RvTranslation['why']): RvTranslation => ({ ...base, ok: false, cause, why });
  let table = (satp & 0x3fffff) * 4096;
  let level: 0 | 1 = 1;
  let pte: number;
  for (;;) {
    const vpn = level === 1 ? va >>> 22 : (va >>> 12) & 0x3ff;
    const pteAddr = table + vpn * 4;
    if (pteAddr >= 2 ** 32) return fail(accessFault, 'access');
    const v = read32(pteAddr >>> 0);
    if (v === undefined) return fail(accessFault, 'access');
    pte = v >>> 0;
    base.steps.push({ level, pteAddr: pteAddr >>> 0, pte });
    if ((pte & 1) === 0) return fail(pageFault, 'invalid');
    if ((pte & 2) === 0 && (pte & 4) !== 0) return fail(pageFault, 'reserved');
    if ((pte & 0xa) !== 0) break; // R or X: leaf
    if (level === 0) return fail(pageFault, 'noLeaf');
    table = (pte >>> 10) * 4096;
    level = 0;
  }
  const user = (pte & 0x10) !== 0;
  if (priv === 'U' && !user) return fail(pageFault, 'notUser');
  if (priv === 'S' && user && (kind === 'fetch' || !flags.sum)) return fail(pageFault, 'userPage');
  if (kind === 'fetch' && (pte & 8) === 0) return fail(pageFault, 'noExec');
  if (kind === 'load' && (pte & 2) === 0 && !(flags.mxr && (pte & 8) !== 0)) return fail(pageFault, 'noRead');
  if (kind === 'store' && (pte & 4) === 0) return fail(pageFault, 'noWrite');
  const ppn = pte >>> 10;
  if (level === 1 && (ppn & 0x3ff) !== 0) return fail(pageFault, 'misaligned');
  const pa = level === 1 ? (ppn >>> 10) * 2 ** 22 + (va & 0x3fffff) : ppn * 4096 + (va & 0xfff);
  if (pa >= 2 ** 32) return fail(accessFault, 'access');
  return { ...base, ok: true, pa: pa >>> 0, level, pte };
}
