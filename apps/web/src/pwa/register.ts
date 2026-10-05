/// <reference types="vite-plugin-pwa/client" />
/**
 * FND-09: register the service worker that makes the game playable offline,
 * and drive the update prompt (E-DATA-09).
 *
 * The new worker waits until the player clicks Reload. Nothing ever reloads
 * on its own: when another tab applies an update, this tab only shows the
 * prompt, so a player in the middle of an edit keeps their work on screen.
 * Before reloading, the update checks that the new build reads this tab's
 * save formats, then flushes the autosave.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { SAVE_VERSION, WORKSPACE_VERSION } from '@build-a-computer/schema';
import { useEditor } from '../editor/store';
import { flushSave } from '../level/persist';
import { t } from '../i18n';
import { checkCompat, parseVersions, type BuildVersions } from './compat';
import { getStatus, setStatus } from './state';
import { UpdatePrompt } from './UpdatePrompt';

const UPDATE_CHECK_MS = 60 * 60 * 1000;

let updateSW: ((reload?: boolean) => Promise<void>) | undefined;
let reloadRequested = false;
let activatedElsewhere = false;

async function remoteVersions(): Promise<BuildVersions | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
    return res.ok ? parseVersions(await res.json()) : null;
  } catch {
    return null;
  }
}

/** The Reload button: check save compatibility, save, then activate the new worker. */
export async function applyUpdate(): Promise<void> {
  if (getStatus() === 'reloading') return;
  setStatus('reloading');
  const compat = checkCompat(await remoteVersions(), {
    saveVersion: SAVE_VERSION,
    workspaceVersion: WORKSPACE_VERSION,
  });
  if (!compat.ok) {
    setStatus('incompatible');
    return;
  }
  await flushSave().catch((e: unknown) => console.error(e));
  reloadRequested = true;
  if (!updateSW || activatedElsewhere) return location.reload();
  await updateSW(true);
  // The waiting worker takes over and onNeedReload reloads; if it never does, reload anyway.
  setTimeout(() => location.reload(), 3000);
}

/** Mount the prompt and register the worker. Production builds only. */
export function startPwa(): void {
  const host = document.createElement('div');
  host.className = 'bac-pwa-host';
  document.body.appendChild(host);
  createRoot(host).render(createElement(UpdatePrompt));

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  updateSW = registerSW({
    onNeedRefresh: () => setStatus('ready'),
    onNeedReload: () => {
      // Our own Reload click: the new worker now controls the page.
      if (reloadRequested) return location.reload();
      // Another tab applied the update. Never reload under the player.
      activatedElsewhere = true;
      setStatus('activated');
    },
    onOfflineReady: () => useEditor.getState().toast(t('pwa.offlineReady'), 'success'),
    onRegisteredSW: (_url, reg) => {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine) void reg.update().catch(() => undefined);
      };
      // E-DATA-09: look for a new version on reconnect and every hour.
      window.addEventListener('online', check);
      setInterval(check, UPDATE_CHECK_MS);
    },
    onRegisterError: (e: unknown) => console.error('Service worker registration failed', e),
  });
}
