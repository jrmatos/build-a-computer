import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { t } from '../i18n';
import { IconClose } from './icons';
import './ui.css';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Keep Tab inside `root`, close on Escape, and restore focus on unmount. */
export function useFocusTrap(root: RefObject<HTMLElement | null>, onClose: () => void, active = true): void {
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!active) return;
    const el = root.current;
    if (!el) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el;
    first.focus();
    const onKey = (e: KeyboardEvent) => {
      // Board shortcuts must not fire behind a modal.
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const a = items[0]!;
      const z = items[items.length - 1]!;
      const inside = items.includes(document.activeElement as HTMLElement);
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? z : a).focus();
      } else if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [root, active]);
}

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'lg';
  closeLabel?: string;
}

/** Centered modal island with a backdrop, Excalidraw style. */
export function Dialog({ title, onClose, children, footer, size = 'sm', closeLabel }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, onClose);
  return (
    <div className="gu-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`island gu-dialog gu-dialog--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="gu-dialog__head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="gu-icon-btn" aria-label={closeLabel ?? t('dialog.close')} onClick={onClose}>
            <IconClose size={18} />
          </button>
        </header>
        <div className="gu-dialog__body">{children}</div>
        {footer && <footer className="gu-dialog__foot">{footer}</footer>}
      </div>
    </div>
  );
}
