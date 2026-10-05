import { assembleLine, disassemble } from '@build-a-computer/content';
import { t } from '../../i18n';

/** How the machine-code editor reads each line (TOY-02). */
export type CodeMode = 'hex' | 'asm';

export interface CodeLine {
  /** 0-based line number in the source. */
  line: number;
  /** Address of the line's first byte. */
  addr: number;
  bytes: number[];
  error?: string;
}

export interface ParsedProgram {
  lines: CodeLine[];
  bytes: number[];
  errors: number;
}

const stripComment = (s: string): string => s.replace(/(;|\/\/|#).*$/, '').trim();

/** Max value of one ROM entry. */
const maxOf = (width: number): number => (width >= 32 ? 0xffffffff : 2 ** width - 1);

/**
 * Parse the editor text. Hex mode: whitespace-separated hex entries (a `0x`
 * prefix is allowed). Assembly mode: one Toy-8 instruction per line via
 * `assembleLine`; a line of plain hex bytes is also accepted there, for data.
 */
export function parseProgram(text: string, mode: CodeMode, width = 8, capacity = 256): ParsedProgram {
  const lines: CodeLine[] = [];
  const bytes: number[] = [];
  let errors = 0;
  const max = maxOf(width);
  const rows = text.split('\n');
  const labels = mode === 'asm' ? collectLabels(rows) : {};
  rows.forEach((raw, line) => {
    let src = stripComment(raw);
    if (mode === 'asm') src = src.replace(LABEL_DEFS, '').trim();
    const addr = bytes.length;
    if (!src) {
      lines.push({ line, addr, bytes: [] });
      return;
    }
    let out: number[] = [];
    let error: string | undefined;
    const tokens = src.split(/[\s,]+/).filter(Boolean);
    const allHex = tokens.every((tok) => /^(0x)?[0-9a-f]+$/i.test(tok));
    if (mode === 'hex' || isHexData(src)) {
      if (!allHex) error = messages.badHex(tokens.find((tok) => !/^(0x)?[0-9a-f]+$/i.test(tok)) ?? src);
      else {
        out = tokens.map((tok) => parseInt(tok.replace(/^0x/i, ''), 16));
        const big = out.find((v) => v > max);
        if (big !== undefined) error = messages.tooBig(big.toString(16).toUpperCase(), width);
      }
    } else {
      try {
        out = assembleLine(src, labels);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    if (!error && addr + out.length > capacity) error = messages.full(capacity);
    if (error) {
      errors++;
      lines.push({ line, addr, bytes: [], error });
      return;
    }
    bytes.push(...out);
    lines.push({ line, addr, bytes: out });
  });
  return { lines, bytes, errors };
}

const LABEL_DEFS = /^(\s*[A-Za-z_]\w*\s*:)+/;

/** First pass: label -> byte address, sizing each line by assembling it with every label read as 0. */
function collectLabels(rows: string[]): Record<string, number> {
  const labels: Record<string, number> = {};
  const anyLabel = new Proxy({} as Record<string, number>, { get: () => 0 });
  let addr = 0;
  for (const raw of rows) {
    const src = stripComment(raw);
    const defs = LABEL_DEFS.exec(src);
    if (defs) for (const m of defs[0].matchAll(/([A-Za-z_]\w*)\s*:/g)) labels[m[1]!] ??= addr;
    const rest = src.replace(LABEL_DEFS, '').trim();
    if (!rest) continue;
    if (isHexData(rest)) {
      addr += rest.split(/[\s,]+/).filter(Boolean).length;
      continue;
    }
    try {
      addr += assembleLine(rest, anyLabel).length;
    } catch {
      /* reported in the second pass */
    }
  }
  return labels;
}

const isHexData = (src: string): boolean => {
  const tokens = src.split(/[\s,]+/).filter(Boolean);
  return tokens.every((tok) => /^(0x)?[0-9a-f]{2}$/i.test(tok)) && !looksLikeMnemonic(src);
};

/** Two-letter hex pairs like "AD" or "DE" are bytes, unless a line clearly reads as words ("ADD R1"). */
function looksLikeMnemonic(src: string): boolean {
  return /[g-z]/i.test(src);
}

const messages = {
  badHex: (tok: string) => t('panels.code.badHex', { tok }),
  tooBig: (value: string, width: number) => t('panels.code.tooBig', { value, width }),
  full: (n: number) => t('panels.code.full', { n }),
};

/** ROM `props.data` -> entries. Unparseable tokens read as 0. */
export function dataToBytes(data: string | undefined): number[] {
  if (!data?.trim()) return [];
  return data
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const v = parseInt(tok.replace(/^0x/i, ''), 16);
      return Number.isFinite(v) ? v : 0;
    });
}

export const hex = (v: number, digits = 2): string => (v >>> 0).toString(16).toUpperCase().padStart(digits, '0');

/** Entries -> ROM `props.data`, trailing zeros trimmed. */
export function bytesToData(bytes: number[], width = 8): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  const digits = Math.ceil(width / 4);
  return bytes
    .slice(0, end)
    .map((b) => hex(b, digits))
    .join(' ');
}

/** Mnemonic preview for the instruction at `addr`; '' when it fails to decode. */
export function mnemonicAt(bytes: number[], addr: number): string {
  if (addr >= bytes.length) return '';
  try {
    return disassemble(bytes.slice(addr, addr + 4)).text;
  } catch {
    return '';
  }
}

/** Starting text for the editor: one instruction per line in hex. */
export function programText(bytes: number[], width = 8): string {
  const digits = Math.ceil(width / 4);
  const out: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    let size = 1;
    if (width === 8) {
      try {
        size = Math.max(1, Math.min(4, disassemble(bytes.slice(i, i + 4)).size || 1));
      } catch {
        size = 1;
      }
    }
    out.push(
      bytes
        .slice(i, i + size)
        .map((b) => hex(b, digits))
        .join(' '),
    );
    i += size;
  }
  return out.join('\n');
}

/** The program as Toy-8 assembly, one instruction per line; null when it is not 8-bit. */
export function asmText(bytes: number[], width = 8): string | null {
  if (width !== 8) return null;
  const out: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    let size = 1;
    let text: string;
    try {
      const d = disassemble(bytes.slice(i, i + 4));
      size = Math.max(1, Math.min(4, d.size || 1));
      text = d.text;
    } catch {
      text = '';
    }
    const chunk = bytes.slice(i, i + size);
    // Undecodable or truncated: keep the raw bytes as a data line.
    out.push(text && !text.includes('?') && chunk.length === size ? text : chunk.map((b) => hex(b)).join(' '));
    i += size;
  }
  return out.join('\n');
}
