import type { Level } from '@build-a-computer/schema';
import { describeError, judgeJs, startJs, type DatasetProvider, type JsRun, type JsTestSpec, type SandboxRunner } from '@build-a-computer/js-check';
import type { JsApi, JsCallOptions, JsDebugResult, JsRunState, MlSample } from './protocol';

/** console output kept for the UI. */
const LOG_LIMIT = 64 * 1024;
/** Samples kept for the loss curve; beyond this every other one is dropped. */
const MAX_SAMPLES = 20_000;
/** State updates are posted at most ~30 times a second. */
const EMIT_MS = 1000 / 30;

export interface JsHostOptions {
  /** Sandbox runner; default: the platform's (Web Worker in browsers, worker_threads in Node). */
  runner?: SandboxRunner | Promise<SandboxRunner>;
  /** Datasets for the 'data' module. */
  datasets?: DatasetProvider;
}

/**
 * Track 2 runs (JsApi): one sandboxed call at a time, streaming log, report()
 * samples and checkpoints to the subscriber at most 30 times a second.
 * Starting a new call stops the previous one. A crash in the sandbox ends the
 * call with an error; the host itself never throws.
 */
export class JsHost implements JsApi {
  private run: JsRun | null = null;
  private listener: ((s: JsRunState) => void) | null = null;
  private state: JsRunState = { running: false, log: '', samples: [] };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEmit = -Infinity;
  private generation = 0;

  constructor(
    private opts: JsHostOptions = {},
    private readonly now: () => number = () => performance.now(),
    private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) => setTimeout(fn, ms),
  ) {}

  /** Sets the dataset provider (the app builds it from the content package). */
  setDatasets(datasets: DatasetProvider | undefined): void {
    this.opts = { ...this.opts, ...(datasets ? { datasets } : {}) };
    if (!datasets) delete this.opts.datasets;
  }

  /** Sets the sandbox runner (tests, or an app-specific runner). */
  setRunner(runner: SandboxRunner | Promise<SandboxRunner>): void {
    this.opts = { ...this.opts, runner };
  }

  /** The runner and datasets for checks (SimHost.runTests). */
  get options(): JsHostOptions {
    return this.opts;
  }

  jsSubscribe(onState: (s: JsRunState) => void): void {
    this.listener = onState;
    this.emit(true);
  }

  jsStop(): void {
    this.run?.stop();
  }

  async jsCall(
    source: string,
    level: Level,
    entry: string,
    args: unknown[],
    opts: JsCallOptions = {},
  ): Promise<{ ok: boolean; result?: unknown; error?: { message: string; line?: number } }> {
    const test = level.tests.find((t) => t.kind === 'js' && t.entry === entry);
    const timeoutMs = test && test.kind === 'js' ? test.timeoutMs : level.js?.training ? 600_000 : 10_000;
    const seed = test && test.kind === 'js' ? test.seed : 1;
    const out = await this.start(source, level, { entry, args, seed, timeoutMs }, opts);
    return out.ok ? { ok: true, result: out.result } : { ok: false, error: out.error };
  }

  /**
   * "Debug this test": run only `level.tests[testIndex]` with its own args,
   * seed and time limit, streaming console output and report() samples like
   * jsCall, then judge the result exactly as the checker does. The verdict
   * carries the full expected-vs-actual diff tree. Resolves to null when the
   * test is not a 'js' test.
   */
  async jsDebugCall(source: string, level: Level, testIndex: number): Promise<JsDebugResult | null> {
    const test = level.tests[testIndex];
    if (!test || test.kind !== 'js') return null;
    const spec = test as JsTestSpec;
    const out = await this.start(source, level, { entry: spec.entry, args: spec.args ?? [], seed: spec.seed ?? 1, timeoutMs: spec.timeoutMs ?? 10_000 }, {}, testIndex);
    return { ...out, test: testIndex, ...(out.verdict ? { verdict: out.verdict } : {}) };
  }

  private async start(
    source: string,
    level: Level,
    req: { entry: string; args: unknown[]; seed: number; timeoutMs: number },
    opts: JsCallOptions,
    testIndex?: number,
  ): Promise<Omit<JsDebugResult, 'test'>> {
    this.run?.stop();
    const gen = ++this.generation;
    const resumeStep = opts.resume?.step;
    this.state = {
      running: true,
      log: '',
      // Resuming keeps the curve up to the checkpoint.
      samples: resumeStep !== undefined ? this.state.samples.filter((s) => s.step <= resumeStep) : [],
      ...(opts.resume ? { checkpoint: opts.resume } : {}),
      ...(testIndex !== undefined ? { test: { index: testIndex } } : {}),
    };
    this.emit(true);
    const live = (): boolean => gen === this.generation;
    const seen: { count: number; last?: MlSample } = { count: 0 };
    let run: JsRun;
    try {
      run = startJs(
        {
          source,
          level,
          entry: req.entry,
          args: req.args,
          seed: req.seed,
          timeoutMs: req.timeoutMs,
          ...(opts.resume ? { checkpoint: opts.resume.state, checkpointStep: opts.resume.step } : {}),
        },
        {
          ...(this.opts.runner ? { runner: this.opts.runner } : {}),
          ...(this.opts.datasets ? { datasets: this.opts.datasets } : {}),
          onLog: (t) => {
            if (!live()) return;
            const log = this.state.log + t;
            this.state.log = log.length > LOG_LIMIT ? log.slice(-LOG_LIMIT) : log;
            this.emit(false);
          },
          onSamples: (s) => {
            seen.count += s.length;
            seen.last = s[s.length - 1] ?? seen.last;
            if (!live()) return;
            this.addSamples(s);
            this.emit(false);
          },
          onCheckpoint: (state, step) => {
            if (!live()) return;
            this.state.checkpoint = { step, state };
            this.emit(false);
          },
        },
      );
    } catch (e) {
      const message = `The JavaScript sandbox failed: ${e instanceof Error ? e.message : String(e)}`;
      this.state = { ...this.state, running: false, error: { message } };
      this.emit(true);
      return { ok: false, error: { message } };
    }
    this.run = run;
    const out = await run.done;
    const test = testIndex !== undefined ? (level.tests[testIndex] as JsTestSpec) : undefined;
    const verdict = test ? judgeJs(out, test, seen, true) : undefined;
    if (!live()) return out.ok ? { ok: true, result: out.result } : { ok: false, error: { message: out.error?.message ?? 'Stopped.' } };
    this.run = null;
    this.state.running = false;
    if (verdict && testIndex !== undefined) this.state.test = { index: testIndex, verdict };
    if (out.ok) {
      this.state.result = out.result;
      this.emit(true);
      return { ok: true, result: out.result, ...(verdict ? { verdict } : {}) };
    }
    const e = out.error!;
    const error = { message: e.file && e.file !== 'main.js' ? describeError(e) : e.message, ...(e.file === 'main.js' && e.line ? { line: e.line } : {}), ...(e.file === 'main.js' && e.column ? { column: e.column } : {}) };
    this.state.error = error;
    const tail = `${describeError(e)}\n`;
    this.state.log = (this.state.log + tail).slice(-LOG_LIMIT);
    this.emit(true);
    return { ok: false, error: { message: error.message, ...(error.line ? { line: error.line } : {}) }, ...(verdict ? { verdict } : {}) };
  }

  private addSamples(s: MlSample[]): void {
    const all = this.state.samples;
    all.push(...s);
    if (all.length > MAX_SAMPLES) this.state.samples = all.filter((_, i) => i % 2 === 0 || i === all.length - 1);
  }

  private emit(force: boolean): void {
    if (!this.listener) return;
    const t = this.now();
    if (!force && t - this.lastEmit < EMIT_MS) {
      if (!this.timer) this.timer = this.schedule(() => {
        this.timer = null;
        this.emit(true);
      }, EMIT_MS - (t - this.lastEmit));
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.lastEmit = t;
    const s = this.state;
    this.listener({ ...s, samples: [...s.samples], ...(s.error ? { error: { ...s.error } } : {}) });
  }
}
