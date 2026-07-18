import { defineConfig, devices } from '@playwright/test';
import { availableParallelism } from 'node:os';

// Some shells set both FORCE_COLOR and NO_COLOR. Node warns before every Playwright
// worker when both are inherited, so prefer the explicit force-color request for tests.
if (process.env.FORCE_COLOR && process.env.NO_COLOR) delete process.env.NO_COLOR;

const MAX_BROWSER_WORKERS = 4;
const previewPort = Number(process.env.PLAYWRIGHT_PORT ?? 5173);
if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65_535)
  throw new Error('PLAYWRIGHT_PORT must be a valid TCP port');
const parseWorkerCount = (value: string | undefined) => {
  if (!value) return Math.max(1, Math.min(MAX_BROWSER_WORKERS, availableParallelism()));
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('PLAYWRIGHT_WORKERS must be a positive integer');
  return parsed;
};
const workerCount = parseWorkerCount(process.env.PLAYWRIGHT_WORKERS);
const serverMode = process.env.PLAYWRIGHT_SERVER ?? 'preview';
const cleanColorEnv = 'env -u NO_COLOR ';
const previewUrl = `http://127.0.0.1:${previewPort}`;
const webServerCommand = serverMode === 'preview'
  ? `${cleanColorEnv}bun run preview -- --host 127.0.0.1 --port ${previewPort} --strictPort`
  : `${cleanColorEnv}bun run dev -- --host 127.0.0.1 --port ${previewPort} --strictPort`;

export default defineConfig({
  testDir: './tests/browser',
  timeout: 0,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: workerCount,
  reporter: [['list']],
  use: {
    baseURL: previewUrl,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome']
  },
  webServer: {
    command: webServerCommand,
    url: previewUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ]
});
