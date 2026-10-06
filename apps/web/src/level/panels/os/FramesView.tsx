import { useState } from 'react';
import { t } from '../../../i18n';
import { hex32 } from '../rv';
import { frameCounts, type Frame, type FrameKind } from './kernel';
import type { ViewProps } from './ProcessesView';

const KINDS: FrameKind[] = ['kernel', 'loaded', 'table', 'user', 'used', 'free', 'kstack', 'unused'];
/** Frames per row of the strip (4 MiB of RAM = 1024 frames = 16 rows). */
const PER_ROW = 64;

/** Physical memory, one cell per 4 KiB frame: who has it (kernel, a process, the free list). */
export function FramesView({ model, snap, selected, onSelect }: ViewProps) {
  const [hover, setHover] = useState<Frame | null>(null);
  if (!snap) return <p className="dk-empty">{t('os.reading')}</p>;
  const frames = snap.frames ?? [];
  const counts = frameCounts(frames);
  const pick = selected !== null ? snap.procs[selected] : undefined;
  const nameOf = (pid: number) => snap.procs.find((p) => p.pid === pid && p.state)?.name ?? '?';
  const describe = (f: Frame): string => {
    const base = t(`os.frame.${f.kind}`);
    const who = f.pid !== undefined ? ` · ${t('os.frame.owner', { pid: f.pid, name: nameOf(f.pid) })}` : '';
    const shared = f.shared?.length ? ` · ${t('os.frame.shared', { pids: f.shared.join(', ') })}` : '';
    return `0x${hex32(f.pa)} ${base}${who}${shared}`;
  };
  const free = snap.free;
  const mismatch = free && snap.nfree !== undefined && free.pages.length !== snap.nfree;

  return (
    <div className="os-split">
      <div className="os-scroll">
        <div className="os-strip" role="img" aria-label={t('os.frames.label', { free: counts.free, used: frames.length - counts.free })} style={{ gridTemplateColumns: `repeat(${PER_ROW}, 1fr)` }}>
          {frames.map((f) => (
            <span
              key={f.pa}
              className={`os-cell is-${f.kind} ${pick && f.pid === pick.pid ? 'is-picked' : ''} ${pick && f.pid !== pick.pid && f.pid !== undefined ? 'is-dim' : ''} ${f.shared?.length ? 'is-shared' : ''}`}
              title={describe(f)}
              onMouseEnter={() => setHover(f)}
            />
          ))}
        </div>
        <div className="os-strip-axis dk-readout" aria-hidden="true">
          <span>0x{hex32(model.ramBase)}</span>
          <span>0x{hex32(model.ramEnd)}</span>
        </div>
        <p className="dk-readout os-hover" aria-live="off">
          {hover ? describe(hover) : t('os.frames.hint')}
        </p>
      </div>
      <div className="os-detail">
        <ul className="os-legend" aria-label={t('os.frames.legend')}>
          {KINDS.filter((k) => counts[k]).map((k) => (
            <li key={k}>
              <span className={`os-cell is-${k}`} aria-hidden="true" />
              <span>{t(`os.frame.${k}`)}</span>
              <span className="dk-readout">{t('os.frames.count', { n: counts[k], kib: counts[k] * 4 })}</span>
            </li>
          ))}
        </ul>
        {free ? (
          <p className={`os-note ${mismatch || free.broken !== undefined || free.loop ? 'is-error' : ''}`}>
            {t('os.frames.freeList', { n: free.pages.length })}
            {snap.nfree !== undefined && ` ${t('os.frames.nfree', { n: snap.nfree })}`}
            {free.broken !== undefined && ` ${t('os.frames.broken', { addr: hex32(free.broken) })}`}
            {free.loop && ` ${t('os.frames.loop')}`}
          </p>
        ) : (
          <p className="os-note">{t('os.frames.noFreeList')}</p>
        )}
        {snap.spaces.size > 0 && <h3 className="dk-cpu-label">{t('os.frames.byProc')}</h3>}
        <ul className="os-owners">
          {snap.procs
            .filter((p) => snap.spaces.has(p.slot))
            .map((p) => {
              const own = frames.filter((f) => f.pid === p.pid);
              return (
                <li key={p.slot}>
                  <button type="button" className={`dk-btn ${selected === p.slot ? 'is-active' : ''}`} aria-pressed={selected === p.slot} onClick={() => onSelect(selected === p.slot ? null : p.slot)}>
                    {t('os.vm.proc', { pid: p.pid, name: p.name || '?' })}
                  </button>
                  <span className="dk-readout">
                    {t('os.frames.owns', { tables: own.filter((f) => f.kind === 'table').length, pages: own.filter((f) => f.kind === 'user').length })}
                  </span>
                </li>
              );
            })}
        </ul>
      </div>
    </div>
  );
}
