/**
 * Every interface string goes through t() from day one, even while only
 * English ships. Each UI area owns its own dictionary file in ./en/ so
 * parallel work never edits the same file.
 */
import { app } from './en/app';
import { editor } from './en/editor';
import { ui } from './en/ui';
import { level } from './en/level';
import { panels } from './en/panels';
import { chips } from './en/chips';
import { storage } from './en/storage';
import { code } from './en/code';
import { community } from './en/community';
import { pwa } from './en/pwa';
import { ml } from './en/ml';
import { debug } from './en/debug';
import { achievements } from './en/achievements';
import { cases } from './en/cases';

const en: Record<string, string> = { ...app, ...editor, ...ui, ...level, ...chips, ...panels, ...storage, ...code, ...ml, ...pwa, ...community, ...achievements, ...debug, ...cases };

/** Locales load from here once translations exist. */
const locales: Record<string, Record<string, string>> = { en };
let current = 'en';

export function setLocale(locale: string): void {
  if (locales[locale]) current = locale;
}

/** Look up a key; `{name}` placeholders are filled from `vars`. Missing keys show the key itself. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const s = locales[current]?.[key] ?? en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : s;
}
