/**
 * Community overlays (M14): the share dialog and shared-board banner
 * (COM-01), the pack import check (COM-03) and the level editor (COM-02).
 * Mounted once by the main menu.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { levelById } from '@build-a-computer/content';
import { rootBoard } from '../editor/chips';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { exportBoard } from '../storage/controller';
import { Dialog } from '../ui/Dialog';
import { cancelPackImport, confirmPackImport } from './packImport';
import { useCommunity } from './registry';
import { makeShareLink, sharePayload, SHARE_MAX_CHARS, type ShareLink } from './share';
import { emitAchievement } from '../achievements/events';
import { applyFork, closeShared, fork, forkTargets, startShareLinks } from './shareView';
import { useCommunityUi } from './ui';
import './community.css';

const LevelEditor = lazy(() => import('./LevelEditor').then((m) => ({ default: m.LevelEditor })));

export function CommunityLayer() {
  const shareOpen = useCommunityUi((s) => s.shareOpen);
  const editorOpen = useCommunityUi((s) => s.editorOpen);
  const shared = useCommunityUi((s) => !!s.shared);
  const pendingFork = useCommunityUi((s) => s.pendingFork);
  const packImport = useCommunityUi((s) => !!s.packImport);
  useEffect(() => startShareLinks(), []);
  return (
    <>
      {shareOpen && <ShareDialog />}
      {shared && <SharedBanner />}
      {pendingFork && (
        <Dialog
          title={t('community.fork.confirmTitle')}
          onClose={() => useCommunityUi.getState().set({ pendingFork: null })}
          footer={
            <>
              <button type="button" className="gu-btn" data-autofocus onClick={() => useCommunityUi.getState().set({ pendingFork: null })}>
                {t('confirm.cancel')}
              </button>
              <button type="button" className="gu-btn gu-btn--danger" onClick={() => applyFork(pendingFork)}>
                {t('community.fork.replace')}
              </button>
            </>
          }
        >
          <p>{t('community.fork.confirmBody', { title: useEditor.getState().level?.title ?? '' })}</p>
        </Dialog>
      )}
      {packImport && <PackImportDialog />}
      {editorOpen && (
        <Suspense fallback={null}>
          <LevelEditor />
        </Suspense>
      )}
    </>
  );
}

// ---------------------------------------------------------------- share (COM-01)

function ShareDialog() {
  const close = () => useCommunityUi.getState().set({ shareOpen: false });
  const [link, setLink] = useState<ShareLink | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const { chips, level } = useEditor.getState();
    const board = rootBoard();
    let live = true;
    void makeShareLink(sharePayload(board, chips, level?.id, level?.track === 'sandbox' ? undefined : level?.title), location.href)
      .then((l) => {
        if (l.kind === 'link') emitAchievement({ type: 'share-created' });
        if (live) setLink(l);
      })
      .catch((e: unknown) => {
        console.error(e);
        if (live) setLink({ kind: 'too-large', chars: 0 });
      });
    return () => {
      live = false;
    };
  }, []);
  const copy = async () => {
    if (link?.kind !== 'link') return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      (document.getElementById('gu-share-url') as HTMLInputElement | null)?.select();
    }
  };
  const download = () => {
    exportBoard();
    close();
  };
  return (
    <Dialog
      title={t('community.share.title')}
      onClose={close}
      footer={
        <>
          <button type="button" className="gu-btn" onClick={download}>
            {t('community.share.download')}
          </button>
          {link?.kind === 'link' && (
            <button type="button" className="gu-btn gu-btn--primary" data-autofocus onClick={() => void copy()}>
              {copied ? t('community.share.copied') : t('community.share.copy')}
            </button>
          )}
        </>
      }
    >
      <div className="cm-share">
        {!link && <p>{t('community.share.making')}</p>}
        {link?.kind === 'link' && (
          <>
            <p>{t('community.share.body')}</p>
            <input id="gu-share-url" className="gu-input" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label={t('community.share.urlLabel')} />
            <p className="cm-muted">{t('community.share.size', { kb: (link.chars / 1024).toFixed(1), max: SHARE_MAX_CHARS / 1024 })}</p>
          </>
        )}
        {link?.kind === 'too-large' && <p>{t('community.share.tooLarge', { max: SHARE_MAX_CHARS / 1024 })}</p>}
      </div>
    </Dialog>
  );
}

function SharedBanner() {
  const shared = useCommunityUi((s) => s.shared);
  const level = useEditor((s) => s.level);
  if (!shared) return null;
  const targets = forkTargets();
  const title = shared.payload.title ?? (shared.payload.levelId ? levelById(shared.payload.levelId)?.title : undefined);
  return (
    <div className="island cm-banner" role="region" aria-label={t('community.banner.label')}>
      <div className="cm-banner__text">
        <strong>{t('community.banner.title')}</strong>
        <span>{title ? t('community.banner.for', { title }) : t('community.banner.hint')}</span>
      </div>
      <div className="cm-banner__actions">
        {targets.level && (
          <button type="button" className="gu-btn gu-btn--primary" onClick={() => void fork(targets.level!.id)}>
            {t('community.banner.forkLevel', { title: targets.level.title })}
          </button>
        )}
        <button type="button" className={`gu-btn${targets.level ? '' : ' gu-btn--primary'}`} onClick={() => void fork('sandbox')}>
          {t('community.banner.forkSandbox')}
        </button>
        <button type="button" className="gu-btn" onClick={closeShared} title={level ? t('community.banner.closeTitle', { title: level.title }) : undefined}>
          {t('community.banner.close')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- packs (COM-03)

function PackImportDialog() {
  const p = useCommunityUi((s) => s.packImport);
  const installed = useCommunity((s) => s.packs);
  if (!p) return null;
  const ok = p.report?.levels.filter((l) => l.ok).length ?? 0;
  const replaces = p.report && installed.some((x) => x.slug === p.report!.slug);
  return (
    <Dialog
      title={t('community.pack.title', { file: p.fileName })}
      size="lg"
      onClose={cancelPackImport}
      footer={
        <>
          <button type="button" className="gu-btn" onClick={cancelPackImport}>
            {t('confirm.cancel')}
          </button>
          <button type="button" className="gu-btn gu-btn--primary" disabled={!p.report || ok === 0} data-autofocus onClick={() => void confirmPackImport()}>
            {t('community.pack.install', { n: ok })}
          </button>
        </>
      }
    >
      <div className="cm-pack">
        <p>
          <strong>{p.pack.name}</strong>
          {p.pack.author ? ` · ${t('community.pack.by', { author: p.pack.author })}` : ''}
        </p>
        {p.pack.description && <p className="cm-muted">{p.pack.description}</p>}
        <p className="cm-muted">{t('community.pack.rule')}</p>
        {!p.report && !p.error && (
          <p role="status">
            <span className="lv-spinner" aria-hidden="true" /> {t('community.pack.checking', { done: p.progress.done, total: p.progress.total })}
          </p>
        )}
        {p.error && <p className="cm-bad">{t('community.pack.checkFailed', { reason: p.error })}</p>}
        {p.report && (
          <ul className="cm-pack__list">
            {p.report.levels.map((l) => (
              <li key={l.id} className={l.ok ? 'is-ok' : 'is-bad'}>
                <span className="cm-pack__mark" aria-hidden="true">
                  {l.ok ? '✓' : '✗'}
                </span>
                <span>
                  <strong>{l.title}</strong>
                  <span className="visually-hidden">{l.ok ? t('community.pack.passed') : t('community.pack.failed')}</span>
                  {l.problems.map((m, i) => (
                    <small key={i}>{m}</small>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
        {replaces && <p className="cm-muted">{t('community.pack.replaces')}</p>}
      </div>
    </Dialog>
  );
}
