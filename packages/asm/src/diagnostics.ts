/** Source ranges and error reporting shared by the assembler and linker. */

import type { Token } from './lexer';

/** A source range. Offsets are into the file's text; line and col are 1-based. */
export interface Span {
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly col: number;
}

/** One error, with the range [from, to) to underline in the editor (ASM-03). */
export interface Diagnostic {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly from: number;
  readonly to: number;
}

/** Error carrying a span; caught per statement and turned into a Diagnostic. */
export class AsmError extends Error {
  constructor(
    message: string,
    readonly span: Span,
  ) {
    super(message);
  }
}

/** Span of one token. */
export function spanOf(t: Token): Span {
  return { from: t.from, to: t.to, line: t.line, col: t.col };
}

/** Span from the start of `a` to the end of `b`. */
export function spanJoin(a: Span, b: Span): Span {
  return { from: a.from, to: Math.max(a.to, b.to), line: a.line, col: a.col };
}

/** Span covering a non-empty token list. */
export function spanOfTokens(tokens: readonly Token[], fallback: Span): Span {
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (!first || !last) return fallback;
  return spanJoin(spanOf(first), spanOf(last));
}

/** Builds a Diagnostic. */
export function diagnostic(file: string, span: Span, message: string): Diagnostic {
  return {
    severity: 'error',
    message,
    file,
    line: span.line,
    col: span.col,
    from: span.from,
    to: span.to,
  };
}

/** Formats a diagnostic like a compiler: `file:line:col: error: message`. */
export function formatDiagnostic(d: Diagnostic): string {
  return `${d.file}:${d.line}:${d.col}: ${d.severity}: ${d.message}`;
}
