import { chromium, expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { ProjectState } from '../../types';
import { dismissStartupAnnouncement } from './startupHarness';
import { readPortableProjectBundle } from '../../runtime/versions/versionPortable';

test.use({ trace: 'on' });

const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? '/';
const entry = (page: Page) => page.getByTestId('getting-started-dialog');
const lifecycle = (page: Page) => page.getByTestId('project-lifecycle-panel');
const badgeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><path fill="#f5b847" stroke="#724115" stroke-width="5" d="M60 8 73 43 111 44 81 67 91 106 60 83 28 106 39 67 9 44 47 43Z"/></svg>';

const nextClass = async (baseURL: string | undefined, width = 1366) => {
  // A new browser process has no prior project cache, artwork, or preferences.
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL, acceptDownloads: true, viewport: { width, height: width === 1366 ? 768 : 720 } });
  const page = await context.newPage();
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  await expect(entry(page)).toBeVisible();
  await expect(page.getByTestId('recover-browser-backup')).toHaveCount(0);
  return { page, close: async () => {
    await browser.close();
  } };
};

const saveFile = async (page: Page, testInfo: TestInfo, label: string) => {
  await page.getByTestId('workflow-stage-project').click();
  const pending = page.waitForEvent('download');
  await lifecycle(page).getByRole('button', { name: 'Save Project', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.motionsmith$/);
  const file = testInfo.outputPath(`${label}-${download.suggestedFilename()}`);
  await download.saveAs(file);
  await expect(page.getByTestId('status-bar')).toContainText('Download started');
  const document = JSON.parse(await readFile(file, 'utf8'));
  expect(document.format).toBe('motionsmith-project');
  return { file, project: (await readPortableProjectBundle(document)).project };
};

const openFile = async (page: Page, file: string) => {
  const pending = page.waitForEvent('filechooser');
  await entry(page).getByRole('button', { name: 'Open Project', exact: true }).click();
  await (await pending).setFiles(file);
  await expect(entry(page)).toHaveCount(0);
  await expect(page.getByTestId('status-bar')).toContainText('Loaded project');
  await expect(page.locator('.editor-stage-frame[data-stage="path"]')).toBeVisible();
};

const editHead = async (page: Page, rotation: number) => {
  await page.getByTestId('workflow-stage-character').click();
  await page.getByTestId('character-part-item-head').click();
  await page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true }).fill(String(rotation));
  await page.getByTestId('part-art-controls').getByText('Artwork', { exact: true }).click();
  await page.getByTestId('part-art-controls').getByLabel('Scale number', { exact: true }).fill('1.1');
};

const addArtwork = async (page: Page) => {
  const pending = page.waitForEvent('filechooser');
  await page.getByTestId('character-add-scene-object').click();
  await (await pending).setFiles({ name: 'class-star.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(badgeSvg) });
  const inspector = page.getByTestId('scene-object-inspector');
  await expect(inspector).toBeVisible();
  await inspector.getByLabel('Object name').fill('Class star');
  await inspector.getByLabel('X number', { exact: true }).fill('-100');
  await inspector.getByLabel('Y number', { exact: true }).fill('-100');
};

const draw = async (page: Page, side: 'left' | 'right') => {
  await page.getByTestId('novice-path-panel').getByRole('button', { name: 'Draw free path', exact: true }).click();
  const state = page.getByTestId('path-three-puppet-state');
  await expect(state).toHaveAttribute('data-three-renderer', 'webgl');
  await expect(state).toHaveAttribute('data-camera-preset', 'front');
  const box = (await page.getByTestId('path-three-puppet-canvas').boundingBox())!;
  const x = box.x + box.width * (side === 'left' ? .35 : .65), y = box.y + box.height * .42;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 28, y - 25, { steps: 5 });
  await page.mouse.move(x + 58, y + 16, { steps: 5 });
  await page.mouse.move(x + 10, y + 38, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
};

const addLeftPath = async (page: Page) => {
  await page.getByTestId('workflow-stage-path').click();
  await page.getByTestId('novice-path-panel').getByRole('button', { name: 'Add path', exact: true }).click();
  await page.getByLabel('New path target').selectOption('part:left_arm_lower');
  await page.getByTestId('add-path-chooser').getByRole('button', { name: 'Create path', exact: true }).click();
  await draw(page, 'left');
  await expect(page.getByTestId('motion-count')).toHaveText('2');
};

const workingPaths = async (page: Page, expectedIds: string[]) => {
  await page.getByTestId('workflow-stage-project').click();
  await expect(page.getByTestId('foundry-preview')).toHaveAttribute('data-three-topology-ready', 'true');
  const rig = page.getByTestId('foundry-camera-rig');
  await expect.poll(async () => JSON.parse(await rig.getAttribute('data-three-automata-paths') || '[]').map((path: { id: string }) => path.id)).toEqual(expectedIds);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('project-working-preview')).toBeVisible();
};

test('a student-created two-path project and its embedded artwork return through two real files', async ({ baseURL }, testInfo) => {
  let classroom = await nextClass(baseURL);
  try {
    let page = classroom.page;
    await entry(page).getByTestId('getting-started-card-guided').click();
    await entry(page).getByTestId('guided-project-card-waving-arm').click();
    await editHead(page, 18);
    await addArtwork(page);
    await addLeftPath(page);
    const original = await saveFile(page, testInfo, 'class-one');
    expect(original.project.parts.head.transform.rotation).toBe(18);
    expect(original.project.parts.head.transform.scale).toBe(1.1);
    expect(original.project.mechanisms).toHaveLength(1);
    expect(original.project.pathOrder).toEqual(['path-right-arm', 'path-left_arm_lower']);
    const objectId = original.project.sceneObjectOrder[0];
    expect(original.project.sceneObjects[objectId].textureUrl).toMatch(/^data:image\//);
    expect(original.project.sceneObjects[objectId].name).toBe('Class star');
    expect(Object.values(original.project.parts).some(part => part.textureUrl?.startsWith('data:image/'))).toBe(true);
    await workingPaths(page, original.project.pathOrder!);
    await page.getByTestId('design-foundry-camera-controls').getByRole('button', { name: 'Front', exact: true }).click();
    await page.getByRole('slider', { name: 'Workspace scrubber' }).fill('37');
    await page.screenshot({ path: testInfo.outputPath('project-two-paths-class-one.png') });
    await classroom.close();

    classroom = await nextClass(baseURL);
    page = classroom.page;
    await page.screenshot({ path: testInfo.outputPath('open-project-clean-entry.png') });
    await openFile(page, original.file);
    expect((await saveFile(page, testInfo, 'restored-one')).project).toEqual(original.project);
    await workingPaths(page, original.project.pathOrder!);
    await editHead(page, -12);
    await page.getByTestId('workflow-stage-path').click();
    await page.getByTestId('motion-item-path-left_arm_lower').click();
    await draw(page, 'right');
    const updated = await saveFile(page, testInfo, 'class-two');
    expect(updated.project.paths['path-right-arm']).toEqual(original.project.paths['path-right-arm']);
    expect(updated.project.paths['path-left_arm_lower'].points).not.toEqual(original.project.paths['path-left_arm_lower'].points);
    expect(updated.project.mechanisms).toEqual(original.project.mechanisms);
    expect(updated.project.sceneObjects).toEqual(original.project.sceneObjects);
    expect(updated.project.parts.head.transform.rotation).toBe(-12);
    await page.getByTestId('workflow-stage-blueprint').click();
    await expect(page.getByTestId('blueprint-canvas-preview')).toBeVisible();
    await expect(page.getByTestId('blueprint-unassigned-path-left_arm_lower')).toContainText('No mechanism');
    await page.getByTestId('workflow-stage-assembly').click();
    await expect(page.getByTestId('assembly-readonly-step-strip')).toBeVisible();
    await expect(page.getByTestId('assembly-step-list').getByRole('button').first()).toBeVisible();
    await page.getByTestId('assembly-step-list').getByRole('button').nth(1).click();
    await page.screenshot({ path: testInfo.outputPath('assembly-class-two.png') });
    await page.getByTestId('workflow-stage-path').click();
    await expect(page.getByTestId('motion-count')).toHaveText('2');
    expect((await saveFile(page, testInfo, 'after-assembly')).project.paths).toEqual(updated.project.paths);
    await classroom.close();

    classroom = await nextClass(baseURL, 1280);
    page = classroom.page;
    await openFile(page, updated.file);
    expect((await saveFile(page, testInfo, 'restored-two')).project).toEqual(updated.project);
    await workingPaths(page, updated.project.pathOrder!);
    await page.screenshot({ path: testInfo.outputPath('project-two-paths-class-three.png') });
  } finally { await classroom.close(); }
});

for (const kind of ['character-only', 'path-only'] as const) {
  test(`${kind} authoring saves and opens without a mechanism`, async ({ baseURL }, testInfo) => {
    let classroom = await nextClass(baseURL, 1280);
    try {
      let page = classroom.page;
      if (kind === 'character-only') {
        await entry(page).getByRole('button', { name: 'Close', exact: true }).click();
        await page.getByTestId('workflow-stage-character').click();
        await page.getByTestId('character-rig-actions').getByRole('button', { name: 'Add layer', exact: true }).click();
        await page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true }).fill('21');
      } else {
        await entry(page).getByRole('button', { name: 'Open starter rig', exact: true }).click();
        await editHead(page, 21);
      }
      await addArtwork(page);
      if (kind === 'path-only') {
        await page.getByTestId('workflow-stage-path').click();
        await page.getByLabel('Motion target').selectOption('right_arm_lower');
        await draw(page, 'right');
        await addLeftPath(page);
      }
      const saved = await saveFile(page, testInfo, kind);
      expect(saved.project.mechanisms).toEqual([]);
      expect(Object.keys(saved.project.paths)).toHaveLength(kind === 'path-only' ? 2 : 0);
      await classroom.close();
      classroom = await nextClass(baseURL, 1280);
      page = classroom.page;
      await openFile(page, saved.file);
      expect((await saveFile(page, testInfo, `${kind}-restored`)).project).toEqual(saved.project);
      await expect(page.getByTestId('project-three-puppet')).toHaveAttribute('data-three-initial-scene-ready', 'true');
      await expect(page.getByTestId('project-three-puppet-state')).toHaveAttribute('data-three-path-count', kind === 'path-only' ? '2' : '0');
      await expect(page.getByTestId('project-three-puppet-state')).toHaveAttribute('data-three-mechanism-count', '0');
      await page.screenshot({ path: testInfo.outputPath(`${kind}-restored.png`) });
    } finally { await classroom.close(); }
  });
}
