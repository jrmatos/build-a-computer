import { useMemo, useState, type FormEvent } from 'react';
import type { RvTranslation } from '@build-a-computer/worker';
import { useEditor } from '../../../editor/store';
import { t } from '../../../i18n';
import { rv } from '../../../sim/client';
import { causeKey, hex32 } from '../rv';
import { rangeKind } from './kernel';
import type { ViewProps } from './ProcessesView';
import { PTE, flagString, isPageFault, mergeRanges, rangeAt, satpRoot, type Range } from './sv32';
import { useSpace } from './useKernel';

const FLAG_ORDER = ['D', 'A', 'G', 'U', 'X', 'W', 'R', 'V'] as const;

function Flags({ flags }: { flags: number }) {
  const s = flagString(flags);
  return (
    <span className="os-flags" aria-label={FLAG_ORDER.filter((_, i) => s[i] !== '-').join(' ')}>
      {FLAG_ORDER.map((f, i) => (
        <span key={f} className={s[i] === '-' ? 'is-off' : `is-on is-${f}`} title={t(`os.flag.${f}`)} aria-hidden="true">
          {s[i] === '-' ? '·' : f}
        </span>
      ))}
    </span>
  );
}

const end = (r: Range) => (r.va + r.size - 1) >>> 0;
const sizeText = (n: number): string => (n >= 1 << 20 ? `${n / (1 << 20)} MiB` : `${n / 1024} KiB`);

/** One address space: its mappings merged into ranges, the two-level tree, and an MMU probe. */
export function SpaceView({ model, snap, selected, onSelect }: ViewProps) {
  const state = useEditor((s) => s.rv?.state);
  const satp = state?.csrs['satp'] ?? 0;
  const owners = snap ? snap.procs.filter((p) => snap.spaces.has(p.slot)) : [];
  const slot = selected !== null && snap?.spaces.has(selected) ? selected : snap && snap.current >= 0 && snap.spaces.has(snap.current) ? snap.current : null;
  const proc = slot !== null ? snap?.procs[slot] : undefined;
  // Without a process to show, follow satp (the table the MMU uses now).
  const fallbackRoot = slot === null ? satpRoot(satp) : null;
  const satpWalk = useSpace(fallbackRoot);
  const walk = slot !== null ? snap?.spaces.get(slot) : satpWalk;
  const ranges = useMemo(() => (walk ? mergeRanges(walk.leaves) : []), [walk]);
  const root = walk?.root ?? fallbackRoot;
  const usesSatp = root !== null && satpRoot(satp) === root;

  // The last trap, when it was a page fault: mtval is the faulting address.
  const mcause = state?.csrs['mcause'] ?? 0;
  const fault = isPageFault(mcause) ? (state?.csrs['mtval'] ?? 0) >>> 0 : null;
  const faultRange = fault !== null ? rangeAt(ranges, fault) : undefined;

  if (!snap) return <p className="dk-empty">{t('os.reading')}</p>;
  return (
    <div className="os-split">
      <div className="os-scroll">
        <div className="os-line">
          {owners.length > 0 && (
            <label className="dk-check">
              {t('os.vm.space')}
              <select className="dk-input os-select" value={slot ?? ''} onChange={(e) => onSelect(e.target.value === '' ? null : Number(e.target.value))}>
                {slot === null && <option value="">satp</option>}
                {owners.map((p) => (
                  <option key={p.slot} value={p.slot}>
                    {t('os.vm.proc', { pid: p.pid, name: p.name || '?' })}
                    {p.slot === snap.current ? ` ${t('os.vm.currentMark')}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {root !== null ? (
            <span className="dk-readout">
              {t('os.vm.root', { root: hex32(root) })}
              {usesSatp && <span className="dk-tag os-satp">{t('os.vm.inSatp')}</span>}
            </span>
          ) : (
            <span className="dk-readout">{t('os.vm.bare')}</span>
          )}
        </div>
        {fault !== null && (
          <p className="os-fault" role="status">
            {t('os.vm.fault', { cause: t(`panels.rv.cause.${causeKey(mcause)}`), addr: hex32(fault) })}{' '}
            {faultRange ? (faultRange.flags & PTE.U ? t('os.vm.faultMapped') : t('os.vm.faultNoU')) : t('os.vm.faultUnmapped')}
          </p>
        )}
        {!walk ? (
          <p className="dk-empty">{root === null ? t('os.vm.noTable') : t('os.reading')}</p>
        ) : (
          <table className="os-table" aria-label={t('os.vm.ranges')}>
            <thead>
              <tr>
                <th scope="col">{t('os.vm.va')}</th>
                <th scope="col">{t('os.vm.pa')}</th>
                <th scope="col">{t('os.vm.size')}</th>
                <th scope="col">{t('os.vm.flags')}</th>
                <th scope="col">{t('os.vm.what')}</th>
              </tr>
            </thead>
            <tbody>
              {fault !== null && !faultRange && (
                <tr className="os-row is-fault">
                  <td>
                    <code>0x{hex32(fault)}</code>
                  </td>
                  <td colSpan={4}>{t('os.vm.notMapped')}</td>
                </tr>
              )}
              {ranges.map((r) => {
                const kind = rangeKind(model, r);
                return (
                  <tr key={r.va} className={`os-row ${r === faultRange ? 'is-fault' : ''} ${kind === 'guard' ? 'is-guard' : ''}`}>
                    <td>
                      <code>
                        0x{hex32(r.va)}–0x{hex32(end(r))}
                      </code>
                    </td>
                    <td>
                      <code>0x{hex32(r.pa)}</code>
                    </td>
                    <td className="dk-readout">
                      {r.level === 1 ? t('os.vm.superpages', { n: r.count }) : t('os.vm.pages', { n: r.count })} · {sizeText(r.size)}
                    </td>
                    <td>
                      <Flags flags={r.flags} />
                    </td>
                    <td>
                      <span
                        className={`os-kind is-${kind}`}
                        title={proc?.heapEnd !== undefined && kind === 'data' && proc.heapEnd > r.va && proc.heapEnd <= r.va + r.size ? t('os.vm.heapEnd', { addr: hex32(proc.heapEnd) }) : undefined}
                      >
                        {t(`os.kind.${kind}`)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="os-detail">
        <Translate key={fault ?? 'none'} satp={root !== null ? ((0x8000_0000 | (root >>> 12)) >>> 0) : satp} initial={fault} />
        {walk && (
          <section aria-label={t('os.vm.tree')}>
            <h3 className="dk-cpu-label">{t('os.vm.tree')}</h3>
            <ul className="os-tree">
              <li>
                <span className="dk-readout">{t('os.vm.rootTable', { pa: hex32(walk.root) })}</span>
                <ul>
                  {walk.branches.map((b) => (
                    <li key={b.vpn1}>
                      <details>
                        <summary className="dk-readout">
                          {t('os.vm.branch', { i: b.vpn1, va: hex32(b.vpn1 << 22), table: hex32(b.table), n: b.leaves })}
                        </summary>
                        <ul>
                          {walk.leaves
                            .filter((l) => l.level === 0 && l.va >>> 22 === b.vpn1)
                            .map((l) => (
                              <li key={l.va} className="dk-readout">
                                [{(l.va >>> 12) & 0x3ff}] 0x{hex32(l.va)} → 0x{hex32(l.pa)} <Flags flags={l.pte} />
                              </li>
                            ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                  {walk.leaves
                    .filter((l) => l.level === 1)
                    .map((l) => (
                      <li key={l.va} className="dk-readout">
                        {t('os.vm.superpage', { i: l.va >>> 22, va: hex32(l.va), pa: hex32(l.pa) })} <Flags flags={l.pte} />
                      </li>
                    ))}
                  {walk.bad.map((b) => (
                    <li key={b.pteAddr} className="dk-readout is-error">
                      {t('os.vm.bad', { addr: hex32(b.pteAddr), pte: hex32(b.pte) })}
                    </li>
                  ))}
                </ul>
              </li>
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/** Translate one virtual address through `satp` with the worker's MMU probe (no side effects). */
function Translate({ satp, initial }: { satp: number; initial: number | null }) {
  const [text, setText] = useState(initial !== null ? `0x${hex32(initial)}` : '0x00010000');
  const [access, setAccess] = useState<'load' | 'store' | 'fetch'>('load');
  const [result, setResult] = useState<RvTranslation | null>(null);
  const [error, setError] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = text.trim().replace(/_/g, '');
    const va = /^(0x)?[0-9a-f]{1,8}$/i.test(clean) ? parseInt(clean.replace(/^0x/i, ''), 16) : NaN;
    if (!Number.isFinite(va)) {
      setError(true);
      return;
    }
    setError(false);
    setResult((await rv.translate(va, satp, access)) ?? null);
  };
  return (
    <section aria-label={t('os.vm.translate')}>
      <h3 className="dk-cpu-label">{t('os.vm.translate')}</h3>
      <form className="os-line" onSubmit={(e) => void submit(e)}>
        <input
          className={`dk-input os-va ${error ? 'is-error' : ''}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={t('os.vm.vaInput')}
          aria-invalid={error}
          spellCheck={false}
        />
        <select className="dk-input os-select" value={access} onChange={(e) => setAccess(e.target.value as typeof access)} aria-label={t('os.vm.access')}>
          {(['load', 'store', 'fetch'] as const).map((a) => (
            <option key={a} value={a}>
              {t(`os.vm.access.${a}`)}
            </option>
          ))}
        </select>
        <button type="submit" className="dk-btn">
          {t('os.vm.go')}
        </button>
      </form>
      {result && (
        <div className="os-tr" role="status">
          {result.bare ? (
            <p className="dk-readout">{t('os.vm.trBare')}</p>
          ) : result.ok ? (
            <p className="dk-readout">{t('os.vm.trOk', { va: hex32(result.va), pa: hex32(result.pa ?? 0) })}</p>
          ) : (
            <p className="dk-readout is-error">
              {t('os.vm.trFault', { cause: t(`panels.rv.cause.${causeKey(result.cause ?? 0)}`) })} {t(`os.why.${result.why}`)}
            </p>
          )}
          <ol className="os-steps">
            {result.steps.map((s) => (
              <li key={s.pteAddr} className="dk-readout">
                {t('os.vm.step', { level: s.level, addr: hex32(s.pteAddr), pte: hex32(s.pte) })} <Flags flags={s.pte} />
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
