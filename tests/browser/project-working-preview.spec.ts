import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createEmptyProject, createLessonProject, serializeProject } from '../../utils/project';
import type { ProjectState } from '../../types';
import { motionPreviewForPaths, playableMotionPaths } from '../../utils/motion';
import { dismissStartupAnnouncement } from './startupHarness';

const twoPathProject = () => {
  const project = createLessonProject('waving-arm');
  const original = Object.values(project.paths)[0];
  project.paths['path-left-arm'] = { ...original, id: 'path-left-arm', partId: 'left_arm_lower',
    targetAnchorJointId: 'left_hand', chainRootJointId: 'left_shoulder',
    points: original.points.map(point => ({ x: -point.x, y: point.y })), timedPoints: undefined };
  project.pathOrder = [original.id, 'path-left-arm'];
  project.selectedPathId = 'path-left-arm';
  return project;
};

const openProject = async (page: Page, project: ProjectState) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  const entry = page.getByTestId('getting-started-dialog');
  await expect(entry).toBeVisible();
  const chosen = page.waitForEvent('filechooser');
  await entry.getByTestId('getting-started-open-project').click();
  await (await chosen).setFiles({
    name: 'working-preview.motionsmith', mimeType: 'application/json', buffer: Buffer.from(serializeProject(project)),
  });
  await expect(entry).toHaveCount(0);
  await page.getByTestId('workflow-stage-project').click();
};

const authored = async (page: Page) => {
  const pending = page.waitForEvent('download');
  await page.getByTestId('command-menu-file').click();
  await page.getByTestId('command-download-snapshot').click();
  const download = await pending;
  const project = JSON.parse(await readFile((await download.path())!, 'utf8')).project;
  return { parts: project.parts, skeleton: project.skeleton, paths: project.paths, pathOrder: project.pathOrder,
    mechanisms: project.mechanisms, assignments: project.assignments, selectedPathId: project.selectedPathId };
};

const foundryReady = async (page: Page) => {
  await expect(page.getByTestId('foundry-preview')).toHaveAttribute('data-three-renderer-status', 'webgl');
  await expect(page.getByTestId('foundry-preview')).toHaveAttribute('data-three-topology-ready', 'true');
  await expect(page.getByTestId('foundry-camera-rig')).toHaveAttribute('data-three-automata-context', 'shown');
};
const foundryPose = (page: Page) => page.getByTestId('foundry-camera-rig').evaluate(element => {
  // Matrix decompositions can differ at machine epsilon after a renderer lease changes.
  const read = (name: string) => JSON.parse(element.getAttribute(name) || '[]',
    (_key, value) => typeof value === 'number' ? Math.round(value * 1e9) / 1e9 : value);
  return {
    parts: read('data-three-automata-part-transforms'),
    mechanism: read('data-three-working-mechanism-transforms'),
    paths: read('data-three-automata-paths') as { id: string; points: number; opacity: number }[],
  };
});

test('Project and Design share real geometry, all authored paths, camera and phase without edits', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openProject(page, twoPathProject());
  await foundryReady(page);
  await expect(page.locator('canvas.foundry-three-canvas')).toHaveCount(1);
  const before = await authored(page);
  const controls = page.getByTestId('design-foundry-camera-controls');
  await controls.getByRole('button', { name: 'Front', exact: true }).click();
  await expect(page.getByTestId('foundry-camera-rig')).toHaveAttribute('data-camera-preset', 'front');
  const rest = await foundryPose(page);
  expect(rest.parts).toHaveLength(14);
  expect(rest.mechanism.length).toBeGreaterThan(3);
  expect(rest.paths.map(path => path.id)).toEqual(['path-right-arm', 'path-left-arm']);
  expect(rest.paths.every(path => path.points > 2)).toBe(true);
  expect(rest.paths.find(path => path.id === 'path-left-arm')!.opacity).toBeGreaterThan(rest.paths[0].opacity);
  await page.getByRole('slider', { name: 'Workspace scrubber' }).fill('37');
  await expect.poll(async () => JSON.stringify((await foundryPose(page)).parts)).not.toBe(JSON.stringify(rest.parts));
  const projectPose = await foundryPose(page);
  expect(projectPose.mechanism).not.toEqual(rest.mechanism);
  await page.screenshot({ path: testInfo.outputPath('project-front-phase37.png') });
  const projectCamera = await page.getByTestId('project-working-preview').getAttribute('data-working-camera');
  await page.getByTestId('workflow-stage-design').click();
  await foundryReady(page);
  expect(await foundryPose(page)).toEqual(projectPose);
  expect(await page.getByTestId('design-shared-foundry-preview').getAttribute('data-working-camera')).toEqual(projectCamera);
  await page.screenshot({ path: testInfo.outputPath('design-front-phase37.png') });
  await page.getByTestId('workflow-stage-project').click();
  await foundryReady(page);
  await controls.getByRole('button', { name: 'Full scene', exact: true }).click();
  const rig = page.getByTestId('foundry-camera-rig');
  const zoom = async () => JSON.parse((await page.getByTestId('project-working-preview').getAttribute('data-working-camera'))!).zoom as number;
  await expect(page.getByTestId('project-working-preview')).not.toHaveAttribute('data-working-camera', projectCamera!);
  const fullCamera = await page.getByTestId('project-working-preview').getAttribute('data-working-camera');
  const fullZoom = await zoom();
  await controls.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(page.getByTestId('project-working-preview')).not.toHaveAttribute('data-working-camera', fullCamera!);
  await expect.poll(zoom).toBeGreaterThanOrEqual(fullZoom - 1e-9);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => JSON.stringify((await foundryPose(page)).parts)).not.toBe(JSON.stringify(projectPose.parts));
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => {
    const held = Number(await page.getByTestId('project-working-preview').getAttribute('data-working-phase'));
    const rendered = Number(await rig.getAttribute('data-three-working-phase'));
    return Math.abs(held - rendered);
  }).toBeLessThan(1e-9);
  const paused = await foundryPose(page);
  await page.getByTestId('workflow-stage-design').click();
  await foundryReady(page);
  expect(await foundryPose(page)).toEqual(paused);
  expect(await authored(page)).toEqual(before);
});

for (const content of ['path-only', 'character-only', 'empty'] as const) {
  test(`Project ${content} uses its actual content and remains read-only`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    let project = content === 'empty' ? createEmptyProject() : twoPathProject();
    project = { ...project, mechanisms: [], selectedMechanismId: undefined };
    if (content === 'path-only') Object.values(project.paths).forEach((path, index) => { path.duration = index ? 1100 : 700; });
    if (content === 'character-only') project = { ...project, paths: {}, pathOrder: [], selectedPathId: undefined };
    await openProject(page, project);
    if (content === 'empty') {
      await expect(page.locator('[data-testid="project-working-empty"], [data-testid="project-empty-state"]')).toHaveCount(1);
      await expect(page.locator('canvas')).toHaveCount(0);
      return;
    }
    const viewer = page.getByTestId('project-three-puppet');
    await expect(viewer).toHaveAttribute('data-three-renderer-status', 'webgl');
    await expect(viewer).toHaveAttribute('data-three-initial-scene-ready', 'true');
    const state = page.getByTestId('project-three-puppet-state');
    await expect(state).toHaveAttribute('data-three-mechanism-count', '0');
    await expect(state).toHaveAttribute('data-three-rendered-path-handle-count', '0');
    await expect(state).toHaveAttribute('data-three-path-count', content === 'path-only' ? '2' : '0');
    await expect(page.getByTestId('project-three-puppet-toggle-skeleton')).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(1);
    const before = await authored(page);
    const pose = await state.getAttribute('data-three-part-transforms');
    if (content === 'path-only') {
      await page.getByRole('slider', { name: 'Workspace scrubber' }).fill('35');
      await expect(state).not.toHaveAttribute('data-three-part-transforms', pose!);
    }
    await page.getByTestId('project-three-puppet-view-3d').click();
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`${content}-project.png`) });
    if (content === 'path-only') {
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await expect.poll(async () => Number(await state.getAttribute('data-three-playback-timeline-ms'))).toBeGreaterThan(1300);
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      // Pause commits the held phase before the queued final render submits.
      const heldPhase = (await page.getByTestId('project-working-preview').getAttribute('data-working-phase'))!;
      await expect(state).toHaveAttribute('data-three-playback-phase', heldPhase);
      const heldTime = Number(await state.getAttribute('data-three-playback-timeline-ms'));
      const expected = motionPreviewForPaths(project, playableMotionPaths(project), heldTime);
      const expectArms = async (testId: string) => {
        const actualState = page.getByTestId(testId);
        await expect.poll(async () => {
          const parts = JSON.parse(await actualState.getAttribute('data-three-part-transforms') || '{}');
          return Math.max(...['left_arm_lower', 'right_arm_lower'].map(id => {
            const part = expected.parts[id];
            if (!part || !parts[id]) return Infinity;
            return Math.max(Math.abs(parts[id].x - part.transform.x / 35), Math.abs(parts[id].y - part.transform.y / 35));
          }));
        }).toBeLessThan(1e-8);
        expect(Number(await actualState.getAttribute('data-three-playback-timeline-ms'))).toBeCloseTo(heldTime, 2);
      };
      await expectArms('project-three-puppet-state');
      await page.getByTestId('workflow-stage-path').click();
      await expect(page.getByTestId('path-three-puppet')).toHaveAttribute('data-three-initial-scene-ready', 'true');
      await expectArms('path-three-puppet-state');
      await page.getByTestId('workflow-stage-project').click();
      await expect(viewer).toHaveAttribute('data-three-initial-scene-ready', 'true');
      await expectArms('project-three-puppet-state');
    }
    expect(await authored(page)).toEqual(before);
  });
}
