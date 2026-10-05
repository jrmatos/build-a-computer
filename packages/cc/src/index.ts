/**
 * C subset compiler: C source -> RV32IM assembly for @build-a-computer/asm
 * (plan M10, CC-01..CC-05, CC-08 line table).
 *
 * Pipeline: preprocess (headers from `options.headers` plus the compiler's
 * freestanding headers) -> parse and type-check -> tree code generation with
 * the ilp32 calling convention (GCC compatible) -> light peephole.
 * See README.md for the supported language, the ABI and the limits.
 */

import { type AsmLine, Codegen, type FnDebug } from './codegen';
import { type CcDiagnostic, Diags, TooMany } from './diag';
import { Parser } from './parse';
import { Preprocessor } from './preprocess';
import { setCharSigned } from './types';
import { RUNTIME_SOURCE } from './runtime';

export type { CcDiagnostic } from './diag';
export type { FnDebug } from './codegen';
export { BUILTIN_HEADERS } from './headers';

export interface CompileResult {
  ok: boolean;
  /** RV32 assembly text (GNU-style, as accepted by @build-a-computer/asm). */
  asm: string;
  diagnostics: CcDiagnostic[];
  /**
   * For each line of `asm` (index 0 = line 1), the 1-based C source line it
   * came from, or 0 when none. The debugger maps pc -> asm line -> C line.
   */
  lineMap: number[];
  /**
   * Per-function debug info (CC-08): source line range and the frame offset
   * (from s0, the frame pointer) of every local and parameter.
   */
  functions: FnDebug[];
}

export interface CompileOptions {
  /** File name used in diagnostics. */
  file?: string;
  /** Extra headers by name for #include "x.h" / <x.h> (libc provides its own). */
  headers?: Record<string, string>;
  /** Plain `char` is signed? Default false: unsigned, like GCC on RISC-V (psABI). */
  charSigned?: boolean;
  /** Extra predefined macros, name -> replacement text. */
  defines?: Record<string, string>;
  /** Keep every local in the stack frame (no register variables): simplest code to read. */
  noRegisterVariables?: boolean;
}

/** Compile one translation unit. Never throws: problems become diagnostics. */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  return compileUnit(source, options, false);
}

function compileUnit(source: string, options: CompileOptions, internal: boolean): CompileResult {
  const file = options.file ?? 'main.c';
  const charSigned = options.charSigned ?? false;
  setCharSigned(charSigned);
  const diags = new Diags();
  const labels = { next: 1 };
  let lines: AsmLine[] = [];
  let functions: FnDebug[] = [];
  try {
    const pp = new Preprocessor(diags, {
      file,
      headers: options.headers ?? {},
      charSigned,
      ...(options.defines ? { defines: options.defines } : {}),
    });
    const toks = pp.run(source);
    const parser = new Parser(toks, diags, { labels });
    const prog = parser.parseProgram();
    if (diags.errors === 0) {
      const cg = new Codegen(prog, diags, labels, file, internal ? 'rt' : '', !options.noRegisterVariables);
      const res = cg.run();
      lines = res.lines;
      functions = res.debug;
      if (res.helpers.size && !internal) {
        const rt = compileUnit(RUNTIME_SOURCE, { file: '<runtime>' }, true);
        setCharSigned(charSigned);
        if (!rt.ok) {
          diags.error({ file, line: 1, col: 1, endLine: 1, endCol: 2 }, 'internal error: runtime helpers failed to compile');
        } else {
          for (const l of rt.asm.split('\n')) lines.push({ text: l, line: 0 });
        }
      }
    }
  } catch (e) {
    if (!(e instanceof TooMany)) {
      const msg = e instanceof Error ? e.message : String(e);
      diags.error({ file, line: 1, col: 1, endLine: 1, endCol: 2 }, `internal compiler error: ${msg}`);
    }
  }
  const ok = diags.errors === 0;
  const diagnostics = diags.list;
  if (!ok) return { ok, asm: '', diagnostics, lineMap: [], functions: [] };
  const head: AsmLine[] = internal ? [] : [{ text: `# ${file}: compiled by the Build a Computer C compiler`, line: 0 }];
  const all = [...head, ...lines];
  return {
    ok,
    asm: all.map((l) => l.text).join('\n') + '\n',
    diagnostics,
    lineMap: all.map((l) => l.line),
    functions,
  };
}
