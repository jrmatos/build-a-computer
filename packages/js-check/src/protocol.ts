/**
 * Messages between the sandbox (player code, in its own worker) and the
 * runner that started it. Everything is structured-clone safe.
 */

/** One training-progress sample (same shape as the worker's MlSample). */
export interface MlSample {
  step: number;
  values: Record<string, number>;
}

/** Facts about a dataset, available synchronously inside the sandbox. */
export interface DatasetMeta {
  id: string;
  title?: string;
  /** SPDX id or short license text (E-ML-07). */
  license?: string;
  [key: string]: unknown;
}

/** What the runner sends when the sandbox is ready. */
export interface StartRequest {
  type: 'start';
  /** Function name exported by main.js. */
  entry: string;
  args: unknown[];
  seed: number;
  /** Module names the level unlocks (JsSetup.modules). */
  modules: string[];
  /** Library file names (JsSetup.library), importable as './name'. */
  library: string[];
  /** Datasets of the level: meta, or null when the provider does not have it. */
  datasets: { id: string; meta: DatasetMeta | null }[];
  /** Last saved checkpoint for restoreCheckpoint(), if any. */
  checkpoint?: unknown;
  /** Step the checkpoint was taken at: report() steps continue after it. */
  checkpointStep?: number;
}

export type ToSandbox =
  | StartRequest
  | { type: 'dataset'; req: number; ok: true; data: unknown }
  | { type: 'dataset'; req: number; ok: false; message: string };

/** An error thrown by player code, before line mapping. */
export interface RawError {
  name: string;
  message: string;
  stack?: string;
  /** Known file/line (e.g. a missing import name) without a stack. */
  file?: string;
  line?: number;
}

export type FromSandbox =
  | { type: 'ready' }
  | { type: 'log'; text: string }
  | { type: 'samples'; samples: MlSample[] }
  | { type: 'checkpoint'; step: number; state: unknown }
  | { type: 'dataset'; req: number; id: string }
  | { type: 'done'; ok: true; result: unknown }
  | { type: 'done'; ok: false; error: RawError }
  /** The bundle failed to parse (Node; browsers report it through the worker's error event). */
  | { type: 'syntax'; message: string; stack: string }
  | { type: 'fatal'; message: string };
