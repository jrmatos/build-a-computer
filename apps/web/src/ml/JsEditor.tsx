/**
 * One CodeMirror view for one file of a Track 2 level. The player's main.js is
 * editable and synced with store.source; level library files and the API
 * reference are read-only. Errors from the last run (store.js.error) show as
 * a diagnostic on their line in main.js. Shares the code workspace's theme.
 */
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, lintKeymap, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, type Extension, type Text } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import { useEditor, type EditorState as StoreState } from '../editor/store';
import { t } from '../i18n';
import { runLevelTests } from '../level/runTests';
import { codeTheme } from '../code/extensions';

/** The player's file on Track 2 levels. */
export const JS_MAIN = 'main.js';

/** Colors from the code tokens (code/code.css), so one style serves both themes. */
const jsHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.modifier], color: 'var(--code-mnemonic)' },
  { tag: [tags.function(tags.definition(tags.variableName)), tags.definition(tags.className)], color: 'var(--code-label)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--code-symbol)' },
  { tag: [tags.typeName, tags.className, tags.self, tags.special(tags.variableName)], color: 'var(--code-register)' },
  { tag: tags.propertyName, color: 'var(--code-csr)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--code-number)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--code-string)' },
  { tag: tags.escape, color: 'var(--code-reloc)' },
  { tag: [tags.lineComment, tags.blockComment, tags.comment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [tags.operator, tags.punctuation, tags.paren, tags.brace, tags.squareBracket, tags.separator, tags.derefOperator], color: 'var(--code-punct)' },
]);

// ---------------------------------------------------------------- open views

const views = new Map<string, EditorView>();
const revealListeners = new Set<(file: string) => void>();

/** Show `line` (1-based) of `file`: switch to its tab, scroll it to the middle and put the cursor there. */
export function revealJsLine(line: number, file: string = JS_MAIN, focus = true): boolean {
  revealListeners.forEach((fn) => fn(file));
  const view = views.get(file);
  if (!view) return false;
  const n = Math.max(1, Math.min(line, view.state.doc.lines));
  const l = view.state.doc.line(n);
  view.dispatch({ selection: EditorSelection.range(l.from, l.to), effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
  if (focus) view.focus();
  return true;
}

/** Called with the file name whenever revealJsLine targets a file. */
export function onJsReveal(fn: (file: string) => void): () => void {
  revealListeners.add(fn);
  return () => revealListeners.delete(fn);
}

/** Focus main.js. */
export function focusJsEditor(): void {
  views.get(JS_MAIN)?.focus();
}

/** The run's error as a CodeMirror diagnostic on its line of main.js, or none. */
export function errorDiagnostics(err: { message: string; line?: number; column?: number } | undefined, doc: Text): Diagnostic[] {
  if (!err?.line || err.line < 1 || err.line > doc.lines) return [];
  const l = doc.line(err.line);
  const col = err.column && err.column > 0 ? Math.min(l.from + err.column - 1, l.to) : l.from;
  // Underline from the column (or the first non-space) to the end of the line.
  const start = err.column ? col : l.from + (/^\s*/.exec(l.text)?.[0].length ?? 0);
  return [{ from: Math.min(start, l.to), to: l.to, severity: 'error', message: err.message }];
}

// ---------------------------------------------------------------- the view

interface JsEditorProps {
  file: string;
  /** Text for read-only files; main.js reads store.source. */
  text?: string;
  readOnly?: boolean;
  /** Plain text (the API reference), no JavaScript highlighting. */
  plain?: boolean;
  hidden?: boolean;
  onCursor?: (line: number, col: number) => void;
  /** Ctrl+Shift+Enter: run the selected entry. */
  onRun?: () => void;
}

export function JsEditor({ file, text, readOnly = false, plain = false, hidden = false, onCursor, onRun }: JsEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cursorCb = useRef(onCursor);
  const runCb = useRef(onRun);
  useEffect(() => {
    cursorCb.current = onCursor;
    runCb.current = onRun;
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const isMain = !readOnly;
    const store = useEditor.getState();
    const editable = new Compartment();
    let synced = isMain ? store.source : (text ?? '');

    const keys = keymap.of([
      {
        key: 'Mod-Enter',
        preventDefault: true,
        run: () => {
          void runLevelTests();
          return true;
        },
      },
      {
        key: 'Mod-Shift-Enter',
        preventDefault: true,
        run: () => {
          runCb.current?.();
          return true;
        },
      },
    ]);

    const extensions: Extension[] = [
      highlightSpecialChars(),
      drawSelection(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      bracketMatching(),
      highlightSelectionMatches(),
      search({ top: false }),
      lineNumbers(),
      lintGutter(),
      ...(plain ? [EditorView.lineWrapping] : [javascript(), syntaxHighlighting(jsHighlight)]),
      EditorState.tabSize.of(2),
      indentUnit.of('  '),
      codeTheme,
      EditorView.contentAttributes.of({ 'aria-label': `${t('ml.editorLabel')}: ${file}`, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
      keys,
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged) {
          const head = u.state.selection.main.head;
          const l = u.state.doc.lineAt(head);
          cursorCb.current?.(l.number, head - l.from + 1);
        }
        if (!isMain || !u.docChanged) return;
        const source = u.state.doc.toString();
        if (source !== useEditor.getState().source) {
          synced = source;
          useEditor.getState().set({ source });
        }
      }),
    ];
    if (isMain) {
      extensions.push(
        history(),
        closeBrackets(),
        autocompletion({ icons: false }),
        editable.of(EditorState.readOnly.of(store.readOnly)),
        keymap.of([{ key: 'Mod-/', run: toggleComment }, ...closeBracketsKeymap, ...completionKeymap, indentWithTab, ...searchKeymap, ...historyKeymap, ...lintKeymap, ...defaultKeymap]),
      );
    } else {
      extensions.push(EditorState.readOnly.of(true), keymap.of([...searchKeymap, ...defaultKeymap]));
    }

    const view = new EditorView({ parent: el, state: EditorState.create({ doc: synced, extensions }) });
    viewRef.current = view;
    views.set(file, view);

    const apply = (s: StoreState, prev: StoreState | null) => {
      if (!isMain) return;
      if (s.source !== synced && s.source !== view.state.doc.toString()) {
        synced = s.source;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s.source } });
      }
      if (!prev || s.readOnly !== prev.readOnly) view.dispatch({ effects: editable.reconfigure(EditorState.readOnly.of(s.readOnly)) });
      if (!prev || s.js?.error !== prev.js?.error) view.dispatch(setDiagnostics(view.state, errorDiagnostics(s.js?.error, view.state.doc)));
    };
    apply(useEditor.getState(), null);
    const off = useEditor.subscribe((s, prev) => {
      if (s.source !== prev.source || s.readOnly !== prev.readOnly || s.js?.error !== prev.js?.error) apply(s, prev);
    });
    return () => {
      off();
      if (views.get(file) === view) views.delete(file);
      view.destroy();
      viewRef.current = null;
    };
    // One view per file; read-only texts change only with a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, readOnly, plain]);

  // Read-only texts that arrive later (the API reference loads lazily).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !readOnly || text === undefined || text === view.state.doc.toString()) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, [text, readOnly]);

  useEffect(() => {
    if (!hidden) viewRef.current?.requestMeasure();
  }, [hidden]);

  return <div ref={host} className="code-ws__cm" hidden={hidden} data-file={file} />;
}
