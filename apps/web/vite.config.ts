import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  server: {
    port: 5173,
    // Docker bind mounts miss files replaced by rename (sed -i, many editors); poll there.
    watch: process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
  },
  test: { environment: 'node' },
} as Parameters<typeof defineConfig>[0]);
