import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { sitePortabilityFixture } from './site-portability-fixture';
import { assertProjectRoundTrip } from '../utils/projectSerialization';
import { readPortableProjectBundle } from '../runtime/versions/versionPortable';
import { dismissStartupAnnouncement } from '../tests/browser/startupHarness';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:8792/');
if (url.pathname !== '/' || url.search || url.username || url.password
  || !((url.protocol === 'http:' && url.hostname === '127.0.0.1')
    || (url.protocol === 'https:' && ['motionsmith.org', 'motionsmith-site.alansynn.workers.dev'].includes(url.hostname)))) {
  throw new Error('Expected the dedicated local preview, workers.dev preview or motionsmith.org root.');
}
const output = 'artifacts/cloudflare-site/smoke';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const errors: string[] = [];
const responses: { path: string; status: number; mime: string; cache: string }[] = [];
const pending: Promise<void>[] = [];
try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const target = window as typeof window & { __smokeWasm: number };
    target.__smokeWasm = 0;
    const instantiate = WebAssembly.instantiate;
    WebAssembly.instantiate = (async (...args: Parameters<typeof instantiate>) => {
      const value = await Reflect.apply(instantiate, WebAssembly, args);
      target.__smokeWasm++;
      return value;
    }) as typeof instantiate;
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', response => {
    pending.push((async () => {
      const headers = await response.allHeaders();
      const asset = new URL(response.url());
      assert.equal(asset.origin, url.origin, 'startup/import never depends on another site');
      assert(response.status() < 400, `${response.status()}: ${asset.pathname}`);
      responses.push({ path: asset.pathname, status: response.status(),
        mime: headers['content-type'] ?? '', cache: headers['cache-control'] ?? '' });
    })());
  });
  await page.goto(url.href);
  await dismissStartupAnnouncement(page);
  const fixture = await sitePortabilityFixture();
  const input = `${output}/input.motionsmith`;
  await writeFile(input, Buffer.from(await fixture.blob.arrayBuffer()));
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('getting-started-open-project').click();
  await (await chooser).setFiles(input);
  await expect(page.getByTestId('status-bar')).toContainText('Loaded project', { timeout: 120_000 });
  await page.getByTestId('workflow-stage-project').click();
  const downloaded = page.waitForEvent('download');
  await page.getByTestId('project-lifecycle-panel').getByRole('button', { name: 'Save Project', exact: true }).click();
  const file = `${output}/saved.motionsmith`;
  await (await downloaded).saveAs(file);
  const saved = await readPortableProjectBundle(JSON.parse(await readFile(file, 'utf8')));
  assertProjectRoundTrip(fixture.project, saved.project);
  assert.deepEqual(saved.history, fixture.history);
  await page.locator('[data-help-id="project.moveBetweenSites"]').getByRole('button').click();
  await expect(page.getByRole('tooltip')).toContainText('Autosave is separate for each site.');
  await page.locator('[data-help-id="project.moveBetweenSites"]').getByRole('button').press('Escape');
  await page.getByTestId('workflow-stage-foundry').click();
  await expect(page.getByTestId('foundry-preview')).toHaveAttribute('data-three-renderer-status', 'webgl');
  const rapier = page.waitForResponse(response => /\/assets\/rapier-[^/]+\.js/.test(response.url()));
  await page.getByTestId('foundry-toggle-forces').click();
  assert.equal((await rapier).status(), 200);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __smokeWasm: number }).__smokeWasm),
    { timeout: 120_000 }).toBeGreaterThan(0);
  const phase = page.getByRole('slider', { name: 'Foundry phase', exact: true });
  await phase.fill('180');
  await expect(phase).toHaveValue('180');
  await page.getByTestId('foundry-toolbar').getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => phase.inputValue()).not.toBe('180');
  await page.getByTestId('foundry-toolbar').getByRole('button', { name: 'Pause', exact: true }).click();
  const versionResponse = await context.request.get(new URL('version.json', url).href);
  assert.equal(versionResponse.status(), 200);
  assert.match(versionResponse.headers()['content-type'], /application\/json/);
  assert.match(versionResponse.headers()['cache-control'], /no-store/);
  const version = await versionResponse.json();
  const missing = await context.request.get(new URL('assets/missing-required-chunk.js', url).href);
  assert.equal(missing.status(), 404, 'missing chunks must not receive index.html');
  await Promise.all(pending);
  assert.deepEqual(errors, []);
  for (const response of responses.filter(asset => asset.path.endsWith('.js'))) {
    assert.match(response.mime, /(?:text|application)\/javascript/);
    assert.match(response.cache, /immutable/);
  }
  const main = responses.find(response => response.path === '/');
  assert(main && /no-cache/.test(main.cache));
  assert.match(main.cache, /no-transform/, 'Cloudflare must serve authored HTML without automatic beacon injection');
  assert(responses.some(response => /projectImportWorker-[^/]+\.js/.test(response.path)));
  await page.screenshot({ path: `${output}/app.png` });
  const report = { passed: true, url: url.href, version, responses, errors, retainedVersions: saved.history?.entries.length,
    wasmInstantiations: await page.evaluate(() => (window as typeof window & { __smokeWasm: number }).__smokeWasm) };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, url: url.href, version, report: `${output}/report.json` }, null, 2));
} finally { await browser.close(); }
