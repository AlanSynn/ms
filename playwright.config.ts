import { defineConfig, devices } from '@playwright/test';
import { availableParallelism } from 'node:os';

const MAX_BROWSER_WORKERS = 4;
const parseWorkerCount = (value: string | undefined) => {
  if (!value) return Math.max(1, Math.min(MAX_BROWSER_WORKERS, availableParallelism()));
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('PLAYWRIGHT_WORKERS must be a positive integer');
  return parsed;
};
const workerCount = parseWorkerCount(process.env.PLAYWRIGHT_WORKERS);
const serverMode = process.env.PLAYWRIGHT_SERVER ?? 'dev';
const webServerCommand = serverMode === 'preview'
  ? 'bun run preview -- --host 127.0.0.1 --port 5173 --strictPort'
  : 'bun run dev -- --host 127.0.0.1 --port 5173';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 0,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: workerCount,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome']
  },
  webServer: {
    command: webServerCommand,
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ]
});
