import { JsSetup, type Level } from '@build-a-computer/schema';
import { NAN_MESSAGE } from './compare';
import type { DatasetMeta, DeviceInfo, FromSandbox, GpuMode, MlSample, RawError, ToSandbox } from './protocol';
import { buildBundle, isTransformError, mapBundleLine, mapStack, transformModule, type BundleMap, type TransformedModule } from './transform';

/** A dataset the level can load through the 'data' module. */
export interface DatasetSource {
  meta: DatasetMeta;
  /** Loads the data: typed arrays, strings, numbers or plain objects/arrays of them (structured-clone safe). */
  load(): unknown;
}

/**
 * Datasets come from the content package; the app passes a provider in.
 * Returns undefined for an unknown id. Only ids listed in the level's
 * `js.datasets` are ever asked for.
 */
export type DatasetProvider = (id: string) => DatasetSource | undefined | Promise<DatasetSource | undefined>;

/** Builds a provider from a record of sources. */
export function datasetsFrom(record: Record<string, DatasetSource>): DatasetProvider {
  return (id) => (Object.prototype.hasOwnProperty.call(record, id) ? record[id] : undefined);
}

/** Events from a running sandbox. */
export interface SandboxEvents {
  message(m: FromSandbox): void;
  /** An error the platform reported (browser ErrorEvent: syntax errors; Node worker 'error'). */
  error(e: { message: string; line?: number; column?: number; stack?: string }): void;
  /** The sandbox stopped on its own. */
  exit(): void;
}

export interface SandboxHandle {
  /** The file name stack frames use for the bundle script. */
  readonly bundleFile: string;
  post(m: ToSandbox): void;
  /** Kills the sandbox at once, even inside an infinite loop. */
  terminate(): void;
}

/**
 * Starts sandboxes. Node (content tests) uses worker_threads; the browser
 * uses a classic Web Worker built from a blob: URL (CSP worker-src blob:).
 */
export interface SandboxRunner {
  /** URL the bundle loads the runtime from ('' when the runner injects it). */
  readonly runtimeUrl: string;
  spawn(bundle: string, events: SandboxEvents): SandboxHandle;
}

export type JsErrorKind = 'syntax' | 'import' | 'runtime' | 'nan' | 'timeout' | 'stopped' | 'crash';

/** An error with its position in the player's files. */
export interface JsError {
  kind: JsErrorKind;
  message: string;
  /** 'main.js' or a library file name. */
  file?: string;
  line?: number;
  column?: number;
}

export interface JsRunRequest {
  /** The player's main.js. */
  source: string;
  level: Level;
  entry: string;
  args?: unknown[];
  /** Seed for Math.random (and tensor init); default 1. */
  seed?: number;
  /** Wall-clock limit for the player's code in ms; default 10,000. */
  timeoutMs?: number;
  /** State returned by restoreCheckpoint() (E-ML-06). */
  checkpoint?: unknown;
  /** Step of that checkpoint; report() steps continue after it. */
  checkpointStep?: number;
  /** GPU for the tensor modules; default 'auto' for training levels (js.training), else 'off'. */
  gpu?: GpuMode;
}

export interface JsRunOptions {
  runner?: SandboxRunner | Promise<SandboxRunner>;
  datasets?: DatasetProvider;
  onLog?(text: string): void;
  onSamples?(samples: MlSample[]): void;
  /** checkpoint(state) from the player's code; the host stores it (IndexedDB in the browser). */
  onCheckpoint?(state: unknown, step: number): void;
  /** The device the tensor modules have, then again when the code first uses the GPU (E-ML-01 badge). */
  onDevice?(info: DeviceInfo): void;
}

export interface JsOutcome {
  ok: boolean;
  /** JSON-safe result (tensors as {shape, data}); NaN/Infinity kept. */
  result?: unknown;
  error?: JsError;
  /** Milliseconds the player's code ran. */
  ms: number;
}

export interface JsRun {
  done: Promise<JsOutcome>;
  /** Stops the code (terminates the sandbox); `done` resolves with kind 'stopped'. */
  stop(): void;
}

/** Longest the sandbox may take to start before the player's code runs. */
const BOOT_MS = 30_000;

const seconds = (ms: number): string => `${Math.round(ms / 100) / 10} s`;

/** Places an error message: "main.js line 3: …". */
export function describeError(e: JsError): string {
  if (e.line && e.file) return `${e.file} line ${e.line}: ${e.message}`;
  return e.message;
}

/** Transforms main.js and the library files; checks every static import against what the level allows. */
export function prepareModules(source: string, setup: JsSetup): { modules: { file: string; mod: TransformedModule }[] } | { error: JsError } {
  const files = [{ file: 'main.js', text: source }, ...setup.library.map((l) => ({ file: l.name, text: l.text }))];
  const modules: { file: string; mod: TransformedModule }[] = [];
  const libs = new Set(setup.library.map((l) => l.name));
  for (const f of files) {
    let mod: TransformedModule;
    try {
      mod = transformModule(f.text, f.file);
    } catch (e) {
      if (isTransformError(e)) return { error: { kind: 'syntax', message: `SyntaxError: ${e.message}`, file: e.file, line: e.line, column: e.column } };
      throw e;
    }
    for (const imp of mod.imports) {
      const lib = imp.spec.startsWith('./') && (libs.has(imp.spec.slice(2)) || libs.has(`${imp.spec.slice(2)}.js`));
      if (lib || (setup.modules as string[]).includes(imp.spec)) continue;
      const allowed = [...setup.modules.map((m) => `'${m}'`), ...setup.library.map((l) => `'./${l.name}'`)].join(', ') || 'nothing';
      const known = ['tensor', 'autograd', 'nn', 'optim', 'data', 'tokenizer', 'plot'].includes(imp.spec);
      return {
        error: {
          kind: 'import',
          message: known
            ? `The '${imp.spec}' module is not unlocked in this level. You can import ${allowed}.`
            : `Cannot import '${imp.spec}': this sandbox has no network or files. You can import ${allowed}.`,
          file: f.file,
          line: imp.line,
          column: imp.column,
        },
      };
    }
    modules.push({ file: f.file, mod });
  }
  return { modules };
}

function mapRawError(raw: RawError, map: BundleMap, bundleFile: string): JsError {
  const nan = raw.name === 'NaNError' || raw.name === 'NonFiniteError';
  const kind: JsErrorKind = nan ? 'nan' : raw.name === 'ImportError' ? 'import' : 'runtime';
  const message = nan
    ? raw.message.includes('lower learning rate') ? raw.message : `${raw.message} — ${NAN_MESSAGE}`
    : raw.name === 'ImportError' ? raw.message : `${raw.name}: ${raw.message}`;
  if (raw.file && raw.line) return { kind, message, file: raw.file, line: raw.line };
  if (raw.file && !raw.line) return { kind, message };
  const at = raw.stack ? mapStack(map, raw.stack, bundleFile) : undefined;
  return at ? { kind, message, file: at.file, line: at.line, column: at.column } : { kind, message };
}

/** Parses "file:LINE" from a V8 SyntaxError stack (vm scripts put the position on the first line). */
function syntaxLine(stack: string, bundleFile: string): { line: number; column?: number } | undefined {
  const lines = stack.split('\n');
  const head = lines[0] ?? '';
  const m = head.startsWith(bundleFile) ? /:(\d+)$/.exec(head) : null;
  if (!m) return undefined;
  const caret = lines[2]?.indexOf('^');
  return { line: Number(m[1]), ...(caret !== undefined && caret >= 0 ? { column: caret + 1 } : {}) };
}

/**
 * Runs `entry(...args)` from the player's main.js in a fresh sandbox.
 * Output streams through the callbacks; `done` never rejects.
 */
export function startJs(req: JsRunRequest, opts: JsRunOptions = {}): JsRun {
  const setup = JsSetup.parse(req.level.js ?? {});
  let handle: SandboxHandle | null = null;
  let finished = false;
  let stopRequested = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let bootTimer: ReturnType<typeof setTimeout> | null = null;
  let startedAt = 0;
  let resolveDone!: (o: JsOutcome) => void;
  const done = new Promise<JsOutcome>((r) => (resolveDone = r));
  const elapsed = (): number => (startedAt ? Date.now() - startedAt : 0);
  const finish = (o: Omit<JsOutcome, 'ms'>): void => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    if (bootTimer) clearTimeout(bootTimer);
    try {
      handle?.terminate();
    } catch {
      /* already gone */
    }
    resolveDone({ ...o, ms: elapsed() });
  };
  const timeoutMs = req.timeoutMs ?? 10_000;

  const begin = async (): Promise<void> => {
    const prepared = prepareModules(req.source, setup);
    if ('error' in prepared) return finish({ ok: false, error: prepared.error });
    const runner = await (opts.runner ?? defaultRunner());
    if (finished) return;
    const bundle = buildBundle(prepared.modules, runner.runtimeUrl);
    const sources = new Map<string, Promise<DatasetSource | undefined>>();
    const source = (id: string): Promise<DatasetSource | undefined> => {
      let p = sources.get(id);
      if (!p) {
        p = Promise.resolve(opts.datasets ? opts.datasets(id) : undefined).catch(() => undefined);
        sources.set(id, p);
      }
      return p;
    };
    let ready = false;
    const placeSyntax = (message: string, line?: number, column?: number): JsError => {
      const at = line ? mapBundleLine(bundle.map, line) : undefined;
      return at ? { kind: 'syntax', message, file: at.file, line: at.line, ...(column ? { column } : {}) } : { kind: 'syntax', message };
    };
    const events: SandboxEvents = {
      message: (m) => {
        if (finished) return;
        switch (m.type) {
          case 'ready': {
            ready = true;
            if (bootTimer) clearTimeout(bootTimer);
            void Promise.all(setup.datasets.map(async (id) => ({ id, meta: (await source(id))?.meta ?? null }))).then((datasets) => {
              if (finished) return;
              startedAt = Date.now();
              timer = setTimeout(
                () => finish({ ok: false, error: { kind: 'timeout', message: `Stopped after ${seconds(timeoutMs)}: the code ran longer than the time limit. Is there an infinite loop?` } }),
                timeoutMs,
              );
              handle!.post({
                type: 'start',
                entry: req.entry,
                args: req.args ?? [],
                seed: req.seed ?? 1,
                modules: [...setup.modules],
                library: setup.library.map((l) => l.name),
                datasets,
                ...(req.checkpoint !== undefined ? { checkpoint: req.checkpoint } : {}),
                ...(req.checkpointStep !== undefined ? { checkpointStep: req.checkpointStep } : {}),
                gpu: req.gpu ?? (setup.training ? 'auto' : 'off'),
              });
            });
            return;
          }
          case 'log':
            opts.onLog?.(m.text);
            return;
          case 'samples':
            opts.onSamples?.(m.samples);
            return;
          case 'checkpoint':
            opts.onCheckpoint?.(m.state, m.step);
            return;
          case 'device':
            opts.onDevice?.(m.info);
            return;
          case 'dataset': {
            const reply = (msg: ToSandbox): void => {
              if (!finished) handle!.post(msg);
            };
            if (!setup.datasets.includes(m.id)) return reply({ type: 'dataset', req: m.req, ok: false, message: `Dataset '${m.id}' is not part of this level.` });
            void source(m.id)
              .then(async (src) => {
                if (!src) throw new Error(`Dataset '${m.id}' is not available.`);
                return src.load();
              })
              .then(
                (data) => reply({ type: 'dataset', req: m.req, ok: true, data }),
                (e: unknown) => reply({ type: 'dataset', req: m.req, ok: false, message: e instanceof Error ? e.message : String(e) }),
              );
            return;
          }
          case 'done':
            if (m.ok) return finish({ ok: true, result: m.result });
            return finish({ ok: false, error: mapRawError(m.error, bundle.map, handle!.bundleFile) });
          case 'syntax': {
            const at = syntaxLine(m.stack, handle!.bundleFile);
            return finish({ ok: false, error: placeSyntax(`SyntaxError: ${m.message}`, at?.line, at?.column) });
          }
          case 'fatal':
            return finish({ ok: false, error: { kind: 'crash', message: m.message } });
        }
      },
      error: (e) => {
        if (finished) return;
        if (!ready) return finish({ ok: false, error: placeSyntax(e.message.startsWith('Uncaught ') ? e.message.slice(9) : e.message, e.line, e.column) });
        const at = e.stack ? mapStack(bundle.map, e.stack, handle!.bundleFile) : e.line ? { ...mapBundleLine(bundle.map, e.line), column: e.column } : undefined;
        const nan = /NaNError/.test(e.message);
        const err: JsError = { kind: nan ? 'nan' : 'runtime', message: e.message };
        if (at?.file && at.line) Object.assign(err, { file: at.file, line: at.line, ...(at.column ? { column: at.column } : {}) });
        finish({ ok: false, error: err });
      },
      exit: () => {
        if (finished) return;
        finish({ ok: false, error: { kind: stopRequested ? 'stopped' : 'crash', message: stopRequested ? 'Stopped.' : 'The sandbox stopped unexpectedly.' } });
      },
    };
    handle = runner.spawn(bundle.code, events);
    if (finished) handle.terminate();
    bootTimer = setTimeout(() => {
      if (!ready && !finished) finish({ ok: false, error: { kind: 'crash', message: 'The JavaScript sandbox did not start.' } });
    }, BOOT_MS);
  };
  begin().catch((e: unknown) => finish({ ok: false, error: { kind: 'crash', message: `The JavaScript sandbox failed: ${e instanceof Error ? e.message : String(e)}` } }));
  return {
    done,
    stop: () => {
      stopRequested = true;
      finish({ ok: false, error: { kind: 'stopped', message: 'Stopped.' } });
    },
  };
}

/** NaN message used by checks (E-ML-03). */
export { NAN_MESSAGE };

let cachedDefault: Promise<SandboxRunner> | null = null;

/**
 * The runner for the current platform: Node worker_threads when
 * `process.getBuiltinModule` exists, otherwise a browser Web Worker.
 */
export function defaultRunner(): Promise<SandboxRunner> {
  if (!cachedDefault) {
    const proc = (globalThis as { process?: { getBuiltinModule?: unknown; versions?: { node?: string } } }).process;
    cachedDefault =
      typeof proc?.getBuiltinModule === 'function' && proc.versions?.node
        ? import('./node-runner').then((m) => m.nodeRunner())
        : import('./browser-runner').then((m) => m.browserRunner());
  }
  return cachedDefault;
}
