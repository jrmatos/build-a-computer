/**
 * Turns the player's ES modules (main.js and level library files) into plain
 * functions that run inside one classic sandbox script, without eval (the CSP
 * has no 'unsafe-eval') and without blob: module imports (script-src 'self').
 *
 * The transform only rewrites top-level `import` / `export` statements and
 * dynamic `import(...)`. Every rewrite keeps line breaks, and `export` keywords
 * become spaces, so line numbers (and columns, except on rewritten
 * `export default` lines) inside each module match the player's file. Imports
 * become a single header line evaluated before the body (imports are hoisted in
 * ES modules too).
 */

/** A source position problem found before running (unknown import, unbalanced braces…). */
export interface TransformError {
  message: string;
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

type TokType = 'ident' | 'punct' | 'string' | 'template' | 'regex' | 'number';

interface Tok {
  type: TokType;
  value: string;
  start: number;
  end: number;
  /** Bracket depth ((, [, {, and ${ of templates) before this token. */
  depth: number;
  /** True when a line break separates this token from the previous one. */
  nl: boolean;
}

const REGEX_AFTER_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);
const STATEMENT_KEYWORDS = new Set([
  'export', 'import', 'function', 'class', 'const', 'let', 'var', 'if', 'for', 'while', 'do', 'return', 'switch', 'try', 'throw',
]);

class ScanError extends Error {
  constructor(message: string, readonly pos: number) {
    super(message);
  }
}

const isIdStart = (c: string): boolean => /[A-Za-z_$#\u0080-\uffff]/.test(c);
const isIdPart = (c: string): boolean => /[\w$\u0080-\uffff]/.test(c);

/** A light JavaScript tokenizer: enough to find statements, strings, comments, templates and regexes. */
export function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  // Stack of open brackets; 'T' marks a template `${`.
  const stack: { ch: string; pos: number }[] = [];
  let i = 0;
  let nl = false;
  const n = src.length;
  const prevAllowsRegex = (): boolean => {
    const p = toks[toks.length - 1];
    if (!p) return true;
    if (p.type === 'ident') return REGEX_AFTER_KEYWORDS.has(p.value);
    if (p.type === 'punct') return !(p.value === ')' || p.value === ']' || p.value === '}');
    return false;
  };
  const push = (type: TokType, start: number, end: number, depth: number): void => {
    toks.push({ type, value: src.slice(start, end), start, end, depth, nl });
    nl = false;
  };
  /** Scans template characters from i (just after ` or a closing } of ${) to the end or the next ${. */
  const scanTemplate = (start: number, depth: number): void => {
    while (i < n) {
      const c = src[i]!;
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        i++;
        push('template', start, i, depth);
        return;
      }
      if (c === '$' && src[i + 1] === '{') {
        i += 2;
        push('template', start, i, depth);
        stack.push({ ch: 'T', pos: i - 2 });
        return;
      }
      i++;
    }
    throw new ScanError('Unterminated template literal', start);
  };
  while (i < n) {
    const c = src[i]!;
    if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') {
      nl = true;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\v' || c === '\f' || c === '\ufeff' || c === '\u00a0') {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n' && src[i] !== '\r') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new ScanError('Unterminated comment', i);
      if (/[\n\r]/.test(src.slice(i, end))) nl = true;
      i = end + 2;
      continue;
    }
    const depth = stack.length;
    if (c === '"' || c === "'") {
      const start = i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') i++;
        else if (src[i] === '\n') throw new ScanError('Unterminated string', start);
        i++;
      }
      if (i >= n) throw new ScanError('Unterminated string', start);
      i++;
      push('string', start, i, depth);
      continue;
    }
    if (c === '`') {
      const start = i++;
      scanTemplate(start, depth);
      continue;
    }
    if (c === '/' && prevAllowsRegex()) {
      const start = i++;
      let inClass = false;
      while (i < n) {
        const d = src[i]!;
        if (d === '\\') i++;
        else if (d === '\n') throw new ScanError('Unterminated regular expression', start);
        else if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        i++;
      }
      if (i >= n) throw new ScanError('Unterminated regular expression', start);
      i++;
      while (i < n && isIdPart(src[i]!)) i++;
      push('regex', start, i, depth);
      continue;
    }
    if (isIdStart(c)) {
      const start = i++;
      while (i < n && isIdPart(src[i]!)) i++;
      push('ident', start, i, depth);
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const start = i++;
      while (i < n) {
        const d = src[i]!;
        if ((d === '+' || d === '-') && /[eE]/.test(src[i - 1]!) && !/^0[xX]/.test(src.slice(start, i))) i++;
        else if (isIdPart(d) || d === '.') i++;
        else break;
      }
      push('number', start, i, depth);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      push('punct', i, i + 1, depth);
      stack.push({ ch: c, pos: i });
      i++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      const open = stack.pop();
      if (!open) throw new ScanError(`Unexpected '${c}'`, i);
      if (open.ch === 'T') {
        if (c !== '}') throw new ScanError(`Unexpected '${c}'`, i);
        const start = i++;
        scanTemplate(start, depth - 1);
        continue;
      }
      const want = open.ch === '(' ? ')' : open.ch === '[' ? ']' : '}';
      if (c !== want) throw new ScanError(`Unexpected '${c}' (expected '${want}')`, i);
      push('punct', i, i + 1, depth - 1);
      i++;
      continue;
    }
    push('punct', i, i + 1, depth);
    i++;
  }
  const open = stack.pop();
  if (open) throw new ScanError(open.ch === 'T' ? 'Unterminated template literal' : `Unclosed '${open.ch}'`, open.pos);
  return toks;
}

/** 1-based line and column of an offset. */
export function lineCol(src: string, pos: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let k = 0; k < pos && k < src.length; k++) {
    if (src[k] === '\n') {
      line++;
      lineStart = k + 1;
    }
  }
  return { line, column: pos - lineStart + 1 };
}

/** What a module imports, for the header line. */
interface ImportRec {
  spec: string;
  /** 1-based line of the statement. */
  line: number;
  column: number;
  /** local name -> imported name ('default', a name, or '*' for the namespace). */
  bindings: [local: string, imported: string][];
}

interface ReexportRec {
  spec: string;
  line: number;
  column: number;
  /** exported name -> imported name; null = `export *`. */
  names: [exported: string, imported: string][] | null;
}

export interface TransformedModule {
  /** Module body: same lines as the source. */
  body: string;
  /** One line of JavaScript run before the body (exports, imports). */
  header: string;
  /** Static module specifiers with their positions (for validation). */
  imports: { spec: string; line: number; column: number }[];
}

const SHADOWED_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'importScripts', 'Worker', 'SharedWorker',
  'postMessage', 'process', 'require', 'module',
];

/**
 * Rewrites one ES module. `file` names it in error messages. Throws a
 * TransformError (as a value with `message`, `line`, `column`) on problems.
 */
export function transformModule(src: string, file: string): TransformedModule {
  let toks: Tok[];
  try {
    toks = tokenize(src);
  } catch (e) {
    if (e instanceof ScanError) throw makeError(e.message, file, src, e.pos);
    throw e;
  }
  const out = src.split('');
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  const write = (at: number, text: string): void => {
    for (let k = 0; k < text.length; k++) out[at + k] = text[k]!;
  };
  const imports: ImportRec[] = [];
  const reexports: ReexportRec[] = [];
  const localExports: [exported: string, local: string][] = [];
  const err = (message: string, pos: number): TransformError => makeError(message, file, src, pos);
  const str = (t: Tok | undefined): string | null => (t && t.type === 'string' ? t.value.slice(1, -1).replace(/\\(.)/g, '$1') : null);
  const isName = (t: Tok | undefined, v?: string): boolean => !!t && t.type === 'ident' && (v === undefined || t.value === v);
  const isP = (t: Tok | undefined, v: string): boolean => !!t && t.type === 'punct' && t.value === v;
  /** Index after an optional ';'. */
  const endStmt = (k: number): number => (isP(toks[k], ';') ? k + 1 : k);
  const posOf = (t: Tok): { line: number; column: number } => lineCol(src, t.start);

  /** Parses `{ a, b as c, 'x' as d }` starting at the '{' index; returns specifiers and the index after '}'. */
  const parseSpecList = (k: number): { list: [string, string][]; next: number } => {
    const list: [string, string][] = [];
    k++;
    while (!isP(toks[k], '}')) {
      const a = toks[k];
      if (!a || (a.type !== 'ident' && a.type !== 'string')) throw err('Expected a name in { … }', a?.start ?? src.length);
      const first = a.type === 'string' ? str(a)! : a.value;
      let second = first;
      k++;
      if (isName(toks[k], 'as')) {
        const b = toks[k + 1];
        if (!b || (b.type !== 'ident' && b.type !== 'string')) throw err("Expected a name after 'as'", toks[k]!.end);
        second = b.type === 'string' ? str(b)! : b.value;
        k += 2;
      }
      list.push([first, second]);
      if (isP(toks[k], ',')) k++;
      else if (!isP(toks[k], '}')) throw err("Expected ',' or '}'", toks[k]?.start ?? src.length);
    }
    return { list, next: k + 1 };
  };

  /** Binding names of a destructuring pattern between toks[from] ('{' or '[') and its match; returns index after it. */
  const patternNames = (from: number, names: string[]): number => {
    const d = toks[from]!.depth;
    let k = from + 1;
    for (; k < toks.length && toks[k]!.depth > d; k++) {
      const t = toks[k]!;
      if (t.type !== 'ident') continue;
      const prev = toks[k - 1]!;
      const next = toks[k + 1];
      const prevOk = isP(prev, '{') || isP(prev, '[') || isP(prev, ',') || isP(prev, ':') || isP(prev, '.');
      const nextOk = isP(next, ',') || isP(next, '}') || isP(next, ']') || isP(next, '=');
      if (prevOk && nextOk && t.depth > d) {
        // `{ a = b }`: skip the default value's identifiers (prev '=' fails prevOk already).
        names.push(t.value);
      }
    }
    return k + 1;
  };

  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]!;
    if (t.type !== 'ident') continue;
    const prev = toks[k - 1];
    if (prev && isP(prev, '.') && !isP(toks[k - 2], '.')) continue; // member access: obj.import
    if (t.value === 'import') {
      const next = toks[k + 1];
      if (isP(next, '(')) {
        write(t.start, '__sbxI');
        continue;
      }
      if (isP(next, '.')) {
        write(t.start, '__sbxM');
        continue;
      }
      if (t.depth !== 0) continue;
      const { line, column } = posOf(t);
      let j = k + 1;
      const rec: ImportRec = { spec: '', line, column, bindings: [] };
      if (toks[j]?.type === 'string') {
        rec.spec = str(toks[j])!;
      } else {
        if (isName(toks[j]) && !isName(toks[j], 'from')) {
          rec.bindings.push([toks[j]!.value, 'default']);
          j++;
          if (isP(toks[j], ',')) j++;
        } else if (isName(toks[j], 'from') && isName(toks[j + 1], 'from')) {
          rec.bindings.push(['from', 'default']);
          j++;
        }
        if (isP(toks[j], '*')) {
          if (!isName(toks[j + 1], 'as') || !isName(toks[j + 2])) throw err("Expected '* as name'", toks[j]!.start);
          rec.bindings.push([toks[j + 2]!.value, '*']);
          j += 3;
        } else if (isP(toks[j], '{')) {
          const r = parseSpecList(j);
          for (const [imported, local] of r.list) rec.bindings.push([local, imported]);
          j = r.next;
        }
        if (!isName(toks[j], 'from') || toks[j + 1]?.type !== 'string') throw err("Expected 'from' and a module name in this import", t.start);
        j++;
        rec.spec = str(toks[j])!;
      }
      const end = endStmt(j + 1);
      blank(t.start, toks[end - 1]!.end);
      imports.push(rec);
      k = end - 1;
      continue;
    }
    if (t.value === 'export' && t.depth === 0) {
      const { line, column } = posOf(t);
      const a = toks[k + 1];
      if (isName(a, 'default')) {
        let j = k + 2;
        if (isName(toks[j], 'async') && isName(toks[j + 1], 'function')) j++;
        const isDecl = isName(toks[j], 'function') || isName(toks[j], 'class');
        if (isDecl) {
          let nameTok = toks[j + 1];
          if (isP(nameTok, '*')) nameTok = toks[j + 2];
          if (isName(nameTok) && !isName(nameTok, 'extends')) {
            blank(t.start, a!.end);
            localExports.push(['default', nameTok!.value]);
            continue;
          }
        }
        // `export default <expression>` -> `__ex.default =` (same length: 14 characters).
        if (a!.start === t.start + 7) write(t.start, '__ex.default =');
        else {
          blank(t.start, a!.end);
          write(t.start, '__ex.default=');
        }
        continue;
      }
      if (isName(a, 'function') || isName(a, 'class') || (isName(a, 'async') && isName(toks[k + 2], 'function'))) {
        let j = k + 1;
        if (isName(toks[j], 'async')) j++;
        j++;
        if (isP(toks[j], '*')) j++;
        if (!isName(toks[j])) throw err('An exported function or class needs a name', t.start);
        blank(t.start, t.end);
        localExports.push([toks[j]!.value, toks[j]!.value]);
        continue;
      }
      if (isName(a, 'const') || isName(a, 'let') || isName(a, 'var')) {
        blank(t.start, t.end);
        let j = k + 2;
        for (;;) {
          const names: string[] = [];
          const d = toks[j];
          if (isName(d)) {
            names.push(d!.value);
            j++;
          } else if (isP(d, '{') || isP(d, '[')) j = patternNames(j, names);
          else throw err('Expected a variable name after export', d?.start ?? src.length);
          for (const nm of names) localExports.push([nm, nm]);
          // Skip the initializer to the next declarator or the end of the statement.
          let more = false;
          while (j < toks.length) {
            const u = toks[j]!;
            if (u.depth === 0 && isP(u, ';')) break;
            if (u.depth === 0 && isP(u, ',')) {
              more = true;
              j++;
              break;
            }
            if (u.depth === 0 && u.nl && u.type === 'ident' && STATEMENT_KEYWORDS.has(u.value)) break;
            j++;
          }
          if (!more) break;
        }
        k = j - 1;
        continue;
      }
      if (isP(a, '{')) {
        const r = parseSpecList(k + 1);
        let j = r.next;
        if (isName(toks[j], 'from') && toks[j + 1]?.type === 'string') {
          reexports.push({ spec: str(toks[j + 1])!, line, column, names: r.list.map(([imp, exp]) => [exp, imp]) });
          j += 2;
        } else for (const [local, exp] of r.list) localExports.push([exp, local]);
        const end = endStmt(j);
        blank(t.start, toks[end - 1]!.end);
        k = end - 1;
        continue;
      }
      if (isP(a, '*')) {
        let j = k + 2;
        let asName: string | null = null;
        if (isName(toks[j], 'as')) {
          const b = toks[j + 1];
          asName = b?.type === 'string' ? str(b) : (b?.value ?? null);
          j += 2;
        }
        if (!isName(toks[j], 'from') || toks[j + 1]?.type !== 'string') throw err("Expected 'from' and a module name", t.start);
        reexports.push({ spec: str(toks[j + 1])!, line, column, names: asName ? [[asName, '*']] : null });
        const end = endStmt(j + 2);
        blank(t.start, toks[end - 1]!.end);
        k = end - 1;
        continue;
      }
      throw err('Unsupported export statement', t.start);
    }
  }

  const q = (s: string): string => JSON.stringify(s);
  const header: string[] = [];
  if (localExports.length) header.push(`__sbx.exp(__ex, {${localExports.map(([e, l]) => `${q(e)}: () => ${l}`).join(', ')}});`);
  imports.forEach((rec, idx) => {
    const ns = `__sbxNs${idx}`;
    header.push(`const ${ns} = await __sbx.imp(${q(rec.spec)}, ${q(file)}, ${rec.line});`);
    const named = rec.bindings.filter(([, imp]) => imp !== '*');
    for (const [local, imp] of rec.bindings) if (imp === '*') header.push(`const ${local} = ${ns};`);
    if (named.length) {
      header.push(
        `const {${named.map(([local, imp]) => `${q(imp)}: ${local}`).join(', ')}} = __sbx.pick(${ns}, ${q(rec.spec)}, ${q(JSON.stringify(named.map(([, i]) => i)))}, ${q(file)}, ${rec.line});`,
      );
    }
  });
  reexports.forEach((rec) => {
    header.push(`__sbx.reexp(__ex, await __sbx.imp(${q(rec.spec)}, ${q(file)}, ${rec.line}), ${rec.names ? q(JSON.stringify(rec.names)) : 'null'}, ${q(rec.spec)}, ${q(file)}, ${rec.line});`);
  });
  const allImports = [
    ...imports.map((r) => ({ spec: r.spec, line: r.line, column: r.column })),
    ...reexports.map((r) => ({ spec: r.spec, line: r.line, column: r.column })),
  ];
  return { body: out.join(''), header: header.join(' '), imports: allImports };
}

function makeError(message: string, file: string, src: string, pos: number): TransformError {
  const { line, column } = lineCol(src, pos);
  return { message, file, line, column };
}

/** True when a thrown value is a TransformError. */
export function isTransformError(e: unknown): e is TransformError {
  return !!e && typeof e === 'object' && 'file' in e && 'line' in e && 'message' in e && !(e instanceof Error);
}

/** Where each module's lines live inside the bundle script. */
export interface BundleMap {
  /** File name -> first bundle line (1-based) of the module body and its number of lines. */
  modules: { file: string; start: number; lines: number }[];
}

export interface Bundle {
  code: string;
  map: BundleMap;
}

/**
 * Locks the sandbox down before any player code runs: captures the message
 * channel, then hides every network and worker API. Serialized with
 * Function#toString into the bundle's first line, so it must not reference
 * anything outside itself.
 */
export function sandboxPrelude(g: Record<string, unknown>, blocked: string[]): unknown {
  const pre = g.__bacHost as { post: (m: unknown) => void; listen: (f: (m: unknown) => void) => void } | undefined;
  let host = pre;
  if (!host) {
    const post = (g.postMessage as (m: unknown) => void).bind(g);
    const add = (g.addEventListener as (t: string, f: (e: { data: unknown }) => void) => void).bind(g);
    host = { post, listen: (f) => add('message', (e) => f(e.data)) };
  }
  try {
    delete g.__bacHost;
  } catch {
    g.__bacHost = undefined;
  }
  for (const name of blocked) {
    try {
      Object.defineProperty(g, name, { value: undefined, writable: false, configurable: false, enumerable: false });
    } catch {
      try {
        g[name] = undefined;
      } catch {
        /* not writable: nothing to hide */
      }
    }
  }
  return host;
}

/** Globals hidden inside the sandbox (ASM-05: no network). */
export const BLOCKED_GLOBALS = [
  ...SHADOWED_GLOBALS,
  'WebSocketStream', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'BroadcastChannel', 'indexedDB', 'caches',
  'fetchLater', 'Deno', 'Bun',
];

export const BUNDLE_FACTORY_PARAMS = ['__sbx', '__ex', '__sbxI', '__sbxM', ...SHADOWED_GLOBALS];

/**
 * Builds the classic sandbox script: prelude (lockdown) first, then each
 * module as an async function whose body lines are the module's lines, then a
 * loader that hands everything to the runtime.
 */
export function buildBundle(modules: { file: string; mod: TransformedModule }[], runtimeUrl: string): Bundle {
  const lines: string[] = [];
  // The prelude is a serialized function and may span several lines.
  lines.push(...`"use strict"; var __bacH = (${sandboxPrelude.toString()})(globalThis, ${JSON.stringify(BLOCKED_GLOBALS)});`.split(/\r\n|\r|\n/));
  lines.push('var __bacFactory = function (__sbx) { var __m = {};');
  const map: BundleMap = { modules: [] };
  for (const { file, mod } of modules) {
    lines.push(`__m[${JSON.stringify(file)}] = async function (${BUNDLE_FACTORY_PARAMS.join(', ')}) { "use strict"; ${mod.header}`);
    const body = mod.body.split(/\r\n|\r|\n|\u2028|\u2029/);
    map.modules.push({ file, start: lines.length + 1, lines: body.length });
    lines.push(...body);
    lines.push('};');
  }
  lines.push('return __m; };');
  lines.push(
    `(__bacH.runtime ? Promise.resolve(__bacH.runtime) : import(${JSON.stringify(runtimeUrl)}).then(function () { return globalThis.__bacRuntime; })).then(function (rt) { rt.boot(__bacH, __bacFactory); }, function (e) { __bacH.post({ type: 'fatal', message: 'Could not load the sandbox runtime: ' + (e && e.message) }); });`,
  );
  return { code: lines.join('\n'), map };
}

/** Maps a bundle line to the player's file and line. */
export function mapBundleLine(map: BundleMap, line: number): { file: string; line: number } | undefined {
  for (const m of map.modules) if (line >= m.start && line < m.start + m.lines) return { file: m.file, line: line - m.start + 1 };
  return undefined;
}

/**
 * Finds the first stack frame inside the bundle (`bundleFile:line:col`) and
 * maps it to the player's file and line.
 */
export function mapStack(map: BundleMap, stack: string, bundleFile: string): { file: string; line: number; column: number } | undefined {
  const esc = bundleFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc}:(\\d+):(\\d+)`, 'g');
  for (const m of stack.matchAll(re)) {
    const hit = mapBundleLine(map, Number(m[1]));
    if (hit) return { ...hit, column: Number(m[2]) };
  }
  return undefined;
}
