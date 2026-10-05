/**
 * "Create level…" (COM-02): turns the sandbox board into a community level.
 * Export stays disabled until Check passes: the board (the reference
 * solution) passes every test and the empty starter fails at least one.
 */
import { useMemo, useState } from 'react';
import type { TruthRow } from '@build-a-computer/schema';
import { rootBoard } from '../editor/chips';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { download } from '../storage/controller';
import { emitAchievement } from '../achievements/events';
import { Dialog } from '../ui/Dialog';
import { checkLevel, checkWorker, probeRows, type LevelCheck } from './checker';
import { buildLevel, buildPack, defaultPalette, draftProblems, inputVectors, PALETTE_CHOICES, portsOf, referenceBoard, type LevelDraft } from './editor';
import { toInstalled } from './packs';
import { installPack } from './registry';
import { useCommunityUi } from './ui';

type CheckState = { status: 'idle' } | { status: 'running' } | { status: 'done'; check: LevelCheck; key: string } | { status: 'error'; message: string };

export function LevelEditor() {
  // The board is captured when the editor opens; the dialog covers the canvas.
  const [board] = useState(() => rootBoard());
  const chips = useEditor((s) => s.chips);
  const ports = useMemo(() => portsOf(board), [board]);
  const [draft, setDraft] = useState<LevelDraft>(() => {
    const io = [...ports.inputs, ...ports.outputs].map((p) => p.id);
    return {
      title: '',
      goal: '',
      hints: [],
      afterword: '',
      palette: defaultPalette(board, io),
      inputs: ports.inputs.map((p) => p.id),
      outputs: ports.outputs.map((p) => p.id),
      rows: [],
      packName: '',
      author: '',
      description: '',
    };
  });
  const [hintsText, setHintsText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [check, setCheck] = useState<CheckState>({ status: 'idle' });
  const close = () => useCommunityUi.getState().set({ editorOpen: false });
  const toast = useEditor.getState().toast;

  const full: LevelDraft = { ...draft, hints: hintsText.split('\n') };
  const problems = draftProblems(full, board);
  const key = JSON.stringify(full);
  const passed = check.status === 'done' && check.check.ok && check.key === key;
  const patch = (p: Partial<LevelDraft>) => setDraft((d) => ({ ...d, ...p }));

  const inPorts = ports.inputs.filter((p) => draft.inputs.includes(p.id));
  const outPorts = ports.outputs.filter((p) => draft.outputs.includes(p.id));

  const generate = async () => {
    setGenerating(true);
    try {
      const { host, wrap } = await checkWorker();
      const rows = await probeRows(host, board, chips, inputVectors(inPorts), outPorts.map((p) => p.label), wrap);
      const good = rows.filter((r): r is TruthRow => r !== null);
      setSkipped(rows.length - good.length);
      patch({ rows: good });
    } catch (e) {
      console.error(e);
      toast(t('community.editor.generateFailed'), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const runCheck = async () => {
    setCheck({ status: 'running' });
    try {
      const level = buildLevel(full, board);
      const { host, wrap } = await checkWorker();
      const c = await checkLevel(host, level, { board: referenceBoard(board, [...full.inputs, ...full.outputs]) }, chips, wrap);
      setCheck({ status: 'done', check: c, key });
    } catch (e) {
      console.error(e);
      setCheck({ status: 'error', message: e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e) });
    }
  };

  const pack = () => {
    const level = buildLevel(full, board);
    return buildPack(full, level, board, chips);
  };

  const exportPack = async () => {
    const p = pack();
    const name = `build-a-computer-pack-${p.slug ?? 'pack'}.json`;
    try {
      await download.save(JSON.stringify(p, null, 2), name);
      toast(t('community.editor.exported', { file: name }), 'success');
      emitAchievement({ type: 'pack-exported' });
    } catch (e) {
      console.error(e);
    }
  };

  const playHere = async () => {
    const p = pack();
    if (check.status !== 'done') return;
    const level = p.levels[0]!;
    const installed = toInstalled(p, { slug: p.slug!, name: p.name, levels: [{ id: level.id, installId: '', title: level.title, ok: true, problems: [] }] });
    await installPack(installed);
    toast(t('community.pack.installed', { n: 1, name: p.name }), 'success');
    close();
    useEditor.getState().set({ levelsOpen: true });
  };

  const setExpect = (ri: number, label: string, value: string) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) return;
    patch({ rows: draft.rows.map((r, i) => (i === ri ? { ...r, expect: { ...r.expect, [label]: n } } : r)) });
  };

  const toggle = (list: 'inputs' | 'outputs', id: string) =>
    patch({ [list]: draft[list].includes(id) ? draft[list].filter((x) => x !== id) : [...draft[list], id], rows: [] } as Partial<LevelDraft>);

  return (
    <Dialog
      title={t('community.editor.title')}
      size="lg"
      onClose={close}
      footer={
        <>
          <span className="cm-foot-status" role="status">
            {check.status === 'running' && t('community.editor.checking')}
            {check.status === 'error' && <span className="cm-bad">{check.message}</span>}
            {check.status === 'done' && check.key !== key && t('community.editor.stale')}
            {check.status === 'done' && check.key === key && (check.check.ok ? <span className="cm-good">{t('community.editor.passed')}</span> : <span className="cm-bad">{check.check.problem}</span>)}
          </span>
          <button type="button" className="gu-btn" onClick={close}>
            {t('confirm.cancel')}
          </button>
          <button type="button" className="gu-btn" disabled={problems.length > 0 || check.status === 'running'} onClick={() => void runCheck()} title={problems.length ? t('community.editor.fixFirst', { list: problems.map((p) => t(`community.editor.need.${p}`)).join(', ') }) : undefined}>
            {t('community.editor.check')}
          </button>
          <button type="button" className="gu-btn" disabled={!passed} onClick={() => void playHere()}>
            {t('community.editor.play')}
          </button>
          <button type="button" className="gu-btn gu-btn--primary" disabled={!passed} onClick={() => void exportPack()} title={passed ? undefined : t('community.editor.exportNeedsCheck')}>
            {t('community.editor.export')}
          </button>
        </>
      }
    >
      <div className="cm-editor">
        <p className="cm-muted">{t('community.editor.intro')}</p>

        <section>
          <h3>{t('community.editor.io')}</h3>
          {ports.inputs.length + ports.outputs.length === 0 && <p className="cm-bad">{t('community.editor.noPorts')}</p>}
          {ports.unlabeled > 0 && <p className="cm-muted">{t('community.editor.unlabeled', { n: ports.unlabeled })}</p>}
          {ports.duplicates.length > 0 && <p className="cm-bad">{t('community.editor.duplicates', { list: ports.duplicates.join(', ') })}</p>}
          <div className="cm-cols">
            <fieldset>
              <legend>{t('community.editor.inputs')}</legend>
              {ports.inputs.map((p) => (
                <label key={p.id} className="cm-check">
                  <input type="checkbox" checked={draft.inputs.includes(p.id)} onChange={() => toggle('inputs', p.id)} />
                  {p.label} {p.width > 1 && <small>{t('community.editor.bits', { n: p.width })}</small>}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>{t('community.editor.outputs')}</legend>
              {ports.outputs.map((p) => (
                <label key={p.id} className="cm-check">
                  <input type="checkbox" checked={draft.outputs.includes(p.id)} onChange={() => toggle('outputs', p.id)} />
                  {p.label} {p.width > 1 && <small>{t('community.editor.bits', { n: p.width })}</small>}
                </label>
              ))}
            </fieldset>
          </div>
        </section>

        <section className="cm-grid2">
          <label className="gu-field">
            <span>{t('community.editor.levelTitle')}</span>
            <input className="gu-input" maxLength={80} value={draft.title} onChange={(e) => patch({ title: e.target.value })} data-autofocus />
          </label>
          <label className="gu-field">
            <span>{t('community.editor.packName')}</span>
            <input className="gu-input" maxLength={80} value={draft.packName} onChange={(e) => patch({ packName: e.target.value })} />
          </label>
          <label className="gu-field cm-span2">
            <span>{t('community.editor.goal')}</span>
            <textarea className="gu-input cm-textarea" maxLength={600} value={draft.goal} onChange={(e) => patch({ goal: e.target.value })} />
          </label>
          <label className="gu-field cm-span2">
            <span>{t('community.editor.hints')}</span>
            <textarea className="gu-input cm-textarea" value={hintsText} onChange={(e) => setHintsText(e.target.value)} />
          </label>
          <label className="gu-field">
            <span>{t('community.editor.author')}</span>
            <input className="gu-input" maxLength={80} value={draft.author} onChange={(e) => patch({ author: e.target.value })} />
          </label>
          <label className="gu-field">
            <span>{t('community.editor.afterword')}</span>
            <input className="gu-input" maxLength={4000} value={draft.afterword} onChange={(e) => patch({ afterword: e.target.value })} />
          </label>
        </section>

        <section>
          <h3>{t('community.editor.palette')}</h3>
          <div className="cm-palette">
            {PALETTE_CHOICES.map((p) => (
              <label key={p} className="cm-check">
                <input
                  type="checkbox"
                  checked={draft.palette.includes(p)}
                  onChange={() => patch({ palette: draft.palette.includes(p) ? draft.palette.filter((x) => x !== p) : PALETTE_CHOICES.filter((x) => x === p || draft.palette.includes(x)) })}
                />
                {t(`part.${p}`)}
              </label>
            ))}
          </div>
        </section>

        <section>
          <div className="cm-row">
            <h3>{t('community.editor.tests')}</h3>
            <button type="button" className="gu-btn" disabled={generating || !inPorts.length || !outPorts.length} onClick={() => void generate()}>
              {generating ? t('community.editor.generating') : t('community.editor.generate')}
            </button>
          </div>
          {skipped > 0 && <p className="cm-bad">{t('community.editor.skipped', { n: skipped })}</p>}
          {draft.rows.length === 0 ? (
            <p className="cm-muted">{t('community.editor.noRows')}</p>
          ) : (
            <div className="cm-table-wrap">
              <table className="cm-table">
                <thead>
                  <tr>
                    {inPorts.map((p) => (
                      <th key={p.id}>{p.label}</th>
                    ))}
                    {outPorts.map((p) => (
                      <th key={p.id} className="is-out">
                        {p.label}
                      </th>
                    ))}
                    <th>
                      <span className="visually-hidden">{t('community.editor.remove')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {draft.rows.map((r, ri) => (
                    <tr key={ri}>
                      {inPorts.map((p) => (
                        <td key={p.id}>{r.inputs[p.label]}</td>
                      ))}
                      {outPorts.map((p) => (
                        <td key={p.id} className="is-out">
                          <input
                            className="cm-cell"
                            inputMode="numeric"
                            aria-label={t('community.editor.expectLabel', { out: p.label, row: ri + 1 })}
                            value={r.expect[p.label] ?? ''}
                            onChange={(e) => setExpect(ri, p.label, e.target.value)}
                          />
                        </td>
                      ))}
                      <td>
                        <button type="button" className="cm-x" aria-label={t('community.editor.removeRow', { row: ri + 1 })} onClick={() => patch({ rows: draft.rows.filter((_, i) => i !== ri) })}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Dialog>
  );
}
