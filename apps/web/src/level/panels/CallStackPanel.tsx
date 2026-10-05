import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { rv, useRvDebug } from '../../sim/client';
import { hex32, sortSymbols, symbolize, walkStack, type Frame } from './rv';

/** Read the frame-pointer chain from the worker: a few words below each fp. */
async function readFrames(pc: number, regs: number[]): Promise<Frame[]> {
  const words = new Map<number, number>();
  // Collect the addresses the walk asks for, fetch them, and walk again until nothing new is needed.
  for (let round = 0; round < 32; round++) {
    const need: number[] = [];
    walkStack(pc, regs, (a) => {
      const v = words.get(a);
      if (v === undefined) need.push(a);
      return v ?? null;
    });
    if (!need.length) break;
    const lo = Math.min(...need);
    const hi = Math.max(...need) + 4;
    const data = await rv.memory(lo, hi - lo);
    if (!data) break;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (const a of need) if (a - lo + 4 <= data.byteLength) words.set(a, view.getUint32(a - lo, true));
    if (need.every((a) => !words.has(a))) break;
  }
  return walkStack(pc, regs, (a) => words.get(a) ?? null);
}

/** Call stack (ASM-04): pc, ra and the frame-pointer chain, named from the program's labels. */
export function CallStackPanel() {
  const state = useEditor((s) => s.rv?.state);
  const stop = useRvDebug((s) => s.stop);
  const symbols = useRvDebug((s) => s.symbols);
  const sorted = useMemo(() => sortSymbols(symbols), [symbols]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const running = !!state?.running;
  const loaded = !!state;

  useEffect(() => {
    const st = useEditor.getState().rv?.state;
    if (!st || st.running) return;
    let alive = true;
    void readFrames(st.pc, st.regs).then((f) => alive && setFrames(f));
    return () => {
      alive = false;
    };
  }, [stop, loaded]);

  if (!state) return <p className="dk-empty">{t('panels.rv.notLoaded')}</p>;
  if (running) return <p className="dk-empty">{t('panels.rv.stack.running')}</p>;
  return (
    <ol className="dk-stack" aria-label={t('panels.tab.stack')}>
      {frames.map((f, i) => (
        <li key={i} className={`dk-stack-frame ${i === 0 ? 'is-current' : ''}`}>
          <span className="dk-stack-n">#{i}</span>
          <span className="dk-stack-name">{symbolize(f.addr, sorted) ?? t('panels.rv.stack.unknown')}</span>
          <code className="dk-readout">0x{hex32(f.addr)}</code>
          {i === 0 && state.line !== undefined && <span className="dk-readout">{t('panels.rv.stack.line', { line: state.line })}</span>}
          <span className="dk-tag" title={t(`panels.rv.stack.via.${f.via}Help`)}>
            {t(`panels.rv.stack.via.${f.via}`)}
          </span>
        </li>
      ))}
    </ol>
  );
}
