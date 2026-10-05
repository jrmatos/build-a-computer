import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { rv, useRvDebug } from '../../sim/client';
import { hex32, parseAddress, sortSymbols, symbolize } from './rv';

const ROW_H = 20;
const PER_ROW = 16;
/** The dump shows a 64 KiB window of the 4 GiB address space around the target. */
const WINDOW = 0x10000;
const ROWS = WINDOW / PER_ROW;

const windowFor = (addr: number): number => {
  const centered = Math.floor(Math.max(0, (addr >>> 0) - WINDOW / 2) / PER_ROW) * PER_ROW;
  return Math.min(centered, 0x1_0000_0000 - WINDOW);
};

interface Bytes {
  addr: number;
  data: Uint8Array;
}

/** RV32 memory (ASM-04): virtualized hex dump with jump-to address, symbol or register, and follow sp. */
export function RvMemoryPanel() {
  const state = useEditor((s) => s.rv?.state);
  const running = !!state?.running;
  const stop = useRvDebug((s) => s.stop);
  const symbols = useRvDebug((s) => s.symbols);
  const entry = useRvDebug((s) => s.entry);
  const sorted = useMemo(() => sortSymbols(symbols), [symbols]);
  const loads = useRvDebug((s) => s.loads);
  const sp = state?.regs[2];
  const loaded = !!state;
  /** Where the player jumped to; a new load goes back to the entry point. */
  const [nav, setNav] = useState<{ loads: number; target: number; base: number } | null>(null);
  const [follow, setFollow] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(200);
  const [bytes, setBytes] = useState<Bytes | null>(null);
  const [changed, setChanged] = useState<Set<number>>(new Set());
  const atStop = useRef<{ stop: number; bytes: Bytes | null }>({ stop: -1, bytes: null });

  let target: number;
  let base: number;
  if (follow && sp !== undefined) {
    target = sp >>> 0;
    const kept = nav?.base;
    base = kept !== undefined && target >= kept && target < kept + WINDOW ? kept : windowFor(target);
  } else if (nav && nav.loads === loads) {
    ({ target, base } = nav);
  } else {
    target = (entry || 0x80000000) >>> 0;
    base = windowFor(target);
  }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Bring the target row into view when it moves (the scroll event updates `scroll`).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const top = Math.floor((target - base) / PER_ROW) * ROW_H;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 2 * ROW_H) el.scrollTop = Math.max(0, top - el.clientHeight / 3);
  }, [target, base, stop]);

  const jump = (addr: number) => {
    const a = addr >>> 0;
    setNav({ loads, target: a, base: windowFor(a) });
  };

  const first = Math.max(0, Math.floor(scroll / ROW_H) - 2);
  const last = Math.min(ROWS, Math.ceil((scroll + height) / ROW_H) + 2);
  const from = base + first * PER_ROW;
  const len = (last - first) * PER_ROW;

  const fetchRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    fetchRef.current = async () => {
      if (!loaded || len <= 0) return;
      const data = await rv.memory(from, len);
      if (!data) return;
      const got: Bytes = { addr: from, data: new Uint8Array(data) };
      const s = useRvDebug.getState().stop;
      const live = !!useEditor.getState().rv?.state.running;
      if (s !== atStop.current.stop && !live) {
        // A new stop: highlight bytes that differ from what the previous stop showed.
        const prev = atStop.current.bytes;
        const diff = new Set<number>();
        if (prev && atStop.current.stop >= 0) {
          for (let i = 0; i < got.data.length; i++) {
            const j = got.addr + i - prev.addr;
            if (j >= 0 && j < prev.data.length && prev.data[j] !== got.data[i]) diff.add(got.addr + i);
          }
        }
        setChanged(diff);
        atStop.current = { stop: s, bytes: got };
      } else if (!live) atStop.current.bytes = got;
      setBytes(got);
    };
  });

  useEffect(() => {
    void fetchRef.current();
  }, [from, len, stop, loaded]);

  // While running, refresh once per frame with at most one request in flight.
  useEffect(() => {
    if (!running) return;
    let alive = true;
    let busy = false;
    let raf = 0;
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
  }, [running]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const a = parseAddress(query, state?.regs, symbols);
    setError(a === null);
    if (a === null) return;
    setFollow(false);
    jump(a);
  };

  const rows = [];
  for (let r = first; r < last; r++) {
    const addr = base + r * PER_ROW;
    let cells = '';
    let mask = '';
    for (let i = 0; i < PER_ROW; i++) {
      const a = addr + i;
      const j = bytes ? a - bytes.addr : -1;
      const v = bytes && j >= 0 && j < bytes.data.length ? bytes.data[j]! : -1;
      cells += v < 0 ? '-- ' : `${v.toString(16).padStart(2, '0')} `;
      mask += changed.has(a) ? '1' : '0';
    }
    const isTarget = target >= addr && target < addr + PER_ROW;
    const isSp = sp !== undefined && sp >>> 0 >= addr && sp >>> 0 < addr + PER_ROW;
    rows.push(<Row key={r} top={r * ROW_H} addr={addr} cells={cells.trimEnd()} mask={mask} target={isTarget} sp={isSp} />);
  }
  const label = symbolize(target, sorted);

  return (
    <div className="dk-rv-mem">
      <form className="dk-toolbar" onSubmit={onSubmit}>
        <input
          className={`dk-input ${error ? 'is-error' : ''}`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(false);
          }}
          placeholder={t('panels.rv.mem.jumpPlaceholder')}
          aria-label={t('panels.rv.mem.jump')}
          aria-invalid={error}
          list="dk-rv-symbols"
          spellCheck={false}
        />
        <datalist id="dk-rv-symbols">
          {sorted.map((s) => (
            <option key={s.name} value={s.name} />
          ))}
        </datalist>
        <button type="submit" className="dk-btn">
          {t('panels.rv.mem.go')}
        </button>
        <label className="dk-check">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => {
              // Leaving follow mode stays where sp was.
              if (!e.target.checked) jump(target);
              setFollow(e.target.checked);
            }}
          />
          {t('panels.rv.mem.followSp')}
        </label>
        <span className="dk-spacer" />
        {error ? (
          <span className="dk-readout is-error" role="alert">
            {t('panels.rv.mem.bad')}
          </span>
        ) : (
          <span className="dk-readout">
            0x{hex32(target)}
            {label ? ` · ${label}` : ''}
          </span>
        )}
      </form>
      <div
        className="dk-hex"
        ref={ref}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
        tabIndex={0}
        role="table"
        aria-label={t('panels.rv.mem.dump', { from: hex32(base), to: hex32(base + WINDOW - 1) })}
        aria-rowcount={ROWS}
      >
        <div className="dk-hex-head" aria-hidden="true">
          <span className="dk-hex-addr dk-rv-addr">{' '.repeat(8)}</span>
          {Array.from({ length: PER_ROW }, (_, i) => (
            <span key={i} className="dk-hex-cell">
              {i.toString(16).padStart(2, '0')}
            </span>
          ))}
        </div>
        <div style={{ height: ROWS * ROW_H, position: 'relative' }}>{rows}</div>
      </div>
    </div>
  );
}

const Row = memo(function Row({ top, addr, cells, mask, target, sp }: { top: number; addr: number; cells: string; mask: string; target: boolean; sp: boolean }) {
  const list = cells.split(' ');
  return (
    <div className={`dk-hex-row ${target ? 'is-target' : ''}`} role="row" style={{ top, height: ROW_H }}>
      <span className="dk-hex-addr dk-rv-addr" role="rowheader">
        {hex32(addr)}
      </span>
      {list.map((c, i) => (
        <span key={i} role="cell" className={`dk-hex-cell ${mask[i] === '1' ? 'is-changed' : ''}`}>
          {c}
        </span>
      ))}
      <span className="dk-hex-ascii" aria-hidden="true">
        {list
          .map((c) => {
            const v = parseInt(c, 16);
            return v >= 32 && v < 127 ? String.fromCharCode(v) : '.';
          })
          .join('')}
      </span>
      {sp && <span className="dk-tag dk-rv-sp">sp</span>}
    </div>
  );
});
