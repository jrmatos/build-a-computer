// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient Vite module type; tsc of dependants must see it
/// <reference path="./vite-env.d.ts" />
import runtimeUrl from './runtime-entry.ts?worker&url';
import type { SandboxEvents, SandboxHandle, SandboxRunner } from './runner';

/** The bits of the DOM Worker API used here (the package compiles without DOM types). */
interface WebWorker {
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: { message: string; lineno: number; colno: number; error?: unknown; preventDefault(): void }) => void) | null;
  postMessage(m: unknown): void;
  terminate(): void;
}
type WorkerCtor = new (url: string) => WebWorker;

/**
 * Runs sandboxes as classic Web Workers created from a blob: URL (CSP
 * `worker-src 'self' blob:`). The bundle imports the runtime (bundled by Vite,
 * same origin, so `script-src 'self'` allows it). Classic workers report
 * syntax errors with line numbers through the error event.
 */
export function browserRunner(): SandboxRunner {
  const base = (globalThis as unknown as { location?: { href: string } }).location?.href ?? '';
  return {
    runtimeUrl: new URL(runtimeUrl, base).href,
    spawn(bundle: string, events: SandboxEvents): SandboxHandle {
      const url = URL.createObjectURL(new Blob([bundle], { type: 'text/javascript' }));
      const worker = new (globalThis as unknown as { Worker: WorkerCtor }).Worker(url);
      let alive = true;
      worker.onmessage = (e) => events.message(e.data as never);
      worker.onerror = (e) => {
        e.preventDefault();
        events.error({ message: e.message || 'The code could not run.', line: e.lineno || undefined, column: e.colno || undefined, stack: (e.error as Error | undefined)?.stack });
      };
      return {
        bundleFile: url,
        post: (m) => {
          if (alive) worker.postMessage(m);
        },
        terminate: () => {
          if (!alive) return;
          alive = false;
          worker.terminate();
          URL.revokeObjectURL(url);
        },
      };
    },
  };
}
