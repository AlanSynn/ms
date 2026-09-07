import { expect, test, type Page } from '@playwright/test';
import { APP_PATH, saveFile, drawMark, installedArtwork } from './paintingHarness';
import { dismissStartupAnnouncement } from './startupHarness';

test.use({ viewport: { width: 1366, height: 768 } });
const state = (page: Page) => page.getByTestId('path-three-puppet-state');
const transforms = async (page: Page) => JSON.parse(await state(page).getAttribute('data-three-part-transforms') || '{}');
const drawPath = async (page: Page, side: 'left' | 'right') => {
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  const box = (await page.getByTestId('path-three-puppet-canvas').boundingBox())!;
  const x = box.x + box.width * (side === 'left' ? .35 : .65), y = box.y + box.height * .42;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 32, y - 22, { steps: 4 });
  await page.mouse.move(x + 56, y + 12, { steps: 4 });
  await page.mouse.move(x + 12, y + 35, { steps: 4 }); await page.mouse.up();
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
};

test('two independently drawn arm paths keep their owners and paint through playback and stage changes', async ({ page }, info) => {
  await page.goto(APP_PATH); await dismissStartupAnnouncement(page);
  await page.getByTestId('getting-started-dialog').getByRole('button', { name: 'Open starter rig', exact: true }).click();
  await page.getByTestId('workflow-stage-path').click();
  await page.getByLabel('Motion target').selectOption('right_arm_lower'); await drawPath(page, 'right');
  await page.getByTestId('novice-path-panel').getByRole('button', { name: 'Add path', exact: true }).click();
  await page.getByLabel('New path target').selectOption('part:left_arm_lower');
  await page.getByTestId('add-path-chooser').getByRole('button', { name: 'Create path', exact: true }).click();
  await drawPath(page, 'left');
  const before = await saveFile(page, info, 'two-paths');
  expect(before.project.pathOrder).toHaveLength(2);
  await page.getByTestId('workflow-stage-character').click();
  for (const [id, color] of [['right_arm_lower', '#ef476f'], ['left_arm_lower', '#06a77d']]) {
    await page.getByTestId(`character-part-item-${id}`).click();
    if (!await page.getByTestId('paint-workspace').count()) await page.getByTestId('character-draw-paint').click();
    await page.getByRole('button', { name: `Paint color ${color}`, exact: true }).click();
    await drawMark(page, [{ x: -15, y: 0 }, { x: 15, y: 0 }]);
  }
  const painted = await saveFile(page, info, 'two-painted-paths');
  expect(painted.project.paths).toEqual(before.project.paths);
  expect(painted.project.skeleton).toEqual(before.project.skeleton);
  expect(painted.project.mechanisms).toEqual(before.project.mechanisms);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByTestId('workflow-stage-path').click();
  const owners = ['left_arm_lower', 'right_arm_lower'];
  for (const id of owners) await installedArtwork(page, id, painted.project.parts[id].artwork!.revision);
  await expect.poll(async () => Object.keys(await transforms(page))).toEqual(expect.arrayContaining(owners));
  const initial = await transforms(page);
  await page.getByRole('button', { name: 'Play paths', exact: true }).click();
  for (const id of owners) await expect.poll(async () => (await transforms(page))[id].rotation).not.toBe(initial[id].rotation);
  await page.getByRole('button', { name: 'Pause all paths', exact: true }).click();
  await page.screenshot({ path: info.outputPath('two-painted-paths-playing.png') });
  for (const stage of ['project', 'design']) {
    await page.getByTestId(`workflow-stage-${stage}`).click();
    if (stage === 'design') await page.getByRole('button', { name: 'Four-bar linkage', exact: true }).click();
    for (const id of owners) await installedArtwork(page, id, painted.project.parts[id].artwork!.revision);
  }
  const after = await saveFile(page, info, 'two-painted-after-stages');
  expect(after.project.paths).toEqual(before.project.paths);
  expect(after.project.parts).toEqual(painted.project.parts);
});
