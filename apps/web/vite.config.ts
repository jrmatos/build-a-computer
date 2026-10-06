import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

// Served from a subpath on GitHub Pages (/build-a-computer/); '/' everywhere else.
const base = process.env.VITE_BASE ?? '/';
const build = process.env.GITHUB_SHA?.slice(0, 12) ?? new Date().toISOString();

/** Read `export const NAME = <int>` from a schema source file (the config cannot import TS workspace packages). */
function schemaConst(file: string, name: string): number {
  const src = readFileSync(new URL(`../../packages/schema/src/${file}`, import.meta.url), 'utf8');
  const m = new RegExp(`export const ${name} = (\\d+);`).exec(src);
  if (!m) throw new Error(`${name} not found in packages/schema/src/${file}`);
  return Number(m[1]);
}

/**
 * E-DATA-09: `version.json` tells an open (older) tab which save formats the
 * new build reads, so the update prompt can refuse a reload that would strand
 * the player's saves. Never precached: it must come from the network.
 */
function versionFile(): Plugin {
  return {
    name: 'bac-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({
          build,
          saveVersion: schemaConst('save.ts', 'SAVE_VERSION'),
          workspaceVersion: schemaConst('workspace.ts', 'WORKSPACE_VERSION'),
        }),
      });
    },
  };
}

export default defineConfig({
  base,
  plugins: [
    react(),
    versionFile(),
    // FND-09: offline play after the first load. The service worker precaches the
    // whole build (app shell, lazy code/ML/solutions chunks, the sim worker,
    // level content bundled in JS) and only updates when the player says so.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false, // src/pwa/register.ts registers it
      includeManifestIcons: false, // workbox.globPatterns already precaches every public file
      manifest: {
        name: 'Build a Computer',
        short_name: 'Build a Computer',
        description: 'Build a computer from NAND gates up, in your browser.',
        id: base,
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#121418',
        theme_color: '#121418',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,woff,woff2,wasm,bin}'],
        globIgnores: ['**/version.json'],
        // Lazy chunks (CodeMirror, compiler, ML) are large; precache them anyway.
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/version\.json$/],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
      },
    }),
  ],
  worker: { format: 'es' },
  server: {
    port: 5173,
    // Docker bind mounts miss files replaced by rename (sed -i, many editors); poll there.
    watch:
      process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
  },
  // Kernel-booting and full-level tests run real programs; CI runners are slower than dev machines.
  test: { environment: 'node', testTimeout: 30_000 },
} as Parameters<typeof defineConfig>[0]);
