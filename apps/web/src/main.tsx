import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startPersistence } from './level/persist';
import { startSimSync } from './sim/client';
import './styles/tokens.css';

async function boot() {
  await startPersistence();
  startSimSync();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
