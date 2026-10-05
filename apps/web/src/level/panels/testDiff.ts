/**
 * Pure helpers for showing why a code ('riscv') or JS ('js') test case passes
 * or fails: one line per check, UART text split at the first difference,
 * memory bytes with the wrong ones marked. Used by the test strip's detail
 * row and by the code and JS test debuggers.
 */
import type { CaseResult } from '@build-a-computer/sim-logic';
import type { JsCaseDetail, RvCheck } from '@build-a-computer/worker';
import { t } from '../../i18n';

/** The structured details a case result may carry (rv-check `checks`, js-check `detail`). */
export function caseChecks(r: CaseResult | undefined): RvCheck[] | undefined {
  const c = (r as { checks?: unknown } | undefined)?.checks;
  return Array.isArray(c) ? (c as RvCheck[]) : undefined;
}
export function caseDetail(r: CaseResult | undefined): JsCaseDetail | undefined {
  const d = (r as { detail?: unknown } | undefined)?.detail;
  return d && typeof d === 'object' && Array.isArray((d as JsCaseDetail).mismatches) ? (d as JsCaseDetail) : undefined;
}

/** "55", "4294967295 (-1)", or with hex: "55 (0x00000037)". */
export function showReg(v: number, hex = false): string {
  const u = v >>> 0;
  const signed = u >= 0x80000000 ? ` (${u | 0})` : '';
  return hex ? `0x${u.toString(16).padStart(8, '0')}` : `${u}${signed}`;
}

export const hex32 = (v: number): string => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;

/** Printable text for a UART string: control characters as escapes. */
export function visible(s: string): string {
  let out = '';
  for (const c of s) {
    const code = c.charCodeAt(0);
    if (c === '\n') out += '↵\n';
    else if (c === '\t') out += '→';
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else out += c;
  }
  return out;
}

/** UART text split at the first difference. */
export interface UartSplit {
  /** The common prefix. */
  same: string;
  /** Expected text after it. */
  want: string;
  /** Actual text after it. */
  got: string;
  /** 'match', 'partial' (output so far is a prefix of the expected text), 'extra' (expected text is a prefix of the output), or 'wrong'. */
  state: 'match' | 'partial' | 'extra' | 'wrong';
}

export function splitUart(expected: string, actual: string): UartSplit {
  let i = 0;
  const n = Math.min(expected.length, actual.length);
  while (i < n && expected[i] === actual[i]) i++;
  const same = expected.slice(0, i);
  const want = expected.slice(i);
  const got = actual.slice(i);
  const state = !want && !got ? 'match' : !got ? 'partial' : !want ? 'extra' : 'wrong';
  return { same, want, got, state };
}

/** Memory bytes side by side, with the wrong ones marked. */
export function memoryBytes(c: Extract<RvCheck, { kind: 'memory' }>): { want: string; got: string | null; bad: boolean }[] {
  const want = c.expected.split(' ').filter(Boolean);
  const got = c.actual?.split(' ').filter(Boolean) ?? null;
  return want.map((w, i) => {
    const g = got ? (got[i] ?? null) : null;
    return { want: w, got: g, bad: g !== w };
  });
}

/** Short label of a check: "a0", "exit code", "memory 0x80001000", "UART output", "screen". */
export function checkLabel(c: RvCheck): string {
  switch (c.kind) {
    case 'reg':
      return c.name;
    case 'exit':
      return t('panels.test.exitCode');
    case 'memory':
      return t('panels.test.memoryAt', { addr: hex32(c.addr) });
    case 'uart':
      return t('panels.test.uart');
    case 'framebuffer':
      return t('panels.test.screen');
  }
}

/** One line per failing check: "a0: expected 55, got 45". */
export function checkLine(c: RvCheck): string {
  const label = checkLabel(c);
  switch (c.kind) {
    case 'reg':
      return t('panels.test.line', { label, want: showReg(c.expected), got: showReg(c.actual) });
    case 'exit':
      return c.actual === null ? t('panels.test.noExit', { label, want: c.expected }) : t('panels.test.line', { label, want: showReg(c.expected), got: showReg(c.actual) });
    case 'memory': {
      if (c.actual === null) return t('panels.test.notMemory', { label });
      const bytes = memoryBytes(c);
      const from = Math.max(0, c.firstBad & ~3);
      const span = (k: 'want' | 'got') =>
        bytes
          .slice(from, from + 8)
          .map((b) => b[k] ?? '??')
          .join(' ') + (from + 8 < bytes.length ? ' …' : '');
      return t('panels.test.line', { label: t('panels.test.memoryAt', { addr: hex32(c.addr + from) }), want: span('want'), got: span('got') });
    }
    case 'uart': {
      // firstDiff is in the whole output; the strings may be cut `offset` characters in.
      const at = c.firstDiff;
      const local = Math.max(0, c.firstDiff - (c.offset ?? 0));
      const cut = (s: string) => JSON.stringify(s.slice(Math.max(0, local - 8), local + 24));
      return t('panels.test.uartLine', { at, want: cut(c.expected), got: cut(c.actual) });
    }
    case 'framebuffer':
      return t('panels.test.screenWrong');
  }
}

/** First line of a failing case for a tooltip: "Case 2 — a0: expected 55, got 45". */
export function caseSummaryLine(r: CaseResult | undefined): string | undefined {
  if (!r || r.pass) return undefined;
  const checks = caseChecks(r)?.filter((c) => !c.ok);
  if (checks?.length) return checkLine(checks[0]!) + (checks.length > 1 ? ` ${t('panels.test.more', { n: checks.length - 1 })}` : '');
  const d = caseDetail(r);
  if (d?.mismatches.length) return d.mismatches[0]!.message + (d.mismatches.length > 1 ? ` ${t('panels.test.more', { n: d.mismatches.length - 1 })}` : '');
  return r.message?.split('\n')[0];
}
