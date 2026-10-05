/**
 * ASM-02: flat-image linker. Places sections at a base address (default
 * 0x8000_0000, the start of RAM in the plan's memory map) in the order
 * text, rodata, data, bss; resolves symbols and fixups; returns the image plus
 * a symbol map and an address-to-line source map for the debugger.
 *
 * Layout matches GNU ld with this script (see tools/asm-golden/link.ld):
 *   . = BASE;
 *   .text   : ALIGN(4) { *(.text .text.*) }
 *   .rodata : ALIGN(4) { *(.rodata .rodata.*) }
 *   .data   : ALIGN(4) { *(.data .data.*) }
 *   .bss    : ALIGN(4) { *(.bss .bss.*) }
 * Input sections are placed in object order, then in order of first use.
 */

import {
  type AsmObject,
  type AssembleOptions,
  type ObjSymbol,
  type SectionGroup,
  assemble,
} from './assembler';
import { AsmError, type Diagnostic, type Span, diagnostic } from './diagnostics';
import { type Value, UnknownSymbol, evaluate } from './expr';
import { type Fixup, applyFixup } from './fixups';

/** Default load address: start of RAM. */
export const DEFAULT_BASE = 0x8000_0000;

/** Options for `link`. */
export interface LinkOptions {
  /** Address of the first byte of the image. Default 0x8000_0000. */
  readonly base?: number;
  /** Entry symbol. Default `_start` when defined, else the base address. */
  readonly entry?: string;
}

/** A symbol with its final address (or constant value for .equ). */
export interface LinkedSymbol {
  readonly name: string;
  readonly address: number;
  readonly kind: 'label' | 'equ';
  readonly section: string | null;
  readonly global: boolean;
  readonly file: string;
}

/** Maps an address range to the source line that produced it. */
export interface SourceMapEntry {
  readonly address: number;
  readonly size: number;
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly kind: 'code' | 'data';
}

/** Where one output group (text, rodata, data, bss) landed. */
export interface PlacedSection {
  readonly name: SectionGroup;
  readonly address: number;
  readonly size: number;
}

/** Result of `link`. On errors, `image` may be incomplete. */
export interface LinkResult {
  readonly ok: boolean;
  /** Bytes from `base` to the end of initialised data (bss is not included). */
  readonly image: Uint8Array;
  readonly base: number;
  readonly entry: number;
  /** bss range the loader must zero (right after the image, maybe after padding). */
  readonly bss: { readonly start: number; readonly size: number };
  /** First address past everything (bss included): where a heap can start. */
  readonly end: number;
  readonly sections: readonly PlacedSection[];
  /** Labels and constants sorted by address; numeric local labels are left out. */
  readonly symbols: readonly LinkedSymbol[];
  /** Sorted by address. */
  readonly sourceMap: readonly SourceMapEntry[];
  readonly diagnostics: readonly Diagnostic[];
}

const GROUPS: readonly SectionGroup[] = ['text', 'rodata', 'data', 'bss'];

const alignUp = (v: number, a: number): number => Math.ceil(v / a) * a;

/** Links objects into one flat image. Never throws; problems become diagnostics. */
export function link(objects: readonly AsmObject[], options: LinkOptions = {}): LinkResult {
  const base = (options.base ?? DEFAULT_BASE) >>> 0;
  const diags: Diagnostic[] = [];
  const err = (file: string, span: Span, message: string): void => {
    diags.push(diagnostic(file, span, message));
  };

  // 1. layout
  const secAddr = objects.map(() => new Map<string, number>());
  const placed: PlacedSection[] = [];
  let cur = base;
  let imageEnd = base;
  for (const g of GROUPS) {
    const members: { oi: number; name: string; align: number; size: number }[] = [];
    objects.forEach((o, oi) => {
      for (const s of o.sections)
        if (s.group === g) members.push({ oi, name: s.name, align: s.align, size: s.size });
    });
    if (members.length === 0 || members.every((m) => m.size === 0)) {
      for (const m of members) secAddr[m.oi]?.set(m.name, cur);
      continue;
    }
    const groupAlign = Math.max(4, ...members.map((m) => m.align));
    cur = alignUp(cur, groupAlign);
    const start = cur;
    for (const m of members) {
      cur = alignUp(cur, m.align);
      secAddr[m.oi]?.set(m.name, cur);
      cur += m.size;
    }
    placed.push({ name: g, address: start, size: cur - start });
    if (g !== 'bss') imageEnd = cur;
  }
  const bssPlaced = placed.find((p) => p.name === 'bss');
  const end = cur;

  if (end - base > 0x4000000) {
    const o = objects[0];
    err(
      o?.file ?? 'main.s',
      { from: 0, to: 0, line: 1, col: 1 },
      `program is ${end - base} bytes; the limit is 64 MiB`,
    );
    return empty(base, diags);
  }

  const image = new Uint8Array(imageEnd - base);
  objects.forEach((o, oi) => {
    for (const s of o.sections) {
      if (s.group === 'bss' || s.group === 'discard') continue;
      const at = secAddr[oi]?.get(s.name);
      if (at !== undefined) image.set(s.bytes, at - base);
    }
  });

  // 2. symbols
  const globals = new Map<string, { sym: ObjSymbol; oi: number }>();
  for (const [oi, o] of objects.entries()) {
    for (const s of o.symbols) {
      if (!s.global || s.kind === 'extern') continue;
      const prev = globals.get(s.name);
      if (prev) {
        err(
          o.file,
          s.span,
          `'${s.name}' is defined globally twice (also in ${objects[prev.oi]?.file}:${prev.sym.span.line})`,
        );
        continue;
      }
      globals.set(s.name, { sym: s, oi });
    }
  }
  const locals = objects.map(
    (o) => new Map(o.symbols.filter((s) => s.kind !== 'extern').map((s) => [s.name, s])),
  );

  const resolving = new Set<string>();
  const sectionBase =
    (oi: number) =>
    (name: string): bigint =>
      BigInt(secAddr[oi]?.get(name) ?? base);
  const symbolValue = (sym: ObjSymbol, oi: number): bigint => {
    if (sym.kind === 'label')
      return BigInt(secAddr[oi]?.get(sym.section ?? '') ?? base) + BigInt(sym.offset);
    const key = `${oi}:${sym.name}`;
    if (resolving.has(key))
      throw new AsmError(`'${sym.name}' is defined in terms of itself`, sym.span);
    resolving.add(key);
    try {
      if (!sym.expr) return 0n;
      return evaluate(sym.expr, resolver(oi), sectionBase(oi)).off;
    } finally {
      resolving.delete(key);
    }
  };
  const resolver =
    (oi: number) =>
    (name: string): Value | undefined => {
      const local = locals[oi]?.get(name);
      if (local) return { section: null, off: symbolValue(local, oi) };
      const g = globals.get(name);
      if (g) return { section: null, off: symbolValue(g.sym, g.oi) };
      return undefined;
    };
  const evalIn = (oi: number, f: Fixup): bigint | null => {
    const file = objects[oi]?.file ?? '';
    try {
      return evaluate(f.expr, resolver(oi), sectionBase(oi)).off;
    } catch (e) {
      if (e instanceof UnknownSymbol) {
        const shown = e.symbol.includes('\u0002') ? e.symbol.split('\u0002')[0] + 'f' : e.symbol;
        err(file, e.span, `undefined symbol '${shown}'`);
      } else if (e instanceof AsmError) err(file, e.span, e.message);
      else throw e;
      return null;
    }
  };

  // 3. fixups: %pcrel_hi first, so %pcrel_lo can find its pair by address
  const hiTargets = new Map<number, bigint | null>();
  const fixAddr = (oi: number, f: { section: string; offset: number }): number =>
    (secAddr[oi]?.get(f.section) ?? base) + f.offset;
  objects.forEach((o, oi) => {
    for (const f of o.fixups)
      if (f.kind === 'PCREL_HI20') hiTargets.set(fixAddr(oi, f), evalIn(oi, f));
  });
  objects.forEach((o, oi) => {
    for (const f of o.fixups) {
      const at = fixAddr(oi, f);
      let value: bigint | null;
      if (f.kind === 'PCREL_LO12_I' || f.kind === 'PCREL_LO12_S') {
        let hiAt: number;
        if (f.hi) hiAt = fixAddr(oi, f.hi);
        else {
          const v = evalIn(oi, f);
          if (v === null) continue;
          hiAt = Number(BigInt.asUintN(32, v));
        }
        if (!hiTargets.has(hiAt)) {
          err(
            o.file,
            f.span,
            `%pcrel_lo must name the label of an auipc with %pcrel_hi; none at 0x${hiAt.toString(16)}`,
          );
          continue;
        }
        const target = hiTargets.get(hiAt);
        if (target === null || target === undefined) continue;
        value = target - BigInt(hiAt);
      } else {
        value = evalIn(oi, f);
      }
      if (value === null) continue;
      try {
        applyFixup(image, at - base, f.kind, value, BigInt(at), f.span);
      } catch (e) {
        if (e instanceof AsmError) err(o.file, e.span, e.message);
        else throw e;
      }
    }
  });

  // 4. symbol map, entry, source map
  const symbols: LinkedSymbol[] = [];
  objects.forEach((o, oi) => {
    for (const s of o.symbols) {
      if (s.kind === 'extern' || s.hidden) continue;
      let v: bigint;
      try {
        v = symbolValue(s, oi);
      } catch (e) {
        if (e instanceof AsmError) err(o.file, e.span, e.message);
        else if (e instanceof UnknownSymbol) err(o.file, e.span, e.message);
        else throw e;
        continue;
      }
      symbols.push({
        name: s.name,
        address: Number(BigInt.asUintN(32, v)),
        kind: s.kind,
        section: s.section,
        global: s.global,
        file: o.file,
      });
    }
  });
  symbols.sort((a, b) => a.address - b.address || a.name.localeCompare(b.name));

  let entry = base;
  const entryName = options.entry ?? '_start';
  const entrySym =
    globals.get(entryName) ??
    (locals[0]?.get(entryName) ? { sym: locals[0]?.get(entryName), oi: 0 } : undefined);
  if (entrySym?.sym) entry = Number(BigInt.asUintN(32, symbolValue(entrySym.sym, entrySym.oi)));
  else if (options.entry) {
    err(
      objects[0]?.file ?? 'main.s',
      { from: 0, to: 0, line: 1, col: 1 },
      `entry symbol '${options.entry}' is not defined`,
    );
  }

  const sourceMap: SourceMapEntry[] = [];
  objects.forEach((o, oi) => {
    for (const l of o.lines) {
      const at = secAddr[oi]?.get(l.section);
      if (at === undefined) continue;
      sourceMap.push({
        address: at + l.offset,
        size: l.size,
        file: o.file,
        line: l.line,
        col: l.col,
        kind: l.kind,
      });
    }
  });
  sourceMap.sort((a, b) => a.address - b.address);

  return {
    ok: diags.length === 0,
    image,
    base,
    entry,
    bss: { start: bssPlaced?.address ?? end, size: bssPlaced?.size ?? 0 },
    end,
    sections: placed,
    symbols,
    sourceMap,
    diagnostics: diags,
  };
}

function empty(base: number, diagnostics: Diagnostic[]): LinkResult {
  return {
    ok: false,
    image: new Uint8Array(0),
    base,
    entry: base,
    bss: { start: base, size: 0 },
    end: base,
    sections: [],
    symbols: [],
    sourceMap: [],
    diagnostics,
  };
}

/** Finds the source line for an address (binary search), or undefined. */
export function lineForAddress(
  map: readonly SourceMapEntry[],
  address: number,
): SourceMapEntry | undefined {
  let lo = 0;
  let hi = map.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = map[mid];
    if (!e) break;
    if (address < e.address) hi = mid - 1;
    else if (address >= e.address + e.size) lo = mid + 1;
    else return e;
  }
  return undefined;
}

/** All addresses whose bytes came from `line` of `file` (for setting breakpoints by line). */
export function addressesForLine(
  map: readonly SourceMapEntry[],
  file: string,
  line: number,
): number[] {
  return map
    .filter((e) => e.file === file && e.line === line && e.kind === 'code')
    .map((e) => e.address);
}

/** One input file for `build`. */
export interface SourceFile {
  readonly name: string;
  readonly text: string;
}

/** Assembles one or more files and links them. Diagnostics from both steps are combined. */
export function build(
  input: string | readonly SourceFile[],
  options: AssembleOptions & LinkOptions = {},
): LinkResult {
  const files: readonly SourceFile[] =
    typeof input === 'string' ? [{ name: options.file ?? 'main.s', text: input }] : input;
  const results = files.map((f) => assemble(f.text, { file: f.name }));
  const asmDiags = results.flatMap((r) => r.diagnostics);
  if (asmDiags.length > 0) return empty((options.base ?? DEFAULT_BASE) >>> 0, asmDiags);
  return link(
    results.map((r) => r.object),
    options,
  );
}
