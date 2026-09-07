import { dismissStartupAnnouncement } from './startupHarness';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { ProjectState } from '../../types';
import { createSampleProject, serializeProject } from '../../utils/project';
import { createFabricationReadyFourBarProject } from '../fixtures/fabricationProject';

const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? '/';
const sizes = [{ width: 1366, height: 768 }, { width: 1024, height: 700 }];

const openApp = async (page: Page) => {
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
  const welcome = page.getByTestId('getting-started-dialog');
  if (await welcome.count()) await welcome.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('workflow-stage-character').click();
  await expect(page.getByTestId('character-screen')).toBeVisible();
};

const openProjectMenu = async (page: Page) => {
  const summary = page.getByTestId('command-menu-file');
  if (!await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) await summary.click();
};

const projectFile = (project: ProjectState) => ({
  name: 'synthetic-support.motionsmith', mimeType: 'application/json', buffer: Buffer.from(serializeProject(project)),
});

const importFile = async (page: Page, file: ReturnType<typeof projectFile>) => {
  await openProjectMenu(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('command-load-project').click();
  await (await chooser).setFiles(file);
  await expect(page.getByTestId('status-bar')).toContainText('Loaded project');
};

const snapshot = async (page: Page) => {
  await openProjectMenu(page);
  const pending = page.waitForEvent('download');
  await page.getByTestId('command-download-snapshot').click();
  const download = await pending;
  const buffer = await readFile((await download.path())!);
  const packet = JSON.parse(buffer.toString('utf8'));
  return {
    project: packet.project as ProjectState,
    file: { name: download.suggestedFilename(), mimeType: 'application/json', buffer },
  };
};

const fixture = () => {
  const project = createFabricationReadyFourBarProject();
  const first = project.paths[project.selectedPathId!];
  const other = {
    ...first, id: 'support-left-motion', partId: 'left_arm_lower', targetAnchorJointId: 'left_hand',
    chainRootJointId: 'left_shoulder', points: first.points.map(point => ({ x: -point.x, y: point.y })),
  };
  return {
    ...project, metadata: { ...project.metadata, name: 'Synthetic support QA' },
    paths: { ...project.paths, [other.id]: other }, pathOrder: [first.id, other.id],
    settings: { ...project.settings, autosave: false },
  };
};

const find = async (page: Page, query: string) => {
  await page.getByTestId('find-feature-entry').click();
  const panel = page.getByRole('dialog', { name: 'Find a feature', exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole('combobox', { name: 'Find a feature' }).fill(query);
  return panel;
};

const reveal = async (page: Page, query: string, resultId: string, targetId = resultId) => {
  const panel = await find(page, query);
  await expect(panel.locator(`[data-feature-result="${resultId}"]`)).toBeVisible();
  const ids = await panel.locator('[data-feature-result]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-feature-result')));
  expect(ids.length).toBeLessThanOrEqual(5);
  expect(ids.slice(0, 3), `${query}: relevant feature is among first three`).toContain(resultId);
  await panel.locator(`[data-feature-result="${resultId}"]`).click();
  // Observe both in one read so tracing the dialog check cannot consume the transient highlight.
  await expect.poll(() => page.evaluate(id => ({
    dialogRemoved: !document.querySelector('[role="dialog"][aria-label="Find a feature"]'),
    highlighted: document.querySelector(`[data-feature-id="${id}"]`)?.getAttribute('data-feature-highlighted') === 'true',
  }), targetId)).toEqual({ dialogRemoved: true, highlighted: true });
  const target = page.locator(`[data-feature-id="${targetId}"]`);
  await expect(target).toBeVisible();
  await expect(target).toBeInViewport();
  return target;
};

for (const viewport of sizes) {
  test(`students locate real controls from Character, Path, and Assembly at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const posts: string[] = [];
    const errors: string[] = [];
    let downloads = 0;
    let fileChoosers = 0;
    page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    page.on('download', () => downloads++);
    page.on('filechooser', () => fileChoosers++);
    await openApp(page);
    await importFile(page, projectFile(fixture()));
    const before = await snapshot(page);
    expect(Object.keys(before.project.paths)).toHaveLength(2);
    expect(before.project.mechanisms).toHaveLength(1);
    expect(before.project.mechanisms[0].fabricationMetadata?.pathFit?.status).toBe('fit');
    const baselineDownloads = downloads;
    const baselineChoosers = fileChoosers;

    for (const from of ['character', 'path', 'assembly']) {
      for (const [query, id] of [
        ['keep this for next class', 'project.save'],
        ['reopn project', 'project.open'],
        ['paper body pieces', 'blueprint.customParts'],
        ['different body part', 'path.target'],
        ['match this curve', 'foundry.fitPath'],
        ['put the parts together', 'assembly.steps'],
      ]) {
        await page.getByTestId(`workflow-stage-${from}`).click();
        await expect(page.locator(`.editor-stage-frame[data-stage="${from}"]`)).toBeVisible();
        await reveal(page, query, id);
      }
    }
    expect(downloads, 'locating Save/PDF never starts a download').toBe(baselineDownloads);
    expect(fileChoosers, 'locating Open never opens a file picker').toBe(baselineChoosers);
    expect(posts, 'search and ordinary navigation never submit feedback').toEqual([]);
    const after = await snapshot(page);
    expect(after.project, 'all authored and recovery state survives location-only actions').toEqual(before.project);

    // Continue through ordinary file operations, then perform an intentional edit.
    await page.reload();
    await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
    const welcome = page.getByTestId('getting-started-dialog');
    if (await welcome.count()) await welcome.getByRole('button', { name: 'Close', exact: true }).click();
    await importFile(page, after.file);
    await page.getByTestId('workflow-stage-path').click();
    await expect(page.getByTestId('motion-count')).toHaveText('2');
    await page.getByLabel('Smoothness number', { exact: true }).fill('20');
    const edited = await snapshot(page);
    expect(edited.project.paths[edited.project.selectedPathId!].smoothness).toBe(20);
    expect(Object.keys(edited.project.paths)).toHaveLength(2);
    await page.getByTestId('workflow-stage-assembly').click();
    await expect(page.getByTestId('assembly-control-panel')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('search supports keyboard ambiguity, focus, collapsed controls, and editable suggestions', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let downloads = 0;
  const posts: string[] = [];
  page.on('download', () => downloads++);
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await openApp(page);
  await importFile(page, projectFile(fixture()));
  await page.getByTestId('workflow-stage-path').click();
  const before = await snapshot(page);
  const baselineDownloads = downloads;

  let panel = await find(page, 'print');
  const input = panel.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.press('Shift+Tab');
  await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await input.press('Tab');
  await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(input).toBeFocused();
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1024);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
  await expect(panel.locator('[data-feature-result="blueprint.pdf"]')).toBeVisible();
  await expect(panel.locator('[data-feature-result="blueprint.customParts"]')).toBeVisible();
  await input.press('ArrowDown');
  await expect(panel.locator('[data-feature-result="blueprint.customParts"]')).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowUp');
  await expect(panel.locator('[data-feature-result="blueprint.pdf"]')).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowDown');
  await input.press('Enter');
  const characterPdf = page.locator('[data-feature-id="blueprint.customParts"]');
  await expect(characterPdf).toBeFocused();
  await expect(characterPdf).toHaveAttribute('data-feature-highlighted', 'true');
  expect(downloads).toBe(baselineDownloads);

  panel = await find(page, 'keyboard');
  await panel.getByRole('combobox').press('?');
  await panel.getByRole('combobox').press('Alt+2');
  await panel.getByRole('combobox').press('ControlOrMeta+z');
  await expect(page.locator('.editor-stage-frame[data-stage="blueprint"]')).toBeVisible();
  await expect(page.getByTestId('shortcut-help-dialog')).toHaveCount(0);
  await panel.getByRole('combobox').press('Escape');
  await expect(page.getByTestId('find-feature-entry')).toBeFocused();

  await page.getByTestId('workflow-stage-path').click();
  const trace = page.locator('[data-feature-id="path.trace"]');
  await expect(trace).not.toBeVisible();
  await reveal(page, 'copy motion clip', 'path.trace');
  await expect(trace).toBeFocused();
  await expect(page.getByTestId('tracking-modal')).toHaveCount(0);

  panel = await find(page, 'fit');
  await expect(panel.locator('[data-feature-result="view.fit"]')).toBeVisible();
  await expect(panel.locator('[data-feature-result="foundry.fitPath"]')).toBeVisible();
  await panel.getByRole('combobox').fill('  ASSEMB  ');
  await expect(panel.locator('[data-feature-result="assembly.steps"]')).toBeVisible();
  await panel.getByRole('combobox').fill('dev mode');
  await expect(panel).toContainText('No matching feature.');
  await panel.getByRole('combobox').fill('save my pizza');
  await expect(panel).toContainText('No matching feature.');
  await expect(panel.locator('[data-feature-result]')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Suggest a feature' }).click();
  const feedback = page.getByRole('dialog', { name: 'Feedback', exact: true });
  await expect(feedback.getByTestId('feedback-message')).toHaveValue('save my pizza');
  await expect(feedback.getByRole('radio', { name: 'I have an idea' })).toBeChecked();
  await feedback.getByTestId('feedback-message').fill('An editable suggestion, never submitted by search.');
  await feedback.getByRole('button', { name: 'Discard draft' }).click();
  expect(posts).toEqual([]);
  expect(downloads).toBe(baselineDownloads);
  expect((await snapshot(page)).project).toEqual(before.project);
});

test('missing character and missing path reveal prerequisites without manufacturing project state', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openApp(page);
  const empty = await snapshot(page);
  let panel = await find(page, 'move an arm');
  await panel.locator('[data-feature-result="path.draw"]').click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText('Load a character first.');
  await panel.getByRole('combobox').press('Escape');
  expect((await snapshot(page)).project).toEqual(empty.project);

  const sample = createSampleProject();
  await importFile(page, projectFile({ ...sample, paths: {}, pathOrder: [], selectedPathId: undefined,
    settings: { ...sample.settings, autosave: false } }));
  const withoutPath = await snapshot(page);
  const fit = await reveal(page, 'match my path', 'foundry.fitPath');
  await expect(fit).toBeDisabled();
  await expect(page.getByTestId('status-bar')).toContainText('Draw path first');
  expect((await snapshot(page)).project).toEqual(withoutPath.project);
});
