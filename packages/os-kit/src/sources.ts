/**
 * The C and assembly sources of the reference kernel, the bootloader, the
 * user library and the levels' test programs, read from this package's
 * directories (kernel/, boot/, user/, levels/). Node only: used to generate
 * the content package's Phase 9 data and in tests, never in the browser.
 */

import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);

/** Text of a source file, by path relative to packages/os-kit (e.g. "kernel/trap.c"). */
export function source(path: string): string {
  return readFileSync(new URL(path, ROOT), 'utf8');
}

/** File names in a directory of packages/os-kit, sorted. */
export function listDir(dir: string): string[] {
  return readdirSync(new URL(dir.endsWith('/') ? dir : `${dir}/`, ROOT)).sort();
}
