import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import type { ProjectState } from '../../types';
import { serializeProject } from '../../utils/project';
import { assertProjectRoundTrip } from '../../utils/projectSerialization';
import { dismissStartupAnnouncement } from './startupHarness';
import { APP_PATH, drawMark, installedArtwork, paintHead, pixel, saveFile } from './paintingHarness';

test.use({ viewport: { width: 1366, height: 768 }, trace: 'on' });

declare global {
  interface Window {
    __paintingDownloadFault: { created: string[]; revoked: string[]; failures: number; restore(): void };
    __paintingPngFault: { surfaces: Array<{ canvas: HTMLCanvasElement; width: number; height: number }>; restore(): void };
    __paintingImportGate: { hold: boolean; waiting: Array<() => void>; release(): void };
  }
}

const fileMenu = async (page: Page) => {
  const button = page.getByTestId('command-menu-file');
  if (!await button.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) await button.click();
};

const chooseFile = async (page: Page, content: string | null, name = 'replacement.motionsmith') => {
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page);
  await page.getByTestId('command-load-project').click();
  await (await chooser).setFiles(content === null ? [] : {
    name, mimeType: 'application/json', buffer: Buffer.from(content),
  });
};

/** Every failure case starts with real pointer-authored, downloaded retained art. */
const committedPainting = async (page: Page, info: TestInfo) => {
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  await page.getByTestId('getting-started-card-guided').click();
  await page.getByTestId('guided-project-card-waving-arm').click();
  await paintHead(page);
  await drawMark(page, [{ x: -23, y: 12 }, { x: 23, y: 12 }]);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await drawMark(page, [{ x: 0, y: 20 }, { x: 0, y: 4 }]);
  await expect.poll(() => pixel(page, { x: -15, y: 12 })).toEqual([239, 71, 111, 255]);
  await expect.poll(() => pixel(page, { x: 0, y: 12 })).not.toEqual([239, 71, 111, 255]);
  const saved = await saveFile(page, info, 'committed-painting');
  expect(saved.project.parts.head.artwork?.operations.map(operation => operation.kind)).toEqual(['brush', 'erase']);
  expect(saved.project.parts.head.textureUrl).toMatch(/^data:image\//);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await installedArtwork(page, 'head', saved.project.parts.head.artwork!.revision);
  return saved;
};

/** Refuse only the requested file download, leaving serialization and rendering real. */
const refuseDownload = (page: Page, suffix: string) => page.evaluate(extension => {
  const click = HTMLAnchorElement.prototype.click;
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  const fault = {
    created: [] as string[], revoked: [] as string[], failures: 0,
    restore() {
      HTMLAnchorElement.prototype.click = click;
      URL.createObjectURL = create;
      URL.revokeObjectURL = revoke;
    },
  };
  window.__paintingDownloadFault = fault;
  URL.createObjectURL = value => {
    const url = create(value);
    fault.created.push(url);
    return url;
  };
  URL.revokeObjectURL = url => { fault.revoked.push(url); revoke(url); };
  HTMLAnchorElement.prototype.click = function () {
    if (this.download.endsWith(extension) && this.href.startsWith('blob:')) {
      fault.failures += 1;
      throw new Error('Synthetic file download refused');
    }
    click.call(this);
  };
}, suffix);

const expectDownloadReleased = async (page: Page) => {
  await expect.poll(() => page.evaluate(() => {
    const fault = window.__paintingDownloadFault;
    return fault.failures > 0 && fault.created.length > 0 && fault.created.every(url => fault.revoked.includes(url));
  })).toBe(true);
  await expect(page.locator('a[download][href^="blob:"]')).toHaveCount(0);
};

test('a refused project download preserves retained paint and releases temporary resources', async ({ page }, info) => {
  const before = await committedPainting(page, info);
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await refuseDownload(page, '.motionsmith');
  try {
    await fileMenu(page);
    await page.getByTestId('command-download-snapshot').click();
    await expect(page.getByTestId('status-bar')).toContainText('Project save failed: Synthetic file download refused');
    expect(downloads).toBe(0);
    await expectDownloadReleased(page);
  } finally { await page.evaluate(() => window.__paintingDownloadFault.restore()); }
  assertProjectRoundTrip(before.project, (await saveFile(page, info, 'save-retry')).project);

  await paintHead(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByRole('button', { name: 'Paint color #06a77d', exact: true }).click();
  await drawMark(page, [{ x: 0, y: 12 }]);
  await expect.poll(() => pixel(page, { x: 0, y: 12 })).toEqual([6, 167, 125, 255]);
  const continued = await saveFile(page, info, 'paint-after-save-failure');
  expect(continued.project.parts.head.artwork?.operations.slice(0, 2)).toEqual(before.project.parts.head.artwork?.operations);
  expect(continued.project.parts.head.artwork?.operations).toHaveLength(3);
});

test('painted PDF encoding and download failures preserve source and allow real retry', async ({ page }, info) => {
  const before = await committedPainting(page, info);
  await page.getByTestId('workflow-stage-blueprint').click();
  await expect.poll(() => page.locator('[data-blueprint-artwork-owner]').evaluateAll(elements =>
    elements.length > 0 && elements.every(element => element.getAttribute('data-blueprint-artwork-status') === 'current'),
  )).toBe(true);
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  // The real print compositor calls toDataURL on a detached canvas. An empty
  // PNG result exercises its normal encoding failure; no app fault flag exists.
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toDataURL;
    const surfaces: Window['__paintingPngFault']['surfaces'] = [];
    window.__paintingPngFault = { surfaces, restore: () => { HTMLCanvasElement.prototype.toDataURL = original; } };
    HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
      if (type === 'image/png' && !this.isConnected) {
        surfaces.push({ canvas: this, width: this.width, height: this.height });
        return 'data:,';
      }
      return original.call(this, type, quality);
    };
  });
  try {
    await page.getByRole('button', { name: 'Download Build PDF', exact: true }).click();
    await expect(page.getByTestId('stage-left-pane')).toContainText('Painted image export failed. Your painting is unchanged.');
    await expect(page.getByRole('button', { name: 'Download Build PDF', exact: true })).toBeEnabled();
    expect(downloads).toBe(0);
    expect(await page.evaluate(() => window.__paintingPngFault.surfaces.every(surface =>
      surface.width > 0 && surface.height > 0 && surface.canvas.width === 0 && surface.canvas.height === 0,
    ) && window.__paintingPngFault.surfaces.length > 0)).toBe(true);
  } finally { await page.evaluate(() => window.__paintingPngFault.restore()); }
  assertProjectRoundTrip(before.project, (await saveFile(page, info, 'after-encoding-failure')).project);

  // This time the complete PDF is produced, but the browser refuses its download.
  await refuseDownload(page, '.pdf');
  const beforeRefusal = downloads;
  try {
    await page.getByRole('button', { name: 'Download Build PDF', exact: true }).click();
    await expect(page.getByTestId('stage-left-pane')).toContainText('PDF download failed: Synthetic file download refused');
    expect(downloads).toBe(beforeRefusal);
    await expectDownloadReleased(page);
  } finally { await page.evaluate(() => window.__paintingDownloadFault.restore()); }
  assertProjectRoundTrip(before.project, (await saveFile(page, info, 'after-pdf-download-failure')).project);

  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Build PDF', exact: true }).click();
  const output = info.outputPath('recovered-painted-build.pdf');
  await (await pending).saveAs(output);
  const pdf = await PDFDocument.load(await readFile(output));
  expect(pdf.getPageCount()).toBeGreaterThan(2);
  expect(pdf.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream
    && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')).length).toBeGreaterThan(0);
  // A cached package uses the same visible failure boundary as first generation.
  await refuseDownload(page, '.pdf');
  const beforeCachedRefusal = downloads;
  try {
    await page.getByRole('button', { name: 'Download Build PDF', exact: true }).click();
    await expect(page.getByTestId('stage-left-pane')).toContainText('PDF download failed: Synthetic file download refused');
    expect(downloads).toBe(beforeCachedRefusal);
    await expectDownloadReleased(page);
  } finally { await page.evaluate(() => window.__paintingDownloadFault.restore()); }
  assertProjectRoundTrip(before.project, (await saveFile(page, info, 'after-cached-pdf-failure')).project);
});

test('future or corrupt artwork and canceled imports preserve the committed painted project', async ({ page }, info) => {
  const before = await committedPainting(page, info);
  const future = structuredClone(before.project);
  (future.parts.head.artwork as unknown as { version: number }).version = 999;
  const corrupt = structuredClone(before.project);
  (corrupt.parts.head.artwork!.operations[0] as unknown as { points: unknown[] }).points = [{ x: 'invalid', y: 12 }];
  const missingSource = structuredClone(before.project);
  missingSource.parts.head.textureUrl = 'blob:missing-retained-source';
  // Serialize again so the portable integrity field is correct: each rejection
  // must reach the artwork/asset validator, rather than stop at a stale checksum.
  for (const [name, candidate, message] of [
    ['future-art', future, /unsupported artwork version/i],
    ['corrupt-art', corrupt, /finite artwork coordinates/i],
    ['missing-art', missingSource, /original embedded artwork asset is missing/i],
  ] as const) {
    await chooseFile(page, serializeProject(candidate), `${name}.motionsmith`);
    await expect(page.getByTestId('status-bar')).toContainText('Project import failed:');
    await expect(page.getByTestId('status-bar')).toContainText(message);
    await expect(page.getByTestId('project-file-input')).toHaveValue('');
    assertProjectRoundTrip(before.project, (await saveFile(page, info, `after-${name}`)).project);
  }
  await chooseFile(page, null);
  assertProjectRoundTrip(before.project, (await saveFile(page, info, 'after-empty-picker')).project);
  const replacement: ProjectState = { ...before.project, metadata: { ...before.project.metadata, id: 'replacement-file', name: 'Replacement painting' } };
  page.once('dialog', dialog => dialog.dismiss());
  await chooseFile(page, serializeProject(replacement));
  await expect(page.getByTestId('status-bar')).toHaveText('Project unchanged');
  assertProjectRoundTrip(before.project, (await saveFile(page, info, 'after-canceled-import')).project);

  // Accepting replacement still cannot discard paint if the required recovery
  // copy cannot be downloaded. The importer reports its existing cancellation.
  await refuseDownload(page, '.motionsmith');
  try {
    page.once('dialog', dialog => dialog.accept());
    await chooseFile(page, serializeProject(replacement));
    await expect(page.getByTestId('status-bar')).toContainText('Open cancelled: Synthetic file download refused');
    await expectDownloadReleased(page);
  } finally { await page.evaluate(() => window.__paintingDownloadFault.restore()); }
  assertProjectRoundTrip(before.project, (await saveFile(page, info, 'after-recovery-copy-failure')).project);
  await paintHead(page);
  await expect.poll(() => pixel(page, { x: -15, y: 12 })).toEqual([239, 71, 111, 255]);
});

test('a late real import cannot replace painting committed while it was opening', async ({ page }, info) => {
  await page.addInitScript(() => {
    const gate = { hold: false, waiting: [] as Array<() => void>,
      release() { this.hold = false; for (const deliver of this.waiting.splice(0)) deliver(); },
    };
    window.__paintingImportGate = gate;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name !== 'motionsmith-project-import') return;
        let listener: Worker['onmessage'] = null;
        Object.defineProperty(this, 'onmessage', { get: () => listener, set: next => { listener = next; } });
        this.addEventListener('message', event => {
          const captured = listener;
          if (!captured) return;
          const deliver = () => captured.call(this, event);
          if (gate.hold) gate.waiting.push(deliver);
          else deliver();
        });
      }
    };
  });
  const before = await committedPainting(page, info);
  const replacement = { ...before.project, metadata: { ...before.project.metadata, id: 'slow-replacement', name: 'Older incoming painting' } };
  await page.evaluate(() => { window.__paintingImportGate.hold = true; });
  await chooseFile(page, serializeProject(replacement), 'slow-painting.motionsmith');
  await expect.poll(() => page.evaluate(() => window.__paintingImportGate.waiting.length)).toBe(1);
  await paintHead(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByRole('button', { name: 'Paint color #06a77d', exact: true }).click();
  await drawMark(page, [{ x: 0, y: 12 }]);
  const edited = await saveFile(page, info, 'paint-committed-during-import');
  expect(edited.project.parts.head.artwork?.operations).toHaveLength(3);
  await page.evaluate(() => window.__paintingImportGate.release());
  await expect(page.getByTestId('status-bar')).toContainText('Project changed while opening. Open it again.');
  assertProjectRoundTrip(edited.project, (await saveFile(page, info, 'after-late-import')).project);
  await expect.poll(() => pixel(page, { x: 0, y: 12 })).toEqual([6, 167, 125, 255]);
});
