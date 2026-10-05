/**
 * CodeMirror extensions for the code workspace: breakpoint gutter, the
 * program-counter line, and a theme drawn from the app's design tokens.
 */
import { RangeSet, RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutter, gutterLineClass, lineNumbers, type DecorationSet } from '@codemirror/view';

// ---------------------------------------------------------------- breakpoints

/** Replace all breakpoints with these 1-based lines. */
export const setBreakpointsEffect = StateEffect.define<readonly number[]>();

class BreakpointMarker extends GutterMarker {
  override toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-bp-dot';
    return el;
  }
}
const bpMarker = new BreakpointMarker();

function buildBreakpoints(state: EditorState, lines: readonly number[]): RangeSet<GutterMarker> {
  const b = new RangeSetBuilder<GutterMarker>();
  const valid = [...new Set(lines)].filter((n) => n >= 1 && n <= state.doc.lines).sort((a, c) => a - c);
  for (const n of valid) b.add(state.doc.line(n).from, state.doc.line(n).from, bpMarker);
  return b.finish();
}

/** Breakpoints as gutter markers; they move with their line as text is edited. */
export const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) if (e.is(setBreakpointsEffect)) next = buildBreakpoints(tr.state, e.value);
    return next;
  },
});

/** Sorted, de-duplicated 1-based lines that hold a breakpoint. */
export function breakpointLines(state: EditorState): number[] {
  const out = new Set<number>();
  const field = state.field(breakpointField, false);
  if (!field) return [];
  for (let it = field.iter(); it.value; it.next()) out.add(state.doc.lineAt(it.from).number);
  return [...out].sort((a, b) => a - b);
}

/** Lines with `line` toggled. */
export function toggleLine(lines: readonly number[], line: number): number[] {
  return lines.includes(line) ? lines.filter((l) => l !== line) : [...lines, line].sort((a, b) => a - b);
}

/**
 * Breakpoint gutter plus line numbers; clicking either on a line calls
 * `onToggle` with its 1-based number.
 */
export function breakpointGutter(onToggle: (line: number) => void): Extension {
  const handlers = {
    mousedown(view: EditorView, block: { from: number }, event: Event) {
      if ((event as MouseEvent).button !== 0) return false;
      onToggle(view.state.doc.lineAt(block.from).number);
      return true;
    },
  };
  return [
    breakpointField,
    gutter({
      class: 'cm-bp-gutter',
      markers: (v) => v.state.field(breakpointField),
      initialSpacer: () => bpMarker,
      domEventHandlers: handlers,
    }),
    // Line numbers toggle too: a bigger target, as in most IDEs.
    lineNumbers({ domEventHandlers: handlers }),
  ];
}

// ---------------------------------------------------------------- program counter line

/** Mark this 1-based line as where execution stopped, or clear with null. */
export const setPcLineEffect = StateEffect.define<number | null>();

const pcLineDeco = Decoration.line({ class: 'cm-pc-line' });
class PcGutterClass extends GutterMarker {
  override elementClass = 'cm-pc-gutter';
}
const pcGutterClass = new PcGutterClass();

export const pcLineField = StateField.define<{ line: number | null; deco: DecorationSet; gutter: RangeSet<GutterMarker> }>({
  create: () => ({ line: null, deco: Decoration.none, gutter: RangeSet.empty }),
  update(v, tr) {
    let next = tr.docChanged ? { ...v, deco: v.deco.map(tr.changes), gutter: v.gutter.map(tr.changes) } : v;
    for (const e of tr.effects) {
      if (!e.is(setPcLineEffect)) continue;
      const n = e.value;
      if (n === null || n < 1 || n > tr.state.doc.lines) next = { line: null, deco: Decoration.none, gutter: RangeSet.empty };
      else {
        const from = tr.state.doc.line(n).from;
        next = { line: n, deco: Decoration.set([pcLineDeco.range(from)]), gutter: RangeSet.of([pcGutterClass.range(from)]) };
      }
    }
    return next;
  },
  provide: (f) => [EditorView.decorations.from(f, (v) => v.deco), gutterLineClass.from(f, (v) => v.gutter)],
});

// ---------------------------------------------------------------- theme

/** One theme for both modes: every color is a CSS variable (styles/tokens.css, code/code.css). */
export const codeTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'transparent',
    fontSize: '14px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
    overflow: 'auto',
    scrollbarWidth: 'thin',
    scrollbarColor: 'var(--island-border) transparent',
  },
  '.cm-content': { padding: '12px 0 40vh', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 24px 0 12px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--code-selection) !important',
  },
  '.cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--code-match)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--code-match)', outline: 'none' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-faint)',
    border: 'none',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 4px', minWidth: '32px', cursor: 'pointer' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-pc-line': { backgroundColor: 'var(--code-pc-bg)', boxShadow: 'inset 3px 0 0 var(--accent)' },
  '.cm-pc-gutter': { color: 'var(--accent) !important', fontWeight: '700' },
  '.cm-bp-gutter': { width: '18px' },
  '.cm-bp-gutter .cm-gutterElement': { display: 'grid', placeItems: 'center', cursor: 'pointer', paddingLeft: '6px' },
  '.cm-bp-gutter .cm-gutterElement:hover:not(:has(.cm-bp-dot))::after': {
    content: '""',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: 'var(--danger)',
    opacity: '0.3',
  },
  '.cm-bp-dot': {
    display: 'block',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: 'var(--danger)',
  },
  '.cm-gutter-lint': { width: '14px' },
  '.cm-gutter-lint .cm-gutterElement': { padding: '0 0 0 2px' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--danger)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--warning)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--island)',
    color: 'var(--text)',
    border: '1px solid var(--island-border)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--island-shadow)',
    fontFamily: 'var(--font-ui)',
    overflow: 'hidden',
  },
  '.cm-tooltip-lint': { padding: '0' },
  '.cm-diagnostic': { padding: '6px 10px', fontSize: '13px', borderLeftWidth: '3px' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--warning)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', maxHeight: '16em' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '2px 10px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--active)', color: 'var(--text)' },
  '.cm-completionDetail': { color: 'var(--text-faint)', fontStyle: 'normal', marginLeft: '12px' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--accent)', fontWeight: '600' },
  '.cm-panels': { backgroundColor: 'var(--island)', color: 'var(--text)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--island-border)' },
  '.cm-panel.cm-search': { fontFamily: 'var(--font-ui)', padding: '6px 10px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { font: 'inherit', fontSize: '13px' },
  '.cm-textfield': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    border: '1px solid var(--island-border)',
    borderRadius: 'var(--radius-sm)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--island)',
    color: 'var(--text)',
    border: '1px solid var(--island-border)',
    borderRadius: 'var(--radius-sm)',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--code-match)', outline: '1px solid var(--accent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--code-selection)' },
});
