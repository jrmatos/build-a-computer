import type { Level } from '@build-a-computer/schema';

/**
 * OS-05: Phase 9 levels whose kernel has a process table get the Kernel dock
 * tab (not the bootloader, trap-vector or system-call levels). Kernel levels
 * ship kernel.h in their library; program levels (shell, game) run the disk
 * kernel and link the user library instead.
 */
export function isOsLevel(level: Level | null | undefined): boolean {
  if (level?.mode !== 'code' || !level.id.startsWith('os-')) return false;
  const library = level.code?.library ?? [];
  const header = library.find((f) => f.name === 'kernel.h')?.text;
  if (!header) return library.some((f) => f.name === 'user.h') && library.some((f) => f.name === 'bootstart.s');
  return /struct\s+proc\s*\{/.test(header);
}
