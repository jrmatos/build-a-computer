import { useMemo, useState } from 'react';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { useRvDebug } from '../../sim/client';
import { ABI_NAMES, CSR_ORDER, causeKey, decodeMstatus, decodeMtvec, decodeSatp, formatReg, hex32, irqBits, sortSymbols, symbolize, type Radix } from './rv';

const RADIX_KEY = 'build-a-computer:rv-radix';

function loadRadix(): Radix {
  try {
    return globalThis.localStorage?.getItem(RADIX_KEY) === 'dec' ? 'dec' : 'hex';
  } catch {
    return 'hex';
  }
}

/** Registers (ASM-04): x0-x31 with ABI names, pc, privilege mode and decoded CSRs. */
export function RegistersPanel() {
  const state = useEditor((s) => s.rv?.state);
  const prev = useRvDebug((s) => s.prevRegs);
  const symbols = useRvDebug((s) => s.symbols);
  const sorted = useMemo(() => sortSymbols(symbols), [symbols]);
  const [radix, setRadixState] = useState<Radix>(loadRadix);
  const setRadix = (r: Radix) => {
    setRadixState(r);
    try {
      globalThis.localStorage?.setItem(RADIX_KEY, r);
    } catch {
      /* storage blocked */
    }
  };

  if (!state) return <p className="dk-empty">{t('panels.rv.notLoaded')}</p>;
  const changed = (i: number) => !state.running && !!prev && prev[i] !== state.regs[i];
  const pcSym = symbolize(state.pc, sorted);

  return (
    <div className="dk-rv">
      <div className="dk-toolbar">
        <span className="dk-rv-pc">
          <span className="dk-rv-abi">pc</span>
          <code>0x{hex32(state.pc)}</code>
          {pcSym && <span className="dk-rv-sym">{pcSym}</span>}
        </span>
        <span className="dk-tag" title={t('panels.rv.modeHelp')}>
          {t(`panels.rv.mode.${state.mode}`)}
        </span>
        <span className="dk-readout">{t('panels.rv.instret', { n: state.instret.toLocaleString() })}</span>
        <span className="dk-spacer" />
        <div className="dk-seg" role="radiogroup" aria-label={t('panels.rv.radix')}>
          {(['hex', 'dec'] as const).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={radix === r} className={`dk-seg-btn ${radix === r ? 'is-active' : ''}`} onClick={() => setRadix(r)}>
              {t(`panels.rv.radix.${r}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="dk-rv-cols">
        <table className="dk-rv-regs" aria-label={t('panels.rv.regs')}>
          <tbody>
            {Array.from({ length: 8 }, (_, row) => (
              <tr key={row}>
                {[0, 8, 16, 24].map((col) => {
                  const i = row + col;
                  const v = state.regs[i] ?? 0;
                  return (
                    <td key={i} className={`dk-rv-reg ${changed(i) ? 'is-changed' : ''}`} title={`x${i} = 0x${hex32(v)} = ${v >>> 0} = ${v | 0}`}>
                      <span className="dk-rv-x">x{i}</span>
                      <span className="dk-rv-abi">{ABI_NAMES[i]}</span>
                      <code className="dk-rv-val">{formatReg(v, radix)}</code>
                      {changed(i) && <span className="visually-hidden">{t('panels.rv.changed')}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <Csrs csrs={state.csrs} sorted={sorted} />
      </div>
    </div>
  );
}

function Csrs({ csrs, sorted }: { csrs: Record<string, number>; sorted: ReturnType<typeof sortSymbols> }) {
  const names = [...CSR_ORDER.filter((n) => n in csrs), ...Object.keys(csrs).filter((n) => !(CSR_ORDER as readonly string[]).includes(n))];
  const decode = (name: string, v: number): string => {
    switch (name) {
      case 'mstatus':
        return decodeMstatus(v);
      case 'mcause': {
        // All zero means no trap yet, not "misaligned instruction" (cause 0).
        if (!v && !csrs.mepc && !csrs.mtval) return '';
        const k = causeKey(v);
        return k ? t(`panels.rv.cause.${k}`) : '';
      }
      case 'mepc':
        return symbolize(v, sorted) ?? '';
      case 'mtvec':
        return `${decodeMtvec(v)}${symbolize(v & ~3, sorted) ? ` (${symbolize(v & ~3, sorted)})` : ''}`;
      case 'mie':
      case 'mip':
        return irqBits(v).join(' ');
      case 'satp':
        return decodeSatp(v);
      default:
        return '';
    }
  };
  return (
    <section className="dk-rv-csrs" aria-label={t('panels.rv.csrsHelp')}>
      <h3 className="dk-cpu-label" title={t('panels.rv.csrsHelp')}>
        {t('panels.rv.csrs')}
      </h3>
      {names.length ? (
        <dl>
          {names.map((n) => {
            const v = csrs[n] ?? 0;
            return (
              <div key={n} className="dk-rv-csr">
                <dt>{n}</dt>
                <dd>
                  <code>0x{hex32(v)}</code>
                  <span className="dk-rv-sym">{decode(n, v)}</span>
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="dk-readout">{t('panels.rv.noCsrs')}</p>
      )}
    </section>
  );
}
