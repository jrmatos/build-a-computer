import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { create } from 'zustand';
import { worldToScreen } from '../editor/camera';
import { partRect } from '../editor/geometry';
import { numProp } from '../editor/partProps';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { sim } from '../sim/client';
import { formatValue, maskOf, parseNumber, stepValue, toBin } from './numberFormat';
import './Probe.css';

/** Which multi-bit switch has its number input open. */
export const useNumberInput = create<{ partId: string | null }>(() => ({ partId: null }));

export function openNumberInput(partId: string): void {
  useNumberInput.setState({ partId });
}

export function closeNumberInput(): void {
  useNumberInput.setState({ partId: null });
}

type Base = 'hex' | 'dec' | 'bin';

/** Popover anchored under a multi-bit switch: type a number, flip bits, or scroll to step. */
export function NumberInputPopover() {
  const id = useNumberInput((s) => s.partId);
  const exists = useEditor((s) => (id ? s.board.parts.some((p) => p.id === id && p.type === 'switch') : false));
  useEffect(() => {
    if (id && !exists) closeNumberInput();
  }, [id, exists]);
  return id && exists ? <Popover key={id} id={id} /> : null;
}

function Popover({ id }: { id: string }) {
  const part = useEditor((s) => s.board.parts.find((p) => p.id === id))!;
  const camera = useEditor((s) => s.camera);
  const live = useEditor((s) => s.snapshot?.switchValues[id]);
  const width = numProp(part, 'width');
  const [value, setValueState] = useState<number>(() => live ?? part.props?.value ?? 0);
  const [base, setBase] = useState<Base>('hex');
  const [text, setText] = useState(() => formatValue(value, width, 'hex'));
  const [error, setError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Follow the simulation (reset, other inputs) unless the player is mid-typing a bad value.
  const [seenLive, setSeenLive] = useState(live);
  if (live !== seenLive) {
    setSeenLive(live);
    if (live !== undefined && live !== value) {
      setValueState(live);
      if (!error) setText(formatValue(live, width, base));
    }
  }

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) closeNumberInput();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);

  const apply = (v: number, keepText = false) => {
    const next = (v & maskOf(width)) >>> 0;
    setValueState(next);
    setError(false);
    if (!keepText) setText(formatValue(next, width, base));
    void sim.setValue(id, next);
  };

  const commitText = () => {
    const v = parseNumber(text, width);
    if (v === null) {
      setError(true);
      return false;
    }
    apply(v);
    return true;
  };

  const onKey = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeNumberInput();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (commitText()) closeNumberInput();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      apply(stepValue(value, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 16 : 1), width));
    }
  };

  const r = partRect(part);
  const a = worldToScreen(camera, r.x, r.y);
  const b = worldToScreen(camera, r.x + r.w, r.y + r.h);
  const popW = width > 16 ? 360 : 280;
  const left = Math.max(8, Math.min(window.innerWidth - popW - 8, (a.x + b.x) / 2 - popW / 2));
  const below = b.y + 10;
  const top = below + 190 > window.innerHeight ? Math.max(8, a.y - 200) : below;
  const bits = toBin(value, width);

  return (
    <div
      ref={root}
      className="island gu-numpop"
      role="dialog"
      aria-label={t('numpop.aria', { name: part.label || t('part.switch') })}
      style={{ left, top, width: popW }}
      onKeyDown={onKey}
      onWheel={(e) => {
        e.stopPropagation();
        if (e.deltaY) apply(stepValue(value, e.deltaY < 0 ? 1 : -1, width));
      }}
    >
      <div className="gu-numpop__row">
        <div className="gu-seg" role="radiogroup" aria-label={t('numpop.base')}>
          {(['hex', 'dec', 'bin'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={base === k}
              className="gu-seg__btn"
              onClick={() => {
                setBase(k);
                setText(formatValue(value, width, k));
                setError(false);
              }}
            >
              {t(`numpop.${k}`)}
            </button>
          ))}
        </div>
        <span className="gu-numpop__width">{t('numpop.bits', { n: width })}</span>
      </div>
      <div className="gu-numpop__row">
        <button type="button" className="gu-icon-btn gu-icon-btn--boxed" aria-label={t('numpop.dec1')} onClick={() => apply(stepValue(value, -1, width))}>
          −
        </button>
        <input
          ref={input}
          className={`gu-input gu-numpop__input${error ? ' gu-input--error' : ''}`}
          value={text}
          aria-label={t('numpop.value')}
          aria-invalid={error}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseNumber(e.target.value, width);
            setError(v === null && e.target.value.trim() !== '');
            if (v !== null) apply(v, true);
          }}
          onBlur={() => setText(formatValue(value, width, base))}
        />
        <button type="button" className="gu-icon-btn gu-icon-btn--boxed" aria-label={t('numpop.inc1')} onClick={() => apply(stepValue(value, 1, width))}>
          +
        </button>
      </div>
      {error && <div className="gu-numpop__error">{t('numpop.invalid', { max: maskOf(width) })}</div>}
      <div className="gu-bits" role="group" aria-label={t('numpop.bitsAria')}>
        {[...bits].map((c, i) => {
          const bit = width - 1 - i;
          return (
            <button
              key={bit}
              type="button"
              className={`gu-bit${c === '1' ? ' gu-bit--on' : ''}${bit % 4 === 0 && bit ? ' gu-bit--gap' : ''}`}
              aria-pressed={c === '1'}
              aria-label={t('numpop.bit', { n: bit })}
              title={t('numpop.bit', { n: bit })}
              onClick={() => apply((value ^ 2 ** bit) >>> 0)}
            >
              {c}
            </button>
          );
        })}
      </div>
      <div className="gu-numpop__hint">{t('numpop.hint')}</div>
    </div>
  );
}
