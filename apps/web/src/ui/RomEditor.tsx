import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RomParseError } from '@build-a-computer/sim-logic';
import { numProp } from '../editor/partProps';
import { updatePart } from '../editor/ops';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { sim } from '../sim/client';
import { Dialog } from './Dialog';
import { hexDigits, toHex } from './numberFormat';
import {
  COLUMNS,
  addrLabel,
  asciiOf,
  bytesToWords,
  dataFromWords,
  moveCursor,
  parseIntelHex,
  parsePaste,
  typeDigit,
  wordsFromData,
  wordsToBytes,
  writeAt,
  type Cursor,
} from './romGrid';
import './props.css';

const ROW_H = 24;
const VIEW_ROWS = 16;
const OVERSCAN = 6;
const MAX_ERRORS = 6;

/**
 * Hex editor for a ROM's `props.data` (SIM-13), or a read-only live view of a
 * RAM's contents. Saving writes the data as one undoable step.
 */
export function RomEditor({ partId, onClose }: { partId: string; onClose: () => void }) {
  const part = useEditor((s) => s.board.parts.find((p) => p.id === partId));
  const readOnlyBoard = useEditor((s) => s.readOnly);
  useEffect(() => {
    if (!part) onClose();
  }, [part, onClose]);
  if (!part) return null;
  const isRam = part.type === 'ram';
  const width = numProp(part, 'width');
  const addrWidth = numProp(part, 'addrWidth');
  return (
    <MemoryGrid
      key={`${partId}:${width}:${addrWidth}`}
      partId={partId}
      name={part.label?.trim() || t(`part.${part.type}`)}
      width={width}
      addrWidth={addrWidth}
      data={(part.props?.data as string | undefined) ?? ''}
      mode={isRam ? 'ram' : readOnlyBoard || part.locked ? 'view' : 'rom'}
      onClose={onClose}
    />
  );
}

interface GridProps {
  partId: string;
  name: string;
  width: number;
  addrWidth: number;
  data: string;
  /** rom: editable ROM; view: ROM shown read-only; ram: live RAM view. */
  mode: 'rom' | 'view' | 'ram';
  onClose: () => void;
}

function MemoryGrid({ partId, name, width, addrWidth, data, mode, onClose }: GridProps) {
  const size = 1 << addrWidth;
  const editable = mode === 'rom';
  const initial = useMemo(() => wordsFromData(data, width, addrWidth), [data, width, addrWidth]);
  const [words, setWords] = useState<Uint32Array>(initial.words);
  const [errors, setErrors] = useState<RomParseError[]>(initial.errors);
  const [cursor, setCursor] = useState<Cursor>({ addr: 0, nibble: 0 });
  const [note, setNote] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [ramEmpty, setRamEmpty] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const state = useRef({ words, cursor });
  useLayoutEffect(() => {
    state.current = { words, cursor };
  }, [words, cursor]);

  // RAM: poll the worker while the viewer is open.
  useEffect(() => {
    if (mode !== 'ram') return;
    let alive = true;
    const poll = async () => {
      const mem = await sim.memory(partId);
      if (!alive) return;
      if (!mem || !mem.length) setRamEmpty(true);
      else {
        setRamEmpty(false);
        const next = new Uint32Array(size);
        next.set(mem.slice(0, size));
        setWords(next);
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 250);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [mode, partId, size]);

  // Keep the cursor's row in view.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const row = Math.floor(cursor.addr / COLUMNS);
    const top = row * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight - ROW_H) el.scrollTop = top + 2 * ROW_H - el.clientHeight;
  }, [cursor.addr]);

  // Native listeners: the dialog's focus trap stops key events before React sees them,
  // and the board's document-level paste handler must not get our pastes.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const { words: w, cursor: c } = state.current;
      const rows = Math.ceil(size / COLUMNS);
      const go = (delta: number) => {
        e.preventDefault();
        const next = moveCursor(c, delta, size);
        state.current = { words: w, cursor: next };
        setCursor(next);
      };
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowDown') go(COLUMNS);
      else if (e.key === 'ArrowUp') go(-COLUMNS);
      else if (e.key === 'PageDown') go(COLUMNS * Math.min(rows, VIEW_ROWS));
      else if (e.key === 'PageUp') go(-COLUMNS * Math.min(rows, VIEW_ROWS));
      else if (e.key === 'Home') go(e.ctrlKey || e.metaKey ? -size : -(c.addr % COLUMNS));
      else if (e.key === 'End') go(e.ctrlKey || e.metaKey ? size : COLUMNS - 1 - (c.addr % COLUMNS));
      else if (!editable || e.ctrlKey || e.metaKey || e.altKey) return;
      else if (/^[0-9a-fA-F]$/.test(e.key)) {
        e.preventDefault();
        const r = typeDigit(w[c.addr]!, parseInt(e.key, 16), width, c, size);
        const next = writeAt(w, c.addr, [r.word]);
        // Keys can arrive faster than renders; keep the ref current.
        state.current = { words: next, cursor: r.cursor };
        setWords(next);
        setCursor(r.cursor);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        setWords(writeAt(w, c.addr, [0]));
        if (e.key === 'Backspace') setCursor(moveCursor(c, -1, size));
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      e.stopPropagation();
      if (!editable) return;
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const { words: w, cursor: c } = state.current;
      const r = parsePaste(text, width);
      if (!r.values.length) return;
      setWords(writeAt(w, c.addr, r.values));
      setErrors(r.errors.map((x) => ({ ...x, index: x.index + c.addr })));
      const fit = Math.min(r.values.length, size - c.addr);
      setNote(
        t('rom.pasted', { n: fit, addr: `0x${addrLabel(c.addr, addrWidth)}` }) +
          (fit < r.values.length ? ` ${t('rom.truncated', { n: fit })}` : ''),
      );
      setCursor(moveCursor(c, fit, size));
    };
    const onCopy = (e: ClipboardEvent) => {
      e.stopPropagation();
      e.preventDefault();
      e.clipboardData?.setData('text/plain', dataFromWords(state.current.words, width));
    };
    el.addEventListener('keydown', onKey);
    el.addEventListener('paste', onPaste);
    el.addEventListener('copy', onCopy);
    return () => {
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('paste', onPaste);
      el.removeEventListener('copy', onCopy);
    };
  }, [editable, size, width, addrWidth]);

  const importFile = async (file: File) => {
    try {
      let next: Uint32Array;
      let errs: RomParseError[] = [];
      if (/\.bin$/i.test(file.name)) {
        next = bytesToWords(new Uint8Array(await file.arrayBuffer()), width, size);
      } else {
        const text = await file.text();
        const intel = parseIntelHex(text);
        if (intel) next = bytesToWords(intel, width, size);
        else {
          const r = wordsFromData(text, width, addrWidth);
          next = r.words;
          errs = r.errors;
        }
      }
      setWords(next);
      setErrors(errs);
      setNote(t('rom.imported', { n: size, file: file.name }));
    } catch {
      setNote(t('rom.importFailed', { file: file.name }));
    }
  };

  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^\w-]+/g, '_') || 'rom'}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const save = () => {
    const text = dataFromWords(words, width);
    if (text !== data) {
      useEditor.getState().commit((b) => {
        const p = b.parts.find((q) => q.id === partId);
        return p ? updatePart(b, partId, { props: { ...(p.props ?? {}), data: text } }) : b;
      });
    }
    onClose();
  };

  const rows = Math.ceil(size / COLUMNS);
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows, Math.ceil((scrollTop + VIEW_ROWS * ROW_H) / ROW_H) + OVERSCAN);
  const digits = hexDigits(width);
  const cellW = Math.max(22, digits * 8 + 8);
  const cols = Math.min(COLUMNS, size);
  const gridCols = `64px repeat(${cols}, ${cellW}px) ${cols * 9 + 12}px`;

  const header = (
    <div className="gu-hex__row gu-hex__row--head" style={{ gridTemplateColumns: gridCols }} aria-hidden="true">
      <span>{t('rom.addr')}</span>
      {Array.from({ length: cols }, (_, i) => (
        <span key={i}>{i.toString(16).toUpperCase()}</span>
      ))}
      <span className="gu-hex__ascii">{t('rom.ascii')}</span>
    </div>
  );

  const body: ReactNode[] = [];
  for (let r = first; r < last; r++) {
    const base = r * COLUMNS;
    let ascii = '';
    const cells: ReactNode[] = [];
    for (let c = 0; c < cols && base + c < size; c++) {
      const addr = base + c;
      const w = words[addr]!;
      ascii += asciiOf(w);
      const active = addr === cursor.addr;
      const hex = toHex(w, width);
      const bad = errors.some((e) => e.index === addr);
      cells.push(
        <span
          key={c}
          role="gridcell"
          aria-selected={active}
          className={`gu-hex__cell${active ? ' gu-hex__cell--active' : ''}${w === 0 ? ' gu-hex__cell--zero' : ''}${bad ? ' gu-hex__cell--bad' : ''}`}
          onPointerDown={(e) => {
            e.preventDefault();
            setCursor({ addr, nibble: 0 });
            scroller.current?.focus();
          }}
        >
          {active && editable ? (
            <>
              {hex.slice(0, cursor.nibble)}
              <span className="gu-hex__nib">{hex[cursor.nibble]}</span>
              {hex.slice(cursor.nibble + 1)}
            </>
          ) : (
            hex
          )}
        </span>,
      );
    }
    body.push(
      <div key={r} role="row" className="gu-hex__row" style={{ top: r * ROW_H, gridTemplateColumns: gridCols }}>
        <span className="gu-hex__addr">{addrLabel(base, addrWidth)}</span>
        {cells}
        <span className="gu-hex__ascii">{ascii}</span>
      </div>,
    );
  }

  const title = t(mode === 'ram' ? 'rom.ramTitle' : 'rom.title', { name });
  const footer =
    mode === 'rom' ? (
      <>
        <button type="button" className="gu-btn" onClick={onClose}>
          {t('rom.cancel')}
        </button>
        <button type="button" className="gu-btn gu-btn--primary" onClick={save}>
          {t('rom.save')}
        </button>
      </>
    ) : (
      <button type="button" className="gu-btn" onClick={onClose}>
        {t('rom.close')}
      </button>
    );

  return (
    <Dialog title={title} onClose={onClose} size="lg" footer={footer}>
      <div className="gu-hex">
        <div className="gu-hex__bar">
          <span className="gu-muted">{t('rom.size', { words: size, width })}</span>
          <span className="gu-hex__spacer" />
          {editable && (
            <>
              <button type="button" className="gu-btn gu-btn--sm" onClick={() => fileInput.current?.click()}>
                {t('rom.import')}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".hex,.bin,.txt,.ihex"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importFile(f);
                  e.target.value = '';
                }}
              />
            </>
          )}
          <button type="button" className="gu-btn gu-btn--sm" onClick={() => download(new Blob([dataFromWords(words, width) + '\n'], { type: 'text/plain' }), 'hex')}>
            {t('rom.exportHex')}
          </button>
          <button
            type="button"
            className="gu-btn gu-btn--sm"
            onClick={() => download(new Blob([wordsToBytes(words, width) as BlobPart], { type: 'application/octet-stream' }), 'bin')}
          >
            {t('rom.exportBin')}
          </button>
          {editable && (
            <button
              type="button"
              className="gu-btn gu-btn--sm"
              onClick={() => {
                setWords(new Uint32Array(size));
                setErrors([]);
              }}
            >
              {t('rom.clear')}
            </button>
          )}
        </div>
        <p className="gu-hex__help">{mode === 'ram' ? t('rom.ramHelp') : t('rom.help')}</p>
        {mode === 'ram' && ramEmpty ? (
          <p className="gu-hex__empty">{t('rom.ramEmpty')}</p>
        ) : (
          <div className="gu-hex__frame">
            {header}
            <div
              ref={scroller}
              className="gu-hex__scroll"
              role="grid"
              aria-label={t('rom.grid')}
              aria-readonly={!editable}
              tabIndex={0}
              data-autofocus
              style={{ height: Math.min(rows, VIEW_ROWS) * ROW_H + 2 }}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            >
              <div className="gu-hex__inner" style={{ height: rows * ROW_H }}>
                {body}
              </div>
            </div>
          </div>
        )}
        {(errors.length > 0 || note) && (
          <ul className="gu-hex__errors" aria-live="polite">
            {note && <li className="gu-hex__note">{note}</li>}
            {errors.slice(0, MAX_ERRORS).map((e) => (
              <li key={`${e.index}:${e.token}`}>
                {t(e.reason === 'invalid' ? 'rom.errInvalid' : 'rom.errOverflow', {
                  addr: `0x${addrLabel(e.index, addrWidth)}`,
                  token: e.token,
                  width,
                })}
              </li>
            ))}
            {errors.length > MAX_ERRORS && <li>{t('rom.errMore', { n: errors.length - MAX_ERRORS })}</li>}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
