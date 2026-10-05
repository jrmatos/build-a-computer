/**
 * Build a code level's program: the player's file (`main.s` or `main.c`), the
 * level's library files and, for C levels, libc, assembled and linked into one
 * flat image at the RAM base. Shared by the test checker and the worker's
 * debugger. Everything a player sees (diagnostics, trap locations, the
 * debugger's current line, breakpoints) is in source terms: C lines for C
 * files, assembly lines for `.s` files.
 *
 * Conventions (also in docs/code-levels.md):
 * - `.s` / `.S` library files are assembled, `.c` files compiled, `.h` files
 *   are headers for `#include` (C only). Other names are assembled.
 * - C levels link libc (crt0 + libc sources) unless `code.libc === false`;
 *   libc headers are on the include path only when libc is linked. Level `.h`
 *   files come after libc's and win on a name clash.
 * - Entry: `_start` when defined (libc's crt0 defines it), else `main` in a C
 *   level, else the first byte of `.text`.
 */

import {
  type AsmObject,
  type Diagnostic,
  type LinkResult,
  assemble,
  lineForAddress,
  link as linkObjects,
} from '@build-a-computer/asm';
import { type CcDiagnostic, compile } from '@build-a-computer/cc';
import { LIBC_HEADERS, LIBC_SOURCES } from '@build-a-computer/libc';
import { RAM_BASE } from '@build-a-computer/rv32';
import type { Level } from '@build-a-computer/schema';

/** The player's file in assembly levels. */
export const MAIN_FILE = 'main.s';
/** The player's file in C levels. */
export const MAIN_C_FILE = 'main.c';

export type Language = 'rv32-asm' | 'c';

/** A problem in a source file, 1-based (same shape as the worker's SourceDiagnostic). */
export interface ProgramDiagnostic {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  severity: 'error' | 'warning';
  file: string;
}

/** A source position in player terms (C line for C files, assembly line for `.s`). */
export interface SourceLoc {
  file: string;
  line: number;
}

export interface ProgramSymbol {
  name: string;
  addr: number;
}

/** A built program. When `ok` is false, `link` is empty or incomplete and must not run. */
export interface Program {
  readonly ok: boolean;
  readonly language: Language;
  /** `main.s` or `main.c`. */
  readonly mainFile: string;
  /** Linker output (its source map is in assembly lines; use `locate`). */
  readonly link: LinkResult;
  /** Entry address (pc at the first instruction). */
  readonly entry: number;
  /** Problems in player terms; errors make `ok` false. */
  readonly diagnostics: readonly ProgramDiagnostic[];
  /** Labels for the debugger; for compiled C, function and global names only. */
  readonly symbols: readonly ProgramSymbol[];
  /** pc -> source position: assembly line for `.s`, C line (via the compiler's line map) for C. */
  locate(pc: number): SourceLoc | undefined;
  /** Name of the function (nearest label at or before pc) that holds pc. */
  functionAt(pc: number): string | undefined;
  /**
   * Addresses to break at for a line of `file` (default the player's file).
   * A line without code breaks at the next line with code. Each contiguous
   * run of instructions from the line contributes its first address.
   */
  breakpointAddresses(line: number, file?: string): number[];
}

/** One assembly input to the linker. */
interface Unit {
  /** Name in the linker's source map (for C: `<file>.c.s`). */
  name: string;
  text: string;
  origin: 'player' | 'library' | 'libc';
  /** Present when compiled from C. */
  c?: { file: string; source: string; lineMap: number[] };
}

const IS_C = /\.c$/i;
const IS_H = /\.h$/i;

/** 1-based line/column of a 0-based character offset. */
export function position(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

/** An assembler diagnostic in 1-based range form; `text` (the file) gives the end position. */
export function asmToProgramDiagnostic(d: Diagnostic, text: string | undefined): ProgramDiagnostic {
  const end =
    text !== undefined && d.to > d.from
      ? position(text, d.to)
      : { line: d.line, column: d.col + 1 };
  return {
    line: d.line,
    column: d.col,
    endLine: end.line,
    endColumn: end.column,
    message: d.message,
    severity: d.severity,
    file: d.file,
  };
}

const lineOf = (text: string, line: number): string => text.split('\n')[line - 1] ?? '';

/** A diagnostic covering a whole line of `text`. */
function wholeLine(
  file: string,
  text: string,
  line: number,
  message: string,
  severity: 'error' | 'warning' = 'error',
): ProgramDiagnostic {
  return {
    file,
    line,
    column: 1,
    endLine: line,
    endColumn: lineOf(text, line).length + 1,
    message,
    severity,
  };
}

const libcPrefix = (u: { origin: Unit['origin'] }): string =>
  u.origin === 'libc' ? 'Internal error in libc (not your fault): ' : '';

function compileC(
  source: string,
  file: string,
  headers: Record<string, string>,
  origin: Unit['origin'],
): { unit?: Unit; diagnostics: ProgramDiagnostic[] } {
  try {
    const r = compile(source, { file, headers });
    const diagnostics = r.diagnostics.map((d: CcDiagnostic) => ({
      line: d.line,
      column: d.column,
      endLine: d.endLine,
      endColumn: d.endColumn,
      severity: d.severity,
      file: d.file || file,
      message: libcPrefix({ origin }) + d.message,
    }));
    if (!r.ok) return { diagnostics };
    return {
      unit: { name: `${file}.s`, text: r.asm, origin, c: { file, source, lineMap: r.lineMap } },
      diagnostics,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      diagnostics: [
        wholeLine(file, source, 1, `Internal compiler error (not your fault): ${message}`),
      ],
    };
  }
}

/** True when an assembler error on this C line can be the author's (inline asm). */
const hasInlineAsm = (cLine: string): boolean => /\b(asm|__asm__|__asm)\b/.test(cLine);

/** C line for an assembly line of a compiled unit, or 0. */
const cLineFor = (u: Unit, asmLine: number): number => u.c?.lineMap[asmLine - 1] ?? 0;

/**
 * Map an assembler or linker diagnostic to player terms. Assembly units keep
 * their own position. Compiled units are mapped to the C line; assembler
 * errors there are compiler bugs unless the C line has inline asm.
 */
function mapDiagnostic(
  d: Diagnostic,
  u: Unit | undefined,
  phase: 'asm' | 'link',
  units: Map<string, Unit>,
): ProgramDiagnostic {
  const rewrite = (msg: string): string =>
    // "(also in main.c.s:12)" -> "(also in main.c:3)"
    msg.replace(/also in ([^\s:()]+):(\d+)/g, (all, f: string, l: string) => {
      const o = units.get(f);
      if (!o?.c) return all;
      const cl = cLineFor(o, Number(l));
      return cl > 0 ? `also in ${o.c.file}:${cl}` : `also in ${o.c.file}`;
    });
  if (!u?.c) {
    const p = asmToProgramDiagnostic(d, u?.text);
    return { ...p, message: libcPrefix(u ?? { origin: 'player' }) + rewrite(d.message) };
  }
  const cl = cLineFor(u, d.line);
  const line = cl > 0 ? cl : 1;
  let message: string;
  if (phase === 'link') {
    const undef = /^undefined symbol '([^']+)'$/.exec(d.message);
    message = undef
      ? `'${undef[1]}' is used but never defined: no linked file has a function or global with that name.`
      : rewrite(d.message);
    message = libcPrefix(u) + message;
  } else if (u.origin !== 'libc' && cl > 0 && hasInlineAsm(lineOf(u.c.source, cl))) {
    message = d.message;
  } else {
    message = `${u.origin === 'libc' ? 'Internal error in libc' : 'Internal compiler error'} (not your fault): the generated assembly was rejected: ${d.message} (generated line ${d.line}).`;
  }
  return wholeLine(u.c.file, u.c.source, line, message, d.severity);
}

/** libc, compiled and assembled once per process. */
let libcCache:
  { units: Unit[]; objects: AsmObject[]; diagnostics: ProgramDiagnostic[] } | undefined;

function libc(): NonNullable<typeof libcCache> {
  if (libcCache) return libcCache;
  const units: Unit[] = [];
  const diagnostics: ProgramDiagnostic[] = [];
  for (const f of LIBC_SOURCES) {
    if (IS_H.test(f.name)) continue;
    if (IS_C.test(f.name)) {
      const r = compileC(f.text, f.name, { ...LIBC_HEADERS }, 'libc');
      diagnostics.push(...r.diagnostics.filter((d) => d.severity === 'error'));
      if (r.unit) units.push(r.unit);
    } else units.push({ name: f.name, text: f.text, origin: 'libc' });
  }
  const unitMap = new Map(units.map((u) => [u.name, u]));
  const objects: AsmObject[] = [];
  for (const u of units) {
    const r = assemble(u.text, { file: u.name });
    for (const d of r.diagnostics)
      if (d.severity === 'error') diagnostics.push(mapDiagnostic(d, u, 'asm', unitMap));
    objects.push(r.object);
  }
  libcCache = { units, objects, diagnostics };
  return libcCache;
}

const EMPTY_LINK: LinkResult = {
  ok: false,
  image: new Uint8Array(0),
  base: RAM_BASE,
  entry: RAM_BASE,
  bss: { start: RAM_BASE, size: 0 },
  end: RAM_BASE,
  sections: [],
  symbols: [],
  sourceMap: [],
  diagnostics: [],
};

/** Last program built per level (tests run the same source many times). */
const cache = new WeakMap<Level, { source: string; program: Program }>();

/**
 * Build the player's source with the level's library files (and libc for C
 * levels) at the RAM base. Never throws; problems become diagnostics.
 */
export function buildProgram(source: string, level: Level): Program {
  const hit = cache.get(level);
  if (hit && hit.source === source) return hit.program;
  const program = buildUncached(source, level);
  cache.set(level, { source, program });
  return program;
}

function buildUncached(source: string, level: Level): Program {
  const language: Language = level.code?.language ?? 'rv32-asm';
  const isC = language === 'c';
  const mainFile = isC ? MAIN_C_FILE : MAIN_FILE;
  const library = level.code?.library ?? [];
  const withLibc = isC && level.code?.libc !== false;
  const headers: Record<string, string> = withLibc ? { ...LIBC_HEADERS } : {};
  for (const f of library) if (IS_H.test(f.name)) headers[f.name] = f.text;

  const diagnostics: ProgramDiagnostic[] = [];
  const units: Unit[] = [];
  const addC = (text: string, file: string, origin: Unit['origin']): void => {
    const r = compileC(text, file, headers, origin);
    diagnostics.push(...r.diagnostics);
    if (r.unit) units.push(r.unit);
  };
  if (isC) addC(source, MAIN_C_FILE, 'player');
  else units.push({ name: MAIN_FILE, text: source, origin: 'player' });
  for (const f of library) {
    if (IS_H.test(f.name)) continue;
    if (IS_C.test(f.name)) addC(f.text, f.name, 'library');
    else units.push({ name: f.name, text: f.text, origin: 'library' });
  }
  const lib = withLibc ? libc() : undefined;
  if (lib) diagnostics.push(...lib.diagnostics);

  const allUnits = [...units, ...(lib?.units ?? [])];
  const unitMap = new Map(allUnits.map((u) => [u.name, u]));
  const fail = (): Program =>
    makeProgram(false, language, mainFile, EMPTY_LINK, RAM_BASE, diagnostics, unitMap);
  if (diagnostics.some((d) => d.severity === 'error')) return fail();

  const objects: AsmObject[] = [];
  for (const u of units) {
    const r = assemble(u.text, { file: u.name });
    for (const d of r.diagnostics) diagnostics.push(mapDiagnostic(d, u, 'asm', unitMap));
    objects.push(r.object);
  }
  if (diagnostics.some((d) => d.severity === 'error')) return fail();
  // libc's link order: its first file (crt0.s) first, so `_start` is at the
  // RAM base; then the program; then the rest of libc, ending with end.s
  // (`_end`, where the heap starts, must come after every global).
  if (lib?.objects.length) {
    objects.unshift(lib.objects[0]!);
    objects.push(...lib.objects.slice(1));
  }

  const linked = linkObjects(objects, { base: RAM_BASE });
  for (const d of linked.diagnostics) {
    // The player (or level) defines a name libc also defines: point at their definition.
    const dup = /^'([^']+)' is defined globally twice \(also in ([^:]+):(\d+)\)$/.exec(d.message);
    const other = dup ? unitMap.get(dup[2]!) : undefined;
    if (dup && other && other.origin !== 'libc' && unitMap.get(d.file)?.origin === 'libc') {
      const at = Number(dup[3]);
      const message = `'${dup[1]}' is already defined by libc (${unitMap.get(d.file)!.c?.file ?? d.file}); pick another name.`;
      if (other.c)
        diagnostics.push(
          wholeLine(other.c.file, other.c.source, cLineFor(other, at) || 1, message),
        );
      else diagnostics.push(wholeLine(other.name, other.text, at, message));
      continue;
    }
    // A missing main is reported by crt0's `call main`; say it in the player's terms.
    if (
      isC &&
      /^undefined symbol 'main'$/.test(d.message) &&
      unitMap.get(d.file)?.origin !== 'player'
    ) {
      diagnostics.push(
        wholeLine(
          MAIN_C_FILE,
          source,
          1,
          'There is no main function: the program starts by calling main().',
        ),
      );
      continue;
    }
    diagnostics.push(mapDiagnostic(d, unitMap.get(d.file), 'link', unitMap));
  }
  // `call f` is two fixups (auipc + jalr): keep one copy of each message per line.
  const seen = new Set<string>();
  const unique = diagnostics.filter((d) => {
    const key = `${d.file}\u0000${d.line}\u0000${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  diagnostics.length = 0;
  diagnostics.push(...unique);
  const ok = linked.ok && !diagnostics.some((d) => d.severity === 'error');
  let entry = linked.entry;
  if (isC && !linked.symbols.some((s) => s.name === '_start' && s.kind === 'label')) {
    const main = linked.symbols.find((s) => s.name === 'main' && s.kind === 'label' && s.global);
    if (main) entry = main.address;
  }
  return makeProgram(ok, language, mainFile, { ...linked, entry, ok }, entry, diagnostics, unitMap);
}

/** True for compiler-internal labels (`.L12`, `.Lstr0`, `L5`) that the debugger hides. */
const internalLabel = (name: string): boolean =>
  name.startsWith('.') || /^\.?L[0-9_]/.test(name) || name.includes('$');

function makeProgram(
  ok: boolean,
  language: Language,
  mainFile: string,
  link: LinkResult,
  entry: number,
  diagnostics: ProgramDiagnostic[],
  units: Map<string, Unit>,
): Program {
  const labels = link.symbols.filter(
    (s) => s.kind === 'label' && !(units.get(s.file)?.c && internalLabel(s.name)),
  );
  const symbols = labels.map((s) => ({ name: s.name, addr: s.address }));
  const textLabels = labels.filter((s) => !s.section || /text/.test(s.section));

  const locate = (pc: number): SourceLoc | undefined => {
    const e = lineForAddress(link.sourceMap, pc >>> 0);
    if (!e) return undefined;
    const u = units.get(e.file);
    if (!u?.c) return { file: e.file, line: e.line };
    const line = cLineFor(u, e.line);
    return line > 0 ? { file: u.c.file, line } : undefined;
  };

  const functionAt = (pc: number): string | undefined => {
    const a = pc >>> 0;
    let best: string | undefined;
    for (const s of textLabels) {
      if (s.address > a) break;
      best = s.name;
    }
    return best;
  };

  // file -> line -> first address of each contiguous run of that line's code.
  let table: Map<string, Map<number, number[]>> | undefined;
  const lineTable = (): Map<string, Map<number, number[]>> => {
    if (table) return table;
    table = new Map();
    let prevKey = '';
    let prevEnd = -1;
    for (const e of link.sourceMap) {
      if (e.kind !== 'code') {
        prevKey = '';
        continue;
      }
      const loc = locate(e.address);
      if (!loc) {
        prevKey = '';
        continue;
      }
      const key = `${loc.file}\u0000${loc.line}`;
      if (key !== prevKey || e.address !== prevEnd) {
        let byLine = table.get(loc.file);
        if (!byLine) table.set(loc.file, (byLine = new Map()));
        const list = byLine.get(loc.line) ?? [];
        list.push(e.address >>> 0);
        byLine.set(loc.line, list);
      }
      prevKey = key;
      prevEnd = e.address + e.size;
    }
    return table;
  };

  const breakpointAddresses = (line: number, file: string = mainFile): number[] => {
    const byLine = lineTable().get(file);
    if (!byLine) return [];
    let best: number | undefined;
    for (const l of byLine.keys()) if (l >= line && (best === undefined || l < best)) best = l;
    return best === undefined ? [] : [...byLine.get(best)!];
  };

  return {
    ok,
    language,
    mainFile,
    link,
    entry,
    diagnostics,
    symbols,
    locate,
    functionAt,
    breakpointAddresses,
  };
}
