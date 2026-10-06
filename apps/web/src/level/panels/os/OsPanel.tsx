import { useState } from 'react';
import { useEditor } from '../../../editor/store';
import { t } from '../../../i18n';
import { FilesView } from './FilesView';
import { FramesView } from './FramesView';
import { ProcessesView } from './ProcessesView';
import { SpaceView } from './SpaceView';
import { useKernelModel, useKernelSnapshot } from './useKernel';
import './os.css';

type View = 'procs' | 'vm' | 'frames' | 'fs';
const VIEW_KEY = 'build-a-computer:os-view';

function loadView(): View {
  try {
    const v = globalThis.localStorage?.getItem(VIEW_KEY);
    return v === 'vm' || v === 'frames' || v === 'fs' ? v : 'procs';
  } catch {
    return 'procs';
  }
}

/**
 * OS-05: the Phase 9 kernel, live. Processes (the process table and each
 * one's trap frame), page tables (mappings, translate, faults), physical
 * memory (frames by owner, the free list) and the file system on the disk.
 */
export function OsPanel() {
  const loaded = useEditor((s) => !!s.rv);
  const { model, info } = useKernelModel();
  const snap = useKernelSnapshot(model);
  const [view, setViewState] = useState<View>(loadView);
  /** Slot of the process the player picked (the current one when null). */
  const [picked, setPicked] = useState<number | null>(null);
  const setView = (v: View) => {
    setViewState(v);
    try {
      globalThis.localStorage?.setItem(VIEW_KEY, v);
    } catch {
      /* storage blocked */
    }
  };

  if (!loaded) return <p className="dk-empty">{t('panels.rv.notLoaded')}</p>;
  if (info === undefined) return <p className="dk-empty">{t('os.loading')}</p>;
  if (!model) return <p className="dk-empty">{t('os.noKernel')}</p>;

  const views: View[] = ['procs', ...(model.vm ? (['vm', 'frames'] as const) : []), ...(model.fs ? (['fs'] as const) : [])];
  const shown = views.includes(view) ? view : 'procs';
  const selected = picked !== null && snap?.procs[picked]?.state ? picked : null;

  return (
    <div className="os">
      <div className="dk-toolbar">
        <div className="dk-seg" role="tablist" aria-label={t('os.views')}>
          {views.map((v) => (
            <button key={v} type="button" role="tab" aria-selected={shown === v} className={`dk-seg-btn ${shown === v ? 'is-active' : ''}`} onClick={() => setView(v)}>
              {t(`os.view.${v}`)}
            </button>
          ))}
        </div>
        <span className="dk-spacer" />
        {snap?.ticks !== undefined && <span className="dk-readout">{t('os.ticks', { n: snap.ticks })}</span>}
        {snap?.nfree !== undefined && <span className="dk-readout">{t('os.freePages', { n: snap.nfree })}</span>}
      </div>
      <div className="os-body">
        {shown === 'procs' && <ProcessesView model={model} snap={snap} selected={selected} onSelect={setPicked} />}
        {shown === 'vm' && <SpaceView model={model} snap={snap} selected={selected} onSelect={setPicked} />}
        {shown === 'frames' && <FramesView model={model} snap={snap} selected={selected} onSelect={setPicked} />}
        {shown === 'fs' && <FilesView model={model} snap={snap} />}
      </div>
    </div>
  );
}
