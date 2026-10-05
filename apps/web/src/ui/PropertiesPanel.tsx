import { useState, type ReactNode } from 'react';
import type { Part, PartProps } from '@build-a-computer/schema';
import { PART_INFO } from '@build-a-computer/sim-logic';
import { applyProps, describeWire, LARGE_ADDR_WIDTH, memorySize, numProp, PROP_LIMITS, validateProps } from '../editor/partProps';
import { deleteSelection, duplicateSelection, flipSelection, rotateSelection, setPartLabel } from '../editor/actions';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { IconDuplicate, IconFlip, IconLock, IconRotateCcw, IconRotateCw, IconTrash, PartSymbol } from './icons';
import { formatValue, parseNumber } from './numberFormat';
import { RomEditor } from './RomEditor';
import { kbd } from './shortcuts';
import './ui.css';
import './props.css';

/** Left island with the selection's properties, shown only when something is selected. */
export function PropertiesPanel() {
  const selection = useEditor((s) => s.selection);
  const board = useEditor((s) => s.board);
  const readOnly = useEditor((s) => s.readOnly);

  if (!selection.length) return null;
  const ids = new Set(selection);
  const parts = board.parts.filter((p) => ids.has(p.id));
  const wireCount = board.wires.reduce((n, w) => n + (ids.has(w.id) ? 1 : 0), 0);
  if (!parts.length && !wireCount) return null;

  const single = parts.length === 1 && wireCount === 0 ? parts[0]! : null;
  const allLocked = parts.length > 0 && wireCount === 0 && parts.every((p) => p.locked);
  const editableParts = parts.filter((p) => !p.locked).length > 0;
  const summary = [
    parts.length ? (parts.length === 1 ? t('props.part') : t('props.parts', { n: parts.length })) : null,
    wireCount ? (wireCount === 1 ? t('props.wire') : t('props.wires', { n: wireCount })) : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <section className="island gu-props" aria-label={t('props.label')}>
      {single ? (
        <div className="gu-props__head">
          <span className="gu-mini-tile" aria-hidden="true">
            <PartSymbol type={single.type} size={16} />
          </span>
          <div className="gu-props__title">
            <strong>{t(`part.${single.type}`)}</strong>
            {single.locked && (
              <span className="gu-props__locked">
                <IconLock size={12} /> {t('props.locked')}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="gu-props__head">
          <strong>{summary}</strong>
        </div>
      )}

      {single && <LabelField key={`${single.id}:${single.label ?? ''}`} part={single} disabled={readOnly} />}

      {wireCount === 0 && parts.length > 0 && parts.every((p) => p.type === parts[0]!.type) && (
        <PartSettings parts={parts} disabled={readOnly || parts.some((p) => p.locked)} />
      )}

      {parts.length > 0 && (
        <>
          <h3 className="gu-props__section">{t('props.arrange')}</h3>
          <div className="gu-btn-row">
            <IconAction label={t('action.rotateLeft')} shortcut="Shift+R" disabled={readOnly || !editableParts} onClick={() => rotateSelection(-1)}>
              <IconRotateCcw size={16} />
            </IconAction>
            <IconAction label={t('action.rotate')} shortcut="R" disabled={readOnly || !editableParts} onClick={() => rotateSelection(1)}>
              <IconRotateCw size={16} />
            </IconAction>
            <IconAction label={t('action.flip')} shortcut="F" disabled={readOnly || !editableParts} onClick={flipSelection}>
              <IconFlip size={16} />
            </IconAction>
          </div>
        </>
      )}

      <h3 className="gu-props__section">{t('props.actions')}</h3>
      <div className="gu-btn-row">
        <IconAction label={t('action.duplicate')} shortcut={kbd('Mod+D')} disabled={readOnly || allLocked} onClick={duplicateSelection}>
          <IconDuplicate size={16} />
        </IconAction>
        <IconAction label={t('action.delete')} shortcut="Delete" danger disabled={readOnly || allLocked} onClick={deleteSelection}>
          <IconTrash size={16} />
        </IconAction>
      </div>
    </section>
  );
}

function LabelField({ part, disabled }: { part: Part; disabled: boolean }) {
  const [value, setValue] = useState(part.label ?? '');
  const commit = () => {
    if ((part.label ?? '') !== value.trim()) setPartLabel(part.id, value);
  };
  return (
    <label className="gu-field">
      <span className="gu-props__section">{t('props.labelField')}</span>
      <input
        className="gu-input"
        type="text"
        value={value}
        maxLength={40}
        placeholder={t('props.labelPlaceholder')}
        disabled={disabled || part.locked}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            commit();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setValue(part.label ?? '');
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function IconAction({
  label,
  shortcut,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`gu-icon-btn gu-icon-btn--boxed${danger ? ' gu-icon-btn--danger' : ''}`}
      aria-label={label}
      title={`${label} — ${shortcut}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Apply a props patch to the selected parts as one undoable step; report dropped wires. */
function changeProps(ids: string[], patch: PartProps): void {
  const st = useEditor.getState();
  const r = applyProps(st.board, new Set(ids), patch, st.chips);
  if (r.board !== st.board) {
    const gone = new Set(r.dropped.map((w) => w.id));
    st.commit(() => r.board, st.selection.filter((id) => !gone.has(id)));
  }
  if (r.dropped.length) {
    const list = r.dropped.slice(0, 4).map((w) => describeWire(st.board, w)).join(', ') + (r.dropped.length > 4 ? ', …' : '');
    st.toast(t('props.droppedWires', { n: r.dropped.length, list }), 'info');
  }
  if (r.rejected.length) st.toast(t('props.rejected'), 'error');
}

/** The value shared by all parts, or null when they differ. */
function common<T>(parts: Part[], get: (p: Part) => T): T | null {
  const v = get(parts[0]!);
  return parts.every((p) => get(p) === v) ? v : null;
}

/** Per-type settings from PART_INFO[type].editable; edits every selected part of that type. */
function PartSettings({ parts, disabled }: { parts: Part[]; disabled: boolean }) {
  const [romOpen, setRomOpen] = useState(false);
  const type = parts[0]!.type;
  const editable = PART_INFO[type].editable;
  const single = parts.length === 1 ? parts[0]! : null;
  const showRam = type === 'ram' && single;
  if (!editable.length && !showRam) return null;
  const ids = parts.map((p) => p.id);
  const key = ids.join(',');
  const width = common(parts, (p) => numProp(p, 'width'));
  const chunk = common(parts, (p) => numProp(p, 'chunk'));
  const isSplit = type === 'splitter' || type === 'joiner';

  return (
    <>
      <h3 className="gu-props__section">{t('props.settings')}</h3>
      {editable.includes('width') && (
        <Stepper
          key={`w:${key}:${width}`}
          label={t('props.width')}
          value={width}
          min={isSplit && chunk ? chunk : PROP_LIMITS.width[0]}
          max={PROP_LIMITS.width[1]}
          step={isSplit && chunk ? chunk : 1}
          disabled={disabled}
          validate={(v) => {
            const err = validateProps(type, isSplit && chunk ? { width: v, chunk } : { width: v });
            return err ? t(err.key, err.vars) : null;
          }}
          onCommit={(v) => changeProps(ids, { width: v })}
          note={isSplit && width && chunk ? t('props.chunks', { n: width / chunk, chunk }) : undefined}
        />
      )}
      {editable.includes('chunk') && (
        <Stepper
          key={`c:${key}:${chunk}`}
          label={t('props.chunk')}
          value={chunk}
          min={1}
          max={width ?? PROP_LIMITS.chunk[1]}
          disabled={disabled}
          nextValid={(v, dir) => {
            // Step to the next divisor of the width so the splitter stays valid.
            if (!width) return v;
            let n = v;
            while (n >= 1 && n <= width && width % n !== 0) n += dir;
            return n;
          }}
          validate={(v) => {
            const err = validateProps(type, { width: width ?? PART_INFO[type].defaults.width, chunk: v });
            return err ? t(err.key, err.vars) : null;
          }}
          onCommit={(v) => changeProps(ids, { chunk: v })}
        />
      )}
      {editable.includes('selectBits') && (
        <Stepper
          key={`s:${key}:${common(parts, (p) => numProp(p, 'selectBits'))}`}
          label={t('props.selectBits')}
          value={common(parts, (p) => numProp(p, 'selectBits'))}
          min={PROP_LIMITS.selectBits[0]}
          max={PROP_LIMITS.selectBits[1]}
          disabled={disabled}
          validate={(v) => {
            const err = validateProps(type, { selectBits: v });
            return err ? t(err.key, err.vars) : null;
          }}
          onCommit={(v) => changeProps(ids, { selectBits: v })}
          note={(n) => t('props.outputs', { n: 2 ** n })}
        />
      )}
      {editable.includes('addrWidth') && (
        <Stepper
          key={`a:${key}:${common(parts, (p) => numProp(p, 'addrWidth'))}`}
          label={t('props.addrWidth')}
          value={common(parts, (p) => numProp(p, 'addrWidth'))}
          min={PROP_LIMITS.addrWidth[0]}
          max={PROP_LIMITS.addrWidth[1]}
          disabled={disabled}
          validate={(v) => {
            const err = validateProps(type, { addrWidth: v });
            return err ? t(err.key, err.vars) : null;
          }}
          onCommit={(v) => changeProps(ids, { addrWidth: v })}
          note={(n) => {
            const m = memorySize(width ?? 8, n);
            return t('props.memSize', { words: m.words, width: width ?? '?' });
          }}
          warn={(n) => (n >= LARGE_ADDR_WIDTH ? t('props.memLarge', { kb: Math.round(memorySize(width ?? 8, n).bytes / 1024) }) : null)}
        />
      )}
      {editable.includes('value') && (
        <ValueField key={`v:${key}:${common(parts, (p) => numProp(p, 'value'))}:${width}`} parts={parts} width={width ?? 32} disabled={disabled} />
      )}
      {editable.includes('format') && (
        <label className="gu-field">
          <span className="gu-props__section">{t('props.format')}</span>
          <select
            className="gu-select"
            value={common(parts, (p) => p.props?.format ?? PART_INFO[type].defaults.format ?? 'hex') ?? ''}
            disabled={disabled}
            onChange={(e) => changeProps(ids, { format: e.target.value as PartProps['format'] })}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {common(parts, (p) => p.props?.format ?? 'hex') === null && <option value="">{t('props.mixed')}</option>}
            {(['hex', 'dec', 'signed', 'bin'] as const).map((f) => (
              <option key={f} value={f}>
                {t(`props.format.${f}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      {editable.includes('data') && single && (
        <button type="button" className="gu-btn gu-btn--sm gu-btn--block" onClick={() => setRomOpen(true)}>
          {t('props.editContents')}
        </button>
      )}
      {showRam && (
        <button type="button" className="gu-btn gu-btn--sm gu-btn--block" onClick={() => setRomOpen(true)}>
          {t('props.viewMemory')}
        </button>
      )}
      {romOpen && single && <RomEditor partId={single.id} onClose={() => setRomOpen(false)} />}
    </>
  );
}

interface StepperProps {
  label: string;
  /** null when the selected parts disagree. */
  value: number | null;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
  validate: (v: number) => string | null;
  onCommit: (v: number) => void;
  /** Adjust a stepped value to the nearest valid one in direction `dir`. */
  nextValid?: (v: number, dir: 1 | -1) => number;
  note?: string | ((v: number) => string) | undefined;
  warn?: (v: number) => string | null;
}

/** Number field with − / + buttons; typed values commit on Enter or blur after validation. */
function Stepper({ label, value, min, max, step = 1, disabled, validate, onCommit, nextValid, note, warn }: StepperProps) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const parsed = /^\s*\d+\s*$/.test(text) ? Number(text) : null;
  const error = text.trim() === '' ? null : parsed === null ? t('props.err.range', { min, max }) : validate(parsed);
  const commit = (v: number | null) => {
    if (v === null || validate(v) || v === value) return;
    onCommit(v);
  };
  const bump = (dir: 1 | -1) => {
    const base = parsed ?? value ?? min;
    let n = base + dir * step;
    if (nextValid) n = nextValid(n, dir);
    n = Math.max(min, Math.min(max, n));
    setText(String(n));
    commit(n);
  };
  const shown = parsed ?? value;
  const noteText = typeof note === 'function' ? (shown !== null ? note(shown) : null) : note;
  const warnText = warn && shown !== null ? warn(shown) : null;
  return (
    <div className="gu-field">
      <span className="gu-props__section">{label}</span>
      <div className="gu-stepper">
        <button
          type="button"
          className="gu-icon-btn gu-icon-btn--boxed"
          aria-label={t('props.dec', { name: label })}
          disabled={disabled || (value !== null && value <= min)}
          onClick={() => bump(-1)}
        >
          −
        </button>
        <input
          className={`gu-input${error ? ' gu-input--error' : ''}`}
          inputMode="numeric"
          value={text}
          placeholder={value === null ? t('props.mixed') : undefined}
          aria-label={label}
          aria-invalid={!!error}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => (error ? setText(value === null ? '' : String(value)) : commit(parsed))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit(parsed);
            else if (e.key === 'Escape') {
              setText(value === null ? '' : String(value));
              e.currentTarget.blur();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              bump(e.key === 'ArrowUp' ? 1 : -1);
            }
          }}
        />
        <button
          type="button"
          className="gu-icon-btn gu-icon-btn--boxed"
          aria-label={t('props.inc', { name: label })}
          disabled={disabled || (value !== null && value >= max)}
          onClick={() => bump(1)}
        >
          +
        </button>
      </div>
      {error ? <span className="gu-field__error">{error}</span> : noteText && <span className="gu-field__note">{noteText}</span>}
      {warnText && <span className="gu-field__warn">{warnText}</span>}
    </div>
  );
}

/** Const value: hex, binary or decimal (negative numbers read as two's complement). */
function ValueField({ parts, width, disabled }: { parts: Part[]; width: number; disabled: boolean }) {
  const value = common(parts, (p) => numProp(p, 'value'));
  const [text, setText] = useState(value === null ? '' : formatValue(value, width, width > 1 ? 'hex' : 'dec'));
  const parsed = parseNumber(text, width);
  const error = text.trim() !== '' && parsed === null;
  const commit = () => {
    if (parsed === null || parsed === value) return;
    changeProps(
      parts.map((p) => p.id),
      { value: parsed },
    );
  };
  return (
    <label className="gu-field">
      <span className="gu-props__section">{t('props.value')}</span>
      <input
        className={`gu-input${error ? ' gu-input--error' : ''}`}
        value={text}
        placeholder={value === null ? t('props.mixed') : undefined}
        aria-invalid={error}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') e.currentTarget.blur();
        }}
      />
      <span className={error ? 'gu-field__error' : 'gu-field__note'}>{error ? t('props.err.value') : t('props.valueHint')}</span>
    </label>
  );
}
