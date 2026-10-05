import { defineConfig } from 'vitest/config';

// Kernel builds and boots run millions of emulated instructions.
export default defineConfig({ test: { testTimeout: 120_000 } });
