/**
 * Browser entry of the sandbox runtime. Vite bundles it as a worker script
 * (`?worker&url`, which drops exports), so it publishes boot() on the global
 * scope for the bundle's loader instead of exporting it.
 */
import { boot } from './runtime';

(globalThis as unknown as { __bacRuntime?: unknown }).__bacRuntime = { boot };
