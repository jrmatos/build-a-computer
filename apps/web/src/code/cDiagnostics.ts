/**
 * Live diagnostics for C levels: compile main.c (and any level .c library
 * files) with @build-a-computer/cc against libc's headers plus the level's
 * .h files. Only the code chunk imports this module, so the compiler stays
 * out of the main bundle.
 */
import { compile, type CcDiagnostic } from '@build-a-computer/cc';
import { LIBC_HEADERS } from '@build-a-computer/libc';
import type { Level } from '@build-a-computer/schema';
import type { SourceDiagnostic } from '@build-a-computer/worker';
import { C_MAIN_FILE } from './diagnostics';

export { LIBC_HEADERS };

/** True when the compiler is still the placeholder that rejects everything. */
export const isStubDiagnostic = (d: Pick<CcDiagnostic, 'message'>): boolean => /not implemented/i.test(d.message);

/** True when the level links libc (C levels do unless `libc: false`). */
export const linksLibc = (level: Level | null): boolean => level?.code?.language === 'c' && level.code.libc !== false;

const headerCache = new WeakMap<Level, Record<string, string>>();
const NO_LEVEL: Record<string, string> = { ...LIBC_HEADERS };

/** Headers on the include path: libc's (when linked), then the level's .h files. Cached per level. */
export function headersFor(level: Level | null): Record<string, string> {
  if (!level) return NO_LEVEL;
  let h = headerCache.get(level);
  if (!h) {
    h = { ...(linksLibc(level) ? LIBC_HEADERS : {}) };
    for (const f of level.code?.library ?? []) if (/\.h$/i.test(f.name)) h[f.name] = f.text;
    headerCache.set(level, h);
  }
  return h;
}

function compileFile(text: string, file: string, headers: Record<string, string>): SourceDiagnostic[] {
  try {
    const r = compile(text, { file, headers });
    if (r.diagnostics.some(isStubDiagnostic)) return [];
    return r.diagnostics.map((d) => ({ ...d, file: d.file || file }));
  } catch (e) {
    // compile() reports problems as diagnostics; anything thrown is a compiler bug, shown rather than lost.
    const message = e instanceof Error ? e.message : String(e);
    return [{ line: 1, column: 1, endLine: 1, endColumn: 1, message: `internal compiler error: ${message}`, severity: 'error', file }];
  }
}

/** Compile the player's main.c and the level's .c library files; diagnostics only. */
export function checkC(source: string, level: Level | null): SourceDiagnostic[] {
  const headers = headersFor(level);
  const out = compileFile(source, C_MAIN_FILE, headers);
  for (const f of level?.code?.library ?? []) if (/\.c$/i.test(f.name)) out.push(...compileFile(f.text, f.name, headers));
  return out;
}
