import { defineConfig } from '@playwright/test';

/**
 * Browser tests run against the production build (`vite preview`).
 *
 * Projects:
 *  - chrome:   the installed Google Chrome (has native AAC/M4A decoding)
 *  - firefox:  Playwright's Firefox build
 *  - chromium: Playwright's open-source Chromium. It has NO proprietary codecs,
 *              so AAC/M4A must go through the lazy ffmpeg.wasm fallback.
 */
const chromeArgs = ['--autoplay-policy=no-user-gesture-required'];

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1, // timing tests measure real-time audio; don't compete for CPU
  reporter: [['list']],
  globalSetup: './e2e/globalSetup.ts',
  use: {
    baseURL: 'http://localhost:4173',
    acceptDownloads: true,
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome', launchOptions: { args: chromeArgs } } },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        launchOptions: {
          firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false },
        },
      },
    },
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { args: chromeArgs } } },
  ],
});
