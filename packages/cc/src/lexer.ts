/**
 * C tokenizer (CC-02). Produces preprocessing tokens with exact source ranges.
 * Line continuations (backslash-newline) are spliced; comments become spaces.
 */

import type { Diags, Loc } from './diag';

export type TokenKind = 'ident' | 'num' | 'str' | 'char' | 'punct' | 'eof';

export interface Token extends Loc {
  kind: TokenKind;
  text: string;
  /** First token on its (logical) line. */
  bol: boolean;
  /** Preceded by whitespace or a comment. */
  space: boolean;
  /** Macro names this token may not expand again (preprocessor). */
  hideset?: ReadonlySet<string>;
  /** The line of the main file this token came from (after macro expansion). */
  mainLine?: number;
}

const PUNCTS = [
  '<<=', '>>=', '...', '==', '!=', '<=', '>=', '->', '+=', '-=', '*=', '/=', '%=', '&=', '|=',
  '^=', '&&', '||', '++', '--', '<<', '>>', '##',
]; // prettier-ignore

const isIdStart = (c: string): boolean => /[A-Za-z_$]/.test(c);
const isIdChar = (c: string): boolean => /[A-Za-z0-9_$]/.test(c);
const isDigit = (c: string): boolean => c >= '0' && c <= '9';

/** Tokenize one file. Errors (unterminated literals, stray characters) go to `diags`. */
export function tokenize(src: string, file: string, diags: Diags): Token[] {
  // Splice backslash-newline while remembering original positions.
  const chars: string[] = [];
  const lines: number[] = [];
  const cols: number[] = [];
  {
    let line = 1;
    let col = 1;
    for (let i = 0; i < src.length; i++) {
      const c = src[i] ?? '';
      if (c === '\r' && src[i + 1] === '\n') continue;
      if (c === '\\') {
        let j = i + 1;
        while (src[j] === ' ' || src[j] === '\t') j++;
        if (src[j] === '\r') j++;
        if (src[j] === '\n') {
          i = j;
          line++;
          col = 1;
          continue;
        }
      }
      chars.push(c === '\r' ? '\n' : c);
      lines.push(line);
      cols.push(col);
      if (c === '\n' || c === '\r') {
        line++;
        col = 1;
      } else col++;
    }
    lines.push(line);
    cols.push(col);
  }
  const n = chars.length;
  const at = (i: number): string => chars[i] ?? '';
  const out: Token[] = [];
  let bol = true;
  let space = false;
  let i = 0;
  const locOf = (a: number, b: number): Loc => ({
    file,
    line: lines[a] ?? 1,
    col: cols[a] ?? 1,
    endLine: lines[b - 1] ?? lines[a] ?? 1,
    endCol: (cols[b - 1] ?? cols[a] ?? 1) + 1,
  });
  const push = (kind: TokenKind, a: number, b: number): void => {
    out.push({ kind, text: chars.slice(a, b).join(''), bol, space, ...locOf(a, b) });
    bol = false;
    space = false;
  };
  while (i < n) {
    const c = at(i);
    if (c === '\n') {
      i++;
      bol = true;
      space = false;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v') {
      i++;
      space = true;
      continue;
    }
    if (c === '/' && at(i + 1) === '/') {
      while (i < n && at(i) !== '\n') i++;
      space = true;
      continue;
    }
    if (c === '/' && at(i + 1) === '*') {
      const start = i;
      i += 2;
      while (i < n && !(at(i) === '*' && at(i + 1) === '/')) i++;
      if (i >= n) {
        diags.error(locOf(start, start + 2), 'unterminated /* comment: add */ to close it');
        break;
      }
      i += 2;
      space = true;
      continue;
    }
    const start = i;
    // number (pp-number)
    if (isDigit(c) || (c === '.' && isDigit(at(i + 1)))) {
      i++;
      for (;;) {
        const d = at(i);
        if ((d === '+' || d === '-') && /[eEpP]/.test(at(i - 1))) {
          i++;
        } else if (isIdChar(d) || d === '.') i++;
        else break;
      }
      push('num', start, i);
      continue;
    }
    // string / char literal, with optional L/u/U/u8 prefix
    {
      let p = i;
      if (at(p) === 'u' && at(p + 1) === '8') p += 2;
      else if (at(p) === 'L' || at(p) === 'u' || at(p) === 'U') p++;
      const q = at(p);
      if (q === '"' || q === "'") {
        p++;
        while (p < n && at(p) !== q && at(p) !== '\n') {
          if (at(p) === '\\') p++;
          p++;
        }
        if (at(p) !== q) {
          diags.error(
            locOf(start, Math.min(p, n)),
            q === '"' ? 'missing closing " on this string' : "missing closing ' on this character",
          );
          i = p;
          push(q === '"' ? 'str' : 'char', start, Math.min(p, n));
          const last = out[out.length - 1];
          if (last) last.text += q;
          continue;
        }
        i = p + 1;
        push(q === '"' ? 'str' : 'char', start, i);
        continue;
      }
    }
    if (isIdStart(c)) {
      i++;
      while (isIdChar(at(i))) i++;
      push('ident', start, i);
      continue;
    }
    let matched = false;
    for (const p of PUNCTS) {
      let ok = true;
      for (let k = 0; k < p.length; k++)
        if (at(i + k) !== p[k]) {
          ok = false;
          break;
        }
      if (ok) {
        i += p.length;
        push('punct', start, i);
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if ('+-*/%&|^~!=<>?:;,.()[]{}#'.includes(c)) {
      i++;
      push('punct', start, i);
      continue;
    }
    if (c === '@' || c === '`' || c === '\\') {
      i++;
      push('punct', start, i);
      continue;
    }
    diags.error(locOf(i, i + 1), `stray character '${c}' in the program`);
    i++;
  }
  const end = locOf(n, n);
  out.push({
    kind: 'eof',
    text: '',
    bol: true,
    space: false,
    file,
    line: lines[n] ?? 1,
    col: cols[n] ?? 1,
    endLine: end.endLine,
    endCol: (cols[n] ?? 1) + 1,
  });
  return out;
}

/** Decode the escapes in a char or string literal body. Returns byte values (UTF-8 for non-ASCII). */
export function decodeLiteral(
  body: string,
  onError: (msg: string) => void,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i] ?? '';
    if (c !== '\\') {
      const cp = body.codePointAt(i) ?? 0;
      if (cp < 0x80) out.push(cp);
      else {
        const s = String.fromCodePoint(cp);
        if (cp > 0xffff) i++;
        for (const b of new TextEncoder().encode(s)) out.push(b);
      }
      continue;
    }
    const e = body[++i] ?? '';
    switch (e) {
      case 'n': out.push(10); break;
      case 't': out.push(9); break;
      case 'r': out.push(13); break;
      case 'a': out.push(7); break;
      case 'b': out.push(8); break;
      case 'f': out.push(12); break;
      case 'v': out.push(11); break;
      case 'e': out.push(27); break;
      case '\\': out.push(92); break;
      case "'": out.push(39); break;
      case '"': out.push(34); break;
      case '?': out.push(63); break;
      case 'x': {
        let v = 0;
        let k = 0;
        while (/[0-9a-fA-F]/.test(body[i + 1] ?? '')) {
          v = v * 16 + parseInt(body[i + 1] ?? '0', 16);
          i++;
          k++;
        }
        if (k === 0) onError('\\x used with no hex digits after it');
        if (v > 0xff) onError('hex escape sequence out of range for a char');
        out.push(v & 0xff);
        break;
      }
      default:
        if (/[0-7]/.test(e)) {
          let v = Number(e);
          for (let k = 0; k < 2 && /[0-7]/.test(body[i + 1] ?? ''); k++) {
            v = v * 8 + Number(body[i + 1]);
            i++;
          }
          if (v > 0xff) onError('octal escape sequence out of range for a char');
          out.push(v & 0xff);
        } else {
          onError(`unknown escape sequence '\\${e}'`);
          out.push(e.charCodeAt(0) & 0xff);
        }
    }
  }
  return out;
}
