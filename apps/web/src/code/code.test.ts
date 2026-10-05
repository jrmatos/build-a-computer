import { EditorState, Text } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import type { CompletionResult } from '@codemirror/autocomplete';
import { describe, expect, it } from 'vitest';
import type { RvSnapshot } from '@build-a-computer/worker';
import { asmCompletions, atStatementHead, highlightRanges, labelsIn } from './asmLanguage';
import { checkSource, lineCol, toCmDiagnostics, toSourceDiagnostics } from './diagnostics';
import { breakpointField, breakpointLines, pcLineField, setBreakpointsEffect, setPcLineEffect, toggleLine } from './extensions';
import { pcLineFor } from './AsmEditor';
import { devLevelById } from './devLevel';
import { syntaxTree } from '@codemirror/language';
import { highlightTree } from '@lezer/highlight';
import { cCompletions, cHighlightStyle, cLanguage, headerSymbols, identifiersIn, libcReference } from './cLanguage';
import { checkC, headersFor, isStubDiagnostic } from './cDiagnostics';
import { mainFileFor } from './diagnostics';

const classAt = (text: string, word: string) => highlightRanges(text).find((r) => text.slice(r.from, r.to) === word)?.cls;

describe('asm highlighting', () => {
  const src = 'loop: addi a0, a0, %lo(msg) # step\n  .word 0x10\nmsg: .asciz "hi"\n';
  it('classifies mnemonics, registers, labels, numbers, strings, comments, relocations', () => {
    expect(classAt(src, 'addi')).toBe('cm-asm-mnemonic');
    expect(classAt(src, 'a0')).toBe('cm-asm-register');
    expect(classAt(src, 'loop')).toBe('cm-asm-label');
    expect(classAt(src, '.word')).toBe('cm-asm-directive');
    expect(classAt(src, '0x10')).toBe('cm-asm-number');
    expect(classAt(src, '"hi"')).toBe('cm-asm-string');
    expect(classAt(src, '# step')).toBe('cm-asm-comment');
    expect(classAt(src, '%lo')).toBe('cm-asm-reloc');
  });
  it('ranges are sorted and never overlap', () => {
    const r = highlightRanges(src);
    for (let i = 1; i < r.length; i++) expect(r[i]!.from).toBeGreaterThanOrEqual(r[i - 1]!.to);
  });
  it('never throws on garbage', () => {
    expect(() => highlightRanges('"unterminated\n\'\u0000 @@@ %%% 0x')).not.toThrow();
  });
});

describe('asm completion', () => {
  const complete = (doc: string, libs: string[] = []) => {
    const state = EditorState.create({ doc });
    return asmCompletions(() => libs)(new CompletionContext(state, doc.length, true)) as CompletionResult | null;
  };
  it('offers mnemonics and directives at the head of a statement', () => {
    const labels = complete('start: ad')!.options.map((o) => o.label);
    expect(labels).toContain('addi');
    expect(labels).toContain('.word');
    expect(labels).not.toContain('a0');
  });
  it('offers registers and labels (including library labels) in operands', () => {
    const labels = complete('foo:\n  la a0, f', ['bar: ret'])!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(['a0', 'sp', 'x5', 'foo', 'bar', 'mstatus']));
    expect(labels).not.toContain('addi');
  });
  it('stays quiet inside comments', () => {
    expect(complete('  # ad')).toBeNull();
  });
  it('helpers', () => {
    expect(atStatementHead('  ')).toBe(true);
    expect(atStatementHead('x: 1: li')).toBe(true);
    expect(atStatementHead('  li a')).toBe(false);
    expect(labelsIn(['a: b: nop', '1: c = 3'])).toEqual(['a', 'b', 'c']);
  });
});

describe('diagnostics', () => {
  it('lineCol is 1-based', () => {
    expect(lineCol('ab\ncd', 0)).toEqual({ line: 1, column: 1 });
    expect(lineCol('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
  });
  it('ASM-03: errors underline the right token', () => {
    const src = 'nop\n  addi a0, a0, bogus_reg, 1\n  frob t0\n';
    const diags = checkSource(src, null);
    expect(diags.length).toBeGreaterThan(0);
    const cm = toCmDiagnostics(diags, Text.of(src.split('\n')), 'main.s');
    const frob = cm.find((d) => src.slice(d.from, d.to) === 'frob');
    expect(frob, JSON.stringify(cm.map((d) => [src.slice(d.from, d.to), d.message]))).toBeDefined();
    expect(frob!.severity).toBe('error');
  });
  it('converts offsets to exclusive end columns and filters by file', () => {
    const d = toSourceDiagnostics([{ severity: 'error', message: 'm', file: 'lib.s', line: 2, col: 4, from: 7, to: 10 }], { 'lib.s': 'abc\nxyzabcd' });
    expect(d[0]).toMatchObject({ line: 2, column: 4, endLine: 2, endColumn: 7, file: 'lib.s' });
    const doc = Text.of(['abc', 'xyzabcd']);
    expect(toCmDiagnostics(d, doc, 'main.s')).toEqual([]);
    const [c] = toCmDiagnostics(d, doc, 'lib.s');
    expect(doc.sliceString(c!.from, c!.to)).toBe('abc');
  });
  it('an empty range grows to the word so the squiggle shows', () => {
    const doc = Text.of(['  frob t0']);
    const [c] = toCmDiagnostics([{ line: 1, column: 3, endLine: 1, endColumn: 3, message: 'm', severity: 'error', file: 'main.s' }], doc, 'main.s');
    expect(doc.sliceString(c!.from, c!.to)).toBe('frob');
  });
  it('the dev level starter assembles cleanly with its library', () => {
    const level = devLevelById('dev-code')!;
    expect(checkSource(level.code!.starter, level)).toEqual([]);
  });
});

describe('breakpoints and pc line', () => {
  it('breakpoints follow their line when text is inserted above', () => {
    let s = EditorState.create({ doc: 'a\nb\nc', extensions: [breakpointField] });
    s = s.update({ effects: setBreakpointsEffect.of([2, 3, 9]) }).state;
    expect(breakpointLines(s)).toEqual([2, 3]);
    s = s.update({ changes: { from: 0, insert: 'x\n' } }).state;
    expect(breakpointLines(s)).toEqual([3, 4]);
  });
  it('toggleLine adds and removes', () => {
    expect(toggleLine([1, 5], 3)).toEqual([1, 3, 5]);
    expect(toggleLine([1, 3, 5], 3)).toEqual([1, 5]);
  });
  it('pc line field marks one line', () => {
    let s = EditorState.create({ doc: 'a\nb', extensions: [pcLineField] });
    s = s.update({ effects: setPcLineEffect.of(2) }).state;
    expect(s.field(pcLineField).line).toBe(2);
    s = s.update({ effects: setPcLineEffect.of(null) }).state;
    expect(s.field(pcLineField).line).toBeNull();
  });
  it('pcLineFor shows the line only when stopped in that file', () => {
    const rv = (state: Partial<RvSnapshot['state']>) => ({ rv: { state: { pc: 0, regs: [], mode: 'M', instret: 0, running: false, csrs: {}, ...state }, uart: '', fbVersion: 0 } as RvSnapshot });
    expect(pcLineFor(rv({ line: 4 }), 'main.s')).toBe(4);
    expect(pcLineFor(rv({ line: 4, running: true }), 'main.s')).toBeNull();
    expect(pcLineFor(rv({ line: 4, file: 'print.s' }), 'main.s')).toBeNull();
    expect(pcLineFor(rv({ line: 4, file: 'print.s' }), 'print.s')).toBe(4);
    expect(pcLineFor({ rv: null }, 'main.s')).toBeNull();
  });
});

describe('C levels', () => {
  const headers = {
    'stdio.h': '#ifndef STDIO_H\n#define STDIO_H\n/* print */\nint printf(const char *fmt, ...);\nint putchar(int c);\n#define EOF (-1)\n#endif\n',
    'stdlib.h': 'typedef unsigned int size_t;\nvoid *malloc(size_t n);\nstatic inline int abs(int x) { return x < 0 ? -x : x; }\n',
  };
  const completeC = (doc: string, pos = doc.length) => {
    const state = EditorState.create({ doc, extensions: [cLanguage()] });
    return cCompletions(() => ({ headers, others: ['int square(int x) { return x; }'] }))(new CompletionContext(state, pos, true)) as CompletionResult | null;
  };

  it('mainFileFor picks main.c on C levels', () => {
    expect(mainFileFor(devLevelById('dev-c'))).toBe('main.c');
    expect(mainFileFor(devLevelById('dev-code'))).toBe('main.s');
    expect(mainFileFor(null)).toBe('main.s');
  });
  it('headerSymbols finds prototypes, inline functions, macros and typedefs, not include guards', () => {
    const syms = headerSymbols(headers);
    const by = (n: string) => syms.find((s) => s.name === n);
    expect(by('printf')).toMatchObject({ kind: 'function', header: 'stdio.h', signature: 'int printf(const char *fmt, ...);' });
    expect(by('putchar')?.kind).toBe('function');
    expect(by('malloc')).toMatchObject({ kind: 'function', header: 'stdlib.h' });
    expect(by('abs')?.kind).toBe('function');
    expect(by('EOF')?.kind).toBe('macro');
    expect(by('size_t')?.kind).toBe('type');
    expect(by('STDIO_H')).toBeUndefined();
  });
  it('identifiersIn skips keywords, strings and comments', () => {
    expect(identifiersIn(['int foo = bar; /* baz */ char *s = "qux"; // zap'])).toEqual(['foo', 'bar', 's']);
  });
  it('completes keywords, libc functions, file and library identifiers', () => {
    const labels = completeC('int counter;\nint main(void) {\n  co')!.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(['counter', 'printf', 'malloc', 'EOF', 'square', 'return', 'unsigned']));
  });
  it('completes header names after #include', () => {
    const r = completeC('#include <st')!;
    expect(r.options.map((o) => o.label)).toEqual(['stdio.h', 'stdlib.h']);
    expect(r.options[0]!.apply).toBe('stdio.h>');
  });
  it('stays quiet inside comments and strings', () => {
    expect(completeC('int x; /* pri')).toBeNull();
    expect(completeC('char *s = "pri')).toBeNull();
  });
  it('C highlighting tags keywords, strings and comments', () => {
    const doc = 'int main(void) { return 0; } // done\nchar *s = "hi";';
    const state = EditorState.create({ doc, extensions: [cLanguage()] });
    const classes: Record<string, string> = {};
    highlightTree(syntaxTree(state), cHighlightStyle, (from, to, cls) => {
      classes[doc.slice(from, to)] = cls;
    });
    for (const w of ['return', '// done', '"hi"', '0', 'main']) expect(classes[w], w).toBeTruthy();
    expect(classes['return']).not.toBe(classes['"hi"']);
  });
  it('checkC shows nothing while the compiler is a stub, and tags diagnostics with the file', () => {
    expect(isStubDiagnostic({ message: 'C compiler not implemented yet' })).toBe(true);
    const diags = checkC('int main(void) { return 0; }', devLevelById('dev-c')!);
    expect(diags.every((d) => !isStubDiagnostic(d))).toBe(true);
    for (const d of diags) expect(['main.c', 'util.c', 'util.h']).toContain(d.file);
  });
  it('headersFor includes the level .h files', () => {
    expect(headersFor(devLevelById('dev-c')!)['util.h']).toContain('int square');
  });
  it('diagnostics without a file land in the level main file', () => {
    const doc = Text.of(['int x = ;']);
    const d = [{ line: 1, column: 9, endLine: 1, endColumn: 10, message: 'expected expression', severity: 'error' as const, file: '' }];
    expect(toCmDiagnostics(d, doc, 'main.c', 'main.c')).toHaveLength(1);
    expect(toCmDiagnostics(d, doc, 'main.c')).toHaveLength(0);
  });
  it('pcLineFor maps a stop in main.c to the C editor', () => {
    const rv = (state: Partial<RvSnapshot['state']>) => ({ rv: { state: { pc: 0, regs: [], mode: 'M', instret: 0, running: false, csrs: {}, ...state }, uart: '', fbVersion: 0 } as RvSnapshot });
    expect(pcLineFor(rv({ line: 7, file: 'main.c' }), 'main.c', 'main.c')).toBe(7);
    expect(pcLineFor(rv({ line: 7 }), 'main.c', 'main.c')).toBe(7);
    expect(pcLineFor(rv({ line: 7, file: 'util.c' }), 'main.c', 'main.c')).toBeNull();
  });
  it('libcReference lists every header', () => {
    const ref = libcReference(headers);
    expect(ref).toContain('#include <stdio.h>');
    expect(ref).toContain('#include <stdlib.h>');
    expect(ref).toContain('int putchar(int c);');
  });
});
