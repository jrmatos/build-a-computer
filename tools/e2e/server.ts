/**
 * Playwright's web server: a production build of apps/web under the GitHub
 * Pages subpath, served like Pages serves it (tools/bench/lib/serve.ts).
 * E2E_SKIP_BUILD=1 reuses the last build in tools/e2e/out/dist.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDist } from '../bench/lib/serve.ts';

export const BASE = '/build-a-computer/';
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const dist = join(here, 'out', 'dist');
const port = Number(process.env.E2E_PORT ?? 4417);

if (!process.env.E2E_SKIP_BUILD || !existsSync(join(dist, 'index.html'))) {
  const r = spawnSync(
    'pnpm',
    [
      '--filter',
      '@build-a-computer/web',
      'exec',
      'vite',
      'build',
      '--outDir',
      dist,
      '--emptyOutDir',
    ],
    {
      cwd: repo,
      env: { ...process.env, VITE_BASE: BASE },
      stdio: 'inherit',
    },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const served = await serveDist(dist, BASE, port);
console.log(`e2e: serving ${dist} at ${served.url}`);
