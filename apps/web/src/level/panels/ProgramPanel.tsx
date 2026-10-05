import { useMemo, useRef, useState } from 'react';
import type { Part } from '@build-a-computer/schema';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { capacityOf, widthOf } from './memory';
import { shortPart } from './names';
import { asmText, bytesToData, dataToBytes, hex, mnemonicAt, parseProgram, programText, type CodeMode } from './romCode';

/** The ROM to edit: the selected one, else the only ROM on the board. */
function useTargetRom(): Part | undefined {
  const board = useEditor((s) => s.board);
  const selection = useEditor((s) => s.selection);
  return useMemo(() => {
    const roms = board.parts.filter((p) => p.type === 'rom');
    const sel = roms.find((p) => selection.includes(p.id));
    return sel ?? (roms.length === 1 ? roms[0] : undefined);
  }, [board, selection]);
}

/** Write `data` into a ROM as one undoable step. */
export function writeRom(partId: string, data: string): void {
  useEditor.getState().commit((b) => ({
    ...b,
    parts: b.parts.map((p) => (p.id === partId ? { ...p, props: { ...p.props, data } } : p)),
  }));
}

/** Machine-code editor (TOY-02): hex bytes or Toy-8 assembly, with a mnemonic preview and inline errors. */
export function ProgramPanel() {
  const rom = useTargetRom();
  if (!rom) return <p className="dk-empty">{t('panels.code.noRom')}</p>;
  return <RomEditor key={rom.id} rom={rom} />;
}

function RomEditor({ rom }: { rom: Part }) {
  const readOnly = useEditor((s) => s.readOnly);
  const width = widthOf(rom);
  const capacity = capacityOf(rom);
  const data = rom.props?.data ?? '';
  const [mode, setMode] = useState<CodeMode>('hex');
  const [text, setText] = useState(() => programText(dataToBytes(data), width));
  const [dirty, setDirty] = useState(false);

  // Follow the ROM when it changes elsewhere (undo, properties panel) and nothing is being edited.
  const [seenData, setSeenData] = useState(data);
  if (data !== seenData) {
    setSeenData(data);
    if (!dirty) setText(programText(dataToBytes(data), width));
  }

  const parsed = useMemo(() => parseProgram(text, mode, width, capacity), [text, mode, width, capacity]);
  const newData = bytesToData(parsed.bytes, width);
  const same = newData === bytesToData(dataToBytes(data), width);
  const canWrite = !readOnly && parsed.errors === 0 && !same;

  /** Switching format rewrites the text when the program converts exactly; otherwise the text stays. */
  const switchMode = (next: CodeMode) => {
    if (next === mode) return;
    setMode(next);
    if (parsed.errors) return;
    const converted = next === 'asm' ? asmText(parsed.bytes, width) : programText(parsed.bytes, width);
    if (converted !== null && bytesToData(parseProgram(converted, next, width, capacity).bytes, width) === newData) setText(converted);
  };

  const gutter = useRef<HTMLDivElement>(null);
  const write = () => {
    if (!canWrite) return;
    writeRom(rom.id, newData);
    setDirty(false);
  };
  const revert = () => {
    setText(programText(dataToBytes(data), width));
    setDirty(false);
  };

  const digits = Math.max(2, Math.ceil(Math.log2(Math.max(2, capacity)) / 4));
  return (
    <div className="dk-code">
      <div className="dk-toolbar" role="toolbar" aria-label={t('panels.code.tools')}>
        <span className="dk-title">{t('panels.code.editing', { name: shortPart(rom) })}</span>
        <div className="dk-seg" role="radiogroup" aria-label={t('panels.code.mode')}>
          {(['hex', 'asm'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={`dk-seg-btn ${mode === m ? 'is-active' : ''}`} onClick={() => switchMode(m)}>
              {t(`panels.code.mode.${m}`)}
            </button>
          ))}
        </div>
        <span className="dk-spacer" />
        <span className={`dk-readout ${parsed.errors ? 'is-error' : ''}`} aria-live="polite">
          {parsed.errors ? t('panels.code.errors', { n: parsed.errors }) : t('panels.code.size', { n: parsed.bytes.length, cap: capacity })}
        </span>
        <button type="button" className="dk-btn" disabled={!dirty} onClick={revert}>
          {t('panels.code.revert')}
        </button>
        <button type="button" className="dk-btn primary" disabled={!canWrite} onClick={write} title={readOnly ? t('panels.code.readOnly') : `${t('panels.code.write')} — Ctrl+S`}>
          {t('panels.code.write')}
        </button>
      </div>
      <div className="dk-code-body">
        <textarea
          className="dk-code-text"
          value={text}
          spellCheck={false}
          aria-label={t('panels.code.source')}
          aria-invalid={parsed.errors > 0}
          placeholder={mode === 'hex' ? t('panels.code.placeholderHex') : t('panels.code.placeholderAsm')}
          readOnly={readOnly}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
              e.preventDefault();
              write();
            }
            // Keep editor shortcuts (delete, undo on the board) out of the text field.
            e.stopPropagation();
          }}
        />
        <div className="dk-code-preview" ref={gutter} aria-label={t('panels.code.preview')}>
          {parsed.lines.map((l) => (
            <div key={l.line} className={`dk-code-line ${l.error ? 'is-error' : ''}`}>
              {l.error ? (
                <span className="dk-code-err" role="note">
                  {t('panels.code.lineError', { line: l.line + 1, msg: l.error })}
                </span>
              ) : l.bytes.length ? (
                <>
                  <span className="dk-code-addr">{hex(l.addr, digits)}</span>
                  <span className="dk-code-bytes">{l.bytes.map((b) => hex(b, Math.ceil(width / 4))).join(' ')}</span>
                  <span className="dk-code-mn">{width === 8 ? mnemonicAt(parsed.bytes, l.addr) : ''}</span>
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
