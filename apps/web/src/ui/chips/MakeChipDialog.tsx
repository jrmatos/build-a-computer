import { useMemo, useState, type DragEvent } from 'react';
import type { Board, ChipDef, Part } from '@build-a-computer/schema';
import { validatePorts } from '@build-a-computer/sim-logic';
import { makeChip } from '../../editor/chips';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { Dialog } from '../Dialog';
import { IconAlert } from '../icons';
import { ChipPreview } from './ChipPreview';
import { portCandidates } from './logic';
import { CHIP_COLORS, useChipUi } from './state';

/** Board with the dialog's pending label edits applied. */
function withLabels(board: Board, labels: Record<string, string>): Board {
  if (!Object.keys(labels).length) return board;
  return {
    ...board,
    parts: board.parts.map((p) => {
      if (!(p.id in labels)) return p;
      const label = labels[p.id]!.trim();
      const next: Part = { ...p };
      if (label) next.label = label.slice(0, 32);
      else delete next.label;
      return next;
    }),
  };
}

/** "Make chip" (CHIP-01): name, color, port order with pin names, and a live preview of the tile. */
export function MakeChipDialog() {
  const board = useEditor((s) => s.board);
  const level = useEditor((s) => s.level);
  const editStack = useEditor((s) => s.editStack);
  const chips = useEditor((s) => s.chips);
  const close = () => useChipUi.getState().set({ make: false });

  const initial = useMemo(() => portCandidates(board), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [name, setName] = useState(() => {
    const inner = editStack.length
      ? chips[editStack[editStack.length - 1]!.chipId]?.name
      : undefined;
    return (
      inner
        ? `${inner} 2`
        : level && level.track !== 'sandbox'
          ? level.title
          : t('chips.make.defaultName')
    ).slice(0, 40);
  });
  const [color, setColor] = useState(CHIP_COLORS[Object.keys(chips).length % CHIP_COLORS.length]!);
  const [inputs, setInputs] = useState(() => initial.inputs.map((p) => p.id));
  const [outputs, setOutputs] = useState(() => initial.outputs.map((p) => p.id));
  const [labels, setLabels] = useState<Record<string, string>>({});

  const labelled = withLabels(board, labels);
  const draft: ChipDef = {
    id: '__draft__',
    name: name.trim() || t('chips.make.defaultName'),
    version: 1,
    board: labelled,
    ports: { inputs, outputs },
    color,
  };
  const problems = validatePorts(draft).filter(
    (p) => p.code === 'duplicate-name' || p.code === 'too-many',
  );
  const dupNames = new Set(
    problems
      .filter((p) => p.code === 'duplicate-name')
      .map((p) => labelled.parts.find((q) => q.id === p.port)?.label ?? p.port ?? ''),
  );
  const canCreate = !!name.trim() && !problems.length && inputs.length + outputs.length > 0;

  const create = () => {
    if (!canCreate) return;
    const st = useEditor.getState();
    // Pin names come from the port labels: write the edited labels onto the board first.
    if (Object.keys(labels).length) st.commit((b) => withLabels(b, labels));
    const def = makeChip({ name, color, inputs, outputs });
    if (def) {
      close();
      st.set({ libraryOpen: true });
    }
  };

  const partById = (id: string) => labelled.parts.find((p) => p.id === id);

  return (
    <Dialog
      title={t('chips.make.title')}
      onClose={close}
      size="lg"
      footer={
        <>
          <button type="button" className="gu-btn" onClick={close}>
            {t('chips.make.cancel')}
          </button>
          <button
            type="button"
            className="gu-btn gu-btn--primary"
            disabled={!canCreate}
            onClick={create}
          >
            {t('chips.make.create')}
          </button>
        </>
      }
    >
      <form
        className="gu-chipmake"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <div className="gu-chipmake__side">
          <label className="gu-field">
            <span>{t('chips.make.name')}</span>
            <input
              className="gu-input"
              data-autofocus
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <fieldset className="gu-field gu-chip-colors">
            <legend>{t('chips.make.color')}</legend>
            <ColorPicker value={color} onChange={setColor} />
          </fieldset>
          <div className="gu-field">
            <span>{t('chips.make.preview')}</span>
            <div className="gu-chipmake__preview">
              <ChipPreview def={draft} maxWidth={260} maxHeight={300} maxScale={2} />
            </div>
          </div>
        </div>
        <div className="gu-chipmake__ports">
          <p className="gu-muted">{t('chips.make.order')}</p>
          <PortList
            title={t('chips.make.inputs')}
            ids={inputs}
            onChange={setInputs}
            partById={partById}
            labels={labels}
            setLabel={(id, v) => setLabels({ ...labels, [id]: v })}
            dupNames={dupNames}
          />
          <PortList
            title={t('chips.make.outputs')}
            ids={outputs}
            onChange={setOutputs}
            partById={partById}
            labels={labels}
            setLabel={(id, v) => setLabels({ ...labels, [id]: v })}
            dupNames={dupNames}
          />
          {problems.map((p) => (
            <p key={p.message} className="gu-chipmake__error" role="alert">
              <IconAlert size={14} />{' '}
              {p.code === 'duplicate-name'
                ? t('chips.make.duplicate', { name: [...dupNames][0] ?? '' })
                : p.message}
            </p>
          ))}
          <button type="submit" hidden />
        </div>
      </form>
    </Dialog>
  );
}

export function ColorPicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (c: string) => void;
}) {
  return (
    <div className="gu-chip-colors__row" role="radiogroup" aria-label={t('chips.make.color')}>
      {CHIP_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          title={c}
          className={`gu-swatch${value === c ? ' is-active' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

interface PortListProps {
  title: string;
  ids: string[];
  onChange: (ids: string[]) => void;
  partById: (id: string) => Part | undefined;
  labels: Record<string, string>;
  setLabel: (id: string, v: string) => void;
  dupNames: Set<string>;
}

const DRAG_MIME = 'application/x-build-a-computer-port';

/** Reorderable port rows: drag, or the up/down buttons from the keyboard. */
function PortList({ title, ids, onChange, partById, labels, setLabel, dupNames }: PortListProps) {
  const [over, setOver] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    onChange(next);
  };
  const onDrop = (e: DragEvent, to: number) => {
    e.preventDefault();
    setOver(null);
    const from = ids.indexOf(e.dataTransfer.getData(DRAG_MIME));
    if (from >= 0) move(from, to);
  };
  return (
    <section className="gu-ports">
      <h3>{title}</h3>
      {!ids.length && <p className="gu-muted">{t('chips.make.none')}</p>}
      <ol className="gu-ports__list">
        {ids.map((id, i) => {
          const part = partById(id);
          const value = labels[id] ?? part?.label ?? '';
          const width = (part?.props?.width as number | undefined) ?? 1;
          const unlabelled = !value.trim();
          const dup = !unlabelled && dupNames.has(value.trim());
          return (
            <li
              key={id}
              className={`gu-port${over === i ? ' is-over' : ''}${unlabelled || dup ? ' is-warn' : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
                e.preventDefault();
                setOver(i);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => onDrop(e, i)}
            >
              <span className="gu-port__grip" aria-hidden="true">
                ⋮⋮
              </span>
              <span className="gu-port__index">{i + 1}</span>
              <input
                className="gu-input gu-port__name"
                value={value}
                placeholder={id}
                maxLength={32}
                aria-label={t('chips.make.label', { id })}
                aria-invalid={dup || undefined}
                onChange={(e) => setLabel(id, e.target.value)}
                onDragStart={(e) => e.preventDefault()}
                draggable={false}
              />
              {width > 1 && (
                <span className="gu-port__width">{t('chips.make.bits', { n: width })}</span>
              )}
              {unlabelled && (
                <span
                  className="gu-port__warn"
                  title={t('chips.make.unlabelled', { id })}
                  aria-label={t('chips.make.unlabelled', { id })}
                >
                  <IconAlert size={14} />
                </span>
              )}
              <span className="gu-port__moves">
                <button
                  type="button"
                  className="gu-icon-btn gu-icon-btn--sm"
                  aria-label={t('chips.make.up')}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="gu-icon-btn gu-icon-btn--sm"
                  aria-label={t('chips.make.down')}
                  disabled={i === ids.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  ↓
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
