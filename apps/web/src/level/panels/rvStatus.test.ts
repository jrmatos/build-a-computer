import { describe, expect, it } from 'vitest';
import type { RvState } from '@build-a-computer/worker';
import { rvStatus } from './rvStatus';

const base: RvState = { pc: 0x80000010, regs: new Array(32).fill(0), mode: 'M', instret: 4, running: false, csrs: {} };

describe('rvStatus', () => {
  it('says where a breakpoint stopped', () => {
    expect(rvStatus({ ...base, reason: 'breakpoint', line: 12 }, []).text).toBe('Stopped at breakpoint, line 12');
  });
  it('reports the exit code', () => {
    expect(rvStatus({ ...base, reason: 'exit', exitCode: 0 }, [])).toMatchObject({ text: 'Exited with code 0', tone: 'ok' });
  });
  it('names the trap cause and keeps the long message for the tooltip', () => {
    const s = rvStatus({ ...base, reason: 'trap', line: 7, trap: { cause: 2, tval: 0, message: 'Illegal instruction 0x0 at line 7: …' } }, []);
    expect(s.text).toBe('Trap: illegal instruction at line 7');
    expect(s.detail).toContain('0x0');
    expect(s.tone).toBe('error');
  });
  it('names library files and falls back to pc', () => {
    expect(rvStatus({ ...base, reason: 'step', line: 5, file: 'print.s' }, []).text).toBe('Paused at line 5 of print.s');
    expect(rvStatus({ ...base, reason: 'paused' }, []).text).toBe('Paused at pc 0x80000010');
  });
  it('asks to fix errors before the first run', () => {
    const d = { line: 1, column: 1, endLine: 1, endColumn: 2, message: 'x', severity: 'error' as const, file: 'main.s' };
    expect(rvStatus(undefined, [d]).text).toBe('Fix the errors to run (1)');
    expect(rvStatus({ ...base, running: true }, []).text).toBe('Running…');
  });
});
