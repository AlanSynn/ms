import { expect, test, type Page } from '@playwright/test';
import type { Point, ProjectState } from '../../types';
import { localPivotOffsetForScene } from '../../utils/coordinates';
import { APP_PATH, saveFile } from './paintingHarness';
import { dismissStartupAnnouncement } from './startupHarness';

test.use({ viewport: { width: 1366, height: 768 }, trace: 'on' });

const state = (page: Page) => page.getByTestId('path-three-puppet-state');
const chainSummary = (page: Page) => page.getByTestId('ik-chain-summary');
const startStarter = async (page: Page) => {
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  await page.getByTestId('getting-started-dialog').getByRole('button', { name: 'Open starter rig', exact: true }).click();
  await expect(page.getByTestId('character-three-puppet')).toHaveAttribute('data-three-initial-scene-ready', 'true');
};
const openJointOptions = async (page: Page) => {
  const details = page.getByTestId('motion-joint-options');
  if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await details.locator('summary').click();
};
const createPath = async (page: Page, partId: string) => {
  const selected = page.getByTestId('motion-inventory').locator('[aria-pressed="true"]');
  const before = await selected.count() ? await selected.getAttribute('data-testid') : '';
  await page.getByTestId('novice-path-panel').getByRole('button', { name: 'Add path', exact: true }).click();
  await page.getByLabel('New path target').selectOption(`part:${partId}`);
  await page.getByTestId('add-path-chooser').getByRole('button', { name: 'Create path', exact: true }).click();
  await expect(selected).toHaveCount(1);
  await expect(selected).not.toHaveAttribute('data-testid', before ?? '');
  return (await selected.getAttribute('data-testid'))!.replace(/^motion-item-/, '');
};

const defaults = [
  { part: 'left_hand_part', root: 'left_shoulder', handle: 'left_hand', kind: 'three-joint-ik' },
  { part: 'right_hand_part', root: 'right_shoulder', handle: 'right_hand', kind: 'three-joint-ik' },
  { part: 'left_arm_lower', root: 'left_shoulder', handle: 'left_hand', kind: 'three-joint-ik' },
  { part: 'right_arm_lower', root: 'right_shoulder', handle: 'right_hand', kind: 'three-joint-ik' },
  { part: 'left_arm_upper', root: 'left_shoulder', handle: 'left_hand', kind: 'three-joint-ik' },
  { part: 'right_arm_upper', root: 'right_shoulder', handle: 'right_hand', kind: 'three-joint-ik' },
  { part: 'left_foot_part', root: 'left_hip', handle: 'left_foot', kind: 'three-joint-ik' },
  { part: 'right_foot_part', root: 'right_hip', handle: 'right_foot', kind: 'three-joint-ik' },
  { part: 'torso', root: 'hip', handle: 'torso', kind: 'two-joint-direct' },
] as const;

test('new limb paths persist the connected defaults shown in Character and Path', async ({ page }, info) => {
  await startStarter(page);
  const created: Array<{ id: string; part: string; root: string; handle: string }> = [];
  for (const expected of defaults) {
    await page.getByTestId('workflow-stage-character').click();
    await page.getByTestId(`character-part-item-${expected.part}`).click();
    const anchors = page.getByTestId('character-setup-panel').locator('summary').filter({ hasText: /^Anchors$/ });
    if (!await anchors.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) await anchors.click();
    const preset = page.getByTestId('character-motion-preset-summary');
    await expect(preset).toBeVisible();
    await expect(preset).toContainText('New path defaults');
    await expect(preset).toHaveAttribute('data-default-root', expected.root);
    await expect(preset).toHaveAttribute('data-default-handle', expected.handle);
    await expect(preset).toHaveAttribute('data-chain-kind', expected.kind);
    await expect(page.getByLabel('Part pivot')).toBeHidden();

    await page.getByTestId('workflow-stage-path').click();
    const id = await createPath(page, expected.part);
    await expect(chainSummary(page)).toContainText('Start → Handle');
    await expect(chainSummary(page)).toHaveAttribute('data-chain-root', expected.root);
    await expect(chainSummary(page)).toHaveAttribute('data-chain-handle', expected.handle);
    await expect(chainSummary(page)).toHaveAttribute('data-chain-kind', expected.kind);
    await expect(page.getByTestId('motion-joint-options')).toHaveJSProperty('open', false);
    await expect(page.getByLabel('Motion start')).toBeHidden();
    await expect(page.getByLabel('Motion handle')).toBeHidden();
    if (expected.kind === 'three-joint-ik') await expect(page.getByTestId('fold-direction-control')).toBeVisible();
    else await expect(page.getByTestId('fold-direction-control')).toHaveCount(0);
    created.push({ id, part: expected.part, root: expected.root, handle: expected.handle });
  }
  const saved = await saveFile(page, info, 'connected-new-path-defaults');
  expect(new Set(created.map(path => path.id)).size).toBe(defaults.length);
  for (const expected of created) {
    expect(saved.project.paths[expected.id]).toMatchObject({
      partId: expected.part, chainRootJointId: expected.root, targetAnchorJointId: expected.handle,
    });
  }
  const torso = created.find(path => path.part === 'torso')!;
  expect(saved.project.paths[torso.id].targetAnchorJointId).toBe('torso');
  expect(saved.project.mechanisms).toHaveLength(0);
});

type MeshPose = { x: number; y: number; z: number; rotation: number; scale: number };
type ScreenTarget = Point & { id: string; visible: boolean };
type RenderFrame = { phase: number; meshes: Record<string, MeshPose>; targets: ScreenTarget[] };
const readFrame = (page: Page): Promise<RenderFrame> => state(page).evaluate(element => {
  const data = (element as HTMLElement).dataset;
  return { phase: Number(data.threePlaybackPhase), meshes: JSON.parse(data.threePartTransforms ?? '{}'),
    targets: JSON.parse(data.threePartScreenTargets ?? '[]') };
});
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Actual mesh transforms are in renderer units. Calibrate using the stationary
// torso, then map fixed local joint positions without relying on camera pixels
// or a private renderer scale constant.
const jointFromMesh = (project: ProjectState, frame: RenderFrame, partId: string, jointId: string, units: number): Point => {
  const local = localPivotOffsetForScene(project.parts[partId], project.skeleton!.joints[jointId].position);
  const mesh = frame.meshes[partId];
  const x = local.x * mesh.scale, y = local.y * mesh.scale;
  return { x: mesh.x / units + x * Math.cos(mesh.rotation) - y * Math.sin(mesh.rotation),
    y: mesh.y / units + x * Math.sin(mesh.rotation) + y * Math.cos(mesh.rotation) };
};

test('drawn hand motion keeps the arm connected and custom joints survive files until Automatic resets them', async ({ page, browser, baseURL }, info) => {
  await startStarter(page);
  const baseline = await saveFile(page, info, 'connected-rig-before-motion');
  await page.getByTestId('workflow-stage-path').click();
  // Disable the starter's existing arm motion through its ordinary control so
  // the new hand path owns this limb for the playback assertions.
  await page.getByTestId('motion-item-path-right-arm').click();
  await page.getByTestId('novice-path-panel').getByText('More', { exact: true }).click();
  await page.getByTestId('novice-path-panel').getByRole('button', { name: 'Disable', exact: true }).click();
  await page.getByTestId('path-view-2d').click();
  const id = await createPath(page, 'right_hand_part');
  await expect(chainSummary(page)).toHaveAttribute('data-chain-root', 'right_shoulder');
  await expect(chainSummary(page)).toHaveAttribute('data-chain-handle', 'right_hand');
  await expect.poll(async () => Object.keys((await readFrame(page)).meshes)).toEqual(expect.arrayContaining(['torso', 'right_arm_upper', 'right_arm_lower', 'right_hand_part']));
  const rest = await readFrame(page);
  const units = rest.meshes.torso.y / baseline.project.parts.torso.transform.y;
  expect(Number.isFinite(units) && units > 0).toBe(true);
  const hand = rest.targets.find(target => target.id === 'right_hand_part')!;
  expect(hand.visible).toBe(true);
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(state(page)).toHaveAttribute('data-camera-preset', 'front');
  await page.mouse.move(hand.x - 18, hand.y - 15); await page.mouse.down();
  await page.mouse.move(hand.x - 42, hand.y - 40, { steps: 6 });
  await page.mouse.move(hand.x + 4, hand.y - 68, { steps: 6 });
  await page.mouse.move(hand.x + 20, hand.y - 12, { steps: 6 }); await page.mouse.up();
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
  await expect(chainSummary(page)).toContainText('Motion ready');

  const joints = baseline.project.skeleton!.joints;
  const upperLength = distance(joints.right_shoulder.position, joints.right_elbow.position);
  const lowerLength = distance(joints.right_elbow.position, joints.right_hand.position);
  const samples: RenderFrame[] = [];
  await page.getByRole('button', { name: 'Play paths', exact: true }).click();
  let phase = (await readFrame(page)).phase;
  for (let index = 0; index < 4; index += 1) {
    await expect.poll(async () => Math.abs((await readFrame(page)).phase - phase)).toBeGreaterThan(0.2);
    const frame = await readFrame(page); samples.push(frame); phase = frame.phase;
    const shoulder = jointFromMesh(baseline.project, frame, 'right_arm_upper', 'right_shoulder', units);
    const elbow = jointFromMesh(baseline.project, frame, 'right_arm_lower', 'right_elbow', units);
    const handle = jointFromMesh(baseline.project, frame, 'right_hand_part', 'right_hand', units);
    expect(distance(shoulder, joints.right_shoulder.position), 'the shoulder remains fixed while the limb bends').toBeLessThan(0.05);
    expect(Math.abs(distance(shoulder, elbow) - upperLength), 'rendered upper arm keeps its joint spacing').toBeLessThan(0.05);
    expect(Math.abs(distance(elbow, handle) - lowerLength), 'rendered lower arm keeps its joint spacing').toBeLessThan(0.05);
    expect(distance(jointFromMesh(baseline.project, frame, 'right_arm_upper', 'right_elbow', units), elbow), 'upper and lower arm share the elbow').toBeLessThan(0.05);
    expect(distance(jointFromMesh(baseline.project, frame, 'right_arm_lower', 'right_hand', units), handle), 'hand stays attached to the lower arm').toBeLessThan(0.05);
    expect(Math.abs(angleDifference(frame.meshes.right_hand_part.rotation - frame.meshes.right_arm_lower.rotation,
      rest.meshes.right_hand_part.rotation - rest.meshes.right_arm_lower.rotation)), 'the hand follows the lower arm orientation').toBeLessThan(0.001);
  }
  await page.getByRole('button', { name: 'Pause all paths', exact: true }).click();
  expect(samples.some(frame => Math.abs(angleDifference(frame.meshes.right_arm_upper.rotation, rest.meshes.right_arm_upper.rotation)) > 0.03)).toBe(true);
  expect(samples.some(frame => Math.abs(angleDifference(frame.meshes.right_hand_part.rotation, rest.meshes.right_hand_part.rotation)) > 0.03)).toBe(true);
  const restingUpper = rest.targets.find(target => target.id === 'right_arm_upper')!;
  expect(samples.some(frame => distance(frame.targets.find(target => target.id === 'right_arm_upper')!, restingUpper) > 2), 'upper arm movement is visible in the actual scene').toBe(true);
  await page.screenshot({ path: info.outputPath('connected-arm-playback.png') });
  await page.getByTestId('quick-rig-helper').screenshot({ path: info.outputPath('connected-motion-controls.png') });

  await openJointOptions(page);
  await page.getByLabel('Motion start').selectOption('right_hand');
  await expect(chainSummary(page)).toContainText('Use Automatic to keep joints connected');
  await page.getByRole('button', { name: 'Automatic', exact: true }).click();
  await expect(chainSummary(page)).toHaveAttribute('data-chain-root', 'right_shoulder');
  await page.getByLabel('Motion start').selectOption('right_elbow');
  await expect(chainSummary(page)).toHaveAttribute('data-chain-root', 'right_elbow');
  await expect(chainSummary(page)).toHaveAttribute('data-chain-kind', 'two-joint-direct');
  await expect(page.getByTestId('fold-direction-control')).toHaveCount(0);
  const custom = await saveFile(page, info, 'connected-custom-start');
  expect(custom.project.paths[id]).toMatchObject({ chainRootJointId: 'right_elbow', targetAnchorJointId: 'right_hand' });
  expect(custom.project.parts).toEqual(baseline.project.parts);
  expect(custom.project.skeleton).toEqual(baseline.project.skeleton);

  const clean = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  try {
    const next = await clean.newPage(); await next.goto(APP_PATH); await dismissStartupAnnouncement(next);
    const chooser = next.waitForEvent('filechooser');
    await next.getByTestId('getting-started-dialog').getByRole('button', { name: 'Open Project', exact: true }).click();
    await (await chooser).setFiles(custom.file);
    await expect(next.getByTestId('status-bar')).toContainText('Loaded project');
    await next.getByTestId('workflow-stage-character').click();
    await next.getByTestId('character-part-item-right_hand_part').click();
    await expect(next.getByTestId('character-motion-preset-summary')).toHaveAttribute('data-default-root', 'right_shoulder');
    await next.getByTestId('workflow-stage-path').click();
    await next.getByTestId(`motion-item-${id}`).click();
    await expect(chainSummary(next)).toHaveAttribute('data-chain-root', 'right_elbow');
    await expect(chainSummary(next)).toHaveAttribute('data-chain-handle', 'right_hand');
    await expect(next.getByTestId('fold-direction-control')).toHaveCount(0);
    const reopened = await saveFile(next, info, 'connected-custom-reopened');
    expect(reopened.project.paths[id]).toEqual(custom.project.paths[id]);
    await openJointOptions(next);
    await next.getByRole('button', { name: 'Automatic', exact: true }).click();
    await expect(chainSummary(next)).toHaveAttribute('data-chain-root', 'right_shoulder');
    await expect(chainSummary(next)).toHaveAttribute('data-chain-handle', 'right_hand');
    await expect(chainSummary(next)).toHaveAttribute('data-chain-kind', 'three-joint-ik');
    await expect(next.getByTestId('fold-direction-control')).toBeVisible();
    const automatic = await saveFile(next, info, 'connected-automatic-restored');
    expect(automatic.project.paths[id]).toMatchObject({ chainRootJointId: 'right_shoulder', targetAnchorJointId: 'right_hand' });
    expect(automatic.project.paths[id].points).toEqual(custom.project.paths[id].points);
    expect(automatic.project.parts).toEqual(baseline.project.parts);
    expect(automatic.project.skeleton).toEqual(baseline.project.skeleton);
  } finally { await clean.close(); }
});
