#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { ProjectState } from '../types';
import { applyProjectAction } from '../utils/project';
import { assertProjectRoundTrip } from '../utils/projectSerialization';
import { readPortableProjectBundle } from '../runtime/versions/versionPortable';
import { dismissStartupAnnouncement } from '../tests/browser/startupHarness';
import { assertEmbeddedProjectImages, sitePortabilityFixture } from './site-portability-fixture';

// This boundary serves only built assets, without SPA fallback or shared storage.
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };
type Site = { label: string; directory: string; base: string; origin: string; server: Server;
  build: Record<string, unknown>; served: Array<{ path: string; status: number; mime: string }> };
type Bundle = Awaited<ReturnType<typeof readPortableProjectBundle>>;
type Session = { page: Page; context: BrowserContext; errors: string[]; warnings: string[];
  workers: string[]; responses: Array<{ url: string; status: number; mime: string }>; tasks: Promise<void>[] };

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i], value = process.argv[i + 1];
  if (!['--existing-dist', '--candidate-ms-dist', '--candidate-root-dist', '--output'].includes(flag) || !value) {
    throw new Error('Usage: bun scripts/validate-site-portability.ts [--existing-dist DIR] [--candidate-ms-dist DIR] [--candidate-root-dist DIR] [--output DIR]');
  }
  args.set(flag, value);
}
const output = resolve(args.get('--output') ?? process.env.MS_PORTABILITY_OUTPUT ?? 'artifacts/site-validation/portability');
const specs = [
  { label: 'existing-release', base: '/ms/', directory: args.get('--existing-dist') ?? process.env.MS_EXISTING_DIST ?? 'artifacts/site-validation/existing' },
  { label: 'candidate-ms', base: '/ms/', directory: args.get('--candidate-ms-dist') ?? process.env.MS_CANDIDATE_MS_DIST ?? 'artifacts/site-validation/candidate-ms' },
  { label: 'candidate-root', base: '/', directory: args.get('--candidate-root-dist') ?? process.env.MS_CANDIDATE_ROOT_DIST ?? 'artifacts/site-validation/candidate-root' },
];

const serve = async (spec: typeof specs[number]): Promise<Site> => {
  const directory = await realpath(resolve(spec.directory));
  const index = await readFile(join(directory, 'index.html'), 'utf8');
  const version = /class="boot-version"[^>]*>v?([^<]+)/.exec(index)?.[1]?.trim();
  let build: Record<string, unknown> = { version, manifest: 'absent',
    ...(spec.label === 'existing-release' ? { deployedCommit: process.env.MS_EXISTING_COMMIT ?? 'not supplied' } : {}) };
  try { build = { ...build, ...JSON.parse(await readFile(join(directory, 'version.json'), 'utf8')), manifest: 'version.json' }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const served: Site['served'] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      if (!pathname.startsWith(spec.base)) throw Object.assign(new Error('Wrong build base'), { status: 404 });
      const local = pathname.slice(spec.base.length) || 'index.html';
      if (local.split('/').some(part => part === '..' || part === '.') || local.includes('\0')) throw new Error('Invalid asset path');
      const file = await realpath(resolve(directory, local));
      const contained = relative(directory, file);
      if (contained.startsWith(`..${sep}`) || contained === '..' || !contained) throw new Error('Invalid asset path');
      if (!(await stat(file)).isFile()) throw Object.assign(new Error('No asset'), { status: 404 });
      const mime = MIME[extname(file)] ?? 'application/octet-stream';
      const bytes = await readFile(file);
      served.push({ path: pathname, status: 200, mime });
      response.writeHead(200, { 'Content-Type': mime, 'Content-Length': bytes.length,
        'Cache-Control': file.endsWith('index.html') || file.endsWith('version.json') ? 'no-store' : 'public, max-age=31536000, immutable' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    })().catch(error => {
      const status = (error as { status?: number }).status ?? ((error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400);
      served.push({ path: request.url ?? '/', status, mime: 'text/plain' });
      response.writeHead(status, { 'Content-Type': 'text/plain' }); response.end('Asset unavailable');
    });
  });
  await new Promise<void>((done, failed) => { server.once('error', failed); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  assert(address && typeof address === 'object');
  return { ...spec, directory, build, served, server, origin: `http://127.0.0.1:${address.port}` };
};

const fresh = async (browser: Browser, site: Site): Promise<Session> => {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const session: Session = { context, page, errors: [], warnings: [], workers: [], responses: [], tasks: [] };
  // Freeze Date only: timers/animation remain real, automatic history never races the retained manual fixture.
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00.000Z'));
  await page.addInitScript(() => {
    const target = window as typeof window & { __siteWasm?: number };
    target.__siteWasm = 0;
    const instantiate = WebAssembly.instantiate;
    WebAssembly.instantiate = (async (...input: Parameters<typeof instantiate>) => {
      const result = await Reflect.apply(instantiate, WebAssembly, input);
      target.__siteWasm!++;
      return result;
    }) as typeof instantiate;
    const streaming = WebAssembly.instantiateStreaming;
    WebAssembly.instantiateStreaming = async (...input) => {
      const result = await Reflect.apply(streaming, WebAssembly, input);
      target.__siteWasm!++;
      return result;
    };
  });
  page.on('pageerror', error => session.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') session.errors.push(message.text());
    if (message.type() === 'warning') session.warnings.push(message.text());
  });
  page.on('requestfailed', request => session.errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('worker', worker => session.workers.push(worker.url()));
  page.on('response', response => {
    session.tasks.push((async () => {
      const headers = await response.allHeaders();
      session.responses.push({ url: response.url(), status: response.status(), mime: headers['content-type'] ?? '' });
    })());
  });
  await page.goto(`${site.origin}${site.base}`, { waitUntil: 'load' });
  await dismissStartupAnnouncement(page);
  await expect(page.getByTestId('getting-started-dialog')).toBeVisible({ timeout: 60_000 });
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('motionsmith.autosave'))), false,
    'Fresh origin must not inherit another site autosave');
  return session;
};

const open = async (session: Session, file: string) => {
  const { page } = session;
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('getting-started-dialog').getByRole('button', { name: 'Open Project', exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByTestId('status-bar')).toContainText('Loaded project', { timeout: 120_000 });
  await expect(page.getByTestId('getting-started-dialog')).toHaveCount(0);
  assert(session.workers.some(url => /projectImportWorker-[^/]+\.js/.test(url)), 'Open must use actual browser import Worker');
};

const save = async (page: Page, name: string): Promise<{ file: string; bundle: Bundle }> => {
  await page.getByTestId('workflow-stage-project').click();
  const file = join(output, `${name}.motionsmith`);
  const pending = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByTestId('project-lifecycle-panel').getByRole('button', { name: 'Save Project', exact: true }).click();
  const download = await pending;
  assert.match(download.suggestedFilename(), /\.motionsmith$/);
  await download.saveAs(file);
  assert.equal(await download.failure(), null);
  await expect(page.getByTestId('status-bar')).toContainText('Download started');
  const bundle = await readPortableProjectBundle(JSON.parse(await readFile(file, 'utf8')));
  assertEmbeddedProjectImages(bundle.project);
  return { file, bundle };
};

const editHead = async (page: Page, rotation: number) => {
  await page.getByTestId('workflow-stage-character').click();
  await page.getByTestId('character-part-item-head').click();
  const field = page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true });
  await field.fill(String(rotation)); await field.press('Tab');
  await expect(field).toHaveValue(String(rotation));
};

const assertHistory = (before: Bundle, after: Bundle) => {
  assert(before.history?.entries.length, 'Representative file must contain retained history');
  assert.deepEqual(after.history, before.history, 'Retained entries, snapshots and embedded historical artwork must survive exactly');
};
const assertEdit = (before: ProjectState, after: ProjectState, rotation: number) => {
  let expected = applyProjectAction(before, { type: 'select_part', partId: 'head' });
  expected = applyProjectAction(expected, { type: 'update_part', partId: 'head', updates: {
    transform: { ...before.parts.head.transform, rotation },
  } });
  assert(Number.isInteger(after.revision) && after.revision! > before.revision!, 'Authored edit advances revision');
  assert(Date.parse(after.metadata.updatedAt) >= Date.parse(before.metadata.updatedAt));
  expected.revision = after.revision; expected.metadata.updatedAt = after.metadata.updatedAt;
  assertProjectRoundTrip(expected, after);
};

const runtime = async (session: Session) => {
  const { page } = session;
  console.log('  Checking production Design and Foundry canvases, then Push physics');
  await page.getByTestId('workflow-stage-design').click();
  await expect(page.getByTestId('foundry-preview')).toHaveAttribute('data-three-renderer-status', 'webgl', { timeout: 120_000 });
  await expect(page.getByTestId('foundry-preview')).toHaveAttribute('data-three-topology-ready', 'true', { timeout: 120_000 });
  await page.getByTestId('workflow-stage-foundry').click();
  const preview = page.getByTestId('foundry-preview');
  await expect(preview).toHaveAttribute('data-three-renderer-status', 'webgl', { timeout: 120_000 });
  await expect(preview).toHaveAttribute('data-three-topology-ready', 'true', { timeout: 120_000 });
  await expect(preview.locator('canvas.foundry-three-canvas')).toBeVisible();
  const before = await page.evaluate(() => (window as typeof window & { __siteWasm: number }).__siteWasm);
  assert.equal(before, 0, 'Rapier must stay lazy until Push is requested');
  const loaded = page.waitForResponse(response => /\/assets\/rapier-[^/]+\.js(?:\?|$)/.test(response.url()), { timeout: 120_000 });
  const push = page.getByTestId('foundry-toggle-forces');
  await push.click();
  await expect(push).toHaveAttribute('aria-pressed', 'true');
  await expect(preview).toHaveAttribute('data-layer-forces', 'shown');
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __siteWasm: number }).__siteWasm),
    { timeout: 120_000, message: 'Push instantiates actual Rapier WebAssembly' }).toBeGreaterThan(before);
  const response = await loaded;
  assert.equal(response.status(), 200);
  // Read the official version export from the same module already loaded by Push.
  // Its cached module identity preserves the real initialized WASM instance.
  const physicsKernel = await page.evaluate(async url => (await import(url)).version(), response.url());
  assert.match(physicsKernel, /^\d+\.\d+\.\d+$/);
  await push.click();
  await expect(preview).toHaveAttribute('data-layer-forces', 'hidden');
  return { physicsKernel,
    wasmInstantiations: await page.evaluate(() => (window as typeof window & { __siteWasm: number }).__siteWasm) };
};

const inspect = async (session: Session, site: Site, label: string) => {
  await Promise.all(session.tasks);
  for (const response of session.responses) {
    const url = new URL(response.url);
    assert.equal(url.origin, site.origin, `No asset may depend on another origin: ${url}`);
    assert(url.pathname.startsWith(site.base), `Wrong asset base: ${url}`);
    assert(response.status < 400, `${response.status}: ${url}`);
    const mime = MIME[extname(url.pathname)];
    if (mime) assert.equal(response.mime.split(';')[0], mime.split(';')[0], `Asset MIME: ${url}`);
  }
  assert.deepEqual(session.errors, [], `${label}: browser console, script and network errors`);
  assert(session.responses.some(item => /\/assets\/rapier-[^/]+\.js/.test(item.url)), 'Actual lazy Rapier chunk loaded');
  assert(session.responses.some(item => /\/assets\/(?:MechanismDesign|DesignStage|MechanismFoundry|FoundryStage)[^/]*\.js/.test(item.url)), 'Actual optional stage chunks loaded');
  const imported = session.workers.filter(url => /projectImportWorker-[^/]+\.js/.test(url));
  for (const url of imported) assert(site.served.some(item => new URL(url).pathname === item.path && item.status === 200 && item.mime.startsWith('text/javascript')),
    'Browser import Worker was served with JavaScript MIME');
  await session.page.screenshot({ path: join(output, `${label}.png`) });
  return { label, origin: site.origin, build: site.build, workers: session.workers, responses: session.responses,
    warnings: session.warnings, errors: session.errors };
};

const sites: Site[] = [];
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), passed: false, checks: [] };
let browser: Browser | undefined;
await mkdir(output, { recursive: true });
try {
  for (const spec of specs) sites.push(await serve(spec));
  assert.equal(new Set(sites.map(site => site.directory)).size, 3, 'Separate production build outputs required');
  assert.equal(new Set(sites.map(site => site.origin)).size, 3, 'Separate origins required');
  const [existing, candidateMs, candidateRoot] = sites;
  assert.equal(candidateMs.build.version, candidateRoot.build.version, 'Candidate builds must use the same version');
  assert.equal(candidateMs.build.buildId, candidateRoot.build.buildId, 'Candidate builds must use the same commit');
  report.builds = sites.map(({ label, directory, origin, base, build }) => ({ label, directory, origin, base, build }));
  const fixture = await sitePortabilityFixture();
  const fixtureFile = join(output, 'synthetic-fixture.motionsmith');
  await writeFile(fixtureFile, Buffer.from(await fixture.blob.arrayBuffer()));
  browser = await chromium.launch();
  for (const [label, source, rotation] of [
    ['A-candidate-origin-path', candidateMs, 17], ['B-deployed-release', existing, 29],
  ] as const) {
    console.log(`${label}: ${source.label} Save → candidate-root Open/edit/Save → ${source.label} Open/Save`);
    const diagnostics: unknown[] = [];
    let session = await fresh(browser, source);
    let first: Awaited<ReturnType<typeof save>>;
    try {
      await open(session, fixtureFile);
      const physics = await runtime(session);
      first = await save(session.page, `${label}-source`);
      assertProjectRoundTrip(fixture.project, first.bundle.project);
      assertHistory({ project: fixture.project, history: fixture.history }, first.bundle);
      diagnostics.push({ ...(await inspect(session, source, `${label}-source`)), ...physics });
    } finally { await session.context.close(); }
    session = await fresh(browser, candidateRoot);
    let changed: Awaited<ReturnType<typeof save>>;
    try {
      await open(session, first.file);
      const opened = await save(session.page, `${label}-opened`);
      assertProjectRoundTrip(first.bundle.project, opened.bundle.project); assertHistory(first.bundle, opened.bundle);
      await editHead(session.page, rotation);
      const physics = await runtime(session);
      changed = await save(session.page, `${label}-edited`);
      assertEdit(opened.bundle.project, changed.bundle.project, rotation); assertHistory(first.bundle, changed.bundle);
      diagnostics.push({ ...(await inspect(session, candidateRoot, `${label}-edited`)), ...physics });
    } finally { await session.context.close(); }
    session = await fresh(browser, source);
    try {
      await open(session, changed.file);
      const physics = await runtime(session);
      const returned = await save(session.page, `${label}-returned`);
      assertProjectRoundTrip(changed.bundle.project, returned.bundle.project); assertHistory(first.bundle, returned.bundle);
      diagnostics.push({ ...(await inspect(session, source, `${label}-returned`)), ...physics });
    } finally { await session.context.close(); }
    (report.checks as unknown[]).push({ label, passed: true, rotation, retainedVersions: first.bundle.history!.entries.length, diagnostics });
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  report.passed = true;
  console.log(`Both origin/path and deployed-release project round trips passed. Evidence: ${output}`);
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  for (const site of sites) await new Promise<void>((done, failed) => site.server.close(error => error ? failed(error) : done()));
}
