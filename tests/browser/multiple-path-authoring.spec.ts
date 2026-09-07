import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { ProjectState } from '../../types';
import { createSampleProject, serializeProject } from '../../utils/project';
import { createFabricationReadyFourBarProject } from '../fixtures/fabricationProject';
import { dismissStartupAnnouncement } from './startupHarness';

const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? '/';
const pathState = (page: Page) => page.getByTestId('path-three-puppet-state');
const panel = (page: Page) => page.getByTestId('novice-path-panel');
const row = (page: Page, id: string) => page.getByTestId(`motion-item-${id}`);
const projectFile = (project: ProjectState) => ({ name: 'two-arm-class.motionsmith', mimeType: 'application/json', buffer: Buffer.from(serializeProject(project)) });

const start = async (page: Page, keepGettingStarted = false) => {
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  const welcome = page.getByTestId('getting-started-dialog');
  if (!keepGettingStarted && await welcome.count()) await welcome.getByRole('button', { name: 'Close', exact: true }).click();
};
const projectMenu = async (page: Page) => {
  const menu = page.getByTestId('command-menu-file');
  if (!await menu.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) await menu.click();
};
const openFile = async (page: Page, file: ReturnType<typeof projectFile>) => {
  await projectMenu(page);
  const pending = page.waitForEvent('filechooser');
  await page.getByTestId('command-load-project').click();
  await (await pending).setFiles(file);
  await expect(page.getByTestId('status-bar')).toContainText('Loaded project');
};
const save = async (page: Page) => {
  await projectMenu(page);
  const pending = page.waitForEvent('download');
  await page.getByTestId('command-download-snapshot').click();
  const download = await pending;
  const buffer = await readFile((await download.path())!);
  return { project: JSON.parse(buffer.toString()).project as ProjectState, file: { name: download.suggestedFilename(), mimeType: 'application/json', buffer } };
};
const enterPath = async (page: Page) => {
  await page.getByTestId('workflow-stage-path').click();
  await expect(pathState(page)).toHaveAttribute('data-three-renderer', 'webgl');
  await expect.poll(async () => Object.keys(await meshTransforms(page))).toEqual(expect.arrayContaining(['left_arm_lower', 'right_arm_lower']));
};
const stroke = async (page: Page, side: 'left' | 'right') => {
  await panel(page).getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(pathState(page)).toHaveAttribute('data-camera-preset', 'front');
  const box = (await page.getByTestId('path-three-puppet-canvas').boundingBox())!;
  const x = box.x + box.width * (side === 'left' ? 0.35 : 0.65);
  const y = box.y + box.height * 0.42;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 32, y - 22, { steps: 4 });
  await page.mouse.move(x + 56, y + 12, { steps: 4 });
  await page.mouse.move(x + 12, y + 35, { steps: 4 });
  await expect(pathState(page)).toHaveAttribute('data-path-gesture-draft', 'active');
  await page.mouse.up();
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
  await expect(page.getByTestId('free-draw-status')).toHaveAttribute('data-draw-mode', 'idle');
};
type MeshTransform = { x: number; y: number; z: number; rotation: number; scale: number };
const meshTransforms = async (page: Page): Promise<Record<string, MeshTransform>> => JSON.parse(await pathState(page).getAttribute('data-three-part-transforms') ?? '{}');
const heldPathFrame = async (page: Page, expectedPhase?: number) => {
  const canvas = page.locator('.path-canvas-shell');
  await expect(canvas).toHaveAttribute('data-path-held-phase', expectedPhase === undefined ? /\d/ : String(expectedPhase));
  const heldPhase = (await canvas.getAttribute('data-path-held-phase'))!;
  // Pause commits the held phase before the renderer submits its queued final frame.
  await expect(pathState(page)).toHaveAttribute('data-three-playback-phase', heldPhase);
  return Number(await pathState(page).getAttribute('data-three-playback-timeline-ms'));
};
const twoPaths = (fabricable = false): ProjectState => {
  const project = fabricable ? createFabricationReadyFourBarProject() : createSampleProject({ includeMechanism: false });
  const a = Object.values(project.paths)[0];
  const b = { ...a, id: 'path-left-arm', partId: 'left_arm_lower', targetAnchorJointId: 'left_hand', chainRootJointId: 'left_shoulder', points: a.points.map(point => ({ x: fabricable ? point.x : -point.x, y: point.y })) };
  return { ...project, paths: { [a.id]: a, [b.id]: b }, pathOrder: [a.id, b.id], selectedPartId: a.partId, selectedPathId: a.id, settings: { ...project.settings, autosave: false } };
};

for (const size of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
  test(`two arm paths draw, edit, play, hold, and reopen at ${size.width}x${size.height}`, async ({ page, browser }) => {
    await page.setViewportSize(size);
    await start(page, true);
    await page.getByTestId('getting-started-dialog').getByRole('button', { name: 'Open starter rig', exact: true }).click();
    await expect(page.getByTestId('getting-started-dialog')).toHaveCount(0);
    await expect(page.getByTestId('character-screen')).toBeVisible();
    await enterPath(page);
    await page.getByLabel('Motion target').selectOption('right_arm_lower');
    await stroke(page, 'right');
    const beforeAdd = (await save(page)).project;
    const aId = Object.values(beforeAdd.paths).find(path => path.partId === 'right_arm_lower')!.id;

    await panel(page).getByRole('button', { name: 'Add path', exact: true }).click();
    await page.getByLabel('New path target').selectOption('part:left_arm_lower');
    await page.getByTestId('add-path-chooser').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(panel(page).getByRole('button', { name: 'Add path', exact: true })).toBeFocused();
    expect((await save(page)).project).toEqual(beforeAdd);
    await panel(page).getByRole('button', { name: 'Add path', exact: true }).click();
    await expect(page.getByTestId('add-path-existing')).toContainText('Edit Right lower arm');
    await page.getByLabel('New path target').selectOption('part:left_arm_lower');
    await page.getByTestId('add-path-chooser').getByRole('button', { name: 'Create path', exact: true }).click();
    const bId = 'path-left_arm_lower';
    await expect(row(page, bId)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Motion target')).toHaveValue('left_arm_lower');
    await expect(row(page, bId)).toHaveAttribute('data-motion-status', 'draw');
    await stroke(page, 'left');
    await expect(page.getByTestId('motion-count')).toHaveText('2');
    const baseline = (await save(page)).project;
    expect(baseline.paths[aId]).toEqual(beforeAdd.paths[aId]);
    expect(baseline.paths[bId].partId).toBe('left_arm_lower');

    const handles = JSON.parse(await pathState(page).getAttribute('data-three-path-point-screen-targets') ?? '[]') as Array<{ id: string; x: number; y: number }>;
    expect(handles.length).toBeGreaterThan(2);
    expect(handles.every(handle => handle.id.startsWith(`${bId}:`))).toBe(true);
    await page.mouse.move(handles[1].x, handles[1].y);
    await page.mouse.down();
    await page.mouse.move(handles[1].x + 24, handles[1].y - 18, { steps: 4 });
    await page.mouse.up();
    const edited = (await save(page)).project;
    expect(edited.paths[aId]).toEqual(baseline.paths[aId]);
    expect(edited.paths[bId].points).not.toEqual(baseline.paths[bId].points);
    await row(page, aId).click();
    await expect(page.getByLabel('Motion target')).toHaveValue('right_arm_lower');
    await page.keyboard.press('ControlOrMeta+z');
    const undone = (await save(page)).project;
    expect(undone.paths[aId]).toEqual(baseline.paths[aId]);
    expect(undone.paths[bId]).toEqual(baseline.paths[bId]);
    await row(page, aId).click();
    await page.keyboard.press('ControlOrMeta+Shift+z');
    const redone = (await save(page)).project;
    expect(redone.paths[aId]).toEqual(baseline.paths[aId]);
    expect(redone.paths[bId]).toEqual(edited.paths[bId]);

    const firstPose = await meshTransforms(page);
    await panel(page).getByRole('button', { name: 'Play paths', exact: true }).click();
    for (const partId of ['right_arm_lower', 'left_arm_lower']) {
      await expect.poll(async () => (await meshTransforms(page))[partId]?.rotation).not.toBe(firstPose[partId].rotation);
    }
    const secondPose = await meshTransforms(page);
    for (const partId of ['right_arm_lower', 'left_arm_lower']) {
      await expect.poll(async () => (await meshTransforms(page))[partId]?.rotation).not.toBe(secondPose[partId].rotation);
    }
    await panel(page).getByRole('button', { name: 'Pause all paths', exact: true }).click();
    const heldTime = await heldPathFrame(page);
    const held = await meshTransforms(page);
    await page.waitForTimeout(300);
    expect(Number(await pathState(page).getAttribute('data-three-playback-timeline-ms'))).toBe(heldTime);
    expect(await meshTransforms(page)).toEqual(held);
    const scrubber = page.getByRole('slider', { name: 'Workspace scrubber', exact: true });
    await scrubber.fill('37');
    const scrubbedTime = await heldPathFrame(page, (37 / 100) * Math.PI * 2);
    await expect.poll(async () => (await meshTransforms(page)).right_arm_lower.rotation).not.toBe(held.right_arm_lower.rotation);
    const scrubbed = await meshTransforms(page);
    await page.waitForTimeout(300);
    expect(Number(await pathState(page).getAttribute('data-three-playback-timeline-ms'))).toBe(scrubbedTime);
    expect(await meshTransforms(page)).toEqual(scrubbed);
    const saved = await save(page);
    expect(saved.project.paths).toEqual(redone.paths);
    expect(saved.project.parts).toEqual(redone.parts);
    expect(await page.locator('canvas.three-puppet-canvas').count()).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await panel(page).evaluate(element => ({
      fits: element.scrollWidth <= element.clientWidth,
      scrollLeft: element.scrollLeft,
    }))).toEqual({ fits: true, scrollLeft: 0 });

    const clean = await browser.newContext({ viewport: size, acceptDownloads: true });
    try {
      const reopened = await clean.newPage();
      await start(reopened);
      await openFile(reopened, saved.file);
      await enterPath(reopened);
      await expect(reopened.getByTestId('motion-count')).toHaveText('2');
      const reopenedSnapshot = (await save(reopened)).project;
      expect(reopenedSnapshot.paths).toEqual(saved.project.paths);
      expect(reopenedSnapshot.mechanisms).toEqual(saved.project.mechanisms);
      expect(reopenedSnapshot.parts).toEqual(saved.project.parts);
    } finally { await clean.close(); }
  });
}

test('unequal path durations retain the continuous timeline when paused after a full cycle', async ({ page }) => {
  await start(page);
  const fixture = twoPaths();
  const [aId, bId] = fixture.pathOrder!;
  fixture.paths[aId] = { ...fixture.paths[aId], duration: 1000 };
  fixture.paths[bId] = { ...fixture.paths[bId], duration: 1700 };
  await openFile(page, projectFile(fixture));
  await enterPath(page);
  await panel(page).getByRole('button', { name: 'Play paths', exact: true }).click();
  await expect.poll(async () => Number(await pathState(page).getAttribute('data-three-playback-timeline-ms'))).toBeGreaterThan(2300);
  await panel(page).getByRole('button', { name: 'Pause all paths', exact: true }).click();
  const heldTime = await heldPathFrame(page);
  expect(heldTime).toBeGreaterThan(2300);
  const held = await meshTransforms(page);
  await page.waitForTimeout(300);
  expect(Number(await pathState(page).getAttribute('data-three-playback-timeline-ms'))).toBe(heldTime);
  expect(await meshTransforms(page)).toEqual(held);
  const dock = page.getByTestId('workspace-player-dock');
  await dock.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number(await pathState(page).getAttribute('data-three-playback-timeline-ms'))).toBeGreaterThan(heldTime + 100);
  await dock.getByRole('button', { name: 'Pause', exact: true }).click();
  const dockTime = await heldPathFrame(page);
  expect(dockTime).toBeGreaterThan(heldTime);
  const dockPose = await meshTransforms(page);
  await page.waitForTimeout(300);
  expect(Number(await pathState(page).getAttribute('data-three-playback-timeline-ms'))).toBe(dockTime);
  expect(await meshTransforms(page)).toEqual(dockPose);
});

test('changing path identity during draw or point drag cancels only transient geometry', async ({ page }) => {
  await start(page);
  const fixture = twoPaths();
  await openFile(page, projectFile(fixture));
  await enterPath(page);
  const before = (await save(page)).project;
  const aId = fixture.pathOrder![0];
  await panel(page).getByRole('button', { name: 'Draw free path', exact: true }).click();
  const box = (await page.getByTestId('path-three-puppet-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6 + 40, box.y + box.height * 0.45 + 20, { steps: 4 });
  await expect(pathState(page)).toHaveAttribute('data-path-gesture-draft', 'active');
  await page.getByLabel('Motion target').selectOption('left_arm_lower');
  await page.mouse.move(box.x + box.width * 0.6 + 90, box.y + box.height * 0.45 - 20, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('free-draw-status')).toHaveAttribute('data-draw-mode', 'idle');
  expect((await save(page)).project.paths).toEqual(before.paths);

  const handles = JSON.parse(await pathState(page).getAttribute('data-three-path-point-screen-targets') ?? '[]') as Array<{ id: string; x: number; y: number }>;
  expect(handles.length).toBeGreaterThan(0);
  await page.mouse.move(handles[0].x, handles[0].y);
  await page.mouse.down();
  await page.mouse.move(handles[0].x + 15, handles[0].y - 15, { steps: 3 });
  await expect(pathState(page)).toHaveAttribute('data-path-gesture-draft', 'active');
  await row(page, aId).focus();
  await page.keyboard.press('Enter');
  await page.mouse.move(handles[0].x + 30, handles[0].y - 30);
  await page.mouse.up();
  expect((await save(page)).project.paths).toEqual(before.paths);
});

test('overlapping paths remain visible and blocked while independent valid paths still play', async ({ page }) => {
  await start(page);
  const fixture = twoPaths();
  const a = fixture.paths[fixture.pathOrder![0]];
  const duplicate = { ...a, id: 'overlapping-right' };
  const incomplete = { ...a, id: 'incomplete-right', points: a.points.slice(0, 2) };
  const conflictProject = { ...fixture, paths: { ...fixture.paths, [duplicate.id]: duplicate, [incomplete.id]: incomplete }, pathOrder: [...fixture.pathOrder!, duplicate.id, incomplete.id] };
  await openFile(page, projectFile(conflictProject));
  await enterPath(page);
  await expect(row(page, a.id)).toHaveAttribute('data-motion-status', 'conflict');
  await expect(row(page, duplicate.id)).toHaveAttribute('data-motion-status', 'conflict');
  await expect(row(page, incomplete.id)).toHaveAttribute('data-motion-status', 'draw');
  await expect(page.getByTestId('free-draw-status')).toContainText('Disable an overlapping path');
  const before = await meshTransforms(page);
  await panel(page).getByRole('button', { name: 'Play paths', exact: true }).click();
  await expect.poll(async () => (await meshTransforms(page)).left_arm_lower.rotation).not.toBe(before.left_arm_lower.rotation);
  expect((await meshTransforms(page)).right_arm_lower).toEqual(before.right_arm_lower);
  await panel(page).getByRole('button', { name: 'Pause all paths', exact: true }).click();
  await row(page, duplicate.id).click();
  const visibleLinePoints = await pathState(page).getAttribute('data-three-rendered-path-line-point-count');
  await panel(page).getByText('More', { exact: true }).click();
  await panel(page).getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(row(page, duplicate.id)).toHaveAttribute('data-motion-status', 'off');
  await expect(pathState(page)).toHaveAttribute('data-three-rendered-path-line-point-count', visibleLinePoints!);
  await expect(row(page, a.id)).toHaveAttribute('data-motion-status', 'ready');
  await expect(panel(page).getByRole('button', { name: 'Play paths', exact: true })).toContainText('Play all');
  const saved = (await save(page)).project;
  expect(saved.paths[a.id].points).toEqual(a.points);
  expect(saved.paths[duplicate.id].points).toEqual(a.points);
  expect(Object.keys(saved.paths)).toHaveLength(4);
});

test('fitting B asks before replacing A and continues through Design and Assembly with both paths', async ({ page }) => {
  await start(page);
  const fixture = twoPaths(true);
  await openFile(page, projectFile(fixture));
  await enterPath(page);
  await row(page, 'path-left-arm').click();
  const before = (await save(page)).project;
  await page.getByTestId('workflow-stage-foundry').click();
  let rejectedMessage = '';
  page.once('dialog', async dialog => { rejectedMessage = dialog.message(); await dialog.dismiss(); });
  await page.getByTestId('foundry-fit-path').click();
  await expect.poll(() => rejectedMessage).toMatch(/Replace.*Right lower arm.*Left lower arm/);
  await expect(page.getByTestId('status-bar')).toContainText('Fit kept');
  const kept = (await save(page)).project;
  expect(kept.paths).toEqual(before.paths);
  expect(kept.mechanisms).toEqual(before.mechanisms);
  expect(kept.mechanisms[0].outputs).toEqual(before.mechanisms[0].outputs);
  expect(kept.mechanisms[0].outputs?.[0].pathId).toBe(fixture.pathOrder![0]);

  let acceptedMessage = '';
  page.once('dialog', async dialog => { acceptedMessage = dialog.message(); await dialog.accept(); });
  await page.getByTestId('foundry-fit-path').click();
  await expect.poll(() => acceptedMessage).toContain('Replace');
  await expect(page.getByRole('button', { name: 'Use this mechanism', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Use this mechanism', exact: true }).click();
  await expect(page.getByTestId('workflow-stage-design')).toHaveAttribute('aria-current', 'step');
  const fitted = (await save(page)).project;
  expect(fitted.paths).toEqual(before.paths);
  expect(fitted.mechanisms).toHaveLength(1);
  expect(fitted.mechanisms[0].targetPathId).toBe('path-left-arm');
  expect(fitted.mechanisms[0].targetPartId).toBe('left_arm_lower');
  expect(fitted.mechanisms[0].outputs).toHaveLength(before.mechanisms[0].outputs!.length);
  expect(fitted.mechanisms[0].outputs?.[0]).toMatchObject({
    id: before.mechanisms[0].outputs![0].id, pathId: 'path-left-arm', targetPartId: 'left_arm_lower', targetAnchorJointId: 'left_hand',
    fit: { status: 'fit', targetPathId: 'path-left-arm' },
  });
  await page.getByTestId('workflow-stage-assembly').click();
  await expect(page.getByTestId('workflow-stage-assembly')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('assembly-canvas-preview')).toBeVisible();
  const assembled = (await save(page)).project;
  expect(assembled.paths).toEqual(before.paths);
  expect(assembled.mechanisms).toEqual(fitted.mechanisms);
});
