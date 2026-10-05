import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Part } from '@build-a-computer/schema';
import { disassemble } from '@build-a-computer/content';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { capacityOf, changedCells, contentsOf, findCpu, memoryParts, partValue, widthOf, type CpuParts } from './memory';
import { partKind, shortPart } from './names';
import { hex } from './romCode';
import { dockSource } from './source';
import { formatBus } from './waveform';

/**
 * Call `fetch` once per animation frame while the clock runs (never two in
 * flight), and once after each step or edit while paused.
 */
function useLivePoll(fetch: () => Promise<void>, key: string): void {
  const running = useEditor((s) => !!s.snapshot?.running);
  const ticks = useEditor((s) => s.snapshot?.ticks ?? 0);
  const board = useEditor((s) => s.board);
  const fetchRef = useRef(fetch);
  useEffect(() => {
    fetchRef.current = fetch;
  });
  useEffect(() => {
    void fetchRef.current();
  }, [ticks, board, key]);
  useEffect(() => {
    if (!running && !dockSource.live()) return;
    let raf = 0;
    let busy = false;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      if (!busy) {
        busy = true;
        void fetchRef.current().finally(() => (busy = false));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [running, key]);
}

const sameArr = (a: readonly number[] | null, b: readonly number[]): boolean =>
  !!a && a.length === b.length && a.every((v, i) => v === b[i]);

/** Memory and CPU (TOY-04): hex dumps of RAM, ROM, registers and counters, and a Toy-8 CPU view. */
export function MemoryPanel() {
  const board = useEditor((s) => s.board);
  const parts = useMemo(() => memoryParts(board), [board]);
  const cpu = useMemo(() => findCpu(board), [board]);
  const [choice, setChoice] = useState<string>('');
  const options = [...(cpu ? [{ id: 'cpu', label: t('panels.mem.cpu') }] : []), ...parts.map((p) => ({ id: p.id, label: `${shortPart(p)} · ${partKind(p.type)}` }))];
  const active = options.find((o) => o.id === choice)?.id ?? options[0]?.id;

  if (!options.length) return <p className="dk-empty">{t('panels.mem.none')}</p>;
  const part = parts.find((p) => p.id === active);
  return (
    <div className="dk-mem">
      <div className="dk-mem-list" role="listbox" aria-label={t('panels.mem.parts')}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="option"
            aria-selected={o.id === active}
            className={`dk-mem-item ${o.id === active ? 'is-active' : ''}`}
            onClick={() => setChoice(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="dk-mem-view">
        {active === 'cpu' && cpu ? <CpuView cpu={cpu} /> : part ? <MemoryView key={part.id} part={part} /> : null}
      </div>
    </div>
  );
}

function MemoryView({ part }: { part: Part }) {
  const [state, setState] = useState<{ values: number[]; changed: Set<number> }>(() => ({ values: contentsOf(part, undefined), changed: new Set() }));
  const prev = useRef<number[] | null>(null);
  const partRef = useRef(part);
  useEffect(() => {
    partRef.current = part;
  });
  useLivePoll(async () => {
    const raw = await dockSource.memory(part.id);
    const values = contentsOf(partRef.current, raw);
    if (sameArr(prev.current, values)) return;
    const changed = changedCells(prev.current, values);
    prev.current = values;
    setState({ values, changed });
  }, part.id);

  const width = widthOf(part);
  if (capacityOf(part) === 1) {
    const v = state.values[0] ?? 0;
    return (
      <div className="dk-reg-single">
        <div className="dk-reg-name">{shortPart(part)}</div>
        <div className={`dk-reg-value ${state.changed.has(0) ? 'is-changed' : ''}`}>0x{hex(v, Math.ceil(width / 4))}</div>
        <div className="dk-reg-sub">
          {v} · {v.toString(2).padStart(width, '0')}
        </div>
      </div>
    );
  }
  return <HexDump values={state.values} changed={state.changed} width={width} />;
}

const ROW_H = 20;
const PER_ROW = 16;

/** Virtualized hex dump: only visible rows exist, and a row re-renders only when its cells change. */
function HexDump({ values, changed, width }: { values: number[]; changed: Set<number>; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(200);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rows = Math.ceil(values.length / PER_ROW);
  const first = Math.max(0, Math.floor(scroll / ROW_H) - 2);
  const last = Math.min(rows, Math.ceil((scroll + height) / ROW_H) + 2);
  const digits = Math.ceil(width / 4);
  const addrDigits = Math.max(2, Math.ceil(Math.log2(Math.max(2, values.length)) / 4));
  const out = [];
  for (let r = first; r < last; r++) {
    const base = r * PER_ROW;
    const cells = values.slice(base, base + PER_ROW);
    let mask = '';
    for (let i = 0; i < cells.length; i++) mask += changed.has(base + i) ? '1' : '0';
    out.push(<HexRow key={r} top={r * ROW_H} addr={hex(base, addrDigits)} cells={cells.map((v) => hex(v, digits)).join(' ')} mask={mask} ascii={width <= 8} />);
  }
  return (
    <div className="dk-hex" ref={ref} onScroll={(e) => setScroll(e.currentTarget.scrollTop)} tabIndex={0} role="table" aria-label={t('panels.mem.dump')} aria-rowcount={rows}>
      <div className="dk-hex-head" aria-hidden="true">
        <span className="dk-hex-addr">{' '.repeat(addrDigits)}</span>
        {Array.from({ length: PER_ROW }, (_, i) => (
          <span key={i} className="dk-hex-cell" style={{ minWidth: `${digits}ch` }}>
            {hex(i, digits > 1 ? digits : 1).slice(-digits)}
          </span>
        ))}
      </div>
      <div style={{ height: rows * ROW_H, position: 'relative' }}>{out}</div>
    </div>
  );
}

const HexRow = memo(function HexRow({ top, addr, cells, mask, ascii }: { top: number; addr: string; cells: string; mask: string; ascii: boolean }) {
  const list = cells.split(' ');
  return (
    <div className="dk-hex-row" role="row" style={{ top, height: ROW_H }}>
      <span className="dk-hex-addr" role="rowheader">
        {addr}
      </span>
      {list.map((c, i) => (
        <span key={i} role="cell" className={`dk-hex-cell ${mask[i] === '1' ? 'is-changed' : ''}`}>
          {c}
        </span>
      ))}
      {ascii && (
        <span className="dk-hex-ascii" aria-hidden="true">
          {list.map((c) => {
            const v = parseInt(c, 16);
            return v >= 32 && v < 127 ? String.fromCharCode(v) : '·';
          })}
        </span>
      )}
    </div>
  );
});

interface CpuState {
  regs: Record<string, number | null>;
  flags: Record<string, boolean | null>;
  rom: number[];
}

function CpuView({ cpu }: { cpu: CpuParts }) {
  const [st, setSt] = useState<CpuState>({ regs: {}, flags: {}, rom: [] });
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const last = useRef<CpuState | null>(null);
  const cpuRef = useRef(cpu);
  useEffect(() => {
    cpuRef.current = cpu;
  });
  const key = cpu.regs.map((r) => r.part.id).join(',');
  useLivePoll(async () => {
    const c = cpuRef.current;
    const snapshot = useEditor.getState().snapshot;
    const mems = await Promise.all(c.regs.map((r) => dockSource.memory(r.part.id)));
    const regs: CpuState['regs'] = {};
    c.regs.forEach((r, i) => {
      const v = partValue(r.part, snapshot, mems[i]);
      regs[r.name] = v && !v.x ? v.v : null;
    });
    const flags: CpuState['flags'] = {};
    for (const f of c.flags) {
      const v = partValue(f.part, snapshot);
      flags[f.name] = v && !v.x ? (v.v & 1) === 1 : null;
    }
    const rom = c.rom ? contentsOf(c.rom, await dockSource.memory(c.rom.id)) : [];
    const next = { regs, flags, rom };
    const prev = last.current;
    if (prev && JSON.stringify(prev.regs) === JSON.stringify(regs) && JSON.stringify(prev.flags) === JSON.stringify(flags) && sameArr(prev.rom, rom)) return;
    const diff = new Set<string>();
    if (prev) for (const k in regs) if (prev.regs[k] !== regs[k]) diff.add(k);
    last.current = next;
    setSt(next);
    setChanged(diff);
  }, key);

  const pc = st.regs.PC;
  let instr = '';
  if (pc !== null && pc !== undefined && st.rom.length) {
    try {
      instr = disassemble(st.rom.slice(pc, pc + 4)).text;
    } catch {
      instr = '?';
    }
  } else if (st.regs.IR !== null && st.regs.IR !== undefined) {
    try {
      instr = disassemble([st.regs.IR]).text;
    } catch {
      instr = '?';
    }
  }
  return (
    <div className="dk-cpu">
      <div className="dk-cpu-instr">
        <span className="dk-cpu-label">{t('panels.mem.instruction')}</span>
        <code>{instr || '—'}</code>
      </div>
      <div className="dk-cpu-regs" role="list">
        {cpu.regs.map((r) => {
          const v = st.regs[r.name];
          const w = widthOf(r.part);
          return (
            <div key={r.name} role="listitem" className={`dk-cpu-reg ${changed.has(r.name) ? 'is-changed' : ''}`}>
              <span className="dk-cpu-label">{r.name}</span>
              <span className="dk-cpu-hex">{v === null || v === undefined ? 'X'.repeat(Math.ceil(w / 4)) : formatBus({ w, v, x: 0 })}</span>
              <span className="dk-cpu-dec">{v ?? '—'}</span>
            </div>
          );
        })}
      </div>
      {cpu.flags.length > 0 && (
        <div className="dk-cpu-flags" aria-label={t('panels.mem.flags')}>
          {cpu.flags.map((f) => {
            const on = st.flags[f.name];
            return (
              <span key={f.name} className={`dk-flag ${on ? 'is-on' : ''} ${on === null ? 'is-x' : ''}`} title={t(`panels.mem.flag.${f.name}`)}>
                {f.name}
                <span className="visually-hidden">{on === null ? 'X' : on ? '1' : '0'}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
