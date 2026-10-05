import type { KeyboardEvent } from 'react';

const ITEM = '[role="menuitem"]:not([aria-disabled="true"]),[role="menuitemcheckbox"]:not([aria-disabled="true"])';

/** Roving focus for role=menu lists: arrows, Home and End move between enabled items. */
export function onMenuKeyDown(e: KeyboardEvent<HTMLElement>): void {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEM)];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  let next: number;
  if (e.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % items.length;
  else if (e.key === 'ArrowUp') next = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  else return;
  // Keep arrows from also nudging the selection on the board.
  e.preventDefault();
  e.stopPropagation();
  items[next]?.focus();
}

export function focusFirstItem(root: HTMLElement | null): void {
  root?.querySelector<HTMLElement>(ITEM)?.focus();
}
