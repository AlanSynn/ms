import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';
import type { Point } from '../../types';
import { createBuildPlanV1 } from '../../utils/buildPlan';
import { dismissStartupAnnouncement } from './startupHarness';
import { APP_PATH, saveFile, drawMark, pixel, installedArtwork } from './paintingHarness';

test.use({ viewport: { width: 1280, height: 720 }, trace: 'on' });
const drawOutline = async (page: Page, points: Point[]) => {
  const dialog = page.getByTestId('shape-editor');
  await dialog.getByRole('button', { name: 'Draw outline', exact: true }).click();
  const svg = dialog.getByTestId('shape-editor-canvas');
  const box = (await svg.boundingBox())!;
  const [x, y, width, height] = (await svg.getAttribute('viewBox'))!.split(' ').map(Number);
  const screen = (point: Point) => ({ x: box.x + (point.x - x) / width * box.width, y: box.y + (-point.y - y) / height * box.height });
  const first = screen(points[0]);
  await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const point of [...points.slice(1), points[0]]) {
    const next = screen(point); await page.mouse.move(next.x, next.y, { steps: 2 });
  }
  await page.mouse.up();
};

test('drawn rocket retains ink through custom cuts, files, painted builds and object motion', async ({ page, browser, baseURL }, info) => {
  await page.goto(APP_PATH); await dismissStartupAnnouncement(page);
  await page.getByTestId('getting-started-dialog').getByRole('button', { name: 'Open starter rig', exact: true }).click();
  const baseline = await saveFile(page, info, 'starter');
  expect(Object.values(baseline.project.parts).every(part => !part.textureUrl && !part.artwork)).toBe(true);
  await page.getByTestId('character-draw-object').click();
  await drawMark(page, [{ x: -10, y: 0 }, { x: 10, y: 0 }]);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  // Toolbar focus still routes shortcuts to the uncommitted draft's history.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => pixel(page, { x: 0, y: 0 })).toEqual([255, 255, 255, 255]);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => pixel(page, { x: 0, y: 0 })).toEqual([239, 71, 111, 255]);
  await page.getByTestId('paint-workspace').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await saveFile(page, info, 'canceled-draft')).project).toEqual(baseline.project);

  await page.getByTestId('character-draw-object').click();
  await page.getByRole('textbox', { name: 'Object name', exact: true }).fill('Rocket');
  await page.getByTestId('paint-workspace').getByRole('button', { name: 'Change shape', exact: true }).click();
  await drawOutline(page, [{ x: 0, y: 38 }, { x: 20, y: 10 }, { x: 20, y: -18 }, { x: 32, y: -34 }, { x: 10, y: -26 },
    { x: 0, y: -37 }, { x: -10, y: -26 }, { x: -32, y: -34 }, { x: -20, y: -18 }, { x: -20, y: 10 }]);
  await page.getByTestId('use-shape').click();
  await page.getByRole('button', { name: 'Filled rectangle', exact: true }).click();
  await page.getByRole('button', { name: 'Paint color #2389da', exact: true }).click();
  await drawMark(page, [{ x: -38, y: -38 }, { x: 38, y: 38 }]);
  await expect.poll(() => pixel(page, { x: 19, y: 0 })).toEqual([35, 137, 218, 255]);
  await page.getByRole('button', { name: 'Filled ellipse', exact: true }).click();
  await page.getByRole('button', { name: 'Paint color #ffd166', exact: true }).click();
  await drawMark(page, [{ x: -10, y: 20 }, { x: 10, y: 0 }]);
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.getByRole('button', { name: 'Paint color #172033', exact: true }).click();
  await page.getByRole('button', { name: 'Thin brush', exact: true }).click();
  await drawMark(page, [{ x: -14, y: -15 }, { x: 14, y: -15 }]);
  expect((await saveFile(page, info, 'draft-not-project')).project).toEqual(baseline.project);
  await page.getByTestId('paint-workspace').getByRole('button', { name: 'Add object', exact: true }).click();
  const added = await saveFile(page, info, 'rocket-added');
  const id = added.project.selectedSceneObjectId!;
  expect(added.project.sceneObjects[id]).toMatchObject({ name: 'Rocket', fabrication: 'cuttable', contourSource: 'user' });
  expect(added.project.sceneObjects[id].artwork!.operations.map(op => op.kind)).toEqual(['rectangle', 'ellipse', 'line']);
  const initialObject = added.project.sceneObjects[id];
  await page.getByTestId('character-draw-paint').click();

  // Contour clipping hides retained ink without redefining its frame.
  await page.getByTestId('paint-workspace').getByRole('button', { name: 'Change shape', exact: true }).click();
  await page.getByTestId('shape-editor').getByRole('button', { name: 'Shrink', exact: true }).click();
  await page.getByTestId('use-shape').click();
  await expect.poll(async () => (await pixel(page, { x: 19, y: 0 }))[3]).toBe(0);
  const shrunk = await saveFile(page, info, 'rocket-shrunk');
  expect(shrunk.project.sceneObjects[id].artwork).toEqual(initialObject.artwork);
  expect(shrunk.project.sceneObjects[id].bounds).toEqual(initialObject.bounds);
  expect(shrunk.project.sceneObjects[id].transform).toEqual(initialObject.transform);
  await page.getByTestId('paint-workspace').getByRole('button', { name: 'Change shape', exact: true }).click();
  await page.getByTestId('shape-editor').getByRole('button', { name: 'Expand', exact: true }).click({ clickCount: 2 });
  await page.getByTestId('use-shape').click();
  await expect.poll(() => pixel(page, { x: 19, y: 0 })).toEqual([35, 137, 218, 255]);

  // Invalid candidates remain editable; Cancel restores the last committed silhouette.
  const valid = await saveFile(page, info, 'rocket-expanded');
  await page.getByTestId('paint-workspace').getByRole('button', { name: 'Change shape', exact: true }).click();
  await drawOutline(page, [{ x: -30, y: -30 }, { x: 30, y: 30 }, { x: -30, y: 30 }, { x: 30, y: -30 }]);
  await expect(page.getByTestId('use-shape')).toBeDisabled();
  await expect(page.getByTestId('shape-editor').getByRole('status')).toContainText('Uncross');
  await page.getByTestId('shape-editor').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await saveFile(page, info, 'invalid-kept')).project).toEqual(valid.project);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await installedArtwork(page, id, initialObject.artwork!.revision);

  // A normal object-motion binding is preserved through paint and portable files.
  await page.getByTestId('workflow-stage-path').click();
  await page.getByTestId('novice-path-panel').getByRole('button', { name: 'Add path', exact: true }).click();
  await page.getByLabel('New path target').selectOption(`scene-object:${id}`);
  await page.getByTestId('add-path-chooser').getByRole('button', { name: 'Create path', exact: true }).click();
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  const pathBox = (await page.getByTestId('path-three-puppet-canvas').boundingBox())!;
  await page.mouse.move(pathBox.x + pathBox.width * .45, pathBox.y + pathBox.height * .5); await page.mouse.down();
  await page.mouse.move(pathBox.x + pathBox.width * .55, pathBox.y + pathBox.height * .35, { steps: 5 });
  await page.mouse.move(pathBox.x + pathBox.width * .65, pathBox.y + pathBox.height * .5, { steps: 5 }); await page.mouse.up();
  const objectPosition = async () => {
    const targets = JSON.parse(await page.getByTestId('path-three-puppet-state').getAttribute('data-three-scene-object-screen-targets') || '[]');
    return targets.find((target: { id: string }) => target.id === id);
  };
  await expect.poll(objectPosition).toBeDefined();
  const atRest = await objectPosition();
  await page.getByRole('button', { name: 'Play paths', exact: true }).click();
  await expect.poll(objectPosition).not.toEqual(atRest);
  await page.getByRole('button', { name: 'Pause all paths', exact: true }).click();
  await installedArtwork(page, id, initialObject.artwork!.revision);
  const moving = await saveFile(page, info, 'rocket-class-one');
  expect(Object.values(moving.project.paths).some(path => path.sceneObjectId === id)).toBe(true);
  const geometry = createBuildPlanV1(moving.project).sourceDigest;
  await page.getByTestId('workflow-stage-blueprint').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Build PDF', exact: true }).click();
  const pdfPath = info.outputPath('rocket-build.pdf'); await (await download).saveAs(pdfPath);
  const pdf = await PDFDocument.load(await readFile(pdfPath));
  expect(pdf.getPages().some(p => p.node.Resources()?.has(PDFName.of('XObject')))).toBe(true);
  await page.getByTestId('workflow-stage-assembly').click();
  await expect(page.getByTestId('assembly-canvas-preview')).toBeVisible();
  await installedArtwork(page, id, initialObject.artwork!.revision);
  await page.screenshot({ path: info.outputPath('rocket-assembly.png') });

  const clean = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  try {
    const next = await clean.newPage(); await next.goto(APP_PATH); await dismissStartupAnnouncement(next);
    const chooser = next.waitForEvent('filechooser');
    await next.getByTestId('getting-started-dialog').getByRole('button', { name: 'Open Project', exact: true }).click();
    await (await chooser).setFiles(moving.file);
    await expect(next.getByTestId('status-bar')).toContainText('Loaded project');
    // Capture the reopened revision before repainting; import may normalize legacy defaults.
    await next.getByTestId('workflow-stage-blueprint').click();
    const reopenedDownload = next.waitForEvent('download');
    await next.getByRole('button', { name: 'Download Build PDF', exact: true }).click();
    const reopenedPdfPath = info.outputPath('rocket-reopened-build.pdf');
    await (await reopenedDownload).saveAs(reopenedPdfPath);
    const reopenedPdf = await PDFDocument.load(await readFile(reopenedPdfPath));
    const reopenedSource = JSON.parse(reopenedPdf.getSubject()!);
    await next.getByTestId('workflow-stage-character').click();
    await next.getByTestId(`scene-object-item-${id}`).click(); await next.getByTestId('character-draw-paint').click();
    await next.getByRole('button', { name: 'Paint color #ef476f', exact: true }).click();
    await drawMark(next, [{ x: -10, y: -6 }, { x: 10, y: -6 }]);
    const repainted = await saveFile(next, info, 'rocket-class-two');
    expect(repainted.project.paths).toEqual(moving.project.paths);
    expect(repainted.project.sceneObjects[id].artwork!.operations.length).toBe(4);
    expect(createBuildPlanV1(repainted.project).sourceDigest).toBe(geometry);
    await next.mouse.move(0, 0);
    await next.getByTestId('paint-workspace').screenshot({ path: info.outputPath('rocket-paint.png') });
    await next.getByRole('button', { name: 'Done', exact: true }).click();
    await next.getByTestId('workflow-stage-blueprint').click();
    const newDownload = next.waitForEvent('download'); await next.getByRole('button', { name: 'Download Build PDF', exact: true }).click();
    const newPdfPath = info.outputPath('rocket-repainted-build.pdf'); await (await newDownload).saveAs(newPdfPath);
    expect(Buffer.compare(await readFile(pdfPath), await readFile(newPdfPath))).not.toBe(0);
    const repaintedPdf = await PDFDocument.load(await readFile(newPdfPath));
    const repaintedSource = JSON.parse(repaintedPdf.getSubject()!);
    expect(repaintedSource.sourceDigest).toBe(reopenedSource.sourceDigest);
    expect(repaintedSource.artworkSourceDigest).not.toBe(reopenedSource.artworkSourceDigest);
    expect(repaintedPdf.getPages().map(p => p.getSize())).toEqual(reopenedPdf.getPages().map(p => p.getSize()));
  } finally { await clean.close(); }
});
