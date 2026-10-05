/**
 * First-level JavaScript, gzipped: the entry chunk, every chunk it imports
 * statically (recursively), and the worker scripts it starts (listed as JS
 * `assets` of a chunk in the Vite manifest). Lazy chunks (dynamicImports: code
 * editor, ML workspace, solutions, workbox-window) are excluded.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

interface Chunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  assets?: string[];
}

export interface SizeReport {
  totalKb: number;
  files: { file: string; gzipKb: number }[];
}

export function firstLevelJs(dist: string): SizeReport {
  const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8')) as Record<
    string,
    Chunk
  >;
  const entry = Object.keys(manifest).find((k) => manifest[k]!.isEntry && k.endsWith('index.html'));
  if (!entry) throw new Error('No index.html entry in the Vite manifest');
  const files = new Set<string>();
  const visit = (key: string): void => {
    const c = manifest[key];
    if (!c || files.has(c.file)) return;
    files.add(c.file);
    for (const a of c.assets ?? []) if (a.endsWith('.js')) files.add(a);
    for (const i of c.imports ?? []) visit(i);
  };
  visit(entry);
  const rows = [...files].map((file) => ({
    file,
    gzipKb: gzipSync(readFileSync(join(dist, file))).length / 1024,
  }));
  return { totalKb: rows.reduce((a, r) => a + r.gzipKb, 0), files: rows };
}
