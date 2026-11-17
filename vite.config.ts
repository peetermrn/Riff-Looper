/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // @ffmpeg/ffmpeg creates its own Web Worker; pre-bundling breaks that in dev.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'] },
});
