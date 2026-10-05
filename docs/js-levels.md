# JavaScript levels (Track 2: Neuron to LLM)

How player JavaScript runs, what it can use, and how levels check it.
Code: `packages/js-check` (sandbox + checker), `packages/worker/src/js-host.ts`
(JsApi), `packages/tensor` (the ML library). Plan refs: ASM-05, E-ML-01..07.

## The player's file

The player edits **`main.js`**, an ES module. Tests call its **exported
functions** by name (`TestSpec.entry`). Everything a level gives lives in
`level.js` (`JsSetup`):

| Field      | Meaning                                                                    |
| ---------- | -------------------------------------------------------------------------- |
| `starter`  | Initial `main.js`.                                                         |
| `modules`  | Library modules the player may import (see below). Grows as levels unlock. |
| `datasets` | Dataset ids the `data` module can load (max 8).                            |
| `library`  | Read-only helper files, imported as `'./name.js'`.                         |
| `training` | Shows the training panel (loss curve, Train/Stop/Resume).                  |

Supported module syntax: every `import` form (default, named, `* as ns`,
side-effect), `export function/class/const/let/var`, `export default`,
`export { a as b }`, `export … from`, top-level `await`, and `import()` of
allowed modules. Simple destructuring in `export const { a, b } = …` works;
exotic patterns may not — export names separately in starters.

## Modules

| Import name | What it is                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `tensor`    | `packages/tensor` `JS_MODULE_MAP.tensor`: `Tensor`, `tensor`, `zeros`, `randn`, ops…            |
| `autograd`  | `JS_MODULE_MAP.autograd`: `noGrad`, `gradCheck`…                                                |
| `nn`        | `JS_MODULE_MAP.nn`: layers and losses (`Linear`, `crossEntropy`…)                               |
| `optim`     | `JS_MODULE_MAP.optim`: `SGD`, `Adam`, schedules, `assertFinite`…                                |
| `data`      | `datasets` (ids), `info(id)` → meta (license…), `await load(id)` → the dataset's data           |
| `tokenizer` | `CharTokenizer(text)`, `WordTokenizer(text, minCount?)` (`encode`, `decode`, `vocab`, `size`), `splitWords` |
| `plot`      | `ema(alpha)`, `every(n, fn)`, `mean`, `accuracy(pred, labels)`, `histogram(values, bins)`, `sparkline(values)`, `table(rows)` |
| `./x.js`    | A file from `level.js.library`.                                                                 |

Importing anything else (`fs`, a URL, a module the level has not unlocked)
fails **before the code runs** with a message and the import's line.
Each import name gets a namespace whose `default` is the namespace itself, so
`import T from 'tensor'` also works.

## Globals

| Global                                 | Behaviour                                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `console.log/info/warn/error/table`    | Captured into the run log (last 64 KiB shown).                                                                                                                                     |
| `report({ loss, acc, … })`             | Adds one sample to the loss curve. Numbers (or 1-element tensors) only. `step` auto-increments; pass `step` to set it. A NaN/Infinity value **throws and stops training** with "`loss` became NaN — try a lower learning rate" (E-ML-03). |
| `checkpoint(state)`                    | Saves training state (E-ML-06). Tensors are copied with shape/dtype/requiresGrad; typed arrays copied; functions dropped. The checkpoint's step is `state.step` if it is a number, else the last `report()` step. |
| `restoreCheckpoint()`                  | **Synchronous.** The state passed on resume (tensors rebuilt as tensors), or `null`. On resume, `report()` steps continue after the checkpoint's step. |
| `Math.random`                          | Seeded (mulberry32) from `test.seed` (default 1); `crypto.getRandomValues` too. `manualSeed(seed)` of the tensor library is called with the same seed. Same seed → same run. |

Typical training entry:

```js
import { tensor, randn } from 'tensor';
import { Linear, mseLoss } from 'nn';
import { SGD } from 'optim';

export function train(steps = 500, lr = 0.1) {
  const saved = restoreCheckpoint();
  let start = saved?.step ?? 0;
  // … build model, load saved.weights when present …
  for (let step = start; step < steps; step++) {
    // … forward, loss.backward(), opt.step() …
    report({ loss: loss.item() });
    if (step % 50 === 0) checkpoint({ step, weights: model.stateDict() });
  }
  return { loss: finalLoss, accuracy };
}
```

## What is not available (ASM-05)

`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`,
`importScripts`, `Worker`, `SharedWorker`, `BroadcastChannel`, `indexedDB`,
`caches`, `postMessage`, `process`, `require` are `undefined`. Dynamic
`import()` only resolves allowed modules. In browsers the CSP
(`script-src 'self'`, `connect-src 'self'`, no `unsafe-eval`) blocks
`Function`/`eval` and remote scripts; in Node module loading is locked after
start. Each call runs in a fresh worker that is **terminated** at the time
limit, on Stop, or when a new call starts.

## Tests (`TestSpec` kind `'js'`)

```ts
{ kind: 'js', name?, entry, args = [], expect?, tolerance = 1e-6, metric?, seed = 1, timeoutMs = 10_000 }
```

- **`expect`**: deep comparison. Numbers match when
  `|actual − expected| ≤ tolerance × max(1, |expected|)` (E-ML-02, never exact).
  Tensors in results become `{ shape, data }`; an expected `{ shape, data }`
  needs the same shape, an expected nested array or number is compared with
  the tensor's nested values. Objects need every expected key (extra keys are
  ignored). Typed arrays compare as arrays.
- **`metric`**: the result must be an object; `result[name]` (number or
  1-element tensor) must be within `[min, max]`. Use for training levels
  (e.g. `accuracy >= 0.95`, `loss <= 0.1`).
- **Neither**: passes when the call returns without error and with no
  NaN/Infinity in the result.
- NaN/Infinity where a number is expected, a NaN in `report()`, or the tensor
  library's `NonFiniteError` fail with `loss became NaN — try a lower learning
  rate` (E-ML-03).
- Timeouts fail with "Stopped after N s … Is there an infinite loop?".
  Training levels should set `timeoutMs` generously (CI machines are slow).
- Errors name the file and line (`main.js line 12: TypeError: …`), mapped
  from the sandbox back to the player's file, also for library files and
  syntax errors.

Each test yields one `CaseResult` (`kind: 'js'`) with `message`, `summary`
("Returned after 1.2 s; 300 report() samples, last: loss 0.031.") and
`actual.result` (a JSON preview) or `actual.error`.

Running checks:

```ts
import { runJsTest, datasetsFrom } from '@build-a-computer/js-check';
const r = await runJsTest(solutionSource, level.tests[0], level, { datasets });
```

In Node (content tests) the default runner uses `worker_threads` with a heap
limit; in browsers a classic Web Worker from a `blob:` URL. Pass `runner` to
override.

## Datasets

Content provides datasets; the app passes a provider to the worker:

```ts
type DatasetProvider = (id: string) => { meta: DatasetMeta; load(): unknown } | undefined | Promise<…>;
interface DatasetMeta { id: string; title?: string; license?: string; [k: string]: unknown }
```

`datasetsFrom({ id: { meta, load } })` builds one from a record. `load()` may
return typed arrays, strings and plain objects/arrays (structured-clone safe);
it runs only when the player calls `load(id)`, and only for ids listed in
`level.js.datasets`. `meta` (with its license, E-ML-07) is available
synchronously through `info(id)`.

## Worker API (JsApi)

`SimHost` implements `JsApi` (delegating to `JsHost`):

- `jsCall(source, level, entry, args, opts?)` runs one call. Seed and time
  limit come from the level's `'js'` test with that entry (else seed 1 and
  10 s, or 10 min when `level.js.training`). `opts.resume = { step, state }`
  makes `restoreCheckpoint()` return `state`; samples after `step` are dropped.
- `jsSubscribe(cb)` streams `JsRunState` (≤ 30 Hz): `running`, `log`,
  `samples`, `checkpoint` (latest `{ step, state }`, for the app to store in
  IndexedDB), `error` (`{ message, line, column }`), `result`.
- `jsDebugCall(source, level, testIndex)` ("Debug this test") runs only that
  test with its own args, seed and time limit, streams like `jsCall`, and
  resolves with `verdict`: the checker's `CaseResult` (`judgeJs`) whose
  `detail` has the full `diff` tree (`diffValues`: tensors with every
  mismatching index, objects, arrays), readable `mismatches`
  (`result.w[2]: expected 0.5 ± 1e-6, got 0.47`) and, for metric tests, the
  value against `[min, max]`. `JsRunState.test` carries the same.
- Case results from `runJsTest` carry `detail` with the first 20 mismatches
  (no tree) for the test strip.
- `jsStop()` terminates the sandbox.
- `runTests(level, onCase, undefined, undefined, source)` runs every `'js'`
  test of a `mode: 'js'` level.
- `sim.js.setDatasets(provider)` / `setRunner(runner)` configure the host;
  `new SimHost(now, schedule, { datasets, runner })` does the same.
