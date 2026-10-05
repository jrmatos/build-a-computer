/**
 * The read-only "API" tab: the modules a Track 2 level unlocks, data-driven.
 * Each module's section comes from docs/js-levels.md (written alongside the
 * sandbox) when that file exists: any heading that names the module in
 * backticks or as its first word starts its section. Modules the doc does not
 * cover fall back to a one-line summary here.
 */
import type { JsModule, Level } from '@build-a-computer/schema';
import { t } from '../i18n';

/** One-line fallbacks, used only when docs/js-levels.md has no section for a module. */
const FALLBACK: Record<JsModule, string> = {
  tensor: 'n-dimensional arrays of numbers: create, reshape, index, broadcast and multiply them.',
  autograd: 'Reverse-mode automatic differentiation: build an expression, run backward, read the gradients.',
  nn: 'Layers, activations and losses built on tensors.',
  optim: 'Optimizers that update parameters from their gradients.',
  data: "The level's datasets by id, split and batched.",
  tokenizer: 'Turn text into token ids and back.',
  plot: 'Draw quick charts from your code.',
};

/** Always-available globals the sandbox gives training code. */
const GLOBALS = `Globals (no import needed)
  report({ loss, acc, … })   add a point to the training curves (step counts up, or pass step)
  checkpoint(state)          save JSON-safe training state; Resume passes it back
  console.log(…)             print to the Run panel's console`;

/** Split a markdown document into sections by module name. Exported for tests. */
export function sectionsByModule(markdown: string, modules: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = markdown.split(/\r?\n/);
  let current: string | null = null;
  let level = 0;
  let buf: string[] = [];
  const flush = () => {
    if (current && buf.length) out[current] = (out[current] ? `${out[current]}\n\n` : '') + buf.join('\n').trim();
    buf = [];
  };
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const depth = h[1]!.length;
      const text = h[2]!;
      const named = modules.find((m) => text.includes(`\`${m}\``) || text.includes(`'${m}'`) || new RegExp(`^${m}\\b`, 'i').test(text));
      if (named) {
        flush();
        current = named;
        level = depth;
        buf.push(line);
        continue;
      }
      // A heading at the same or a higher level ends the module's section.
      if (current && depth <= level) {
        flush();
        current = null;
      }
    }
    if (current) buf.push(line);
  }
  flush();
  return out;
}

/** The reference text for `modules`, from `markdown` sections where present, else the fallbacks. */
export function referenceText(level: Pick<Level, 'js'> | null, markdown: string | null): string {
  const modules = level?.js?.modules ?? [];
  const datasets = level?.js?.datasets ?? [];
  const parts: string[] = [`// ${t('ml.apiHeader')}`, ''];
  if (!modules.length) parts.push(t('ml.apiNone'), '');
  const sections = markdown ? sectionsByModule(markdown, modules) : {};
  for (const m of modules) {
    parts.push(sections[m] ?? `import { … } from '${m}';\n  ${FALLBACK[m]}`, '');
  }
  if (datasets.length) parts.push(t('ml.apiDatasets', { list: datasets.join(', ') }), '');
  parts.push(GLOBALS, '');
  return parts.join('\n');
}

// Vite resolves this at build time; an absent file gives an empty map (no build error).
const docs = import.meta.glob<string>('../../../../docs/js-levels.md', { query: '?raw', import: 'default' });

/** docs/js-levels.md as text, or null when it does not exist yet. */
export async function loadJsDocs(): Promise<string | null> {
  const load = Object.values(docs)[0];
  if (!load) return null;
  try {
    return await load();
  } catch {
    return null;
  }
}
