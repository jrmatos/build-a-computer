/**
 * Tokenizer for RISC-V assembly. Also the API the editor's CodeMirror mode uses
 * (ASM-03): every token carries its kind and its source range, and the kinds are
 * already classified by position (mnemonic, register, label, ...).
 */

import { CSR_NAMES, registerNumber } from './encoding';

/** Token kinds, classified by context so an editor can color them directly. */
export type TokenKind =
  | 'mnemonic' // instruction name at the head of a statement
  | 'directive' // .word, .text, ... at the head of a statement
  | 'label' // a label definition (the name before ':') or a symbol being assigned with '='
  | 'localLabel' // numeric local label definition: `1:`
  | 'localRef' // numeric local label reference: `1f`, `2b`
  | 'register' // x0..x31 or an ABI name in operand position
  | 'csr' // a CSR name in operand position
  | 'symbol' // any other identifier in operand position
  | 'number'
  | 'char' // 'a'
  | 'string' // "text"
  | 'reloc' // %hi, %lo, %pcrel_hi, %pcrel_lo
  | 'operator' // + - * / % << >> & | ^ ~ ! == != < > <= >=
  | 'comma'
  | 'lparen'
  | 'rparen'
  | 'colon'
  | 'equals'
  | 'comment'
  | 'newline' // a statement separator: newline or ';'
  | 'error'; // something the lexer could not read; `message` says why

/** One token. Offsets are UTF-16 offsets into the source; line and column are 1-based. */
export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly col: number;
  /** Numeric value for number, char and localRef (label number) tokens. */
  readonly value?: bigint;
  /** Decoded bytes for string tokens. */
  readonly bytes?: readonly number[];
  /** Direction for localRef tokens. */
  readonly dir?: 'f' | 'b';
  /** Explanation for error tokens. */
  readonly message?: string;
}

const isIdentStart = (c: string): boolean => /[A-Za-z_.$]/.test(c);
const isIdentChar = (c: string): boolean => /[A-Za-z0-9_.$]/.test(c);
const isDigit = (c: string): boolean => c >= '0' && c <= '9';

const ESCAPES: Record<string, number> = {
  n: 10,
  t: 9,
  r: 13,
  '0': 0,
  '\\': 92,
  '"': 34,
  "'": 39,
  a: 7,
  b: 8,
  f: 12,
  v: 11,
  e: 27,
};

const OPERATORS = [
  '<<',
  '>>',
  '==',
  '!=',
  '<=',
  '>=',
  '<>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '&',
  '|',
  '^',
  '~',
  '!',
  '<',
  '>',
];

const CSR_MNEMONICS = /^(csr|rd(cycle|time|instret))/;

/**
 * Splits source into classified tokens. Never throws: unreadable input becomes
 * `error` tokens. Comments (`#`, `//`, `/* *\/`) are kept as `comment` tokens.
 */
export function tokenize(source: string): Token[] {
  const raw = scan(source);
  classify(raw);
  return raw;
}

interface MutToken {
  kind: TokenKind;
  text: string;
  from: number;
  to: number;
  line: number;
  col: number;
  value?: bigint;
  bytes?: number[];
  dir?: 'f' | 'b';
  message?: string;
}

function scan(src: string): MutToken[] {
  const out: MutToken[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const push = (kind: TokenKind, from: number, to: number, extra: Partial<MutToken> = {}): void => {
    out.push({
      kind,
      text: src.slice(from, to),
      from,
      to,
      line,
      col: from - lineStart + 1,
      ...extra,
    });
  };

  // Reads one (possibly escaped) character at position p inside a quoted literal.
  const readChar = (p: number): { byte: number; next: number; error?: string } => {
    const c = src[p] ?? '';
    if (c !== '\\') {
      const code = src.codePointAt(p) ?? 0;
      if (code > 0xff)
        return {
          byte: 0,
          next: p + (code > 0xffff ? 2 : 1),
          error: 'only ASCII and Latin-1 characters fit in a byte',
        };
      return { byte: code, next: p + 1 };
    }
    const e = src[p + 1] ?? '';
    if (e === 'x' || e === 'X') {
      let q = p + 2;
      let v = 0;
      // Like GNU as, \x takes every following hex digit and keeps the low byte.
      while (q < src.length && /[0-9a-fA-F]/.test(src[q] ?? '')) {
        v = ((v << 4) | parseInt(src[q] ?? '0', 16)) & 0xff;
        q++;
      }
      if (q === p + 2) return { byte: 0, next: q, error: '\\x needs hex digits' };
      return { byte: v & 0xff, next: q };
    }
    if (/[0-7]/.test(e)) {
      let q = p + 1;
      let v = 0;
      while (q < p + 4 && /[0-7]/.test(src[q] ?? '')) {
        v = v * 8 + Number(src[q]);
        q++;
      }
      return { byte: v & 0xff, next: q };
    }
    const mapped = ESCAPES[e];
    if (mapped === undefined) return { byte: 0, next: p + 2, error: `unknown escape \\${e}` };
    return { byte: mapped, next: p + 2 };
  };

  while (i < src.length) {
    const c = src[i] ?? '';
    if (c === '\n') {
      push('newline', i, i + 1);
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      i++;
      continue;
    }
    if (c === ';') {
      push('newline', i, i + 1);
      i++;
      continue;
    }
    if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      push('comment', i, j);
      i = j;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const startLine = line;
      const startCol = i - lineStart + 1;
      let j = i + 2;
      while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) {
        if (src[j] === '\n') {
          line++;
          lineStart = j + 1;
        }
        j++;
      }
      const closed = j < src.length;
      const end = closed ? j + 2 : j;
      out.push({
        kind: closed ? 'comment' : 'error',
        text: src.slice(i, end),
        from: i,
        to: end,
        line: startLine,
        col: startCol,
        ...(closed ? {} : { message: 'unterminated /* comment' }),
      });
      i = end;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      const bytes: number[] = [];
      let error: string | undefined;
      while (j < src.length && src[j] !== '"' && src[j] !== '\n') {
        const r = readChar(j);
        if (r.error && !error) error = r.error;
        bytes.push(r.byte);
        j = r.next;
      }
      if (src[j] !== '"') {
        push('error', i, j, { message: 'unterminated string: add a closing "' });
        i = j;
        continue;
      }
      j++;
      if (error) push('error', i, j, { message: error });
      else push('string', i, j, { bytes });
      i = j;
      continue;
    }
    if (c === "'") {
      if (i + 1 >= src.length || src[i + 1] === '\n') {
        push('error', i, i + 1, { message: 'empty character literal' });
        i++;
        continue;
      }
      const r = readChar(i + 1);
      let j = r.next;
      if (src[j] === "'") j++; // GNU also accepts 'a without the closing quote
      if (r.error) push('error', i, j, { message: r.error });
      else push('char', i, j, { value: BigInt(r.byte) });
      i = j;
      continue;
    }
    if (isDigit(c)) {
      let j = i;
      while (j < src.length && /[0-9A-Za-z_]/.test(src[j] ?? '')) j++;
      const text = src.slice(i, j);
      const local = /^([0-9]+)([fb])$/.exec(text);
      if (local && !/^0[bB][01]+$/.test(text)) {
        push('localRef', i, j, { value: BigInt(local[1] ?? '0'), dir: local[2] as 'f' | 'b' });
      } else {
        const v = parseNumber(text);
        if (v === null) push('error', i, j, { message: `'${text}' is not a number` });
        else push('number', i, j, { value: v });
      }
      i = j;
      continue;
    }
    if (c === '%' && /[a-z_]/.test(src[i + 1] ?? '')) {
      let j = i + 1;
      while (j < src.length && /[a-z_]/.test(src[j] ?? '')) j++;
      push('reloc', i, j);
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdentChar(src[j] ?? '')) j++;
      push('symbol', i, j);
      i = j;
      continue;
    }
    if (c === ',') {
      push('comma', i, i + 1);
      i++;
      continue;
    }
    if (c === '(') {
      push('lparen', i, i + 1);
      i++;
      continue;
    }
    if (c === ')') {
      push('rparen', i, i + 1);
      i++;
      continue;
    }
    if (c === ':') {
      push('colon', i, i + 1);
      i++;
      continue;
    }
    if (c === '=' && src[i + 1] !== '=') {
      push('equals', i, i + 1);
      i++;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      push('operator', i, i + op.length);
      i += op.length;
      continue;
    }
    push('error', i, i + 1, { message: `unexpected character '${c}'` });
    i++;
  }
  return out;
}

/** Parses a GNU-style integer literal: decimal, 0x hex, 0b binary, leading-0 octal. */
export function parseNumber(text: string): bigint | null {
  const t = text.replace(/_/g, '');
  if (/^0[xX][0-9a-fA-F]+$/.test(t)) return BigInt(t);
  if (/^0[bB][01]+$/.test(t)) return BigInt(t);
  if (/^0[0-7]+$/.test(t)) return BigInt('0o' + t.slice(1));
  if (/^[0-9]+$/.test(t)) return BigInt(t);
  return null;
}

/** Second pass: decides mnemonic/directive/label/register/... from position. */
function classify(tokens: MutToken[]): void {
  let start = 0;
  while (start < tokens.length) {
    let end = start;
    while (end < tokens.length && tokens[end]?.kind !== 'newline') end++;
    const stmt = tokens.slice(start, end).filter((t) => t.kind !== 'comment');
    let k = 0;
    // leading label definitions
    for (;;) {
      const a = stmt[k];
      const b = stmt[k + 1];
      if (a && b && b.kind === 'colon' && a.kind === 'symbol') {
        a.kind = 'label';
        k += 2;
      } else if (a && b && b.kind === 'colon' && a.kind === 'number' && /^[0-9]+$/.test(a.text)) {
        a.kind = 'localLabel';
        k += 2;
      } else break;
    }
    const head = stmt[k];
    let mnemonic = '';
    if (head && head.kind === 'symbol') {
      if (stmt[k + 1]?.kind === 'equals') head.kind = 'label';
      else if (head.text.startsWith('.') && head.text !== '.') head.kind = 'directive';
      else {
        head.kind = 'mnemonic';
        mnemonic = head.text.toLowerCase();
      }
      k++;
    }
    const csrContext = CSR_MNEMONICS.test(mnemonic);
    for (; k < stmt.length; k++) {
      const t = stmt[k];
      if (!t || t.kind !== 'symbol') continue;
      if (registerNumber(t.text) !== undefined) t.kind = 'register';
      else if (csrContext && CSR_NAMES.has(t.text)) t.kind = 'csr';
    }
    start = end + 1;
  }
}
