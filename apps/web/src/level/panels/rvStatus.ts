import type { RvState, SourceDiagnostic } from '@build-a-computer/worker';
import { t } from '../../i18n';
import { causeKey } from './rv';

export type RvTone = 'info' | 'ok' | 'warn' | 'error';

/** One line about where the machine is: running, stopped at a breakpoint, exited, trapped. */
export function rvStatus(state: RvState | undefined, diagnostics: readonly SourceDiagnostic[]): { text: string; tone: RvTone; detail?: string } {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  if (!state) return errors ? { text: t('panels.rv.ctl.status.errors', { n: errors }), tone: 'error' } : { text: t('panels.rv.ctl.status.ready'), tone: 'info' };
  if (state.running) return { text: t('panels.rv.ctl.status.running'), tone: 'ok' };
  const inLib = state.file !== undefined && state.file !== 'main.s';
  const at = state.line !== undefined ? (inLib ? t('panels.rv.ctl.status.atFileLine', { line: state.line, file: state.file ?? '' }) : t('panels.rv.ctl.status.atLine', { line: state.line })) : t('panels.rv.ctl.status.atPc', { pc: `0x${(state.pc >>> 0).toString(16).padStart(8, '0')}` });
  switch (state.reason) {
    case 'breakpoint':
      return { text: t('panels.rv.ctl.status.breakpoint', { at }), tone: 'warn' };
    case 'ebreak':
      return { text: t('panels.rv.ctl.status.ebreak', { at }), tone: 'warn' };
    case 'step':
    case 'paused':
      return { text: t('panels.rv.ctl.status.paused', { at }), tone: 'info' };
    case 'exit':
      return { text: t('panels.rv.ctl.status.exit', { code: state.exitCode ?? 0 }), tone: (state.exitCode ?? 0) === 0 ? 'ok' : 'warn' };
    case 'trap':
    {
      // Short cause in the status line; the worker's full explanation goes in the tooltip.
      const key = state.trap ? causeKey(state.trap.cause) : null;
      const cause = key ? t(`panels.rv.cause.${key}`) : t('panels.rv.ctl.status.trapUnknown');
      // "Illegal instruction" reads as "Trap: illegal instruction"; acronyms keep their case.
      const what = /^[A-Z][a-z]/.test(cause) ? cause[0]!.toLowerCase() + cause.slice(1) : cause;
      return { text: t('panels.rv.ctl.status.trap', { message: what, at }), tone: 'error', detail: state.trap?.message };
    }
    case 'wfi':
      return { text: t('panels.rv.ctl.status.wfi', { at }), tone: 'info' };
    case 'budget':
      return { text: t('panels.rv.ctl.status.budget'), tone: 'warn' };
    case 'error':
      return { text: t('panels.rv.ctl.status.error'), tone: 'error' };
    default:
      return errors ? { text: t('panels.rv.ctl.status.errors', { n: errors }), tone: 'error' } : { text: t('panels.rv.ctl.status.ready'), tone: 'info' };
  }
}

