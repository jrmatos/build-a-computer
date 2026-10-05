/**
 * Import of level pack files (COM-03), reached through the normal Import
 * command: parse with the E-DATA-03 limits, content-check every level in the
 * check worker, then let the player install the levels that passed.
 */
import { LEVELS } from '@build-a-computer/content';
import { NewerVersionError, parsePackFile } from '@build-a-computer/schema';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { checkWorker } from './checker';
import { toInstalled, validatePack } from './packs';
import { installPack } from './registry';
import { useCommunityUi, type PackImport } from './ui';

const ui = () => useCommunityUi.getState();

/** Handle an imported file whose kind is a pack. */
export async function importPackText(text: string, fileName: string): Promise<void> {
  let pack;
  try {
    pack = parsePackFile(text);
  } catch (e) {
    console.error(e);
    const msg = e instanceof NewerVersionError ? e.message : t('community.pack.invalid', { reason: e instanceof Error ? (e.message.split('\n')[0] ?? '') : '' });
    useEditor.getState().toast(msg, 'error');
    return;
  }
  const state: PackImport = { fileName, pack, report: null, progress: { done: 0, total: pack.levels.length } };
  ui().set({ packImport: state });
  const still = () => ui().packImport?.pack === pack;
  try {
    const { host, wrap } = await checkWorker();
    const builtin = new Set(LEVELS.map((l) => l.id));
    const report = await validatePack(pack, host, builtin, {
      wrap,
      onProgress: (done, total) => {
        if (still()) ui().set({ packImport: { ...ui().packImport!, progress: { done, total } } });
      },
    });
    if (still()) ui().set({ packImport: { ...ui().packImport!, report } });
  } catch (e) {
    console.error(e);
    if (still()) ui().set({ packImport: { ...ui().packImport!, error: e instanceof Error ? e.message : String(e) } });
  }
}

/** Install the levels that passed and open the level map on them. */
export async function confirmPackImport(): Promise<void> {
  const p = ui().packImport;
  if (!p?.report) return;
  const installed = toInstalled(p.pack, p.report);
  ui().set({ packImport: null });
  if (!installed.levels.length) return;
  await installPack(installed);
  const st = useEditor.getState();
  st.toast(t('community.pack.installed', { n: installed.levels.length, name: installed.name }), 'success');
  st.set({ levelsOpen: true });
}

export const cancelPackImport = (): void => ui().set({ packImport: null });
