import type { Board, PinRef } from '@ground-up/schema';
import type { BusValue, Snapshot } from '@ground-up/worker';
import type { ProbeTarget } from '../editor/interaction';
import { geomOf } from '../editor/parts';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { probeText } from './numberFormat';
import './Probe.css';

export interface ProbeState {
  target: ProbeTarget;
  /** Canvas-relative CSS pixels where the pointer rested. */
  x: number;
  y: number;
}

function pinWidth(board: Board, ref: PinRef): number {
  const part = board.parts.find((p) => p.id === ref.part);
  return part ? (geomOf(part).pins.find((p) => p.name === ref.pin)?.width ?? 1) : 1;
}

const fromBit = (b: number | undefined): BusValue | null => (b === undefined ? null : { w: 1, v: b === 1 ? 1 : 0, x: b === 2 ? 1 : 0 });

/** Value, width and a title for a probe target, read from the latest snapshot. */
export function probeValue(board: Board, snap: Snapshot | null, target: ProbeTarget): { title: string; width: number; value: BusValue | null } {
  if (target.kind === 'wire') {
    const w = board.wires.find((x) => x.id === target.id);
    const width = w ? pinWidth(board, w.from) : 1;
    const name = (r: PinRef) => {
      const p = board.parts.find((q) => q.id === r.part);
      return `${p?.label?.trim() || (p ? t(`part.${p.type}`) : '?')}.${r.pin}`;
    };
    const value = snap ? (snap.buses[target.id] ?? fromBit(snap.wires[target.id])) : null;
    return { title: w ? `${name(w.from)} → ${name(w.to)}` : t('probe.wire'), width: value?.w ?? width, value };
  }
  const key = `${target.ref.part}:${target.ref.pin}`;
  const part = board.parts.find((q) => q.id === target.ref.part);
  const value = snap ? (snap.busPins[key] ?? fromBit(snap.pins[key])) : null;
  return {
    title: `${part?.label?.trim() || (part ? t(`part.${part.type}`) : '?')}.${target.ref.pin}`,
    width: value?.w ?? pinWidth(board, target.ref),
    value,
  };
}

/** Hover tooltip with a wire's (or Alt+hovered pin's) live value (EDIT-09). */
export function Probe({ probe }: { probe: ProbeState | null }) {
  const board = useEditor((s) => s.board);
  const snap = useEditor((s) => s.snapshot);
  if (!probe) return null;
  const { title, width, value } = probeValue(board, snap, probe.target);
  const text = value ? probeText(width, value.v, value.x) : null;
  const left = Math.min(probe.x + 16, window.innerWidth - 260);
  const top = probe.y + 18 + 150 > window.innerHeight ? probe.y - 150 : probe.y + 18;

  return (
    <div className="gu-probe island" role="tooltip" style={{ left, top }}>
      <div className="gu-probe__head">
        <span className="gu-probe__title">{title}</span>
        <span className="gu-probe__width">{t('probe.bits', { n: width })}</span>
      </div>
      {!text ? (
        <div className="gu-probe__none">{t('probe.noValue')}</div>
      ) : (
        <dl className="gu-probe__rows">
          <dt>{t('probe.bin')}</dt>
          <dd className={text.xBits ? 'gu-probe__x' : undefined}>{text.bin}</dd>
          <dt>{t('probe.dec')}</dt>
          <dd>{text.dec ?? '—'}</dd>
          {width > 1 && (
            <>
              <dt>{t('probe.signed')}</dt>
              <dd>{text.signed ?? '—'}</dd>
            </>
          )}
          <dt>{t('probe.hex')}</dt>
          <dd>0x{text.hex}</dd>
          {text.xBits > 0 && (
            <>
              <dt>{t('probe.x')}</dt>
              <dd className="gu-probe__x">{t('probe.xBits', { n: text.xBits })}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
