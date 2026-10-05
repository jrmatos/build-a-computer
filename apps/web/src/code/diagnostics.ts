/**
 * Converting assembler diagnostics for the store and for CodeMirror (ASM-03).
 *
 * `SourceDiagnostic` positions are 1-based; `endLine`/`endColumn` point just
 * past the last character (exclusive), so a one-character error at line 3,
 * column 5 is `{ line: 3, column: 5, endLine: 3, endColumn: 6 }`.
 */
import { build, type Diagnostic as AsmDiagnostic, type SourceFile } from '@build-a-computer/asm';
import type { Level } from '@build-a-computer/schema';
import type { SourceDiagnostic } from '@build-a-computer/worker';
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint';
import type { Text } from '@codemirror/state';

/** The player's file name, as diagnostics and the debugger report it. */
export const MAIN_FILE = 'main.s';

/** 1-based line and column of a UTF-16 offset. */
export function lineCol(text: string, offset: number): { line: number; column: number } {
  const o = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let start = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < o; i = text.indexOf('\n', i + 1)) {
    line++;
    start = i + 1;
  }
  return { line, column: o - start + 1 };
}

/** Assembler diagnostics (offsets) to store diagnostics (lines/columns), per file text. */
export function toSourceDiagnostics(diags: readonly AsmDiagnostic[], texts: Readonly<Record<string, string>>): SourceDiagnostic[] {
  return diags.map((d) => {
    const text = texts[d.file] ?? '';
    const end = lineCol(text, Math.max(d.to, d.from));
    return {
      line: d.line,
      column: d.col,
      endLine: end.line,
      endColumn: end.column,
      message: d.message,
      severity: d.severity,
      file: d.file,
    };
  });
}

/** The files a code level assembles: the player's main.s, then the level's library files. */
export function levelFiles(source: string, level: Level | null): SourceFile[] {
  return [{ name: MAIN_FILE, text: source }, ...(level?.code?.library ?? []).map((f) => ({ name: f.name, text: f.text }))];
}

/** Assemble and link the player's code with the level's library; diagnostics only. */
export function checkSource(source: string, level: Level | null): SourceDiagnostic[] {
  const files = levelFiles(source, level);
  let diags: readonly AsmDiagnostic[];
  try {
    diags = build(files).diagnostics;
  } catch (e) {
    // build() reports problems as diagnostics; anything thrown is a bug, shown rather than lost.
    diags = [{ severity: 'error', message: e instanceof Error ? e.message : String(e), file: MAIN_FILE, line: 1, col: 1, from: 0, to: 0 }];
  }
  return toSourceDiagnostics(diags, Object.fromEntries(files.map((f) => [f.name, f.text])));
}

function offsetOf(doc: Text, line: number, column: number): number {
  if (line < 1) return 0;
  if (line > doc.lines) return doc.length;
  const l = doc.line(line);
  return Math.min(l.from + Math.max(0, column - 1), l.to);
}

/**
 * Store diagnostics for one file to CodeMirror lint diagnostics. An empty
 * range grows to the rest of the word (or the line) so the squiggle shows.
 */
export function toCmDiagnostics(diags: readonly SourceDiagnostic[], doc: Text, file: string): CmDiagnostic[] {
  const out: CmDiagnostic[] = [];
  for (const d of diags) {
    if ((d.file || MAIN_FILE) !== file) continue;
    let from = offsetOf(doc, d.line, d.column);
    let to = Math.max(from, offsetOf(doc, d.endLine, d.endColumn));
    if (to === from) {
      const l = doc.lineAt(from);
      const rest = l.text.slice(from - l.from);
      const word = /^\S+/.exec(rest)?.[0].length ?? 0;
      if (word) to = from + word;
      else if (l.to > l.from) {
        // At the end of a line: underline its last non-space character.
        to = l.to;
        from = Math.max(l.from, l.from + l.text.trimEnd().length - 1);
        if (from >= to) from = to - 1;
      }
    }
    out.push({ from, to, severity: d.severity, message: d.message, source: 'asm' });
  }
  return out;
}
