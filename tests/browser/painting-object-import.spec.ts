import { expect, test, type Page } from '@playwright/test';
import { assertProjectRoundTrip } from '../../utils/projectSerialization';
import { dismissStartupAnnouncement } from './startupHarness';
import { APP_PATH, drawMark, paintHead, pixel, saveFile } from './paintingHarness';

test.use({ viewport: { width: 1366, height: 768 }, trace: 'on' });

declare global {
  interface Window {
    __objectOriginalGate: { hold: boolean; waiting: Array<() => void>; release(): void };
  }
}

const originalSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">\n  <path d="M0 0H1024V768H0Z" fill="#2389da"/>\n</svg>';
type ImageFile = { name: string; mimeType: string; buffer: Buffer };
const importObject = async (page: Page, file: ImageFile) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('character-add-scene-object').click();
  await (await chooser).setFiles(file);
  await expect(page.getByTestId('scene-object-image-input')).toHaveValue('');
};
const objectNamed = (page: Page, name: string) => page.locator('[data-testid^="scene-object-item-"]')
  .filter({ hasText: name });
const fileMenu = async (page: Page) => {
  const button = page.getByTestId('command-menu-file');
  if (!await button.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) await button.click();
};

test('Import object keeps original PNG JPEG and SVG bytes through painting and file-only continuation', async ({ page, browser, baseURL }, info) => {
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  await page.getByTestId('getting-started-dialog').getByRole('button', { name: 'Open starter rig', exact: true }).click();
  // Browser encoders produce real native-size sources. No screenshot or worker
  // derivative is used as expected source data.
  const rasters = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 768;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#2389da'; context.fillRect(0, 0, 1024, 768);
    context.fillStyle = '#ffd166'; context.fillRect(700, 500, 160, 160);
    const values = ['image/png', 'image/jpeg'].map(mimeType => ({ mimeType, data: canvas.toDataURL(mimeType, 0.93) }));
    canvas.width = 0; canvas.height = 0;
    return values;
  });
  const originals = [...rasters.map(({ mimeType, data }, index) => ({
    name: index === 0 ? 'Original PNG.png' : 'Original JPEG.jpg', mimeType,
    buffer: Buffer.from(data.split(',')[1], 'base64'), data,
  })), { name: 'Original SVG.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(originalSvg),
    data: `data:image/svg+xml;base64,${Buffer.from(originalSvg).toString('base64')}` }];
  for (const original of originals) {
    await importObject(page, original);
    await expect(objectNamed(page, original.name.replace(/\.[^.]+$/, ''))).toHaveCount(1);
  }
  const imported = await saveFile(page, info, 'three-original-assets');
  expect(imported.project.sceneObjectOrder).toHaveLength(3);
  for (const [index, id] of imported.project.sceneObjectOrder.entries()) {
    const object = imported.project.sceneObjects[id];
    expect(object.textureUrl).toBe(originals[index].data);
    expect(object.bounds).toEqual({ width: 118, height: 88.5 });
    expect(await page.evaluate(async source => {
      const image = new Image(); image.src = source; await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }, object.textureUrl!)).toEqual([1024, 768]);
  }
  const id = imported.project.sceneObjectOrder[0];
  await page.getByTestId(`scene-object-item-${id}`).click();
  await page.getByTestId('character-draw-paint').click();
  await expect.poll(() => pixel(page, { x: -15, y: 0 })).toEqual([35, 137, 218, 255]);
  await drawMark(page, [{ x: -24, y: 0 }, { x: 24, y: 0 }]);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await drawMark(page, [{ x: 0, y: 8 }, { x: 0, y: -8 }]);
  await expect.poll(() => pixel(page, { x: -15, y: 0 })).toEqual([239, 71, 111, 255]);
  await expect.poll(() => pixel(page, { x: 0, y: 0 })).not.toEqual([239, 71, 111, 255]);
  const painted = await saveFile(page, info, 'original-painted-class-one');
  expect(painted.project.sceneObjects[id].textureUrl).toBe(originals[0].data);
  expect(painted.project.sceneObjects[id].contourPoints).toEqual(imported.project.sceneObjects[id].contourPoints);
  expect(painted.project.sceneObjects[id].artwork!.operations.map(operation => operation.kind)).toEqual(['brush', 'erase']);

  const clean = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  try {
    const next = await clean.newPage();
    await next.goto(APP_PATH); await dismissStartupAnnouncement(next);
    const chooser = next.waitForEvent('filechooser');
    await next.getByTestId('getting-started-dialog').getByRole('button', { name: 'Open Project', exact: true }).click();
    await (await chooser).setFiles(painted.file);
    await expect(next.getByTestId('status-bar')).toContainText('Loaded project');
    assertProjectRoundTrip(painted.project, (await saveFile(next, info, 'original-reopened')).project);
    await next.getByTestId('workflow-stage-character').click();
    await next.getByTestId(`scene-object-item-${id}`).click();
    await next.getByTestId('character-draw-paint').click();
    await expect.poll(() => pixel(next, { x: -15, y: 0 })).toEqual([239, 71, 111, 255]);
    await next.getByRole('button', { name: 'Brush', exact: true }).click();
    await next.getByRole('button', { name: 'Paint color #06a77d', exact: true }).click();
    await drawMark(next, [{ x: 0, y: 0 }]);
    await expect.poll(() => pixel(next, { x: 0, y: 0 })).toEqual([6, 167, 125, 255]);
    const continued = await saveFile(next, info, 'original-painted-class-two');
    expect(continued.project.sceneObjects[id].textureUrl).toBe(originals[0].data);
    expect(continued.project.sceneObjects[id].artwork!.operations.slice(0, 2)).toEqual(painted.project.sceneObjects[id].artwork!.operations);
    expect(continued.project.sceneObjects[id].artwork!.operations).toHaveLength(3);
    expect(continued.project.sceneObjects[id].artwork!.frame).toEqual(painted.project.sceneObjects[id].artwork!.frame);
  } finally { await clean.close(); }
});

test('late object import cannot cross same-project edits lesson reset or New Project', async ({ page }, info) => {
  // Delay a real named worker result, including a callback already queued before
  // worker termination. Validation, source bytes, and object creation stay real.
  await page.addInitScript(() => {
    const gate = { hold: false, waiting: [] as Array<() => void>,
      release() { this.hold = false; for (const deliver of this.waiting.splice(0)) deliver(); },
    };
    window.__objectOriginalGate = gate;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name !== 'motionsmith-scene-object-image') return;
        let listener: Worker['onmessage'] = null;
        Object.defineProperty(this, 'onmessage', { get: () => listener, set: next => { listener = next; } });
        this.addEventListener('message', event => {
          const captured = listener;
          if (!captured) return;
          const deliver = () => captured.call(this, event);
          if (gate.hold) gate.waiting.push(deliver); else deliver();
        });
      }
    };
  });
  await page.goto(APP_PATH); await dismissStartupAnnouncement(page);
  await page.getByTestId('getting-started-card-guided').click();
  await page.getByTestId('guided-project-card-waving-arm').click();
  await paintHead(page);
  await drawMark(page, [{ x: -20, y: 12 }, { x: 20, y: 12 }]);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const before = await saveFile(page, info, 'before-late-object');
  const pendingFile = { name: 'Late object.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(originalSvg) };
  const holdImport = async () => {
    await page.evaluate(() => { window.__objectOriginalGate.hold = true; });
    await importObject(page, pendingFile);
    await expect.poll(() => page.evaluate(() => window.__objectOriginalGate.waiting.length)).toBe(1);
  };
  await holdImport();
  await paintHead(page);
  await expect(page.getByTestId('character-status-dock')).toContainText('Project changed. Import object again.');
  await page.getByRole('button', { name: 'Paint color #06a77d', exact: true }).click();
  await drawMark(page, [{ x: 0, y: -12 }]);
  const edited = await saveFile(page, info, 'paint-during-object-import');
  expect(edited.project.metadata.id).toBe(before.project.metadata.id);
  expect(edited.project.parts.head.artwork!.operations).toHaveLength(2);
  await page.evaluate(() => window.__objectOriginalGate.release());
  assertProjectRoundTrip(edited.project, (await saveFile(page, info, 'after-late-object-edit')).project);
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  // Retrying against the current aggregate works and clears the retry message.
  await importObject(page, { ...pendingFile, name: 'Current object.svg' });
  await expect(objectNamed(page, 'Current object')).toHaveCount(1);
  await expect(page.getByTestId('character-status-dock')).toHaveCount(0);
  const retried = await saveFile(page, info, 'current-object-retry');
  expect(retried.project.sceneObjectOrder).toHaveLength(1);
  expect(retried.project.parts.head.artwork).toEqual(edited.project.parts.head.artwork);

  // Reset replaces the aggregate while Character stays mounted.
  await holdImport();
  page.once('dialog', dialog => dialog.accept());
  await fileMenu(page); await page.getByTestId('command-reset-lesson').click();
  await expect(page.getByTestId('status-bar')).toContainText('Lesson reset');
  const reset = await saveFile(page, info, 'reset-before-late-object');
  expect(reset.project.metadata.classroomLessonId).toBe(before.project.metadata.classroomLessonId);
  expect(reset.project.parts.head.artwork).toBeUndefined();
  expect(reset.project.sceneObjectOrder).toHaveLength(0);
  await page.evaluate(() => window.__objectOriginalGate.release());
  assertProjectRoundTrip(reset.project, (await saveFile(page, info, 'reset-after-late-object')).project);

  await holdImport();
  page.once('dialog', dialog => dialog.accept());
  await fileMenu(page); await page.locator('[data-command-id="project.new"]').click();
  await expect(page.getByTestId('status-bar')).toContainText('New project');
  await expect(page.getByTestId('character-part-item-head')).toHaveCount(0);
  const empty = await saveFile(page, info, 'new-before-late-object');
  await page.evaluate(() => window.__objectOriginalGate.release());
  const afterNew = await saveFile(page, info, 'new-after-late-object');
  assertProjectRoundTrip(empty.project, afterNew.project);
  expect(afterNew.project.sceneObjectOrder).toHaveLength(0);
  expect(afterNew.project.metadata.id).not.toBe(before.project.metadata.id);
});
