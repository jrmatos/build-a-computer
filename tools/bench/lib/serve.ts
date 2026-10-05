/**
 * Minimal static server for a Vite `dist` folder mounted under a base path
 * (GitHub Pages serves the site from /build-a-computer/). Unknown paths under
 * the base fall back to index.html like a SPA host; everything else is 404.
 */
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

export interface Served {
  url: string;
  server: Server;
  close(): Promise<void>;
}

export async function serveDist(root: string, base: string, port = 0): Promise<Served> {
  const server = createServer((req, res) => {
    void (async () => {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      if (!path.startsWith(base)) {
        res.writeHead(404).end();
        return;
      }
      let file = normalize(join(root, path.slice(base.length)));
      if (!file.startsWith(root)) {
        res.writeHead(403).end();
        return;
      }
      const isFile = await stat(file).then(
        (s) => s.isFile(),
        () => false,
      );
      if (!isFile) file = join(root, 'index.html');
      const body = await readFile(file);
      const type = TYPES[extname(file)] ?? 'application/octet-stream';
      // Like GitHub Pages: short cache, and the service worker script is never cached.
      res.writeHead(200, {
        'content-type': type,
        'cache-control': file.endsWith('sw.js') ? 'no-cache' : 'max-age=600',
      });
      res.end(body);
    })().catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const addr = server.address();
  const p = typeof addr === 'object' && addr ? addr.port : port;
  return {
    url: `http://127.0.0.1:${p}${base}`,
    server,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
