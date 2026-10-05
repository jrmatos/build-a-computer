import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { startPersistence } from './level/persist';
import { startSimSync } from './sim/client';
import { migrateLegacyStorage } from './storage/legacy-migration';
import { useEditor } from './editor/store';
import { t } from './i18n';
import { startPwa } from './pwa/register';
import './styles/tokens.css';

async function boot() {
  // Copy browser data saved under the old project name before persistence opens the new databases.
  // Never blocks startup: failures are logged and shown as a toast, and retried next boot.
  const migration = await migrateLegacyStorage();
  await startPersistence();
  if (migration.failed.length) useEditor.getState().toast(t('storage.migration.failed'), 'error');
  startSimSync();
  startPwa();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}

void boot();
