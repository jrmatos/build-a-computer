import { OS_DATA } from './os.data';

/** What the debugger's OS panels need to read a level's kernel out of memory. */
export interface OsKernelInfo {
  /** The kernel's kernel.h as this level's kernel is built (structs and constants). */
  header: string;
  /**
   * Addresses of the kernel's data symbols (procs, current, freelist…) when
   * the player's build does not have them: program levels run the disk
   * kernel. Empty for kernel levels, whose build links the kernel itself.
   */
  symbols: Record<string, number>;
}

/** Program levels (os-shell, os-final-game) run the full kernel, the same stage as os-file-system. */
const FULL_KERNEL_LEVEL = 'os-file-system';

const headerOf = (id: string): string | undefined =>
  OS_DATA[id]?.library.find((f) => f.name === 'kernel.h')?.text;

/** The kernel behind a Phase 9 level, or null when the level has none (the bootloader). */
export function osKernelInfo(levelId: string): OsKernelInfo | null {
  const data = OS_DATA[levelId];
  if (!data) return null;
  const own = headerOf(levelId);
  if (own) return { header: own, symbols: {} };
  const symbols: Record<string, number> = {};
  for (const [k, v] of Object.entries(data.facts))
    if (k.startsWith('kernel.')) symbols[k.slice('kernel.'.length)] = v;
  const header = headerOf(FULL_KERNEL_LEVEL);
  return Object.keys(symbols).length && header ? { header, symbols } : null;
}
