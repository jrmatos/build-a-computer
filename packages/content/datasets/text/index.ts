// A wildcard module declaration must live in a script file, so it is referenced, not imported.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./raw.d.ts" />
/**
 * Public-domain texts for the Track 2 language-model levels (phases 4 to 7),
 * provided through the 'data' module as one string each. Both come from
 * Project Gutenberg, with the Gutenberg header and footer removed (their
 * terms for redistributing a public-domain text without the trademark) and
 * normalized to ASCII (curly quotes to ' and ", the dash to --, æ to ae,
 * LF line ends, runs of blank lines collapsed). Sources and licenses:
 * LICENSES.md. The texts are bundled with this module (about 200 KB), which
 * the app loads only when a level asks for a dataset.
 */
import macbeth from './macbeth.txt?raw';
import sonnets from './sonnets.txt?raw';

/** Same shape as DatasetEntry in ../index.ts (kept local to avoid an import cycle). */
interface TextDataset {
  meta: { id: string; title: string; license: string; source: string; sizeBytes: number };
  load: () => string;
}

export const TEXT_DATASETS: Record<string, TextDataset> = {
  'text-macbeth': {
    meta: {
      id: 'text-macbeth',
      title: 'Macbeth, by William Shakespeare (Project Gutenberg eBook #1533)',
      license: 'Public domain in the USA',
      source: 'https://www.gutenberg.org/ebooks/1533',
      sizeBytes: 104_581,
    },
    load: () => macbeth,
  },
  'text-sonnets': {
    meta: {
      id: 'text-sonnets',
      title: "Shakespeare's Sonnets, by William Shakespeare (Project Gutenberg eBook #1041)",
      license: 'Public domain in the USA',
      source: 'https://www.gutenberg.org/ebooks/1041',
      sizeBytes: 96_210,
    },
    load: () => sonnets,
  },
};
