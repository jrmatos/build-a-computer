/**
 * C subset compiler: C source -> RV32IM assembly for @build-a-computer/asm
 * (plan M10, CC-*). STUB: the compiler agent implements it.
 */

export interface CcDiagnostic {
  /** 1-based line and column; endColumn points just past the last character. */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  severity: 'error' | 'warning';
  file: string;
}

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
}

export interface CompileOptions {
  /** File name used in diagnostics. */
  file?: string;
  /** Extra headers by name for #include "x.h" / <x.h> (libc provides its own). */
  headers?: Record<string, string>;
}

export function compile(_source: string, options: CompileOptions = {}): CompileResult {
  const file = options.file ?? 'main.c';
  return {
    ok: false,
    asm: '',
    lineMap: [],
    diagnostics: [{ line: 1, column: 1, endLine: 1, endColumn: 2, message: 'C compiler not implemented yet', severity: 'error', file }],
  };
}
