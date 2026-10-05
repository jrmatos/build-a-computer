import { describe, expect, it } from 'vitest';
import type { CaseResult } from '@build-a-computer/sim-logic';
import { caseSummaryLine, checkLine, memoryBytes, showReg, splitUart, visible } from './testDiff';

describe('testDiff', () => {
  it('splits UART text at the first difference', () => {
    expect(splitUart('hello', 'hello')).toEqual({ same: 'hello', want: '', got: '', state: 'match' });
    expect(splitUart('hello', 'he')).toEqual({ same: 'he', want: 'llo', got: '', state: 'partial' });
    expect(splitUart('hi', 'hi!')).toEqual({ same: 'hi', want: '', got: '!', state: 'extra' });
    expect(splitUart('hello', 'help')).toEqual({ same: 'hel', want: 'lo', got: 'p', state: 'wrong' });
  });

  it('marks wrong memory bytes', () => {
    expect(memoryBytes({ kind: 'memory', addr: 0, expected: '01 02', actual: '01 09', firstBad: 1, ok: false })).toEqual([
      { want: '01', got: '01', bad: false },
      { want: '02', got: '09', bad: true },
    ]);
  });

  it('formats registers and control characters', () => {
    expect(showReg(55)).toBe('55');
    expect(showReg(0xffffffff)).toBe('4294967295 (-1)');
    expect(showReg(55, true)).toBe('0x00000037');
    expect(visible('a\tb\x01')).toBe('a→b\\x01');
  });

  it('writes one line per check', () => {
    expect(checkLine({ kind: 'reg', name: 'a0', expected: 55, actual: 45, ok: false })).toBe('a0: expected 55, got 45');
    expect(checkLine({ kind: 'exit', expected: 0, actual: null, ok: false })).toBe('exit code: expected 0, but the program did not exit');
    expect(checkLine({ kind: 'uart', expected: 'x'.repeat(10) + 'A', actual: 'x'.repeat(10) + 'B', firstDiff: 1010, offset: 1000, ok: false })).toBe(
      'UART output differs at character 1010: expected "xxxxxxxxA", got "xxxxxxxxB"',
    );
  });

  it('summarizes a failing case for the strip tooltip', () => {
    const base: CaseResult = { index: 0, pass: false, inputs: {}, expected: {}, actual: {}, message: 'a0 should be 55 but is 45.' };
    const rv = { ...base, checks: [{ kind: 'reg', name: 'a0', expected: 55, actual: 45, ok: false }, { kind: 'reg', name: 'a1', expected: 1, actual: 2, ok: false }] } as CaseResult;
    expect(caseSummaryLine(rv)).toBe('a0: expected 55, got 45 (+1 more)');
    const jsCase = { ...base, detail: { mismatches: [{ path: 'result[2]', message: 'result[2]: expected 3 ± 1e-6, got 2' }] } } as CaseResult;
    expect(caseSummaryLine(jsCase)).toBe('result[2]: expected 3 ± 1e-6, got 2');
    expect(caseSummaryLine(base)).toBe('a0 should be 55 but is 45.');
    expect(caseSummaryLine({ ...base, pass: true })).toBeUndefined();
  });
});
