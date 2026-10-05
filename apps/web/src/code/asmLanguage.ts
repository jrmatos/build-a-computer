/**
 * RISC-V assembly support for CodeMirror (ASM-03): highlighting from the
 * assembler's own tokenizer, completion of mnemonics, registers, directives,
 * CSRs and labels, and `#` line comments for Ctrl+/.
 */
import { ABI_NAMES, CSR_NAMES, DIRECTIVES, MNEMONICS, tokenize, type Token, type TokenKind } from '@build-a-computer/asm';
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { t } from '../i18n';

/** CSS class for a token kind, or null for kinds drawn in the plain text color. */
export function tokenClass(kind: TokenKind): string | null {
  switch (kind) {
    case 'mnemonic':
      return 'cm-asm-mnemonic';
    case 'directive':
      return 'cm-asm-directive';
    case 'label':
    case 'localLabel':
      return 'cm-asm-label';
    case 'localRef':
    case 'symbol':
      return 'cm-asm-symbol';
    case 'register':
      return 'cm-asm-register';
    case 'csr':
      return 'cm-asm-csr';
    case 'number':
      return 'cm-asm-number';
    case 'char':
    case 'string':
      return 'cm-asm-string';
    case 'reloc':
      return 'cm-asm-reloc';
    case 'comment':
      return 'cm-asm-comment';
    case 'operator':
    case 'comma':
    case 'lparen':
    case 'rparen':
    case 'colon':
    case 'equals':
      return 'cm-asm-punct';
    case 'error':
      return 'cm-asm-error';
    default:
      return null;
  }
}

/** Highlight ranges for a whole file, sorted, non-overlapping. Pure (tested). */
export function highlightRanges(text: string): { from: number; to: number; cls: string }[] {
  const out: { from: number; to: number; cls: string }[] = [];
  let last = 0;
  for (const tok of tokenize(text)) {
    const cls = tokenClass(tok.kind);
    if (!cls || tok.to <= tok.from || tok.from < last) continue;
    out.push({ from: tok.from, to: Math.min(tok.to, text.length), cls });
    last = tok.to;
  }
  return out;
}

const marks = new Map<string, Decoration>();
const mark = (cls: string) => {
  let m = marks.get(cls);
  if (!m) marks.set(cls, (m = Decoration.mark({ class: cls })));
  return m;
};

function decorate(state: EditorState): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const r of highlightRanges(state.doc.toString())) b.add(r.from, r.to, mark(r.cls));
  return b.finish();
}

/** Token highlighting. Re-tokenizes the file on each change (files are at most 100 KB). */
const highlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view.state);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = decorate(u.state);
    }
  },
  { decorations: (v) => v.decorations },
);

const REGISTERS: readonly string[] = [...ABI_NAMES, 'fp', ...Array.from({ length: 32 }, (_, i) => `x${i}`)];

/** Labels defined in the given files, in order of first appearance. */
export function labelsIn(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const text of texts) {
    for (const tok of tokenize(text)) if (tok.kind === 'label' && !/^\d/.test(tok.text)) seen.add(tok.text);
  }
  return [...seen];
}

/** True when the cursor's statement has no mnemonic/directive yet (completion offers instructions). */
export function atStatementHead(lineBefore: string): boolean {
  // Strip a leading `label:` (one or more) and whitespace.
  const rest = lineBefore.replace(/^\s*(?:[A-Za-z_.$][\w.$]*\s*:\s*|\d+\s*:\s*)*/, '');
  return /^[A-Za-z_.$][\w.$]*$|^$/.test(rest);
}

/**
 * Completion source. `otherFiles` returns the level's library texts so their
 * labels complete too.
 */
export function asmCompletions(otherFiles: () => readonly string[] = () => []): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[A-Za-z_.$%][\w.$]*/);
    if (!word && !ctx.explicit) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    if (/(#|\/\/)/.test(before.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) return null; // inside a comment
    const from = word ? word.from : ctx.pos;
    const head = atStatementHead(before);
    const options: Completion[] = [];
    if (head) {
      for (const m of MNEMONICS) options.push({ label: m, type: 'keyword', detail: t('code.complete.mnemonic') });
      for (const d of DIRECTIVES) options.push({ label: d, type: 'namespace', detail: t('code.complete.directive') });
    } else {
      for (const r of REGISTERS) options.push({ label: r, type: 'variable', detail: t('code.complete.register'), boost: r.startsWith('x') ? -1 : 0 });
      for (const c of CSR_NAMES.keys()) options.push({ label: c, type: 'property', detail: t('code.complete.csr'), boost: -2 });
      for (const l of labelsIn([ctx.state.doc.toString(), ...otherFiles()]))
        options.push({ label: l, type: 'function', detail: t('code.complete.label'), boost: 1 });
      for (const r of ['%hi', '%lo', '%pcrel_hi', '%pcrel_lo']) options.push({ label: r, type: 'keyword' });
    }
    return { from, options, validFor: /^[\w.$%]*$/ };
  };
}

/** Highlighting plus `#` line comments (toggleComment reads commentTokens). */
export function asmLanguage(): Extension {
  return [highlighter, EditorState.languageData.of(() => [{ commentTokens: { line: '#' } }])];
}

export type { Token };
