import { defineConfig, devices } from '@playwright/test';
import { availableParallelism } from 'node:os';

// Some shells set both FORCE_COLOR and NO_COLOR. Node warns before every Playwright
// worker when both are inherited, so prefer the explicit force-color request for tests.
if (process.env.FORCE_COLOR && process.env.NO_COLOR) delete process.env.NO_COLOR;

const MAX_BROWSER_WORKERS = 4;
const parseWorkerCount = (value: string | undefined) => {
  if (!value) return Math.max(1, Math.min(MAX_BROWSER_WORKERS, availableParallelism()));
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('PLAYWRIGHT_WORKERS must be a positive integer');
  return parsed;
};
const workerCount = parseWorkerCount(process.env.PLAYWRIGHT_WORKERS);
const serverMode = process.env.PLAYWRIGHT_SERVER ?? 'preview';
const auditEnabled = process.env.CHROMEBOOK_AUDIT === '1';
const serverPort = Number(process.env.PLAYWRIGHT_PORT ?? 5173);
if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
  throw new Error('PLAYWRIGHT_PORT must be a valid TCP port');
}
const cleanColorEnv = 'env -u NO_COLOR ';
const webServerCommand = serverMode === 'preview'
  ? `${cleanColorEnv}${auditEnabled ? 'MOTIONSMITH_AUDIT_ISOLATION=1 ' : ''}bun run preview -- --host 127.0.0.1 --port ${serverPort} --strictPort`
  : `${cleanColorEnv}bun run dev -- --host 127.0.0.1 --port ${serverPort}`;

export default defineConfig({
  testDir: './tests/browser',
  timeout: 0,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: workerCount,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${serverPort}`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    ...(auditEnabled ? {
      channel: 'chrome',
      viewport: { width: 1366, height: 768 },
      screen: { width: 1366, height: 768 },
      deviceScaleFactor: 1,
      launchOptions: { args: ['--enable-precise-memory-info'] },
    } : {}),
  },
  webServer: {
    command: webServerCommand,
    url: `http://127.0.0.1:${serverPort}`,
    reuseExistingServer: !process.env.CI && !auditEnabled,
    timeout: 120_000
  },
  projects: [
    { name: auditEnabled ? 'chrome-audit' : 'chromium' }
  ]
});
