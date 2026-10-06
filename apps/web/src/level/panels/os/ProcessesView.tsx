import { useMemo } from 'react';
import { useEditor } from '../../../editor/store';
import { t } from '../../../i18n';
import { useRvDebug } from '../../../sim/client';
import { ABI_NAMES, hex32, sortSymbols, symbolize } from '../rv';
import type { KernelSnapshot } from './gather';
import type { KernelModel, ProcView } from './kernel';

export interface ViewProps {
  model: KernelModel;
  snap: KernelSnapshot | undefined;
  /** The process the player picked, by slot (null: none). */
  selected: number | null;
  onSelect: (slot: number | null) => void;
}

const stateClass = (p: ProcView): string => `os-state is-${(p.stateName ?? 'unknown').toLowerCase()}`;

/** Process table: one row per used slot, the current process marked; a row opens its trap frame. */
export function ProcessesView({ model, snap, selected, onSelect }: ViewProps) {
  const state = useEditor((s) => s.rv?.state);
  const symbols = useRvDebug((s) => s.symbols);
  const sorted = useMemo(() => sortSymbols(symbols), [symbols]);
  if (!snap) return <p className="dk-empty">{t('os.reading')}</p>;
  const used = snap.procs.filter((p) => p.state !== 0);
  if (!used.length) return <p className="dk-empty">{t('os.procs.none', { n: model.nproc })}</p>;
  const shown = selected ?? (snap.current >= 0 && snap.procs[snap.current]?.state ? snap.current : null);
  const detail = shown !== null ? snap.procs[shown] : undefined;
  // The running process's registers are in the CPU while it runs in user mode; its trap frame holds its last trap.
  const live = (p: ProcView) => p.slot === snap.current && p.stateName === 'RUNNING' && state?.mode === 'U';

  return (
    <div className="os-split">
      <div className="os-scroll">
        <table className="os-table" aria-label={t('os.procs.label')}>
          <thead>
            <tr>
              <th scope="col">{t('os.procs.pid')}</th>
              <th scope="col">{t('os.procs.name')}</th>
              <th scope="col">{t('os.procs.state')}</th>
              <th scope="col" title={t('os.procs.pcHelp')}>
                {t('os.procs.pc')}
              </th>
              <th scope="col">sp</th>
              {model.vm && (
                <th scope="col" title={t('os.procs.ptHelp')}>
                  {t('os.procs.pt')}
                </th>
              )}
              {model.timer && (
                <th scope="col" title={t('os.procs.wakeHelp')}>
                  {t('os.procs.wake')}
                </th>
              )}
              {model.vm && <th scope="col">{t('os.procs.parent')}</th>}
            </tr>
          </thead>
          <tbody>
            {used.map((p) => {
              const pc = live(p) ? state!.pc : p.epc;
              const sp = live(p) ? (state!.regs[2] ?? 0) : (p.regs[2] ?? 0);
              const isCurrent = p.slot === snap.current;
              return (
                <tr
                  key={p.slot}
                  className={`os-row ${isCurrent ? 'is-current' : ''} ${shown === p.slot ? 'is-selected' : ''}`}
                  aria-selected={shown === p.slot}
                  tabIndex={0}
                  onClick={() => onSelect(p.slot)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(p.slot);
                    }
                  }}
                >
                  <td>
                    <span className="os-cur" aria-hidden="true">
                      {isCurrent ? '▶' : ''}
                    </span>
                    {p.pid}
                    {isCurrent && <span className="visually-hidden">{t('os.procs.current')}</span>}
                  </td>
                  <td className="os-name">{p.name || '—'}</td>
                  <td>
                    <span className={stateClass(p)}>{p.stateName ? t(`os.state.${p.stateName}`) : p.state}</span>
                    {p.stateName === 'ZOMBIE' && <span className="dk-readout"> {t('os.procs.exit', { n: p.exitcode })}</span>}
                  </td>
                  <td>
                    <code>0x{hex32(pc)}</code>
                    {pc >= model.ramBase && <span className="dk-rv-sym"> {symbolize(pc, sorted) ?? ''}</span>}
                  </td>
                  <td>
                    <code>0x{hex32(sp)}</code>
                  </td>
                  {model.vm && <td>{p.pagetable ? <code>0x{hex32(p.pagetable)}</code> : '—'}</td>}
                  {model.timer && <td>{p.stateName === 'SLEEPING' ? <code>{p.wake}</code> : '—'}</td>}
                  {model.vm && <td>{p.parent || '—'}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {detail && <TrapFrame model={model} p={detail} live={live(detail)} sorted={sorted} />}
    </div>
  );
}

function TrapFrame({ model, p, live, sorted }: { model: KernelModel; p: ProcView; live: boolean; sorted: ReturnType<typeof sortSymbols> }) {
  return (
    <section className="os-detail" aria-label={t('os.tf.label', { pid: p.pid })}>
      <h3 className="dk-cpu-label">{t('os.tf.title', { pid: p.pid, name: p.name || '?' })}</h3>
      <p className="os-note">{live ? t('os.tf.live') : t('os.tf.saved')}</p>
      <dl className="os-kv">
        <div>
          <dt>{t('os.tf.addr')}</dt>
          <dd>
            <code>0x{hex32(p.addr)}</code>
          </dd>
        </div>
        <div>
          <dt>epc</dt>
          <dd>
            <code>0x{hex32(p.epc)}</code> <span className="dk-rv-sym">{p.epc >= model.ramBase ? (symbolize(p.epc, sorted) ?? '') : ''}</span>
          </dd>
        </div>
        <div>
          <dt>kstack</dt>
          <dd>
            <code>0x{hex32(p.kstack)}</code>
          </dd>
        </div>
        {p.heapEnd !== undefined && (
          <div>
            <dt>{t('os.tf.heap')}</dt>
            <dd>
              <code>0x{hex32(p.heapEnd)}</code>
            </dd>
          </div>
        )}
      </dl>
      <ul className="os-regs" aria-label={t('os.tf.regs')}>
        {p.regs.map((v, i) =>
          i === 0 ? null : (
            <li key={i}>
              <span className="dk-rv-abi">{ABI_NAMES[i]}</span>
              <code>0x{hex32(v)}</code>
            </li>
          ),
        )}
      </ul>
      {p.files && (
        <p className="os-note">
          {t('os.tf.files')}{' '}
          {p.files.some((f) => f.inum)
            ? p.files.map((f, i) => (f.inum ? t('os.tf.file', { fd: i + (model.header.defines.get('FD_FIRST') ?? 3), inum: f.inum, off: f.off }) : null)).filter(Boolean).join(', ')
            : t('os.tf.noFiles')}
        </p>
      )}
    </section>
  );
}
