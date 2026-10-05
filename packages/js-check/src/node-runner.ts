import type { SandboxEvents, SandboxHandle, SandboxRunner } from './runner';

/**
 * Bootstrap of the Node sandbox (worker_threads, eval'd CommonJS). It
 * registers module hooks that load the runtime's TypeScript sources, imports
 * the runtime, then locks module loading (any later import() fails, so player
 * code cannot reach node:fs or node:net) and runs the bundle with vm.
 */
const BOOT = String.raw`
const { workerData, parentPort } = require('node:worker_threads');
const nodeModule = require('node:module');
const fs = require('node:fs');
const vm = require('node:vm');
process.emitWarning = () => {};
let locked = false;
nodeModule.registerHooks({
  resolve(specifier, context, next) {
    if (locked) throw new Error("Cannot import '" + specifier + "': the sandbox has no network or files.");
    try {
      return next(specifier, context);
    } catch (e) {
      if (/^\.\.?\//.test(specifier) && context.parentURL && context.parentURL.endsWith('.ts')) {
        const base = specifier.replace(/\.js$/, '');
        for (const s of [base + '.ts', base + '/index.ts']) {
          try { return next(s, context); } catch {}
        }
      }
      throw e;
    }
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts')) {
      const src = fs.readFileSync(new URL(url), 'utf8');
      return { format: 'module', source: nodeModule.stripTypeScriptTypes(src, { mode: 'transform', sourceUrl: url }), shortCircuit: true };
    }
    return next(url, context);
  },
});
(async () => {
  const runtime = await import(workerData.runtimeUrl);
  locked = true;
  globalThis.__bacHost = { post: (m) => parentPort.postMessage(m), listen: (f) => parentPort.on('message', f), runtime };
  try {
    vm.runInThisContext(workerData.bundle, { filename: workerData.file });
  } catch (e) {
    if (e instanceof SyntaxError) parentPort.postMessage({ type: 'syntax', message: String(e.message), stack: String(e.stack) });
    else parentPort.postMessage({ type: 'fatal', message: 'The sandbox failed to start: ' + String(e && e.message) });
  }
})().catch((e) => parentPort.postMessage({ type: 'fatal', message: 'Could not start the sandbox: ' + String((e && e.stack) || e) }));
`;

export interface NodeRunnerOptions {
  /** Heap limit of each sandbox in MB (default 512). */
  maxHeapMb?: number;
}

/** The file name stack traces use for the bundle. */
const BUNDLE_FILE = 'js-sandbox-bundle.js';

/**
 * Runs sandboxes in Node worker_threads with resource limits. Used by Node
 * tests (content checks) and anything without Web Workers.
 */
export function nodeRunner(options: NodeRunnerOptions = {}): SandboxRunner {
  const proc = (globalThis as unknown as { process: NodeJS.Process }).process;
  const wt = proc.getBuiltinModule('node:worker_threads');
  // Built from parts so bundlers do not treat it as an asset URL.
  const runtimeFile = './runtime' + '.ts';
  const runtimeUrl = new URL(runtimeFile, import.meta.url).href;
  return {
    runtimeUrl: '',
    spawn(bundle: string, events: SandboxEvents): SandboxHandle {
      const worker = new wt.Worker(BOOT, {
        eval: true,
        workerData: { bundle, runtimeUrl, file: BUNDLE_FILE },
        resourceLimits: { maxOldGenerationSizeMb: options.maxHeapMb ?? 512, stackSizeMb: 4 },
        stdout: true,
        stderr: true,
      });
      worker.stdout.resume();
      worker.stderr.resume();
      let alive = true;
      worker.on('message', (m) => events.message(m));
      worker.on('error', (e: Error & { code?: string }) => {
        const oom = e.code === 'ERR_WORKER_OUT_OF_MEMORY';
        events.error({ message: oom ? 'The code ran out of memory.' : `${e.name}: ${e.message}`, stack: String(e.stack ?? '') });
      });
      worker.on('exit', () => {
        if (alive) events.exit();
        alive = false;
      });
      return {
        bundleFile: BUNDLE_FILE,
        post: (m) => {
          if (alive) worker.postMessage(m);
        },
        terminate: () => {
          alive = false;
          void worker.terminate();
        },
      };
    },
  };
}
