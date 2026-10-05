/**
 * Diagnostics and source positions shared by every compiler stage.
 */

/** A source range: 1-based line/column, `endCol` just past the last character. */
export interface Loc {
  file: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

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

/** Thrown to abandon the current statement or declaration (after reporting). */
export class Bail extends Error {
  constructor() {
    super('bail');
  }
}

/** Thrown when there are too many errors to keep going. */
export class TooMany extends Error {
  constructor() {
    super('too many errors');
  }
}

export const MAX_ERRORS = 50;

/** Collects diagnostics; dedupes identical reports at the same place. */
export class Diags {
  readonly list: CcDiagnostic[] = [];
  private seen = new Set<string>();
  errors = 0;

  report(loc: Loc, message: string, severity: 'error' | 'warning' = 'error'): void {
    const key = `${loc.file}:${loc.line}:${loc.col}:${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push({
      line: loc.line,
      column: loc.col,
      endLine: loc.endLine,
      endColumn: loc.endCol,
      message,
      severity,
      file: loc.file,
    });
    if (severity === 'error') {
      this.errors++;
      if (this.errors >= MAX_ERRORS) throw new TooMany();
    }
  }

  error(loc: Loc, message: string): void {
    this.report(loc, message, 'error');
  }

  warn(loc: Loc, message: string): void {
    this.report(loc, message, 'warning');
  }
}

/** A range covering `a` through `b`. */
export function span(a: Loc, b: Loc): Loc {
  if (a.file !== b.file) return a;
  if (b.endLine < a.line || (b.endLine === a.line && b.endCol < a.col)) return a;
  return { file: a.file, line: a.line, col: a.col, endLine: b.endLine, endCol: b.endCol };
}
