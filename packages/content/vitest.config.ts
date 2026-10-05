import { defineConfig } from 'vitest/config';

// Reference solutions for 8- and 32-bit levels run thousands of vectors; give
// them room on a busy machine (parallel CI, Turbo running every package).
export default defineConfig({ test: { testTimeout: 30_000 } });
