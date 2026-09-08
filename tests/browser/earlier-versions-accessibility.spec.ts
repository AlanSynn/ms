import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { dismissStartupAnnouncement } from './startupHarness';
import { createSampleProject, serializeProject } from '../../utils/project';
import type { ProjectState } from '../../types';

const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? '/';
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
] as const;

const entry = (page: Page) => page.getByTestId('getting-started-dialog');
const lifecycle = (page: Page) => page.getByTestId('project-lifecycle-panel');
const historyPanel = (page: Page) => page.getByTestId('earlier-versions-panel');

const openApp = async (page: Page) => {
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  await expect(entry(page)).toBeVisible();
};

const openStarter = async (page: Page) => {
  await entry(page).getByRole('button', { name: 'Open starter rig', exact: true }).click();
  await expect(entry(page)).toHaveCount(0);
  await expect(page.getByTestId('character-screen')).toBeVisible();
};

const editHead = async (page: Page, rotation: number) => {
  await page.getByTestId('workflow-stage-character').click();
  await page.getByTestId('character-part-item-head').click();
  const field = page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true });
  await field.fill(String(rotation));
  await field.press('Tab');
  await expect(field).toHaveValue(String(rotation));
};

const openVersions = async (page: Page) => {
  await page.getByTestId('workflow-stage-project').click();
  await expect.poll(async () => {
    if (await historyPanel(page).count()) return 'history';
    if (await lifecycle(page).count()) return 'lifecycle';
    return '';
  }).not.toBe('');
  if (await lifecycle(page).count()) await lifecycle(page).getByTestId('project-earlier-versions').click();
  await expect(historyPanel(page)).toBeVisible();
  await expect(page.getByTestId('earlier-versions-list')).toBeVisible();
};

const closeVersions = async (page: Page) => {
  await page.getByTestId('workflow-stage-project').click();
  await expect.poll(async () => {
    if (await historyPanel(page).count()) return 'history';
    if (await lifecycle(page).count()) return 'lifecycle';
    return '';
  }).not.toBe('');
  if (await historyPanel(page).count()) await historyPanel(page).getByTestId('earlier-versions-close').click();
  await expect(lifecycle(page)).toBeVisible();
};

const keepNamedVersion = async (page: Page, name: string) => {
  const field = page.getByLabel('Keep version name');
  await expect(field).toHaveAttribute('maxlength', '80');
  await field.fill(name);
  await page.getByTestId('earlier-version-keep').click();
  const row = historyPanel(page).locator('[data-version-reason="manual"]').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-version-status', 'committed');
  return row;
};

const selectPreview = async (page: Page, row: Locator) => {
  await row.locator('[data-earlier-version-select]').click();
  const preview = page.getByTestId('earlier-version-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('data-preview-read-only', 'true');
  await expect(page.getByTestId('earlier-version-viewing')).toHaveText('Viewing earlier version');
  return preview;
};

const waitForReadyViewer = async (preview: Locator) => {
  const viewer = preview.getByTestId('project-three-puppet');
  await expect(viewer).toHaveAttribute('data-three-initial-scene-ready', 'true', { timeout: 30_000 });
  await expect(viewer).toHaveAttribute('data-three-renderer-status', 'webgl');
  await expect.poll(async () => Number(await viewer.getAttribute('data-part-count') ?? 0)).toBeGreaterThan(1);
  const box = await viewer.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(200);
  expect(box?.height ?? 0).toBeGreaterThan(200);
  return viewer;
};

const expectPreviewControlsFit = async (page: Page, preview: Locator) => {
  const bounds = await preview.boundingBox();
  const controls = preview.getByTestId('earlier-version-controls');
  await expect(controls).toBeVisible();
  const fit = await controls.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  const canvasLeft = bounds?.x ?? 0;
  const canvasTop = bounds?.y ?? 0;
  const canvasRight = canvasLeft + (bounds?.width ?? fit.viewportWidth);
  const canvasBottom = canvasTop + (bounds?.height ?? fit.viewportHeight);
  expect(fit.left).toBeGreaterThanOrEqual(canvasLeft);
  expect(fit.top).toBeGreaterThanOrEqual(canvasTop);
  expect(fit.right).toBeLessThanOrEqual(canvasRight);
  expect(fit.right).toBeLessThanOrEqual(fit.viewportWidth);
  expect(fit.bottom).toBeLessThanOrEqual(canvasBottom);
  expect(fit.bottom).toBeLessThanOrEqual(fit.viewportHeight);
  for (const testId of [
    'earlier-version-viewing',
    'earlier-version-playback',
    'earlier-version-back',
    'earlier-version-restore',
  ]) {
    const control = preview.getByTestId(testId);
    await expect(control).toBeVisible();
    const controlBounds = await control.boundingBox();
    if (testId === 'earlier-version-back' || testId === 'earlier-version-restore') {
      expect(await control.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), `${testId} receives pointer input above the renderer`).toBe(true);
    }
    const controlBottom = controlBounds
      ? controlBounds.y + controlBounds.height
      : Number.POSITIVE_INFINITY;
    expect(controlBottom).toBeLessThanOrEqual(fit.viewportHeight);
  }
};

const projectFile = (project: ProjectState) => ({
  name: 'other-browser-project.motionsmith',
  mimeType: 'application/json',
  buffer: Buffer.from(serializeProject(project)),
});

const openOtherProject = async (page: Page) => {
  const other = createSampleProject();
  other.metadata = { ...other.metadata, name: 'Other browser project' };
  const chooserPromise = page.waitForEvent('filechooser');
  const dialogPromise = page.waitForEvent('dialog');
  await lifecycle(page).getByRole('button', { name: 'Open Project', exact: true }).click();
  await (await chooserPromise).setFiles(projectFile(other));
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('confirm');
  expect(dialog.message()).toContain('Current work will be kept');
  await dialog.accept();
  await expect(page.getByTestId('status-bar')).toContainText('Loaded project');
};

const findProjectVersions = async (page: Page, query: string) => {
  await page.getByTestId('find-feature-entry').click();
  const dialog = page.getByRole('dialog', { name: 'Find a feature', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Find a feature' })).toBeFocused();
  await dialog.getByRole('combobox', { name: 'Find a feature' }).fill(query);
  const result = dialog.locator('[data-feature-result="project.versions"]');
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByTestId('command-open-earlier-versions')).toBeVisible();
  await expect(page.getByTestId('command-open-earlier-versions')).toBeFocused();
  await expect(historyPanel(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
};

for (const viewport of VIEWPORTS) {
  test(`Earlier versions stay usable and keyboard accessible at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo: TestInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    let downloads = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('download', () => { downloads += 1; });

    await openApp(page);
    await openStarter(page);
    await editHead(page, 12);
    await openVersions(page);

    const selectedRow = await keepNamedVersion(page, 'Accessibility baseline');
    const selectedButton = selectedRow.locator('[data-earlier-version-select]');
    const preview = await selectPreview(page, selectedRow);
    const viewer = await waitForReadyViewer(preview);
    await expectPreviewControlsFit(page, preview);
    await page.waitForTimeout(150);
    await page.screenshot({ path: testInfo.outputPath(`earlier-versions-ready-${viewport.width}.png`) });

    await preview.getByTestId('earlier-version-play').click();
    await expect(preview.getByTestId('earlier-version-play')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(220);
    await preview.getByTestId('earlier-version-play').click();
    await preview.getByTestId('earlier-version-scrubber').fill('500');
    await expect(preview.getByTestId('earlier-version-scrubber')).toHaveValue('500');

    const viewerBox = await viewer.boundingBox();
    expect(viewerBox).toBeTruthy();
    await viewer.click({ position: { x: (viewerBox?.width ?? 400) * .52, y: (viewerBox?.height ?? 300) * .38 } });
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '')).toBe('earlier-version-preview');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('earlier-version-preview')).toHaveCount(0);
    await expect(selectedButton).toBeFocused();

    const previewAgain = await selectPreview(page, selectedRow);
    await waitForReadyViewer(previewAgain);
    await previewAgain.getByTestId('earlier-version-back').click();
    await expect(page.getByTestId('earlier-version-preview')).toHaveCount(0);
    await expect(selectedButton).toBeFocused();
    await historyPanel(page).getByTestId('earlier-versions-close').click();
    await expect(lifecycle(page)).toBeVisible();
    await expect(page.getByTestId('project-earlier-versions')).toBeFocused();

    for (const query of ['go back', 'earlier version', 'before my changes']) {
      await findProjectVersions(page, query);
      expect(downloads, `${query} only reveals a control`).toBe(0);
      await expect(historyPanel(page)).toHaveCount(0);
    }

    await openVersions(page);
    for (let index = 1; index <= 7; index += 1) {
      await keepNamedVersion(page, `Scroll checkpoint ${index}`);
    }
    const list = page.getByTestId('earlier-versions-list');
    const initialScroll = await list.evaluate(element => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    expect(initialScroll.scrollHeight).toBeGreaterThan(initialScroll.clientHeight);
    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);

    await closeVersions(page);
    const firstProjectName = await page.getByTestId('project-summary').locator('h3').textContent();
    await openOtherProject(page);
    await openVersions(page);

    const storageToggle = page.getByTestId('earlier-browser-storage-toggle');
    await expect(storageToggle).toHaveAttribute('aria-expanded', 'false');
    await storageToggle.click();
    await expect(storageToggle).toHaveAttribute('aria-expanded', 'true');
    const storage = page.getByTestId('earlier-browser-storage');
    await expect(storage).toBeVisible();
    const branch = storage.locator('[data-testid^="earlier-browser-storage-branch-"]').first();
    await expect(branch).toBeVisible();
    if (firstProjectName) await expect(branch).toContainText(firstProjectName.trim());
    await expect(branch).toContainText(/\d+(?:\.\d+)? (?:B|KiB|MiB)/);
    await expect(branch).toContainText(/\d+ versions/);
    await expect(branch.getByRole('button', { name: /Delete browser versions for/ })).toBeVisible();
    await storageToggle.click();
    await expect(page.getByTestId('earlier-browser-storage')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
