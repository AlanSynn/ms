import { chromium, expect, test, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dismissStartupAnnouncement } from './startupHarness';
import { readPortableProjectBundle } from '../../runtime/versions/versionPortable';

test.use({ trace: 'on' });

const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? '/';

type OpenBrowser = { browser: Browser; page: Page };

const entry = (page: Page) => page.getByTestId('getting-started-dialog');
const lifecycle = (page: Page) => page.getByTestId('project-lifecycle-panel');
const historyPanel = (page: Page) => page.getByTestId('earlier-versions-panel');

const openCleanBrowser = async (baseURL: string | undefined, width = 1366): Promise<OpenBrowser> => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL,
    acceptDownloads: true,
    viewport: { width, height: width === 1366 ? 768 : 720 },
  });
  const page = await context.newPage();
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  return { browser, page };
};

const openStarter = async (page: Page, kind: 'starter' | 'guided' = 'starter') => {
  await expect(entry(page)).toBeVisible();
  await expect(page.getByTestId('recover-browser-backup')).toHaveCount(0);
  if (kind === 'guided') {
    await entry(page).getByRole('button', { name: 'Open Guide', exact: true }).click();
    await entry(page).getByTestId('guided-project-card-waving-arm').click();
  } else {
    await entry(page).getByRole('button', { name: 'Open starter rig', exact: true }).click();
  }
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
  const currentPanel = lifecycle(page);
  await expect.poll(async () => {
    if (await historyPanel(page).count()) return 'history';
    if (await currentPanel.count()) return 'current';
    return '';
  }).not.toBe('');
  if (await currentPanel.count()) {
    await currentPanel.getByTestId('project-earlier-versions').click();
  }
  await expect(historyPanel(page)).toBeVisible();
  await expect(page.getByTestId('earlier-versions-list')).toBeVisible();
};

const closeVersions = async (page: Page) => {
  await page.getByTestId('workflow-stage-project').click();
  await expect.poll(async () => {
    if (await historyPanel(page).count()) return 'history';
    if (await lifecycle(page).count()) return 'current';
    return '';
  }).not.toBe('');
  if (await historyPanel(page).count()) {
    await historyPanel(page).getByTestId('earlier-versions-close').click();
  }
  await expect(lifecycle(page)).toBeVisible();
};

const keepNamedVersion = async (page: Page, name: string) => {
  await openVersions(page);
  await page.locator('#earlier-version-name').fill(name);
  await page.getByTestId('earlier-version-keep').click();
  const row = historyPanel(page).locator('[data-version-reason="manual"]');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-version-status', 'committed');
  return row;
};

const saveProject = async (page: Page, testInfo: TestInfo, label: string) => {
  await closeVersions(page);
  const pending = page.waitForEvent('download');
  await lifecycle(page).getByRole('button', { name: 'Save Project', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.motionsmith$/);
  const file = testInfo.outputPath(`${label}-${download.suggestedFilename()}`);
  await download.saveAs(file);
  await expect(page.getByTestId('status-bar')).toContainText('Download started');
  const document = JSON.parse(await readFile(file, 'utf8')) as Record<string, any>;
  expect(document.format).toBe('motionsmith-project');
  const bundle = await readPortableProjectBundle(document);
  return { file, document, bundle };
};

const editPath = async (page: Page) => {
  await page.getByTestId('workflow-stage-path').click();
  await page.getByTestId('motion-item-path-right-arm').click();
  await page.getByTestId('novice-path-panel').getByRole('button', { name: /Draw free path|Redraw/ }).click();
  const canvas = page.getByRole('region', { name: 'Shared canvas', exact: true }).locator('canvas.three-puppet-canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width * .64;
  const y = box.y + box.height * .42;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 28, y - 25, { steps: 5 });
  await page.mouse.move(x + 58, y + 16, { steps: 5 });
  await page.mouse.move(x + 10, y + 38, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
};

const openFileFromEntry = async (page: Page, file: string) => {
  const pending = page.waitForEvent('filechooser');
  await entry(page).getByRole('button', { name: 'Open Project', exact: true }).click();
  await (await pending).setFiles(file);
  await expect(entry(page)).toHaveCount(0);
  await expect(page.getByTestId('status-bar')).toContainText('Loaded project');
};

const selectPreview = async (page: Page, row: Locator) => {
  await row.locator('[data-earlier-version-select]').click();
  const preview = page.getByTestId('earlier-version-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('data-preview-read-only', 'true');
  await expect(page.getByTestId('earlier-version-viewing')).toHaveText('Viewing earlier version');
  return preview;
};

const acceptRestore = async (page: Page) => {
  const confirmation = page.waitForEvent('dialog').then(async dialog => {
    const message = dialog.message();
    await dialog.accept();
    return message;
  });
  await page.getByTestId('earlier-version-restore').click();
  expect(await confirmation).toBe('Restore this version? Your current work will be kept.');
  await expect(page.getByTestId('status-bar')).toContainText('Version restored. Current work was kept.');
  await expect(page.getByTestId('earlier-version-preview')).toHaveCount(0);
};

test('preview and restore use real controls while preserving the later current file', async ({ baseURL }, testInfo) => {
  const session = await openCleanBrowser(baseURL);
  try {
    const { page } = session;
    await openStarter(page, 'guided');
    await editHead(page, 12);
    const row = await keepNamedVersion(page, 'Arm works');
    const rowId = await row.getAttribute('data-testid');
    expect(rowId).toMatch(/^earlier-version-row-/);
    const earlier = await saveProject(page, testInfo, 'earlier-working');
    expect(earlier.bundle.project.parts.head.transform.rotation).toBe(12);

    await editPath(page);
    await editHead(page, 31);
    const later = await saveProject(page, testInfo, 'later-current');
    expect(later.bundle.project.parts.head.transform.rotation).toBe(31);
    expect(later.bundle.project.paths['path-right-arm'].points).not.toEqual(
      earlier.bundle.project.paths['path-right-arm'].points,
    );
    expect(later.bundle.history?.entries).toHaveLength(1);

    await openVersions(page);
    const savedRow = historyPanel(page).locator(`[data-testid="${rowId}"]`);
    await expect(savedRow).toBeVisible();
    const preview = await selectPreview(page, savedRow);
    await preview.getByTestId('earlier-version-play').click();
    await expect(preview.getByTestId('earlier-version-play')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(220);
    await preview.getByTestId('earlier-version-play').click();
    await preview.getByTestId('earlier-version-scrubber').fill('500');
    await expect(preview.getByTestId('earlier-version-scrubber')).toHaveValue('500');

    await preview.getByTestId('earlier-version-back').click();
    await expect(page.getByTestId('earlier-version-preview')).toHaveCount(0);
    const afterPreview = await saveProject(page, testInfo, 'after-preview');
    expect(afterPreview.bundle.project.parts.head.transform.rotation).toBe(31);
    expect(afterPreview.bundle.project).toEqual(later.bundle.project);

    await openVersions(page);
    const restoreRow = historyPanel(page).locator(`[data-testid="${rowId}"]`);
    await selectPreview(page, restoreRow);
    await acceptRestore(page);
    await page.getByTestId('workflow-stage-character').click();
    await page.getByTestId('character-part-item-head').click();
    await expect(page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true })).toHaveValue('12');
    const restored = await saveProject(page, testInfo, 'restored-working');
    expect(restored.bundle.project.parts.head.transform.rotation).toBe(12);
    expect(restored.bundle.project.paths['path-right-arm'].points).toEqual(
      earlier.bundle.project.paths['path-right-arm'].points,
    );

    // Restoring A is one undoable project action. Exercise the real Edit menu
    // to return to C, then redo the same action back to A. Save both states so
    // the assertion covers authored path points as well as head rotation.
    await page.getByTestId('top-command-bar').getByText('Edit', { exact: true }).click();
    await page.getByTestId('command-edit-undo').click();
    await expect(page.getByTestId('status-bar')).toContainText('Undo applied');
    const undoReturned = await saveProject(page, testInfo, 'undo-returned-later');
    expect(undoReturned.bundle.project.parts.head.transform.rotation).toBe(31);
    expect(undoReturned.bundle.project.paths['path-right-arm'].points).toEqual(
      later.bundle.project.paths['path-right-arm'].points,
    );

    await page.getByTestId('top-command-bar').getByText('Edit', { exact: true }).click();
    await page.getByTestId('command-edit-redo').click();
    await expect(page.getByTestId('status-bar')).toContainText('Redo applied');
    const redoRestored = await saveProject(page, testInfo, 'redo-restored-working');
    expect(redoRestored.bundle.project.parts.head.transform.rotation).toBe(12);
    expect(redoRestored.bundle.project.paths['path-right-arm'].points).toEqual(
      earlier.bundle.project.paths['path-right-arm'].points,
    );

    // The pre-restore protection is itself a retained version, so the student
    // can return to the later state without leaving the version panel.
    await openVersions(page);
    const protectedRow = historyPanel(page).locator('[data-version-reason="before-restore"]');
    await expect(protectedRow).toHaveCount(1);
    await selectPreview(page, protectedRow);
    await acceptRestore(page);
    await page.getByTestId('workflow-stage-character').click();
    await page.getByTestId('character-part-item-head').click();
    await expect(page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true })).toHaveValue('31');
    const returned = await saveProject(page, testInfo, 'returned-later');
    expect(returned.bundle.project.paths['path-right-arm'].points).toEqual(
      later.bundle.project.paths['path-right-arm'].points,
    );
  } finally {
    await session.browser.close();
  }
});

test('history in a saved file restores in a clean browser and supports another save', async ({ baseURL }, testInfo) => {
  let session = await openCleanBrowser(baseURL, 1280);
  try {
    const { page } = session;
    await openStarter(page);
    await editHead(page, 9);
    await keepNamedVersion(page, 'Before mechanism change');
    await closeVersions(page);
    await editHead(page, 27);
    const firstFile = await saveProject(page, testInfo, 'class-one');
    expect(firstFile.bundle.history?.entries).toHaveLength(1);
    await session.browser.close();

    session = await openCleanBrowser(baseURL, 1280);
    const reopened = session.page;
    await openFileFromEntry(reopened, firstFile.file);
    await reopened.getByTestId('workflow-stage-project').click();
    await expect(reopened.getByTestId('project-earlier-versions')).toBeVisible();
    await reopened.getByTestId('project-earlier-versions').click();
    await expect(historyPanel(reopened).locator('[data-history-file-status="included"]')).toHaveText('Included in project file');
    const historicalRow = historyPanel(reopened).locator('[data-version-reason="manual"]');
    await expect(historicalRow).toHaveCount(1);
    await selectPreview(reopened, historicalRow);
    await acceptRestore(reopened);
    await reopened.getByTestId('workflow-stage-character').click();
    await reopened.getByTestId('character-part-item-head').click();
    await expect(reopened.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true })).toHaveValue('9');

    await editHead(reopened, 44);
    const secondFile = await saveProject(reopened, testInfo, 'class-two');
    expect(secondFile.bundle.project.parts.head.transform.rotation).toBe(44);
    expect(secondFile.bundle.history?.entries.length).toBeGreaterThanOrEqual(1);
    await session.browser.close();

    session = await openCleanBrowser(baseURL, 1280);
    await openFileFromEntry(session.page, secondFile.file);
    await session.page.getByTestId('workflow-stage-character').click();
    await session.page.getByTestId('character-part-item-head').click();
    await expect(session.page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true })).toHaveValue('44');
  } finally {
    await session.browser.close();
  }
});

test('Reset Lesson protects edited work and its version restores from the saved file', async ({ baseURL }, testInfo) => {
  let session = await openCleanBrowser(baseURL);
  try {
    const page = session.page;
    await openStarter(page, 'guided');
    await editHead(page, 33);
    await editPath(page);
    await page.getByTestId('workflow-stage-options').click();
    await page.getByLabel('Theme', { exact: true }).selectOption('dark');
    const before = await saveProject(page, testInfo, 'before-lesson-reset');

    await page.getByTestId('command-menu-file').click();
    const recoveryCopy = page.waitForEvent('download');
    const confirmation = page.waitForEvent('dialog').then(dialog => dialog.accept());
    await page.getByTestId('command-reset-lesson').click();
    await confirmation;
    expect((await recoveryCopy).suggestedFilename()).toContain('-recovery-');
    await expect(page.getByTestId('status-bar')).toContainText('Lesson reset');
    const reset = await saveProject(page, testInfo, 'lesson-reset-with-history');
    expect(reset.bundle.project.parts.head.transform.rotation).not.toBe(33);
    expect(reset.bundle.project.settings.theme).toBe('dark');
    expect(reset.bundle.history?.entries.filter(item => item.reason === 'before-reset')).toHaveLength(1);
    await session.browser.close();

    session = await openCleanBrowser(baseURL);
    await openFileFromEntry(session.page, reset.file);
    await openVersions(session.page);
    const protectedRow = historyPanel(session.page).locator('[data-version-reason="before-reset"]');
    await expect(protectedRow).toHaveCount(1);
    await selectPreview(session.page, protectedRow);
    await acceptRestore(session.page);
    const restored = await saveProject(session.page, testInfo, 'restored-before-lesson-reset');
    expect(restored.bundle.project.parts.head.transform.rotation).toBe(33);
    expect(restored.bundle.project.paths['path-right-arm'].points).toEqual(before.bundle.project.paths['path-right-arm'].points);
    expect(restored.bundle.project.settings.theme).toBe('dark');
  } finally {
    await session.browser.close();
  }
});
