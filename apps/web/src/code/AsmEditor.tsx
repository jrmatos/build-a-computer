/**
 * One CodeMirror view for one file of a code level. The player's main.s is
 * editable and synced with store.source and store.breakpoints; level library
 * files are read-only. Both show store.codeDiagnostics for their file and the
 * line the RISC-V machine stopped on (store.rv.state.line).
 */
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { lintGutter, lintKeymap, setDiagnostics } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
} from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { useEditor, type EditorState as StoreState } from '../editor/store';
import { t } from '../i18n';
import { runLevelTests } from '../level/runTests';
import { asmCompletions, asmLanguage } from './asmLanguage';
import { MAIN_FILE, toCmDiagnostics } from './diagnostics';
import { breakpointGutter, breakpointLines, codeTheme, pcLineField, setBreakpointsEffect, setPcLineEffect, toggleLine } from './extensions';

// ---------------------------------------------------------------- open views (for the debugger)

const views = new Map<string, EditorView>();
const revealListeners = new Set<(file: string) => void>();

/**
 * Scroll `line` (1-based) of `file` into view, switch to its tab and put the
 * cursor there. Returns false when that file is not open. For the debugger
 * (call stack, symbols, "go to pc").
 */
export function revealLine(line: number, file: string = MAIN_FILE, focus = false): boolean {
  revealListeners.forEach((fn) => fn(file));
  const view = views.get(file);
  if (!view) return false;
  const n = Math.max(1, Math.min(line, view.state.doc.lines));
  const pos = view.state.doc.line(n).from;
  view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  if (focus) view.focus();
  return true;
}

/** Put keyboard focus in the player's editor. */
export function focusCodeEditor(): void {
  views.get(MAIN_FILE)?.focus();
}

/** The player's editor view, when a code level is open (tests and the debugger). */
export function mainCodeView(): EditorView | null {
  return views.get(MAIN_FILE) ?? null;
}

/** Called with the file name whenever revealLine targets a file (the workspace switches tabs). */
export function onReveal(fn: (file: string) => void): () => void {
  revealListeners.add(fn);
  return () => revealListeners.delete(fn);
}

// ---------------------------------------------------------------- helpers

/** The line to mark as stopped-at in `file`, or null (running, no machine, other file). */
export function pcLineFor(s: Pick<StoreState, 'rv'>, file: string): number | null {
  const st = s.rv?.state;
  if (!st || st.running || !st.line) return null;
  return (st.file ?? MAIN_FILE) === file ? st.line : null;
}

const sameLines = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function baseExtensions(): Extension[] {
  return [
    highlightSpecialChars(),
    drawSelection(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    bracketMatching(),
    highlightSelectionMatches(),
    search({ top: false }),
    lintGutter(),
    pcLineField,
    asmLanguage(),
    indentUnit.of('    '),
    EditorState.tabSize.of(8),
    codeTheme,
    EditorView.contentAttributes.of({ 'aria-label': t('code.editorLabel'), spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
  ];
}

const runTestsKey = keymap.of([
  {
    key: 'Mod-Enter',
    preventDefault: true,
    run: () => {
      void runLevelTests();
      return true;
    },
  },
]);

interface AsmEditorProps {
  file: string;
  /** Text for read-only library files; main.s reads store.source. */
  text?: string;
  readOnly?: boolean;
  hidden?: boolean;
  /** Library texts, so their labels complete in main.s. */
  libraryTexts?: readonly string[];
  onCursor?: (line: number, col: number) => void;
}

export function AsmEditor({ file, text, readOnly = false, hidden = false, libraryTexts = [], onCursor }: AsmEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const libs = useRef(libraryTexts);
  const cursorCb = useRef(onCursor);
  useEffect(() => {
    libs.current = libraryTexts;
    cursorCb.current = onCursor;
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const isMain = !readOnly;
    const store = useEditor.getState();
    const editable = new Compartment();
    // The source this view last pushed to (or read from) the store.
    let synced = isMain ? store.source : (text ?? '');

    const toggle = (line: number) => {
      const st = useEditor.getState();
      st.set({ breakpoints: toggleLine(st.breakpoints, line) });
    };

    const extensions: Extension[] = [
      ...baseExtensions(),
      runTestsKey,
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged) {
          const head = u.state.selection.main.head;
          const l = u.state.doc.lineAt(head);
          cursorCb.current?.(l.number, head - l.from + 1);
        }
        if (!isMain || !u.docChanged) return;
        const st = useEditor.getState();
        const source = u.state.doc.toString();
        const patch: Partial<StoreState> = {};
        if (source !== st.source) {
          synced = source;
          patch.source = source;
        }
        // Breakpoints follow their lines as text moves.
        const lines = breakpointLines(u.state);
        if (!sameLines(lines, st.breakpoints)) patch.breakpoints = lines;
        if (Object.keys(patch).length) st.set(patch);
      }),
    ];
    if (isMain) {
      extensions.push(
        history(),
        closeBrackets(),
        autocompletion({ override: [asmCompletions(() => libs.current)], icons: false }),
        breakpointGutter(toggle),
        editable.of(EditorState.readOnly.of(store.readOnly)),
        keymap.of([...closeBracketsKeymap, ...completionKeymap, indentWithTab, ...searchKeymap, ...historyKeymap, ...lintKeymap, ...defaultKeymap]),
      );
    } else {
      extensions.push(
        EditorState.readOnly.of(true),
        breakpointGutter(() => undefined),
        keymap.of([...searchKeymap, ...lintKeymap, ...defaultKeymap]),
      );
    }

    const view = new EditorView({ parent: el, state: EditorState.create({ doc: synced, extensions }) });
    viewRef.current = view;
    views.set(file, view);

    const applyStore = (s: StoreState, prev: StoreState | null) => {
      const effects = [];
      const specs: Parameters<EditorView['dispatch']>[0] = {};
      // Text changed outside the editor (reset to starter, import, another tab): replace it, undoably.
      if (isMain && s.source !== synced && s.source !== view.state.doc.toString()) {
        synced = s.source;
        specs.changes = { from: 0, to: view.state.doc.length, insert: s.source };
      }
      // Rebuilt after a full replace too, or every breakpoint would collapse onto line 1.
      if (isMain && (specs.changes || !sameLines(s.breakpoints, breakpointLines(view.state)))) effects.push(setBreakpointsEffect.of(s.breakpoints));
      const pc = pcLineFor(s, file);
      const prevPc = view.state.field(pcLineField).line;
      if (pc !== prevPc) effects.push(setPcLineEffect.of(pc));
      if (isMain && (!prev || s.readOnly !== prev.readOnly)) effects.push(editable.reconfigure(EditorState.readOnly.of(s.readOnly)));
      if (specs.changes || effects.length) view.dispatch({ ...specs, effects });
      if (!prev || s.codeDiagnostics !== prev.codeDiagnostics || specs.changes) {
        view.dispatch(setDiagnostics(view.state, toCmDiagnostics(s.codeDiagnostics, view.state.doc, file)));
      }
      // Execution stopped on a new line: bring it into view.
      if (pc !== null && pc !== prevPc && pc <= view.state.doc.lines) {
        view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(pc).from, { y: 'nearest', yMargin: 80 }) });
      }
    };
    applyStore(useEditor.getState(), null);
    const off = useEditor.subscribe((s, prev) => {
      if (s.source !== prev.source || s.breakpoints !== prev.breakpoints || s.rv !== prev.rv || s.codeDiagnostics !== prev.codeDiagnostics || s.readOnly !== prev.readOnly)
        applyStore(s, prev);
    });
    return () => {
      off();
      if (views.get(file) === view) views.delete(file);
      view.destroy();
      viewRef.current = null;
    };
    // The view is created once per file; text for library files never changes while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, readOnly]);

  // A view hidden with display:none needs a fresh measure when shown again.
  useEffect(() => {
    if (!hidden) viewRef.current?.requestMeasure();
  }, [hidden]);

  return <div ref={host} className="code-ws__cm" hidden={hidden} data-file={file} />;
}
