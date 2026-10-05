import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { rv, useRvDebug } from '../../sim/client';
import { keyText, sinceClear } from './rv';

/**
 * Console (DEV-03): what the program printed to the UART, and input for the
 * UART receiver and keyboard device. With the output focused, each keystroke
 * is sent as it is typed; the line below sends a whole line on Enter.
 */
export function ConsolePanel() {
  const uart = useEditor((s) => s.rv?.uart ?? '');
  const loads = useRvDebug((s) => s.loads);
  // What the buffer held at Clear; a reload empties the buffer, so the clear point is per load.
  const [clearedAt, setClearedAt] = useState({ loads, text: '' });
  const cleared = clearedAt.loads === loads ? clearedAt.text : '';
  const [line, setLine] = useState('');
  const outRef = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const text = sinceClear(uart, cleared);

  useLayoutEffect(() => {
    const el = outRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [text]);

  const onScroll = () => {
    const el = outRef.current;
    if (el) stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
  };

  const onKey = (e: KeyboardEvent<HTMLPreElement>) => {
    if (e.key === 'Escape') {
      e.currentTarget.blur();
      return;
    }
    // F-keys keep driving the debugger.
    if (/^F\d+$/.test(e.key)) return;
    const s = keyText(e);
    if (s === null) return;
    e.preventDefault();
    e.stopPropagation();
    void rv.input(s);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void rv.input(`${line}\n`);
    setLine('');
  };

  return (
    <div className="dk-console">
      <pre
        ref={outRef}
        className="dk-console-out"
        tabIndex={0}
        role="log"
        aria-live="polite"
        aria-label={t('panels.rv.console.output')}
        aria-description={t('panels.rv.console.focusHelp')}
        onScroll={onScroll}
        onKeyDown={onKey}
      >
        {text || <span className="dk-console-empty">{t('panels.rv.console.empty')}</span>}
        <span className="dk-console-cursor" aria-hidden="true" />
      </pre>
      <form className="dk-console-in" onSubmit={onSubmit}>
        <span className="dk-console-prompt" aria-hidden="true">
          &gt;
        </span>
        <input
          className="dk-input"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          placeholder={t('panels.rv.console.placeholder')}
          aria-label={t('panels.rv.console.input')}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="dk-btn">
          {t('panels.rv.console.send')}
        </button>
        <button
          type="button"
          className="dk-btn"
          onClick={() => {
            setClearedAt({ loads, text: uart });
            stick.current = true;
          }}
        >
          {t('panels.rv.console.clear')}
        </button>
      </form>
    </div>
  );
}
