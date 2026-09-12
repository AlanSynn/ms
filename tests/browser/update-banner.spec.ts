import { expect, test, type Page } from '@playwright/test';

import { dismissStartupAnnouncement } from './startupHarness';

const waitForEditor = async (page: Page) => {
  await dismissStartupAnnouncement(page);
  const welcome = page.getByTestId('getting-started-dialog');
  if (await welcome.count()) await welcome.getByRole('button', { name: 'Close', exact: true }).click();
};

const dispatchVisibilityRegain = (page: Page) =>
  page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test('no banner when the deployed build matches', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let probeAttempts = 0;
  await page.route('**/version.json*', async (route) => {
    probeAttempts += 1;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH ?? '/');
  await waitForEditor(page);
  await dispatchVisibilityRegain(page);
  await expect.poll(() => probeAttempts).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('update-banner')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('shows the reload banner when the deployed build differs', async ({ page }) => {
  await page.route('**/version.json*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: '0.0.0-update-check',
        buildId: 'deployed-build-2',
        builtAt: new Date().toISOString(),
      }),
    });
  });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH ?? '/');
  await waitForEditor(page);
  // The first visibility regain probes immediately: lastAttempt is still 0.
  await dispatchVisibilityRegain(page);
  const banner = page.getByTestId('update-banner');
  await expect(banner).toBeVisible();
  await banner.getByTestId('update-banner-reload').click();
  await expect(page).toHaveURL(/_rs=/);
});

test('probe failures stay silent', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let probeAttempts = 0;
  await page.route('**/version.json*', (route) => {
    probeAttempts += 1;
    return route.abort();
  });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH ?? '/');
  await waitForEditor(page);
  await dispatchVisibilityRegain(page);
  await expect.poll(() => probeAttempts).toBe(1);
  // Give the aborted fetch a beat to surface anything; nothing may appear.
  await page.waitForTimeout(500);
  await expect(page.getByTestId('update-banner')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('stale boot asset recovers with one cache-bust reload', async ({ page }) => {
  let staleMisses = 0;
  let retryLoads = 0;
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    if (new URL(page.url()).searchParams.has('_ms_boot_retry')) {
      retryLoads += 1;
      const response = await route.fetch();
      await route.fulfill({ response });
      return;
    }
    staleMisses += 1;
    await route.fulfill({ status: 404, contentType: 'application/javascript', body: '' });
  });
  // _rs is also used by the deliberate update-banner reload. It must not be
  // mistaken for an automatic retry marker.
  const appPath = process.env.PLAYWRIGHT_BASE_PATH ?? '/';
  await page.goto(`${appPath}${appPath.includes('?') ? '&' : '?'}_rs=manual-reload`);
  await waitForEditor(page);
  expect(staleMisses).toBe(1);
  expect(retryLoads).toBe(1);
  expect(new URL(page.url()).searchParams.has('_rs')).toBe(true);
  expect(new URL(page.url()).searchParams.has('_ms_boot_retry')).toBe(false);
  await expect(page.getByTestId('status-bar')).toBeVisible();
  // The successful retry boot re-arms the guard by clearing the retry flag.
  expect(await page.evaluate(() => window.sessionStorage.getItem('motionsmith-boot-retry'))).toBe(null);
});

test('persistent stale boot stops after one retry when session storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: {
        getItem() {
          throw new Error('session storage read unavailable');
        },
        setItem() {
          throw new Error('session storage write unavailable');
        },
      },
    });
  });
  let entryLoads = 0;
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    entryLoads += 1;
    await route.fulfill({ status: 404, contentType: 'application/javascript', body: '' });
  });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH ?? '/');
  await expect.poll(() => entryLoads).toBe(2);
  // The URL marker survives storage failures and prevents a persistent 404
  // from turning the tab into an automatic reload loop.
  await page.waitForTimeout(300);
  expect(entryLoads).toBe(2);
  expect(new URL(page.url()).searchParams.get('_ms_boot_retry')).toBe('1');
});

test('app-ready disarms boot recovery for later lazy failures', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH ?? '/');
  await waitForEditor(page);
  const beforeUrl = page.url();
  await page.evaluate(() => {
    const failedScript = document.createElement('script');
    document.head.append(failedScript);
    failedScript.dispatchEvent(new Event('error'));
    window.dispatchEvent(new Event('vite:preloadError'));
  });
  await page.waitForTimeout(300);
  expect(page.url()).toBe(beforeUrl);
});
