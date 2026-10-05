/**
 * C support for CodeMirror on C levels: the lezer C/C++ grammar
 * (@codemirror/lang-cpp) with a highlight style drawn from the code color
 * tokens (code/code.css, both themes), and completion of C keywords, libc
 * functions and macros, header names and the identifiers in the open files.
 */
import { cpp } from '@codemirror/lang-cpp';
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { t } from '../i18n';

/** Every color is a CSS variable, so one style serves the light and dark themes. */
export const cHighlightStyle = HighlightStyle.define([
  { tag: [tags.controlKeyword, tags.definitionKeyword, tags.modifier, tags.operatorKeyword, tags.keyword], color: 'var(--code-mnemonic)' },
  { tag: [tags.processingInstruction, tags.meta], color: 'var(--code-directive)' },
  { tag: tags.special(tags.name), color: 'var(--code-reloc)' },
  { tag: [tags.typeName, tags.standard(tags.typeName)], color: 'var(--code-register)' },
  { tag: [tags.function(tags.definition(tags.variableName)), tags.labelName], color: 'var(--code-label)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--code-symbol)' },
  { tag: tags.propertyName, color: 'var(--code-csr)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--code-number)' },
  { tag: [tags.string, tags.character, tags.special(tags.string)], color: 'var(--code-string)' },
  { tag: tags.escape, color: 'var(--code-reloc)' },
  { tag: [tags.lineComment, tags.blockComment, tags.comment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [tags.operator, tags.arithmeticOperator, tags.logicOperator, tags.bitwiseOperator, tags.compareOperator, tags.definitionOperator, tags.updateOperator, tags.punctuation, tags.paren, tags.brace, tags.squareBracket, tags.separator], color: 'var(--code-punct)' },
]);

/** C keywords offered by completion (C99 subset plus the common types). */
export const C_KEYWORDS: readonly string[] = [
  'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'else', 'enum', 'extern', 'for', 'goto', 'if', 'inline',
  'int', 'long', 'register', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned',
  'void', 'volatile', 'while', '_Bool', 'NULL',
];
const C_TYPES = new Set(['char', 'int', 'long', 'short', 'signed', 'unsigned', 'void', '_Bool']);

/** A function or macro a header declares. */
export interface HeaderSymbol {
  name: string;
  kind: 'function' | 'macro' | 'type';
  header: string;
  /** The declaration as written, e.g. `int printf(const char *fmt, ...);`. */
  signature: string;
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');

/** Functions, macros and typedefs declared by each header. Pure (tested). */
export function headerSymbols(headers: Readonly<Record<string, string>>): HeaderSymbol[] {
  const out: HeaderSymbol[] = [];
  const seen = new Set<string>();
  const add = (s: HeaderSymbol) => {
    if (seen.has(s.name) || s.name.startsWith('__')) return;
    seen.add(s.name);
    out.push(s);
  };
  for (const [header, raw] of Object.entries(headers)) {
    const text = stripComments(raw);
    for (const m of text.matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)(\([^)]*\))?[^\n]*/gm)) {
      // Include guards (FOO_H) are noise.
      if (!m[2] && /_H_?$/.test(m[1]!)) continue;
      add({ name: m[1]!, kind: 'macro', header, signature: m[0].trim() });
    }
    // Declarations end with ';' (prototypes) or '{' (static inline bodies); directives end statements.
    const decls = ';' + text.replace(/^[ \t]*#[^\n]*/gm, ';');
    for (const m of decls.matchAll(/(?<=[;}])\s*((?:[A-Za-z_]\w*[\s*]+)+?\**\s*([A-Za-z_]\w*)\s*\(([^;{}]*?)\))\s*[;{]/g)) {
      const name = m[2]!;
      if (C_KEYWORDS.includes(name) || /^\s*#/.test(m[1]!)) continue;
      add({ name, kind: 'function', header, signature: `${m[1]!.replace(/\s+/g, ' ').trim()};` });
    }
    for (const m of text.matchAll(/typedef\s+[^;]*?\b([A-Za-z_]\w*)\s*;/g)) add({ name: m[1]!, kind: 'type', header, signature: m[0].replace(/\s+/g, ' ') });
  }
  return out;
}

/** Identifiers in C texts (no keywords, no string or comment contents), in order of first appearance. */
export function identifiersIn(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of texts) {
    const text = stripComments(raw).replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""').replace(/^[ \t]*#[ \t]*include[^\n]*/gm, '');
    for (const m of text.matchAll(/[A-Za-z_]\w*/g)) if (!C_KEYWORDS.includes(m[0]) && !/^\d/.test(m[0])) seen.add(m[0]);
  }
  return [...seen];
}

const QUIET = new Set(['LineComment', 'BlockComment', 'String', 'CharLiteral', 'RawString', 'Number']);

/**
 * Completion source for C. `context` returns the headers on the include path
 * (libc plus level .h files) and the other files' texts.
 */
export function cCompletions(context: () => { headers: Readonly<Record<string, string>>; others: readonly string[] }): CompletionSource {
  let cache: { headers: Readonly<Record<string, string>>; symbols: HeaderSymbol[] } | null = null;
  const symbolsFor = (headers: Readonly<Record<string, string>>) => {
    if (cache?.headers !== headers) cache = { headers, symbols: headerSymbols(headers) };
    return cache.symbols;
  };
  return (ctx: CompletionContext): CompletionResult | null => {
    const { headers, others } = context();
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    // #include <st|  or  #include "ut|
    const inc = /#\s*include\s*([<"])([\w./-]*)$/.exec(before);
    if (inc) {
      const names = Object.keys(headers);
      return {
        from: ctx.pos - inc[2]!.length,
        options: names.map((n) => ({ label: n, type: 'namespace', detail: t('code.complete.header'), apply: n + (inc[1] === '<' ? '>' : '"') })),
        validFor: /^[\w./-]*$/,
      };
    }
    const word = ctx.matchBefore(/[A-Za-z_]\w*/);
    if (!word && !ctx.explicit) return null;
    // Nothing inside comments, strings or numbers.
    const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
    for (let n: typeof node | null = node; n; n = n.parent) if (QUIET.has(n.name)) return null;
    if (/^\s*#\s*\w*$/.test(before)) {
      const from = ctx.pos - (/\w*$/.exec(before)?.[0].length ?? 0);
      return {
        from,
        options: ['include', 'define', 'ifdef', 'ifndef', 'if', 'else', 'endif', 'undef'].map((d) => ({ label: d, type: 'keyword', detail: t('code.complete.directive') })),
        validFor: /^\w*$/,
      };
    }
    const from = word ? word.from : ctx.pos;
    const typed = word?.text ?? '';
    const options: Completion[] = [];
    const taken = new Set<string>();
    const push = (c: Completion) => {
      if (taken.has(c.label)) return;
      taken.add(c.label);
      options.push(c);
    };
    for (const s of symbolsFor(headers)) {
      push({
        label: s.name,
        type: s.kind === 'function' ? 'function' : s.kind === 'type' ? 'type' : 'constant',
        detail: s.header,
        info: s.signature,
        boost: 1,
        ...(s.kind === 'function' ? { apply: s.name } : {}),
      });
    }
    const doc = ctx.state.doc.toString();
    const own = identifiersIn([doc]);
    // The word being typed is not a suggestion unless it also appears elsewhere.
    const count = typed ? doc.split(new RegExp(`\\b${typed}\\b`)).length - 1 : 0;
    for (const id of own) if (id !== typed || count > 1) push({ label: id, type: 'variable', detail: t('code.complete.identifier'), boost: 2 });
    for (const id of identifiersIn(others)) push({ label: id, type: 'variable', detail: t('code.complete.identifier') });
    for (const k of C_KEYWORDS) push({ label: k, type: C_TYPES.has(k) ? 'type' : 'keyword', detail: t('code.complete.keyword') });
    return { from, options, validFor: /^\w*$/ };
  };
}

/** C highlighting, comment tokens (Ctrl+/ uses //) and indentation from the grammar. */
export function cLanguage(): Extension {
  return [cpp(), syntaxHighlighting(cHighlightStyle)];
}

/** File names the C language support handles (.c and .h); everything else is assembly. */
export const isCFile = (name: string): boolean => /\.[ch]$/i.test(name) || name === LIBC_TAB;

/** The read-only libc reference tab. */
export const LIBC_TAB = 'libc';

/** The libc reference text: every header, in name order, under a banner. */
export function libcReference(headers: Readonly<Record<string, string>>): string {
  const names = Object.keys(headers).sort();
  const list = names.map((n) => ` *   #include <${n}>`).join('\n');
  const head = `/*\n * libc reference: the headers you can #include in main.c.\n *\n${list}\n */\n`;
  return head + names.map((n) => `\n/* ==== <${n}> ${'='.repeat(Math.max(4, 60 - n.length))} */\n\n${headers[n]!.trimEnd()}\n`).join('');
}
