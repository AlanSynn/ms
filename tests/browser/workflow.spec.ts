import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLessonProject, serializeProject } from '../../utils/project';
import { FABRICATION_RENDER_LAYER_Z_STEP } from '../../utils/fabrication';

const expectCleanPage = (pageErrors: string[], consoleErrors: string[]) => {
  expect(pageErrors, 'no uncaught browser exceptions').toEqual([]);
  expect(consoleErrors, 'no browser console errors').toEqual([]);
};

const downloadMetadataJson = async (page: Page) => {
  const [metadataDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Metadata', exact: true }).click()
  ]);
  const metadataPath = await metadataDownload.path();
  expect(metadataPath, 'metadata download path').toBeTruthy();
  return JSON.parse(await readFile(metadataPath!, 'utf8'));
};

const dismissWelcomeSplash = async (page: Page) => {
  const dialog = page.getByTestId('welcome-dialog');
  if (!(await dialog.count())) return;
  if (!(await dialog.first().isVisible().catch(() => false))) return;
  await page.keyboard.press('Escape');
  await expect(dialog, 'welcome splash closes without showing onboarding controls').toHaveCount(0, { timeout: 1000 });
};

const openCharacterScreen = async (page: Page, options: { loadStarter?: boolean } = { loadStarter: true }) => {
  await dismissWelcomeSplash(page);
  if (await page.getByTestId('getting-started-dialog').count()) {
    if (options.loadStarter !== false) await page.getByRole('button', { name: /Open starter rig/i }).click();
    else await page.getByRole('button', { name: 'Skip' }).click();
  }
  if (!(await page.getByTestId('character-screen').count())) {
    await page.getByRole('button', { name: /^Character$/i }).click();
  }
  await expect(page.getByTestId('character-screen')).toBeVisible();
};

test('Character part cut outline editor bakes and edits contour points', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openCharacterScreen(page);
  await page.getByTestId('character-part-item-head').click();
  await expect(page.getByTestId('part-cut-controls')).toBeVisible();
  await expect(page.getByTestId('part-cut-summary')).toContainText(/cut .* pts/i);

  await page.getByTestId('part-cut-bake').click();
  const cutDialog = page.getByTestId('cut-outline-dialog');
  await expect(cutDialog).toBeVisible();
  await expect(page.getByTestId('part-cut-summary')).toContainText('user cut');
  const dialogBox = await cutDialog.boundingBox();
  const viewport = page.viewportSize();
  expect(dialogBox, 'cut editor overlay has a visible box').toBeTruthy();
  expect(viewport, 'browser viewport is available').toBeTruthy();
  if (!dialogBox || !viewport) throw new Error('Missing cut editor overlay or viewport metrics');
  expect(dialogBox.width, 'cut editor opens as a large canvas-first overlay').toBeGreaterThan(700);
  expect(Math.abs((dialogBox.x + dialogBox.width / 2) - viewport.width / 2), 'cut editor is centered over the workbench').toBeLessThan(12);
  await expect(cutDialog.getByLabel('Cut point X number')).toHaveCount(0);
  await cutDialog.getByTestId('part-cut-add-point').click();
  await expect(page.getByTestId('part-cut-summary')).toContainText('user cut');
  const canvas = page.getByTestId('cut-outline-canvas');
  const editedPoint = cutDialog.getByTestId('cut-outline-point-1');
  const beforeClickX = Number(await editedPoint.getAttribute('cx'));
  await canvas.click({ position: { x: 260, y: 140 } });
  await expect.poll(async () => Number(await editedPoint.getAttribute('cx')), { message: 'canvas click moves the selected cut point' }).not.toBe(beforeClickX);
  await cutDialog.getByRole('button', { name: 'Done' }).click();
  await expect(cutDialog).toHaveCount(0);

  const puppet = page.getByTestId('character-three-puppet-state');
  await expect(puppet).toHaveAttribute('data-part-outline-mode', 'model-or-user-contour-with-fabrication-fallback');
  await expect.poll(async () => Number(await puppet.getAttribute('data-three-render-triangles')), { message: 'edited cut contour still renders as 3D solid plates' }).toBeGreaterThan(0);
  expectCleanPage(pageErrors, consoleErrors);
});


const writeWavingArmLessonProject = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motionsmith-lesson-'));
  const path = join(dir, 'waving-arm.motionsmith.json');
  await writeFile(path, serializeProject(createLessonProject('waving-arm')), 'utf8');
  return path;
};

const importWavingArmLessonProject = async (page: Page, targetStage: 'character' | 'path' = 'path') => {
  await dismissWelcomeSplash(page);
  const projectPath = await writeWavingArmLessonProject();
  const gettingStarted = page.getByTestId('getting-started-dialog');
  if (await gettingStarted.count()) await page.getByTestId('getting-started-import-input').setInputFiles(projectPath);
  else await page.getByTestId('project-file-input').setInputFiles(projectPath);
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
  if (targetStage === 'character') {
    await page.getByRole('button', { name: /^Character$/i }).click();
    await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  }
};

const openWavingArmTemplate = async (page: Page) => {
  await importWavingArmLessonProject(page, 'path');
};

const applyFourBarFromFoundry = async (page: Page) => {
  await page.getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  await page.getByRole('button', { name: /Use mechanism/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
};

const readScenePoint = async (locator: Locator) => locator.evaluate((el: SVGElement) => ({
  x: Number(el.getAttribute('cx')),
  y: Number(el.getAttribute('cy'))
}));

const activeElementIsInDialog = (page: Page) => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));

const stageRailButton = (page: Page, name: string | RegExp) => page.getByTestId('workspace-steps').getByRole('button', { name, exact: typeof name === 'string' });
const clickStage = async (page: Page, name: string | RegExp) => stageRailButton(page, name).click();
const expectProjectCounts = async (page: Page, parts: number, paths: number, mechanisms: number) => {
  await expect(page.getByTestId('stage-project-card')).toHaveAttribute('aria-label', new RegExp(`${parts} parts, ${paths} paths, ${mechanisms} mechanisms`));
  await expect(page.getByTestId('stage-project-card')).not.toBeVisible();
};

test('character → path → foundry → design → blueprint runs end-to-end in browser', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await expect(page.getByTestId('shared-workbench')).toBeVisible();
  await expect(page.locator('#boot-loader')).toHaveCount(0);
  const welcomeDialog = page.getByTestId('welcome-dialog');
  await expect(welcomeDialog).toBeVisible();
  await expect(welcomeDialog).toContainText('MOTIONSMITH');
  await expect(welcomeDialog.getByRole('button')).toHaveCount(0);
  await expect(welcomeDialog.getByRole('checkbox')).toHaveCount(0);
  await expect(welcomeDialog.getByLabel('MotionSmith preview video')).toHaveCount(0);
  await expect(welcomeDialog.getByText('Rig a character, draw a path')).toHaveCount(0);
  await expect(welcomeDialog.getByText('Skip forever')).toHaveCount(0);
  const welcomeBox = await welcomeDialog.boundingBox();
  const logoBox = await welcomeDialog.locator('img.motionsmith-logo-mark').boundingBox();
  const viewport = page.viewportSize();
  expect(welcomeBox?.width ?? 0, 'startup splash reads as a large overlay').toBeGreaterThanOrEqual((viewport?.width ?? 1200) * 0.62);
  expect(welcomeBox?.height ?? 0, 'logo-only splash fits inside the editor viewport').toBeLessThanOrEqual((viewport?.height ?? 900) * 0.7);
  expect(logoBox?.width ?? 0, 'splash logo is large enough to read as startup branding').toBeGreaterThan(70);
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= document.scrollingElement!.clientHeight + 8)).toBe(true);
  await expect.poll(() => activeElementIsInDialog(page)).toBe(true);
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    expect(await activeElementIsInDialog(page)).toBe(true);
  }
  await welcomeDialog.press('Escape');
  await expect(page.getByTestId('welcome-dialog')).toHaveCount(0);
  await expect(page.getByTestId('onnx-cache-status')).toBeVisible();
  await expect(page.getByTestId('onnx-cache-status')).toContainText(/AI ready|Get AI|AI \d+%|Try again/);
  await expect(page.getByTestId('status-bar')).not.toContainText(/parts:|paths:|mechs:|zoom/);

  const gettingStarted = page.getByTestId('getting-started-dialog');
  await expect(gettingStarted).toBeVisible();
  await expect(gettingStarted).toContainText('Start a character.');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).toContainText('Starter rig');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).toContainText('Image');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).toContainText('Character file');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).toContainText('Girl');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).toContainText('Boy');
  await expect(gettingStarted).toContainText('Open full project');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Package');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Humanoid');
  await expect(gettingStarted.getByTestId('getting-started-gallery').locator('.template-tile')).toHaveCount(5);
  await expect(gettingStarted.getByTestId('getting-started-gallery').locator('.template-icon-slot')).toHaveCount(5);
  await expect(gettingStarted.getByTestId('getting-started-gallery').locator('.starter-thumb')).toHaveCount(2);
  const topRowTitleYs = await Promise.all(['humanoid', 'girl', 'boy'].map(id => gettingStarted.getByTestId(`getting-started-card-${id}`).locator('strong').boundingBox().then(box => box?.y ?? 0)));
  expect(Math.max(...topRowTitleYs) - Math.min(...topRowTitleYs), 'top-row starter titles align despite thumbnails').toBeLessThan(3);
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Local browser processing');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('rigging');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Waving arm');
  await page.getByRole('button', { name: 'Skip' }).click();

  await expect(page.getByTestId('character-screen')).toBeVisible();
  await expect(page.getByTestId('workspace-steps')).toBeVisible();
  await expect(page.getByTestId('character-preview-pane')).toBeVisible();
  await expect(page.getByTestId('getting-started-gallery')).toHaveCount(0);
  await expect(page.getByText('Start with character art')).toHaveCount(0);
  await expect(page.getByTestId('character-status-dock')).toHaveCount(0);
  await expectProjectCounts(page, 0, 0, 0);
  await expect(page.getByTestId('character-part-list')).not.toContainText('Right lower arm');
  await expect(page.getByTestId('character-setup-panel')).toContainText('No part');
  await expect(page.getByTestId('part-art-controls')).toHaveCount(0);
  await expect(page.getByLabel('Art width number')).toHaveCount(0);
  await expect(page.getByTestId('character-status-dock').getByText('parts', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('onboarding-import-input')).toBeAttached();

  const forbiddenRuntimeImports = await page.locator('script[src], script[type="importmap"]').evaluateAll(nodes =>
    nodes.map(node => ({ src: node.getAttribute('src'), type: node.getAttribute('type') }))
  );
  expect(forbiddenRuntimeImports).not.toContainEqual(expect.objectContaining({ type: 'importmap' }));
  expect(forbiddenRuntimeImports.every(item => !item.src || item.src.startsWith('/'))).toBe(true);

  await openWavingArmTemplate(page);
  await expect(page.getByTestId('workspace-steps')).toContainText('Path Editor');
  await expect(page.getByTestId('stage-project-card')).not.toContainText('Shared canvas');
  await expect(page.getByTestId('stage-project-card')).not.toBeVisible();
  await expect(page.getByTestId('project-compact-stats')).toContainText('20mm');
  await expect(page.getByTestId('project-compact-stats')).not.toBeVisible();
  await expect(page.getByTestId('shared-workbench')).toBeVisible();
  await expect(page.getByTestId('workspace-player-dock')).toBeVisible();
  await expect(page.getByTestId('novice-path-panel')).toContainText('Draw path');
  await expect(page.getByRole('heading', { name: 'Draw path' })).toBeVisible();
  await expect(page.getByTestId('free-draw-status')).toContainText(/5 points .*path-right-arm/);
  await expect(page.getByTestId('path-canvas')).toHaveCount(0);
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  const pathPuppet = page.getByTestId('path-three-puppet-state');
  await expect(pathPuppet).toHaveAttribute('data-three-renderer', 'webgl');
  await expect(pathPuppet).toHaveAttribute('data-camera-preset', 'iso');
  await expect(page.getByTestId('path-three-puppet-view-top')).toHaveCount(0);
  await expect(page.getByTestId('path-three-puppet-view-2d')).toHaveCount(0);
  await page.getByTestId('path-view-2d').click();
  await expect(page.getByTestId('path-view-2d')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('path-canvas')).toBeVisible();
  await expect(page.getByTestId('path-three-puppet-state')).toHaveCount(0);
  await expect(page.getByTestId('path-shape-controls')).toBeVisible();
  await expect(page.getByLabel('Smoothness number')).toBeVisible();
  const zoomReadout = page.getByTestId('canvas-zoom-readout');
  const readZoomPercent = async () => Number((await zoomReadout.textContent())?.replace('%', '') ?? '0');
  const zoomBefore = await readZoomPercent();
  const pathCanvasForZoom = page.getByTestId('path-canvas');
  const pathBox = await pathCanvasForZoom.boundingBox();
  if (!pathBox) throw new Error('path 2D canvas box missing');
  await page.mouse.move(pathBox.x + pathBox.width * 0.55, pathBox.y + pathBox.height * 0.45);
  await page.mouse.wheel(0, -360);
  await expect.poll(readZoomPercent).toBeGreaterThan(zoomBefore);
  await page.getByTestId('path-view-3d').click();
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await expect(page.getByTestId('path-canvas')).toHaveCount(0);
  await expect(pathPuppet).toHaveAttribute('data-camera-preset', 'iso');
  await expect(pathPuppet).toHaveAttribute('data-view-mode', '3d');
  const yawBefore = Number(await pathPuppet.getAttribute('data-camera-yaw'));
  const puppetCanvas = page.getByTestId('path-three-puppet-canvas');
  const puppetBox = await puppetCanvas.boundingBox();
  if (!puppetBox) throw new Error('3D puppet canvas box missing');
  await page.mouse.move(puppetBox.x + puppetBox.width * 0.5, puppetBox.y + puppetBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(puppetBox.x + puppetBox.width * 0.65, puppetBox.y + puppetBox.height * 0.42);
  await page.mouse.up();
  await expect.poll(async () => Number(await pathPuppet.getAttribute('data-camera-yaw'))).toBeGreaterThan(yawBefore + 5);
  await expect(pathPuppet).toHaveAttribute('data-viewer-contract', 'shared-viewer3d:v1');
  await expect(pathPuppet).toHaveAttribute('data-layer-skeleton', 'shown');
  await page.getByTestId('path-three-puppet-toggle-skeleton').click();
  await expect(pathPuppet).toHaveAttribute('data-layer-skeleton', 'hidden');
  await page.getByTestId('path-three-puppet-toggle-skeleton').click();
  await expect(pathPuppet).toHaveAttribute('data-layer-skeleton', 'shown');
  await page.getByTestId('path-three-puppet-toggle-grid').click();
  await expect(pathPuppet).toHaveAttribute('data-layer-grid', 'hidden');
  await page.getByTestId('path-three-puppet-toggle-grid').click();
  await expect(pathPuppet).toHaveAttribute('data-layer-grid', 'shown');
  await expect(pathPuppet).toHaveAttribute('data-puppet-mode', 'thick-flat-assembly');
  await expect(pathPuppet).toHaveAttribute('data-three-part-surface', 'solid-cut-plates');
  await expect(pathPuppet).toHaveAttribute('data-three-part-art', 'top-texture-decal');
  await expect(pathPuppet).toHaveAttribute('data-three-part-opacity', '1');
  await expect(pathPuppet).toHaveAttribute('data-three-assembly-underlay', 'plate-art-decal');
  await expect(pathPuppet).toHaveAttribute('data-joint-placement', 'skeleton-anchors');
  await expect(pathPuppet).toHaveAttribute('data-three-rebuild-mode', 'static-topology-dynamic-transforms');
  const pathHasWebgl = await page.getByTestId('path-three-puppet-canvas').evaluate((canvas: HTMLCanvasElement) => Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')));
  expect(pathHasWebgl, 'path editor mounts a real WebGL canvas').toBeTruthy();
  expect(Number(await pathPuppet.getAttribute('data-three-joint-count')), 'path editor uses skeleton joints in the 3D puppet').toBeGreaterThanOrEqual(17);
  expect(Number(await pathPuppet.getAttribute('data-three-part-hole-count')), '3D puppet body pieces include cut-through joint holes').toBeGreaterThan(0);
  await expect.poll(async () => Number(await pathPuppet.getAttribute('data-three-scene-object-count')), { message: '3D puppet scene has rendered geometry beyond a dummy canvas' }).toBeGreaterThan(40);
  await expect.poll(async () => Number(await pathPuppet.getAttribute('data-three-render-triangles')), { message: 'path WebGL renderer drew real triangles' }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByTestId('skeleton-joint-right_elbow')).toBeVisible();
  expect(await page.locator('[data-testid^="skeleton-joint-"]').count()).toBeGreaterThanOrEqual(17);
  await page.getByRole('button', { name: 'Drawing free path', exact: true }).click();

  const projectDownloadPromise = page.waitForEvent('download');
  await page.getByTestId('top-command-bar').getByText('File', { exact: true }).click();
  await page.getByTestId('command-download-snapshot').click();
  const projectDownload = await projectDownloadPromise;
  expect(projectDownload.suggestedFilename()).toMatch(/\.motionsmith\.json$/);
  const projectDownloadPath = await projectDownload.path();
  expect(projectDownloadPath, 'project download path').toBeTruthy();
  const projectSnapshot = JSON.parse(await readFile(projectDownloadPath!, 'utf8'));
  expect(projectSnapshot.parts).toBeTruthy();
  expect(projectSnapshot.skeleton).toBeTruthy();
  expect(projectSnapshot.paths).toBeTruthy();
  expect(projectSnapshot.mechanisms).toBeTruthy();
  expect(projectSnapshot.settings).toBeTruthy();
  await page.getByTestId('project-file-input').setInputFiles(projectDownloadPath!);
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();

  await page.getByTestId('path-view-3d').click();
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByTestId('path-view-2d')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('path-three-puppet-state')).toHaveCount(0);
  await expect(page.locator('[data-testid="path-canvas"], [data-testid="path-three-puppet-canvas"]')).toHaveCount(1);
  const pathCanvas = page.getByTestId('path-canvas');
  await expect(pathCanvas).toBeVisible();
  await pathCanvas.click({ position: { x: 260, y: 220 } });
  await pathCanvas.click({ position: { x: 320, y: 250 } });
  await expect(page.getByTestId('free-draw-status')).toContainText(/7 points .*path-right-arm/);

  await page.getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  await expect(page.getByTestId('foundry-camera-readout')).toContainText('3D Isometric');
  await expect(page.getByTestId('foundry-three-canvas')).toBeVisible();
  const foundryRig = page.getByTestId('foundry-camera-rig');
  await expect(foundryRig).toHaveAttribute('data-three-renderer', 'webgl');
  await expect(foundryRig).toHaveAttribute('data-three-stack-source', 'fabricationStackForMechanism');
  await expect(foundryRig).toHaveAttribute('data-three-stack-mode', 'assembled-spacer-separated');
  await expect(foundryRig).toHaveAttribute('data-three-exploded', 'false');
  await expect(foundryRig).toHaveAttribute('data-three-stack-order', /^Back Clip → .*S10 spacer.*Front Clip$/);
  await expect(foundryRig).toHaveAttribute('data-three-spacer-key', 's10');
  await expect(foundryRig).toHaveAttribute('data-three-spacer-mm', '10x4');
  expect(Number(await foundryRig.getAttribute('data-three-spacer-render-count'))).toBeGreaterThan(0);
  await expect(foundryRig).toHaveAttribute('data-three-spacer-render-contract', 'recipe-pin-spacer-sites');
  await expect(foundryRig).toHaveAttribute('data-three-pin-stack-policy', 'per-pin-adjacent-stack');
  await expect(foundryRig).toHaveAttribute('data-three-pin-stack-spans', /A:[0-9.]+/);
  await expect(foundryRig).toHaveAttribute('data-three-z-collision-count', '0');
  await expect(foundryRig).toHaveAttribute('data-three-stack-colors', /#334155.*#f59e0b/);
  await expect(foundryRig).toHaveAttribute('data-three-stack-validation-errors', '0');
  expect(await foundryRig.getAttribute('data-three-rendered-layer-labels')).toBe(await foundryRig.getAttribute('data-three-stack-order'));
  expect(await foundryRig.getAttribute('data-three-rendered-layer-roles')).toBe(await foundryRig.getAttribute('data-three-stack-roles'));
  expect(await foundryRig.getAttribute('data-three-rendered-layer-colors')).toBe(await foundryRig.getAttribute('data-three-stack-colors'));
  expect(await foundryRig.getAttribute('data-three-rendered-layer-z'), 'Default foundry 4bar keeps A/D ground links coplanar instead of rendering the printable stack literally').not.toBe(await foundryRig.getAttribute('data-three-stack-z'));
  await expect(foundryRig).toHaveAttribute('data-three-fourbar-ground-link-plane', 'A-D-ground-links-coplanar');
  expect(await foundryRig.getAttribute('data-three-stack-order')).not.toContain('Base board');
  await expect(page.getByTestId('foundry-exploded-guide')).toHaveCount(0);
  await expect(page.getByTestId('foundry-z-layer-labels')).toHaveCount(0);
  await page.getByText('Mechanism options').click();
  await expect(page.getByLabel('Foundry preset')).toHaveValue('balanced');
  const foundryTargetSummary = page.getByTestId('foundry-target-summary');
  await expect(foundryTargetSummary).toBeVisible();
  await expect(foundryTargetSummary).toContainText(/chain|anchor/);
  await expect(page.getByTestId('foundry-mechanism-library')).toHaveCount(0);
  await expect(page.getByTestId('foundry-fabrication-stack')).toContainText(/^Stack\s*Back Clip.*S10 spacer.*Front Clip/);
  await expect(page.getByTestId('foundry-fabrication-stack')).not.toContainText(/Base board/);
  await page.getByRole('button', { name: 'Show details' }).click();
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('Four-bar linkage');
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('pin reactions');
  await page.getByRole('button', { name: 'Hide details' }).click();
  await expect(foundryTargetSummary).toContainText(/Board hole [A-Z]\d+/);
  await expect(page.getByTestId('foundry-anchor-marker'), 'Default sandbox shows only path and mechanism').toHaveCount(0);
  await page.getByTestId('foundry-pick-anchor').click();
  await expect(page.getByTestId('foundry-anchor-status')).toContainText('Pick board hole');
  const previewBox = await page.getByTestId('foundry-preview').boundingBox();
  expect(previewBox, 'foundry preview supports direct anchor picking').toBeTruthy();
  await page.mouse.click(previewBox!.x + previewBox!.width * 0.52, previewBox!.y + previewBox!.height * 0.52);
  await expect(page.getByTestId('foundry-anchor-status')).toContainText('Anchor picked');
  await expect(page.getByTestId('foundry-anchor-marker')).toBeVisible();
  await expect(page.getByTestId('foundry-anchor-marker')).toHaveAttribute('transform', /translate\(/);
  const pickedAnchorX = await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').inputValue();
  const pickedAnchorY = await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').inputValue();
  await page.getByRole('button', { name: /Use mechanism/i }).click();

  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mechanisms' })).toBeVisible();
  await expect(page.getByTestId('design-mechanism-library')).toContainText('Four-bar linkage');
  await expect(page.getByTestId('design-canvas').getByText('Letter sheet · 2cm grid')).toBeVisible();
  await expect(page.getByTestId('design-three-puppet-canvas')).toBeVisible();
  const designPuppet = page.getByTestId('design-three-puppet-state');
  await expect(designPuppet).toHaveAttribute('data-three-renderer', 'webgl');
  await expect(designPuppet).toHaveAttribute('data-puppet-mode', 'thick-flat-assembly');
  await expect(designPuppet).toHaveAttribute('data-three-part-surface', 'solid-cut-plates');
  await expect(designPuppet).toHaveAttribute('data-three-part-art', 'top-texture-decal');
  await expect(designPuppet).toHaveAttribute('data-three-part-opacity', '1');
  await expect(designPuppet).toHaveAttribute('data-three-assembly-underlay', 'plate-art-decal');
  await expect(designPuppet).toHaveAttribute('data-three-rebuild-mode', 'static-topology-dynamic-transforms');
  const designHasWebgl = await page.getByTestId('design-three-puppet-canvas').evaluate((canvas: HTMLCanvasElement) => Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')));
  expect(designHasWebgl, 'design stage mounts a real WebGL canvas').toBeTruthy();
  expect(Number(await designPuppet.getAttribute('data-three-part-count')), 'mechanism design keeps the character as a 3D flat puppet').toBeGreaterThanOrEqual(6);
  expect(Number(await designPuppet.getAttribute('data-three-mechanism-count')), 'mechanism design renders attached mechanisms in WebGL 3D').toBeGreaterThanOrEqual(1);
  expect(Number(await designPuppet.getAttribute('data-three-mechanism-link-count')), '3D mechanism overlay contains physical link bars').toBeGreaterThanOrEqual(5);
  await expect.poll(async () => Number(await designPuppet.getAttribute('data-three-scene-object-count')), { message: 'design 3D scene includes character, joints, and mechanism geometry' }).toBeGreaterThan(60);
  await expect.poll(async () => Number(await designPuppet.getAttribute('data-three-render-triangles')), { message: 'design WebGL renderer drew real triangles' }).toBeGreaterThan(0);
  const designMechanism = page.getByTestId('design-canvas').locator('[data-mechanism-type="4bar"]').first();
  await expect(designMechanism).toHaveAttribute('data-reference-canonical-key', 'four_bar');
  await expect(designMechanism).toHaveAttribute('data-reference-topology', /A-B input.*B-C coupler.*C-D output.*D-A board-ground/);
  await expect(designMechanism).toHaveAttribute('data-reference-stack-labels', /Input L2 linkage.*Coupler L4 linkage.*Output L2 linkage/);
  await expect(designMechanism).toHaveAttribute('data-reference-coord-roles', /I5:board.*G6:link_end_reference.*G10:link_joint_reference.*I9:board/);
  await expect(page.getByTestId('design-parametric-editor'), 'Design reuses the same fabrication-backed parametric editor after Foundry export').toBeVisible();
  await expect(page.getByLabel('Input link length'), 'Foundry-selected 4bar remains visibly editable in Design').toBeVisible();
  const persistedPathCount = await page.getByTestId('design-canvas').locator('path').evaluateAll(paths =>
    paths.filter(path => (path.getAttribute('d') ?? '').includes('M 70.00 60.00') && (path.getAttribute('d') ?? '').includes('L 130.00 84.00')).length
  );
  expect(persistedPathCount, 'drawn path persists into mechanism design canvas').toBeGreaterThan(0);
  const fittedAnchorX = Number(await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').inputValue());
  const fittedAnchorY = Number(await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').inputValue());
  expect(Number.isFinite(fittedAnchorX), 'foundry export keeps a finite placed anchor after path fitting').toBeTruthy();
  expect(Number.isFinite(fittedAnchorY), 'foundry export keeps a finite placed anchor after path fitting').toBeTruthy();
  expect(Math.abs(fittedAnchorX / 40 - Math.round(fittedAnchorX / 40)), 'fitted anchor X stays snapped to the fabrication grid').toBeLessThan(0.01);
  expect(Math.abs(fittedAnchorY / 40 - Math.round(fittedAnchorY / 40)), 'fitted anchor Y stays snapped to the fabrication grid').toBeLessThan(0.01);
  expect(Math.hypot(fittedAnchorX - Number(pickedAnchorX), fittedAnchorY - Number(pickedAnchorY)), 'path fitting may move the picked anchor but keeps it local').toBeLessThanOrEqual(160);
  await expect(page.getByRole('button', { name: /^Fit$/i })).toBeVisible();
  const playback = page.getByRole('button', { name: /Play|Pause/ }).first();
  await expect(playback).toBeVisible();
  await expect(page.getByTestId('design-part-right_arm_lower')).not.toHaveAttribute('transform', 'translate(118 -8) rotate(18)');
  const sharedTransport = page.getByTestId('workspace-player-dock').getByRole('button', { name: /Pause|Play/ });
  if ((await sharedTransport.textContent())?.includes('Ⅱ')) await sharedTransport.click();
  const scrubber = page.getByLabel('Workspace scrubber');
  const effectorSamples: Array<{ x: number; y: number }> = [];
  for (const frame of ['0', '25', '50', '75']) {
    await scrubber.fill(frame);
    const effector = await readScenePoint(page.locator('[data-testid^="mechanism-effector-"]').first());
    const target = await readScenePoint(page.locator('[data-testid^="mechanism-target-"]').first());
    const hand = await readScenePoint(page.getByTestId('skeleton-joint-right_hand'));
    effectorSamples.push(effector);
    expect(Math.hypot(effector.x - hand.x, effector.y - hand.y), `mechanism effector stays pinned to right hand at ${frame}%`).toBeLessThan(0.01);
    expect(Math.hypot(target.x - hand.x, target.y - hand.y), `target marker stays pinned to right hand at ${frame}%`).toBeLessThan(0.01);
  }
  expect(Math.hypot(effectorSamples[0].x - effectorSamples.at(-1)!.x, effectorSamples[0].y - effectorSamples.at(-1)!.y), 'scrubbing moves the mechanism-driven endpoint').toBeGreaterThan(10);
  if ((await playback.textContent())?.includes('Pause')) await playback.click();
  await expect(page.getByRole('button', { name: 'SVG', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'DXF' })).toBeVisible();
  await expectProjectCounts(page, 14, 1, 1);

  await clickStage(page, 'Blueprint');
  await expect(page.getByRole('heading', { name: 'Blueprint' })).toBeVisible();
  await expect(page.getByTestId('workflow-status-strip')).toContainText('Blueprint');
  await expect(page.getByTestId('blueprint-canvas-preview')).toBeVisible();
  await expect(page.getByTestId('blueprint-detail-preview')).toContainText('Cut sheet');
  await expect(page.getByTestId('blueprint-control-panel')).toContainText('Cut sheet');
  await expect(page.getByText('Ready.')).toBeVisible();
  await expect(page.getByTestId('stage-canvas-pane').getByTestId('assembly-guide-web-preview')).toHaveCount(0);
  await expect(page.getByTestId('stage-right-inspector').getByTestId('assembly-guide-web-preview')).toHaveCount(0);
  await page.getByRole('button', { name: /Generate package/i }).click();
  await expect(page.getByText(/Default ·/)).toBeVisible();
  await expect(page.getByTestId('custom-parts-export-lane')).toBeVisible();
  await expect(page.getByTestId('prefab-board-export-lane')).toBeVisible();
  await expect(page.getByTestId('download-custom-stl')).toBeEnabled();
  await expect(page.getByText(/Board (?!pending)/)).toHaveCount(1);
  await expect(page.getByTestId('blueprint-svg-preview')).toBeVisible();
  await expect(page.getByAltText('Cut sheet')).toBeVisible();
  await page.getByRole('button', { name: 'Assembly guide', exact: true }).click();
  await expect(page.locator('h2.current-stage-title', { hasText: 'Assembly' })).toBeVisible();
  await expect(page.getByTestId('workflow-status-strip')).toContainText('Assembly');
  await expect(page.getByTestId('assembly-canvas-preview')).toBeVisible();
  await expect(page.getByTestId('stage-canvas-pane').getByTestId('assembly-stepper-workbench')).toBeVisible();
  await expect(page.getByTestId('stage-canvas-pane').getByTestId('assembly-guide-web-preview')).toHaveCount(0);
  await expect(page.getByTestId('stage-right-inspector').getByTestId('assembly-guide-web-preview')).toHaveCount(0);
  await expect(page.getByTestId('assembly-stepper-workbench')).toContainText('Mechanism first');
  await expect(page.getByTestId('assembly-step-list')).toContainText('Mount module to board');
  const assemblyWorkbench = page.getByTestId('assembly-stepper-workbench');
  await page.getByTestId('assembly-step-list').getByRole('button', { name: /Add coupler/i }).click();
  await expect(assemblyWorkbench).toHaveAttribute('data-step-phase', 'assemble-module');
  await expect(assemblyWorkbench).toHaveAttribute('data-active-board-coords', '');
  await expect(assemblyWorkbench).toHaveAttribute('data-floating-reference-coords', /G6.*G10/);
  await expect(page.getByTestId('assembly-floating-references')).toContainText('G6');
  await expect(page.getByTestId('assembly-board').locator('.assembly-active-hole')).toHaveCount(0);
  await page.getByTestId('assembly-step-list').getByRole('button', { name: /Mount module to board/i }).click();
  await expect(page.getByTestId('assembly-guide-preview')).toContainText('Mount module to board');
  await expect(page.getByTestId('assembly-player-overlay')).toBeVisible();
  await expect(page.getByTestId('assembly-board')).toBeVisible();
  await expect(page.getByTestId('assembly-guide-preview')).toContainText(/Target Right lower arm · path path-right-arm · anchor right_(hand|elbow)/);
  await expect(page.getByTestId('assembly-guide-preview')).toContainText('OK');
  await expect(page.getByTestId('assembly-stack-summary')).toContainText(/^Back Clip.*Spacer 10mm OD \/ 4mm hole.*Front Clip/);
  await expect(page.getByTestId('stage-right-inspector')).toContainText(/row \d+, column \d+/);
  await expect(page.getByTestId('assembly-stack-summary')).not.toContainText(/Base board/);
  await expect(page.getByTestId('prefab-assembly-steps')).toContainText('mount-to-board');
  await expect(page.getByTestId('prefab-assembly-steps')).toContainText(/board/);
  await expect(page.getByTestId('prefab-assembly-steps')).toContainText(/Z \d+\.\dmm/);
  await expect(assemblyWorkbench).toHaveAttribute('data-step-phase', 'mount-to-board');
  await expect(assemblyWorkbench).toHaveAttribute('data-active-board-coords', /I5.*I9/);
  await expect(assemblyWorkbench).toHaveAttribute('data-floating-reference-coords', '');
  await expect(page.getByTestId('assembly-mount-motion')).toBeVisible();
  await page.getByTestId('assembly-player-overlay').getByRole('button', { name: 'Play assembly' }).click();
  await expect.poll(async () => Number(await assemblyWorkbench.getAttribute('data-step-progress')), { message: 'assembly player animates the active step' }).toBeGreaterThan(0);
  const pauseAssembly = page.getByTestId('assembly-player-overlay').getByRole('button', { name: 'Pause assembly' });
  if (await pauseAssembly.count()) await pauseAssembly.click();
  await page.getByTestId('assembly-step-list').getByRole('button', { name: /Connect character/i }).click();
  await expect(page.getByTestId('assembly-character-connect')).toBeVisible();
  await page.getByTestId('assembly-step-list').getByRole('button', { name: /Test motion/i }).click();
  await expect(page.getByTestId('assembly-motion-dot')).toBeVisible();
  await clickStage(page, 'Blueprint');
  await expect(page.getByRole('button', { name: 'JSON', exact: true })).toBeVisible();
  await expect(page.getByTestId('custom-parts-export-lane').getByRole('button', { name: 'SVG', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'HTML', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Metadata', exact: true })).toBeVisible();
  await expect(page.getByTestId('custom-parts-export-lane').getByRole('button', { name: 'PDF', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF cut sheet default' })).toBeVisible();
  await expect(page.getByAltText('Cut sheet')).toBeVisible();

  const [metadataDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Metadata', exact: true }).click()
  ]);
  expect(metadataDownload.suggestedFilename()).toMatch(/metadata\.json$/);
  const metadataPath = await metadataDownload.path();
  expect(metadataPath, 'metadata download path').toBeTruthy();
  const metadataText = await readFile(metadataPath!, 'utf8');
  expect(metadataText).toContain('validationIssues');
  expect(metadataText).toContain('requiredParts');
  expect(metadataText).toContain('assemblySteps');
  const metadata = JSON.parse(metadataText);
  expect(metadata.profile.gridPitchMm).toBe(20);
  expect(metadata.profile.profileKey).toBe('letter-15x15-2cm');
  expect(metadata.profile.exportMode).toBe('both');
  expect(metadata.recipes).toHaveLength(1);
  expect(new Set(metadata.recipes.map((recipe: { mechanismId: string }) => recipe.mechanismId)).size).toBe(1);
  expect(metadata.recipes.every((recipe: { board: unknown; sceneAnchor: unknown; boardCoordinate?: string; requiredParts?: unknown[] }) => recipe.board && recipe.sceneAnchor && recipe.boardCoordinate && recipe.requiredParts?.length)).toBe(true);
  expect(metadata.recipes.some((recipe: { targetPartId?: string; targetPathId?: string; targetAnchorJointId?: string; targetPartName?: string; steps?: string[]; assemblySteps?: Array<{ instruction?: string }>; warnings?: string[] }) =>
    recipe.targetPartId === 'right_arm_lower' &&
    recipe.targetPathId === 'path-right-arm' &&
    /^right_(hand|elbow)$/.test(recipe.targetAnchorJointId ?? '') &&
    recipe.targetPartName === 'Right lower arm' &&
    recipe.steps?.some(step => /Stack:|Connect output/.test(step)) &&
    recipe.assemblySteps?.some((step: { instruction?: string }) => /Set ground pivots|L2|L4/.test(step.instruction ?? '')) &&
    Array.isArray(recipe.warnings)
  )).toBe(true);

  const [guideDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'HTML', exact: true }).click()
  ]);
  expect(guideDownload.suggestedFilename()).toMatch(/assembly\.html$/);
  const guidePath = await guideDownload.path();
  expect(guidePath, 'guide download path').toBeTruthy();
  const guideText = await readFile(guidePath!, 'utf8');
  expect(guideText).toContain('assembly guide');
  expect(guideText).toContain('<strong>Board:</strong>');
  expect(guideText).toContain('Target:');
  expect(guideText).toContain('Right lower arm');
  expect(guideText).toContain('path-right-arm');
  expect(guideText).toContain('right_');
  expect(guideText).toContain('Required parts');
  expect(guideText).toContain('15×15 board kit assembly');
  expect(guideText).toContain('Printable assembly guide');
  expect(guideText).toContain('Exploded view');
  expect(guideText).toContain('Path projection');
  expect(guideText).toContain('Z=0 Base');
  expect(guideText).toContain('window.print');
  expect(metadata.recipes[0].steps.every((step: string) => guideText.includes(step)), 'downloaded guide includes every recipe step').toBe(true);

  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('prefab-board-export-lane').getByRole('button', { name: 'PDF', exact: true }).click()
  ]);
  expect(pdfDownload.suggestedFilename()).toMatch(/assembly\.pdf$/);
  const pdfPath = await pdfDownload.path();
  expect(pdfPath, 'pdf download path').toBeTruthy();
  const pdfBuffer = await readFile(pdfPath!);
  const pdfHeader = pdfBuffer.subarray(0, 5).toString('utf8');
  expect(pdfHeader).toBe('%PDF-');
  const pdfText = pdfBuffer.toString('utf8');
  expect(pdfText).toContain('Printable assembly guide');
  expect(pdfText).toContain('Exploded view');
  expect(pdfText).toContain('Path projection');
  expect(pdfText).toContain('Z=0 Base');

  const [cutSheetPdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF cut sheet default' }).click()
  ]);
  expect(cutSheetPdfDownload.suggestedFilename()).toMatch(/cut-sheet\.pdf$/);
  const cutSheetPdfPath = await cutSheetPdfDownload.path();
  expect(cutSheetPdfPath, 'cut sheet pdf download path').toBeTruthy();
  const cutSheetPdfText = await readFile(cutSheetPdfPath!, 'utf8');
  expect(cutSheetPdfText.slice(0, 5)).toBe('%PDF-');
  expect(cutSheetPdfText).toContain('Cut sheet');

  const [stlDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-custom-stl').click()
  ]);
  expect(stlDownload.suggestedFilename()).toMatch(/custom-parts\.stl$/);
  const stlPath = await stlDownload.path();
  expect(stlPath, 'custom STL download path').toBeTruthy();
  const stlText = await readFile(stlPath!, 'utf8');
  expect(stlText).toContain('solid motionsmith_custom_parts');
  expect(stlText).toContain('facet normal');

  const [svgDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('custom-parts-export-lane').getByRole('button', { name: 'SVG', exact: true }).click()
  ]);
  const svgPath = await svgDownload.path();
  expect(svgPath, 'svg download path').toBeTruthy();
  const svgText = await readFile(svgPath!, 'utf8');
  expect(svgText).toContain('<metadata>');
  expect(svgText).toContain('custom-parts');
  expect(svgText).toContain('fabricablePartOutlinePoints');
  expect(svgText).toContain('Waving arm');
  expect(svgText).toContain('data-part-id="right_arm_lower"');

  await page.getByTestId('workspace-steps').getByRole('button', { name: 'Options' }).click();
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
  await expect(page.getByTestId('options-fabrication')).toBeVisible();
  await expect(page.getByLabel('Export')).toHaveValue('both');
  await expect(page.getByLabel('Format')).toHaveValue('both');

  expectCleanPage(pageErrors, consoleErrors);
});

test('Character tab processing controls route to real browser workflows', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openCharacterScreen(page);
  await expect(page.getByTestId('character-processing-panel')).toContainText('Tools');
  await expect(page.getByTestId('character-preview-pane')).toBeVisible();

  const packageChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Load character file', exact: true }).click();
  const packageChooser = await packageChooserPromise;
  expect(packageChooser.isMultiple()).toBe(true);
  await packageChooser.setFiles([]);

  const imageChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Create from image', exact: true }).click();
  const imageChooser = await imageChooserPromise;
  expect(imageChooser.isMultiple()).toBe(false);
  await imageChooser.setFiles([]);

  await page.getByRole('button', { name: /Open Getting Started/i }).click();
  await expect(page.getByTestId('getting-started-dialog')).toBeVisible();
  const starterPackageChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Load character file/i }).click();
  const starterPackageChooser = await starterPackageChooserPromise;
  expect(starterPackageChooser.isMultiple()).toBe(true);
  await starterPackageChooser.setFiles([]);
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByText('Tools').click();

  const [skeletonDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save Skeleton', exact: true }).click()
  ]);
  expect(skeletonDownload.suggestedFilename()).toBe('char_cfg.json');
  const skeletonPath = await skeletonDownload.path();
  expect(skeletonPath, 'skeleton download path').toBeTruthy();
  const skeletonConfig = JSON.parse(await readFile(skeletonPath!, 'utf8'));
  expect(skeletonConfig.joints).toBeTruthy();
  expect(skeletonConfig.bones).toBeTruthy();

  await page.getByRole('button', { name: 'Edit rig', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await expect(page.getByTestId('stage-left-pane').getByTestId('character-part-list')).toContainText('Right lower arm');
  await expect(page.getByTestId('stage-right-inspector').getByTestId('character-setup-panel')).toContainText('Part');
  await expect(page.getByTestId('stage-right-inspector').getByTestId('part-art-controls')).toBeVisible();
  await expect(page.getByLabel('Edit joint')).toBeVisible();

  expectCleanPage(pageErrors, consoleErrors);
});

test('animation performance: Foundry playback stays responsive without runaway Three rebuilds', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();

  const foundryRig = page.getByTestId('foundry-camera-rig');
  await expect(foundryRig).toHaveAttribute('data-three-renderer', 'webgl');
  await expect(foundryRig).toHaveAttribute('data-three-engine-stack', 'three-webgl2-imperative');
  await expect(foundryRig).toHaveAttribute('data-physics-kernel', 'rapier3d-compat');
  await expect(foundryRig).toHaveAttribute('data-physics-kernel-runtime', 'ready', { timeout: 60_000 });
  await expect(foundryRig).toHaveAttribute('data-physics-kernel-version', /\d+\.\d+\.\d+/);
  await expect(foundryRig).toHaveAttribute('data-physics-kernel-error', 'none');
  await expect(foundryRig).toHaveAttribute('data-physics-update-policy', 'kinematic-authority-rapier-contact-validation');
  await expect(foundryRig).toHaveAttribute('data-high-throughput-scene-policy', 'viser-style-transform-tree-batched-updates-instancing');
  await expect(foundryRig).toHaveAttribute('data-physics-authority', 'motionsmith-kinematics');
  await expect(foundryRig).toHaveAttribute('data-three-static-grid-mode', 'persistent-scene-layer');
  await expect(foundryRig).toHaveAttribute('data-three-fit-bounds', 'phase-invariant-sweep');
  await expect(foundryRig).toHaveAttribute('data-three-animation-commit-ms', '33.3');
  await expect(foundryRig).toHaveAttribute('data-three-pixel-ratio-cap', '1.5');

  const dynamicBuildsBefore = Number(await foundryRig.getAttribute('data-three-dynamic-build-count') ?? '0');
  const geometryCacheBefore = Number(await foundryRig.getAttribute('data-three-geometry-cache-size') ?? '0');
  const phaseControl = page.getByLabel('Foundry phase');
  const phaseBefore = Number(await phaseControl.inputValue());
  await page.getByTestId('foundry-toolbar').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('foundry-toolbar-state')).toContainText('playing');
  await expect(page.getByTestId('foundry-toolbar-state')).not.toBeVisible();
  const playbackStartedAt = Date.now();

  await expect.poll(async () => {
    return Number(await foundryRig.getAttribute('data-three-dynamic-build-count') ?? '0') - dynamicBuildsBefore;
  }, { message: 'Foundry still animates enough frames to feel alive under parallel browser load' }).toBeGreaterThan(12);

  const phaseAfter = Number(await phaseControl.inputValue());
  const dynamicBuildsAfter = Number(await foundryRig.getAttribute('data-three-dynamic-build-count') ?? '0');
  const geometryCacheAfter = Number(await foundryRig.getAttribute('data-three-geometry-cache-size') ?? '0');
  const dynamicBuildsDuringPlayback = dynamicBuildsAfter - dynamicBuildsBefore;
  const playbackSeconds = Math.max(0.1, (Date.now() - playbackStartedAt) / 1000);
  const dynamicBuildsPerSecond = dynamicBuildsDuringPlayback / playbackSeconds;
  expect(dynamicBuildsDuringPlayback, 'Foundry still animates enough committed frames to feel alive').toBeGreaterThan(12);
  expect(dynamicBuildsPerSecond, 'Foundry does not rebuild expensive Three geometry at unbounded 60fps').toBeLessThanOrEqual(35);
  expect(geometryCacheAfter - geometryCacheBefore, 'Foundry path/trail geometry is disposed instead of leaking into the persistent cache').toBeLessThanOrEqual(12);
  expect(Math.abs(phaseAfter - phaseBefore), 'Foundry phase advances during optimized playback').toBeGreaterThan(40);

  await page.getByTestId('foundry-toolbar').getByRole('button', { name: 'Pause', exact: true }).click();
  expectCleanPage(pageErrors, consoleErrors);
});

test('Create from image upload creates a reviewed character package in browser', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openCharacterScreen(page);
  const runOnnxButton = page.getByRole('button', { name: /Create from image/i });
  await runOnnxButton.focus();
  await expect(runOnnxButton).toBeFocused();
  const [onnxChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.keyboard.press('Enter')
  ]);
  await onnxChooser.setFiles('tests/fixtures/stick-character.png');

  const review = page.getByTestId('character-import-review');
  await expect(review).toBeVisible({ timeout: 180_000 });
  await expect(review.getByText('Ready', { exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(review.getByText(/parts · .*joints/i)).toBeVisible();
  const reviewBox = await review.boundingBox();
  const viewport = page.viewportSize();
  const reviewCenterX = (reviewBox?.x ?? 0) + (reviewBox?.width ?? 0) / 2;
  expect(Math.abs(reviewCenterX - (viewport?.width ?? 0) / 2), 'character import approval is centered on screen').toBeLessThan(8);
  await expect(page.getByTestId('character-three-puppet-state')).toHaveAttribute('data-part-count', /[1-9]\d*/);
  await expect(page.getByRole('button', { name: 'Use it' })).toBeVisible();

  await page.getByRole('button', { name: 'Use it' }).click();
  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toHaveCount(0);
  await expectProjectCounts(page, 10, 0, 0);
  await expect(page.getByTestId('character-three-puppet-canvas')).toBeVisible();
  const generatedPuppet = page.getByTestId('character-three-puppet-state');
  await expect(generatedPuppet).toHaveAttribute('data-part-outline-mode', 'model-or-user-contour-with-fabrication-fallback');
  await expect(generatedPuppet).toHaveAttribute('data-puppet-mode', 'thick-flat-assembly');
  await expect(generatedPuppet).toHaveAttribute('data-three-part-surface', 'solid-cut-plates');
  await expect(generatedPuppet).toHaveAttribute('data-three-part-art', 'top-texture-decal');
  await expect(generatedPuppet).toHaveAttribute('data-three-part-opacity', '1');
  expect(Number(await generatedPuppet.getAttribute('data-three-part-hole-count')), 'generated character 3D puppet keeps cut-through joint holes').toBeGreaterThan(0);
  await expect.poll(async () => Number(await generatedPuppet.getAttribute('data-three-render-triangles')), { message: 'accepted ONNX character renders as real 3D fabrication geometry' }).toBeGreaterThan(0);

  expectCleanPage(pageErrors, consoleErrors);
});

test('Load package review, accept, discard, and missing-file recovery stay in browser', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openCharacterScreen(page);

  const packageFiles = [
    'tests/fixtures/package/parts_info.json',
    'tests/fixtures/package/char_cfg.yaml',
    'tests/fixtures/package/body.png'
  ];
  const loadPackageButton = page.getByRole('button', { name: 'Load character file', exact: true });
  await loadPackageButton.focus();
  await expect(loadPackageButton).toBeFocused();
  const [packageChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.keyboard.press('Enter')
  ]);
  await packageChooser.setFiles(packageFiles);
  const review = page.getByTestId('character-import-review');
  await expect(review).toBeVisible();
  await expect(review.getByText('Ready', { exact: true })).toBeVisible();
  await expect(review).toContainText('1 parts · 2 joints');
  await expect(page.getByTestId('character-three-puppet-state')).toHaveAttribute('data-part-count', '1');
  await expect(page.getByText('outlines')).toBeHidden();
  await expect(page.getByText('Checks')).toHaveCount(0);
  await expect(page.getByTestId('character-setup-panel').getByText('Choose new character.')).toBeVisible();
  await page.getByTestId('character-processing-panel').locator('summary').click();
  await expect(page.getByTestId('character-processing-panel').getByText('Choose new character.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit rig' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Edit rig' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save Skeleton' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('character-import-review')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit rig', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await expect(page.getByTestId('stage-right-inspector').getByText('Anchors')).toBeVisible();
  await expectProjectCounts(page, 14, 1, 0);
  await page.getByRole('button', { name: /^Character$/i }).click();

  await page.getByTestId('blank-package-input').setInputFiles(packageFiles);
  await expect(page.getByTestId('character-import-review').getByText('Ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use it' }).click();
  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toHaveCount(0);
  await expectProjectCounts(page, 1, 0, 0);
  await expect(page.getByTestId('character-part-list')).toContainText('Fixture body');

  await page.getByRole('button', { name: /^Character$/i }).click();
  await page.getByTestId('blank-package-input').setInputFiles('tests/fixtures/package/char_cfg.yaml');
  await expect(page.getByTestId('character-screen')).toBeVisible();
  await expect(page.getByText('Couldn’t load character')).toBeVisible();
  await expect(page.getByText('Missing parts_info.json in selected package files')).toBeVisible();

  expectCleanPage(pageErrors, consoleErrors);
});

test('Replacement package preserves compatible mechanisms and rebound paths', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await applyFourBarFromFoundry(page);
  await expectProjectCounts(page, 14, 1, 1);
  await page.getByRole('button', { name: /^Character$/i }).click();
  await page.getByLabel('Keep compatible mechanisms').check();
  await page.getByTestId('blank-package-input').setInputFiles([
    'tests/fixtures/package-compatible/parts_info.json',
    'tests/fixtures/package-compatible/char_cfg.yaml',
    'tests/fixtures/package-compatible/body.png'
  ]);
  await expect(page.getByTestId('character-import-review').getByText('Ready', { exact: true })).toBeVisible();
  await expect(page.getByTestId('character-import-review')).toContainText(/parts · .*joints/i);
  await expect(page.getByText('kept mechanisms')).toHaveCount(0);
  await page.getByRole('button', { name: 'Use it' }).click();

  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toHaveCount(0);
  await clickStage(page, 'Mechanism Design');
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expectProjectCounts(page, 1, 1, 1);
  await expect(page.getByRole('heading', { name: 'Mechanisms' })).toBeVisible();
  await expect(page.locator('select.field').filter({ hasText: 'Right arm replacement' })).toHaveValue('right_arm');
  await expect(page.locator('select.field').filter({ hasText: 'path-right-arm' })).toHaveValue('path-right-arm');

  expectCleanPage(pageErrors, consoleErrors);
});

test('Options and validation gates update browser blueprint output', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
  await applyFourBarFromFoundry(page);
  await page.getByRole('button', { name: /Options/i }).click();
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
  await page.getByLabel('Grid pitch mm number').fill('25');
  await page.getByLabel('Grid pitch mm number').press('Enter');
  await page.getByLabel('Format').selectOption('json');
  await expect(page.getByLabel('Format')).toHaveValue('json');

  await page.getByRole('button', { name: /Path Editor/i }).click();
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByTestId('path-canvas').getByText('Letter sheet · 2.5cm grid')).toBeVisible();
  await page.getByRole('button', { name: 'Drawing free path', exact: true }).click();
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByTestId('design-canvas').getByText('Letter sheet · 2.5cm grid')).toBeVisible();
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').fill('0');
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').press('Enter');
  await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').fill('100');
  await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').press('Enter');
  await clickStage(page, 'Blueprint');
  await expect(page.getByText('Ready.')).toBeVisible();
  await page.getByRole('button', { name: /Generate package/i }).click();
  await expect(page.getByRole('button', { name: 'Download JSON default' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download SVG default' })).toHaveCount(0);
  await expect(page.getByTestId('custom-parts-export-lane').getByRole('button', { name: 'SVG', exact: true })).toBeVisible();

  const [metadataDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Metadata', exact: true }).click()
  ]);
  const metadataPath = await metadataDownload.path();
  expect(metadataPath, 'metadata download path').toBeTruthy();
  const metadata = JSON.parse(await readFile(metadataPath!, 'utf8'));
  expect(metadata.profile.gridPitchMm).toBe(25);

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').fill('255');
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').press('Enter');
  await clickStage(page, 'Blueprint');
  await expect(page.getByTestId('blueprint-control-panel').getByText(/anchor off grid/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Snap to hole/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeDisabled();

  expectCleanPage(pageErrors, consoleErrors);
});

test('Options parity updates workspace UI, canvas context, and blueprint defaults', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await applyFourBarFromFoundry(page);
  await page.getByRole('button', { name: /Options/i }).click();
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
  for (const section of ['appearance', 'simulation', 'performance', 'debugging', 'workflow', 'fabrication', 'units']) {
    await expect(page.getByTestId(`options-${section}`)).toBeVisible();
  }

  await page.getByLabel('Theme').selectOption('dark');
  await expect(page.locator('main[data-theme="dark"]')).toBeVisible();
  await expect(page.getByTestId('quick-toolbar')).toHaveCount(0);
  await page.getByLabel('Show toolbar').check();
  await expect(page.getByTestId('quick-toolbar')).toBeVisible();
  await page.getByLabel('Show toolbar').uncheck();
  await expect(page.getByTestId('quick-toolbar')).toHaveCount(0);

  await page.getByLabel('Part panel').uncheck();
  await page.getByRole('button', { name: /Path Editor/i }).click();
  await expect(page.getByTestId('novice-path-panel')).toBeVisible();
  await expect(page.getByTestId('rig-structure-drawer')).toHaveCount(0);
  await expect(page.getByTestId('rig-structure-hidden')).toBeVisible();
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await page.getByRole('button', { name: /Options/i }).click();
  await page.getByLabel('Part panel').check();
  await page.getByRole('button', { name: /Path Editor/i }).click();
  await expect(page.getByTestId('rig-structure-drawer')).toBeVisible();
  await page.getByRole('button', { name: /Options/i }).click();

  await page.getByLabel('Dev mode').check();
  await page.getByRole('button', { name: /Path Editor/i }).click();
  await expect(page.getByTestId('canvas-debug-visuals')).toBeVisible();
  await page.getByRole('button', { name: /Options/i }).click();

  await page.getByLabel('Enable autosave').check();
  await page.getByLabel('Autosave seconds number').fill('1');
  await page.getByLabel('Autosave seconds number').press('Enter');
  await page.getByLabel('Duration number').fill('6');
  await page.getByLabel('Duration number').press('Enter');
  await page.getByLabel('Timing profile').selectOption('ease-in-out');
  await page.getByLabel('Friction μ number').fill('0.42');
  await page.getByLabel('Friction μ number').press('Enter');
  await page.getByLabel('Mass kg number').fill('1.75');
  await page.getByLabel('Mass kg number').press('Enter');
  await page.getByLabel('Performance preset').selectOption('high');
  await page.getByLabel('Physics snap mode').selectOption('high');
  await page.getByLabel('Import details').check();
  await page.getByLabel('Cut sheet').selectOption('svg');
  await page.getByLabel('Grid units').selectOption('inch');
  await page.getByLabel('Board').selectOption('letter-12x12-2cm');
  await page.getByLabel('Grid pitch mm number').fill('25');
  await page.getByLabel('Grid pitch mm number').press('Enter');
  await page.getByLabel('Format').selectOption('json');
  await expect(page.getByTestId('grid-cell-readout')).toContainText('0.98 in');

  await expect.poll(async () => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('motionsmith.autosave') ?? '{}');
    return {
      autosave: saved.settings?.autosave,
      interval: saved.settings?.autosaveIntervalSeconds,
      duration: saved.settings?.animationDurationMs,
      timing: saved.settings?.timingProfile,
      friction: saved.settings?.simulationFriction,
      mass: saved.settings?.simulationMassKg,
      performance: saved.settings?.performancePreset,
      snap: saved.settings?.physicsSnapMode,
      detailed: saved.settings?.detailedProcessingSteps,
      unit: saved.settings?.gridUnit,
      profile: saved.settings?.physicalKit?.profileKey,
      pitch: saved.settings?.physicalKit?.gridPitchMm,
      cutSheet: saved.settings?.physicalKit?.cutSheetFileType
    };
  }), { timeout: 15000 }).toEqual({
    autosave: true,
    interval: 1,
    duration: 6000,
    timing: 'ease-in-out',
    friction: 0.42,
    mass: 1.75,
    performance: 'high',
    snap: 'high',
    detailed: true,
    unit: 'inch',
    profile: 'letter-12x12-2cm',
    pitch: 25,
    cutSheet: 'svg'
  });

  await page.getByRole('button', { name: /Path Editor/i }).click();
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByTestId('scene-grid-label')).toContainText('Letter sheet · 0.98 in grid');
  await page.getByRole('button', { name: 'Drawing free path', exact: true }).click();
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByTestId('design-canvas').getByTestId('scene-grid-label')).toContainText('Letter sheet · 0.98 in grid');
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').fill('0');
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').press('Enter');
  await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').fill('100');
  await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').press('Enter');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('motionsmith.autosave') ?? '{}')?.mechanisms?.[0]?.anchorX), { timeout: 15000 }).toBe(0);
  await clickStage(page, 'Blueprint');
  await page.getByRole('button', { name: /Generate package/i }).click();
  await expect(page.getByRole('button', { name: 'Download JSON default' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download SVG default' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download SVG cut sheet default' })).toBeVisible();
  const metadata = await downloadMetadataJson(page);
  expect(metadata.profile.profileKey).toBe('letter-12x12-2cm');
  expect(metadata.profile.boardCells).toBe(12);
  expect(metadata.profile.gridPitchMm).toBe(25);
  expect(metadata.profile.cutSheetFileType).toBe('svg');
  await page.getByRole('button', { name: /^Character$/i }).click();
  await expect(page.getByTestId('processing-step-details')).toContainText('Fit sheet');

  expectCleanPage(pageErrors, consoleErrors);
});

test('Legacy storage namespace migrates to MotionSmith keys without losing autosave or workspace layout', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openCharacterScreen(page);
  await page.getByRole('button', { name: /Options/i }).click();
  const autosaveToggle = page.getByLabel('Enable autosave');
  if (!(await autosaveToggle.isChecked())) await autosaveToggle.check();
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('motionsmith.autosave') ?? ''), { timeout: 5000 }).not.toBe('');
  await page.evaluate(() => {
    const current = localStorage.getItem('motionsmith.autosave') ?? '';
    const legacyPrefix = ['mech', 'anim'].join('');
    localStorage.removeItem('motionsmith.autosave');
    localStorage.removeItem('motionsmith.workspace');
    localStorage.setItem(`${legacyPrefix}.autosave`, current);
    localStorage.setItem(`${legacyPrefix}.workspace`, JSON.stringify({
      stage: 'character',
      viewport: { offset: { x: 24, y: -12 }, zoom: 1.25 },
      toolbarVisible: false,
      partPanelVisible: false
    }));
  });

  await page.getByTestId('top-command-bar').getByText('File', { exact: true }).click();
  await page.getByRole('button', { name: 'Recover Autosave…' }).click();
  await expect(page.getByTestId('status-bar')).toContainText('Recovered browser autosave snapshot');
  await expect.poll(async () => page.evaluate(() => Boolean(localStorage.getItem('motionsmith.autosave'))), { timeout: 5000 }).toBe(true);

  await page.getByTestId('top-command-bar').getByText('View', { exact: true }).click();
  await page.getByRole('button', { name: 'Restore Layout' }).click();
  await expect(page.getByTestId('status-bar')).toContainText('Workspace layout restored');
  await expect.poll(async () => page.evaluate(() => Boolean(localStorage.getItem('motionsmith.workspace'))), { timeout: 5000 }).toBe(true);
  await expect(page.getByTestId('quick-toolbar')).toHaveCount(0);

  expectCleanPage(pageErrors, consoleErrors);
});

test('Path Editor sensemaking follows selected part, lock state, and anchor handoff', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
  await expect(page.getByTestId('free-draw-status')).toContainText(/5 points .*path-right-arm/);

  await page.getByLabel('Selected body part').selectOption('head');
  await expect(page.getByLabel('Selected body part')).toHaveValue('head');
  await expect(page.getByTestId('free-draw-status')).toContainText('0 points · none');
  await expect(page.getByText('No path.')).toBeVisible();

  await page.getByTestId('path-view-3d').click();
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByTestId('path-view-2d')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('path-three-puppet-state')).toHaveCount(0);
  await expect(page.locator('[data-testid="path-canvas"], [data-testid="path-three-puppet-canvas"]')).toHaveCount(1);
  const pathCanvas = page.getByTestId('path-canvas');
  const canvasBox = await pathCanvas.boundingBox();
  expect(canvasBox, 'path canvas box for free-draw gesture').toBeTruthy();
  await page.mouse.move(canvasBox!.x + 260, canvasBox!.y + 220);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 290, canvasBox!.y + 235);
  await page.mouse.move(canvasBox!.x + 330, canvasBox!.y + 250);
  await page.mouse.move(canvasBox!.x + 365, canvasBox!.y + 230);
  await page.mouse.up();
  await expect(page.getByTestId('free-draw-status')).toContainText(/[3-9]\d* points · path-head/);
  await expect(page.getByTestId('novice-path-panel').getByRole('button', { name: 'Choose mechanism' })).toBeEnabled();

  await page.getByLabel('Selected body part').selectOption('right_arm_lower');
  await expect(page.getByTestId('free-draw-status')).toContainText(/5 points .*path-right-arm/);
  await expect(page.getByText('No path.')).toHaveCount(0);
  await expect(page.getByTestId('quick-rig-helper')).toContainText('IK');
  await expect(page.getByLabel('IK chain root')).toHaveValue('right_shoulder');
  await expect(page.getByLabel('IK handle')).toHaveValue('right_hand');
  await expect(page.getByTestId('ik-chain-summary')).toContainText('3 joints');
  await page.getByRole('button', { name: 'Fold left', exact: true }).click();
  await expect(page.getByTestId('fold-direction-control')).toContainText('left');
  await page.getByTestId('ik-chain-root-options').getByRole('button', { name: 'right elbow' }).click();
  await expect(page.getByLabel('IK chain root')).toHaveValue('right_elbow');
  await page.getByLabel('IK handle').selectOption('right_elbow');
  await expect(page.getByLabel('IK handle')).toHaveValue('right_elbow');
  await expect(page.getByLabel('IK chain root')).toHaveValue('right_elbow');
  await expect(page.getByTestId('ik-chain-summary')).toContainText('Whole part');
  await expect(page.getByTestId('fold-direction-control')).toContainText('Pick elbow/knee');
  await expect(page.getByTestId('path-shape-controls')).toBeVisible();
  const selectedMotionPath = pathCanvas.locator('path[stroke="#5a6cff"][stroke-width="4"]').first();
  await page.getByRole('button', { name: 'Closed', exact: true }).click();
  await expect(selectedMotionPath).toHaveAttribute('d', /Z$/);
  await page.getByLabel('Smoothness number').fill('70');
  await page.getByLabel('Smoothness number').press('Enter');
  await expect(selectedMotionPath).toHaveAttribute('d', /Q/);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(selectedMotionPath).not.toHaveAttribute('d', /Z$/);

  const firstArmPoint = pathCanvas.locator('circle[stroke="#5a6cff"]').first();
  const firstArmPointBox = await firstArmPoint.boundingBox();
  expect(firstArmPointBox, 'first arm point can be edited directly in 2D view').toBeTruthy();
  const firstArmPointCx = await firstArmPoint.getAttribute('cx');
  await page.mouse.move(firstArmPointBox!.x + firstArmPointBox!.width / 2, firstArmPointBox!.y + firstArmPointBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstArmPointBox!.x + firstArmPointBox!.width / 2 + 34, firstArmPointBox!.y + firstArmPointBox!.height / 2 + 18);
  await page.mouse.up();
  await expect(firstArmPoint).not.toHaveAttribute('cx', firstArmPointCx ?? '');
  await expect(page.getByTestId('free-draw-status')).toContainText(/5 points .*path-right-arm/);

  await page.getByTestId('novice-path-panel').getByText('More', { exact: true }).click();
  const stopButtonBeforePreview = page.getByTestId('novice-path-panel').getByRole('button', { name: /Stop/i });
  if (await stopButtonBeforePreview.count()) await stopButtonBeforePreview.click();
  await page.getByLabel('IK handle').selectOption('right_hand');
  await page.getByTestId('ik-chain-root-options').getByRole('button', { name: 'right shoulder' }).click();
  await expect(page.getByLabel('IK chain root')).toHaveValue('right_shoulder');
  await expect(page.getByLabel('IK handle')).toHaveValue('right_hand');
  await expect(page.getByTestId('ik-chain-summary')).toContainText('3 joints');
  const upperArmTransformBeforePlay = await page.getByTestId('path-part-right_arm_upper').getAttribute('transform');
  const armTransformBeforePlay = await page.getByTestId('path-part-right_arm_lower').getAttribute('transform');
  await page.getByTestId('novice-path-panel').getByRole('button', { name: /Play/i }).click();
  await expect(page.getByText('IK target')).toBeVisible();
  await expect(page.getByTestId('path-part-right_arm_upper')).not.toHaveAttribute('transform', upperArmTransformBeforePlay ?? '');
  await expect(page.getByTestId('path-part-right_arm_lower')).not.toHaveAttribute('transform', armTransformBeforePlay ?? '');
  await page.getByTestId('novice-path-panel').getByRole('button', { name: /Stop/i }).click();
  await page.getByTestId('ik-chain-root-options').getByRole('button', { name: 'right elbow' }).click();
  await page.getByLabel('IK handle').selectOption('right_elbow');
  await page.getByText('Rig setup').click();
  const artXBefore = await page.getByTestId('path-part-art-right_arm_lower').getAttribute('x');
  await page.getByLabel('Art offset X number').fill('-12');
  await page.getByLabel('Art offset X number').press('Enter');
  await expect(page.getByTestId('path-part-art-right_arm_lower')).toHaveAttribute('x', '-12');
  await expect(page.getByTestId('path-part-plate-right_arm_lower')).toHaveAttribute('data-art-offset-x', '-12');
  expect(await page.getByTestId('path-part-art-right_arm_lower').getAttribute('x'), 'art offset control moves the visible path-editor artwork').not.toBe(artXBefore);
  const partLocked = page.locator('label').filter({ hasText: 'Locked' }).first().locator('input[type="checkbox"]');
  await partLocked.check();
  await expect(page.getByRole('button', { name: 'Drawing free path', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Trace', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Clear path', exact: true })).toBeDisabled();
  await expect(page.getByLabel('X number').first()).toBeDisabled();
  await page.getByTestId('path-canvas').click({ position: { x: 260, y: 220 } });
  await expect(page.getByTestId('free-draw-status')).toContainText(/5 points .*path-right-arm.*locked part/);

  await partLocked.uncheck();
  await page.locator('label').filter({ hasText: 'Selected part anchor' }).locator('select').selectOption('right_elbow');
  await expect(page.locator('label').filter({ hasText: 'Selected part anchor' }).locator('select')).toHaveValue('right_elbow');
  await page.getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByTestId('foundry-target-summary')).toContainText('chain right_elbow → right_elbow');

  expectCleanPage(pageErrors, consoleErrors);
});

test('Foundry sensemaking shows library, partial range, and exported metadata', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  await expect(page.locator('[data-testid^="foundry-mini-simulation-"]')).toHaveCount(5);
  await expect(page.getByTestId('foundry-three-canvas')).toBeVisible();
  const threeScene = page.getByTestId('foundry-camera-rig');
  await expect(threeScene).toHaveAttribute('data-three-renderer', 'webgl');
  await expect(threeScene).toHaveAttribute('data-mechanism-type', '4bar');
  await expect(threeScene).toHaveAttribute('data-three-path-source', 'moving-joints');
  await expect(threeScene).toHaveAttribute('data-three-path-trace-ids', 'B,C');
  await expect(threeScene).toHaveAttribute('data-three-primary-path-id', 'C');
  await expect(threeScene).toHaveAttribute('data-three-hole-mode', 'extruded-cut-through');
  await expect(threeScene).toHaveAttribute('data-three-render-loop', 'camera-only-orbit');
  await expect(threeScene).toHaveAttribute('data-three-inventory-source', 'rendered-template');
  await expect(threeScene).toHaveAttribute('data-three-stack-source', 'fabricationStackForMechanism');
  await expect(threeScene).toHaveAttribute('data-three-stack-mode', 'assembled-spacer-separated');
  await expect(threeScene).toHaveAttribute('data-three-exploded', 'false');
  await expect(threeScene).toHaveAttribute('data-three-base-layer', 'Base board');
  await expect(threeScene).toHaveAttribute('data-three-stack-order', /^Back Clip → .*S10 spacer.*Front Clip$/);
  await expect(threeScene).toHaveAttribute('data-three-spacer-key', 's10');
  await expect(threeScene).toHaveAttribute('data-three-spacer-mm', '10x4');
  expect(Number(await threeScene.getAttribute('data-three-spacer-z-gap')), 'Foundry spaces stacked plates along z by the shared S10 spacer layer').toBeGreaterThanOrEqual(FABRICATION_RENDER_LAYER_Z_STEP - 0.01);
  await expect(threeScene).toHaveAttribute('data-three-spacer-render-contract', 'recipe-pin-spacer-sites');
  await expect(threeScene).toHaveAttribute('data-three-pin-stack-policy', 'per-pin-adjacent-stack');
  await expect(threeScene).toHaveAttribute('data-three-spacer-render-count', '4');
  await expect(threeScene).toHaveAttribute('data-three-spacer-pin-ids', /A.*B.*C.*D/);
  await expect(threeScene).toHaveAttribute('data-three-board-pivot-spacer-mode', 'single-board-side-spacer');
  await expect(threeScene).toHaveAttribute('data-three-board-pivot-spacer-ids', 'A,D');
  await expect(threeScene).toHaveAttribute('data-three-board-pivot-fastener-contract', 'fastener-end>S10-board-side>linkage>fastener-head');
  await expect(threeScene).toHaveAttribute('data-three-z-collision-count', '0');
  const spanSummary = await threeScene.getAttribute('data-three-pin-stack-spans') ?? '';
  const pinSpans = Object.fromEntries(spanSummary.split(',').map(item => {
    const [id, value] = item.split(':');
    return [id, Number(value)];
  }));
  expect(pinSpans.A, 'Ground pivot A only carries the input link, so its pin is shorter than the B shared-link stack').toBeLessThan(pinSpans.B);
  expect(pinSpans.D, 'Ground pivot D only carries the output link, so its pin is shorter than the C shared-link stack').toBeLessThan(pinSpans.C);
  await expect(threeScene).toHaveAttribute('data-three-stack-roles', /^clip>.*spacer.*>clip$/);
  await expect(threeScene).toHaveAttribute('data-three-stack-colors', /#334155.*#f59e0b/);
  await expect(threeScene).toHaveAttribute('data-three-stack-validation-errors', '0');
  expect(await threeScene.getAttribute('data-three-rendered-layer-labels')).toBe(await threeScene.getAttribute('data-three-stack-order'));
  expect(await threeScene.getAttribute('data-three-rendered-layer-roles')).toBe(await threeScene.getAttribute('data-three-stack-roles'));
  expect(await threeScene.getAttribute('data-three-rendered-layer-colors')).toBe(await threeScene.getAttribute('data-three-stack-colors'));
  expect(await threeScene.getAttribute('data-three-rendered-layer-z'), '4bar renders A/D ground links coplanar instead of blindly using the printable linear stack z').not.toBe(await threeScene.getAttribute('data-three-stack-z'));
  await expect(threeScene).toHaveAttribute('data-three-fourbar-ground-link-plane', 'A-D-ground-links-coplanar');
  await expect(threeScene).toHaveAttribute('data-anchor-pick-mode', 'three-raycaster-plane');
  const hasWebgl = await page.getByTestId('foundry-three-canvas').evaluate((canvas: HTMLCanvasElement) => Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')));
  expect(hasWebgl, 'Foundry uses an actual WebGL canvas, not a flat SVG-only preview').toBe(true);
  await expect(page.getByTestId('workspace-player-dock')).toHaveCount(0);
  expect(Number(await threeScene.getAttribute('data-three-part-count')), 'Sandbox uses 3D fabrication-style holed bars').toBeGreaterThanOrEqual(4);
  expect(Number(await threeScene.getAttribute('data-three-hole-count')), 'Sandbox models drilled holes in the 3D scene').toBeGreaterThanOrEqual(10);
  await expect(page.getByTestId('foundry-depth-overlay'), 'Foundry hides the confusing floating board plane').toHaveCount(0);
  await expect(page.getByTestId('foundry-cad-plane')).toHaveCount(0);
  await expect(page.getByTestId('foundry-angle-strip'), 'Foundry no longer adds extra multi-view mini canvases over the work area').toHaveCount(0);
  await expect(page.getByTestId('foundry-z-spacer')).toHaveCount(0);
  await expect(page.getByTestId('foundry-velocity-overlay'), 'Velocity vectors are on by default in the physics sandbox').toBeVisible();
  await expect(page.getByTestId('foundry-forces-overlay'), 'Force vectors are on by default in the physics sandbox').toBeVisible();
  await expect(page.getByTestId('foundry-velocity-vector')).toBeVisible();
  await expect(page.getByTestId('foundry-force-vector')).toBeVisible();
  await expect(page.getByTestId('foundry-drive-force-vector')).toBeVisible();
  await expect(page.getByTestId('foundry-friction-vector')).toBeVisible();
  await expect(page.getByTestId('foundry-velocity-overlay'), 'Velocity vector is projected from the same Three.js camera as the mechanism pins').toHaveAttribute('data-projection', 'three-camera');
  await expect(page.getByTestId('foundry-forces-overlay'), 'Force vectors are projected from the same Three.js camera as the mechanism pins').toHaveAttribute('data-projection', 'three-camera');
  await expect(page.getByTestId('foundry-velocity-overlay'), 'Four-bar velocity originates from C, the real coupler/output joint, not a floating coupler trace point').toHaveAttribute('data-origin-source', 'coupler-output-joint');
  await expect(page.getByTestId('foundry-forces-overlay'), 'Four-bar force originates from C, the real coupler/output joint, not a floating coupler trace point').toHaveAttribute('data-origin-source', 'coupler-output-joint');
  await expect(page.getByTestId('foundry-playhead'), 'The live playhead is drawn at the projected physical output joint, not raw path coordinates').toHaveAttribute('data-projection', 'three-camera');
  await expect(page.getByTestId('foundry-playhead')).toHaveAttribute('data-origin-source', 'coupler-output-joint');
  await expect(threeScene, 'Four-bar hardware pins are only A/B/C/D reference joints; the generated trace point must not get floating clips/spacers').toHaveAttribute('data-three-physical-pin-contract', 'reference-A-B-C-D-only');
  await expect(threeScene).toHaveAttribute('data-three-physical-pin-count', '4');
  await expect(threeScene, 'Generated trace/path is hidden until explicitly requested so it does not read as a floating mechanism part').toHaveAttribute('data-path-preview', 'hidden');
  await expect(page.getByTestId('foundry-physics-readout')).toContainText('Motion');
  await expect(page.getByTestId('foundry-physics-readout')).toContainText('μ');
  await expect(page.getByTestId('foundry-physics-readout')).toContainText('constraint err');
  await expect(threeScene).toHaveAttribute('data-friction-coefficient', /0\.\d+/);
  await expect(threeScene).toHaveAttribute('data-constraint-error', /[0-9]+\.[0-9]+/);
  const defaultPhysics = await page.getByTestId('foundry-preview').evaluate(() => {
    const velocity = document.querySelector('[data-testid="foundry-velocity-vector"]') as SVGLineElement | null;
    const force = document.querySelector('[data-testid="foundry-force-vector"]') as SVGLineElement | null;
    const friction = document.querySelector('[data-testid="foundry-friction-vector"]') as SVGLineElement | null;
    const velocityOverlay = document.querySelector('[data-testid="foundry-velocity-overlay"]') as SVGGElement | null;
    const forceOverlay = document.querySelector('[data-testid="foundry-forces-overlay"]') as SVGGElement | null;
    const length = (line: SVGLineElement | null) => line
      ? Math.hypot(Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')), Number(line.getAttribute('y2')) - Number(line.getAttribute('y1')))
      : 0;
    return {
      velocityLength: length(velocity),
      forceLength: length(force),
      frictionLength: length(friction),
      vx: Number(velocityOverlay?.getAttribute('data-vx') ?? 0),
      vy: Number(velocityOverlay?.getAttribute('data-vy') ?? 0),
      speed: Number(velocityOverlay?.getAttribute('data-speed') ?? 0),
      fx: Number(forceOverlay?.getAttribute('data-fx') ?? 0),
      fy: Number(forceOverlay?.getAttribute('data-fy') ?? 0),
      forceMagnitude: Number(forceOverlay?.getAttribute('data-force-magnitude') ?? 0)
    };
  });
  expect(defaultPhysics.velocityLength, 'Velocity vector has visible direction').toBeGreaterThan(20);
  expect(defaultPhysics.forceLength, 'Force vector has visible direction').toBeGreaterThan(20);
  expect(defaultPhysics.frictionLength, 'Friction vector opposes the live motion').toBeGreaterThan(10);
  expect(defaultPhysics.speed, 'Velocity vector is computed from live mechanism samples').toBeGreaterThan(0);
  expect(defaultPhysics.speed, 'Velocity readout matches the data vector on screen').toBeCloseTo(Math.hypot(defaultPhysics.vx, defaultPhysics.vy), 2);
  expect(defaultPhysics.forceMagnitude, 'Force readout matches the data vector on screen').toBeCloseTo(Math.hypot(defaultPhysics.fx, defaultPhysics.fy), 2);
  expect(Number(await threeScene.getAttribute('data-three-part-count')), 'Sandbox scene contains extruded cardboard/wood parts').toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId('foundry-mini-linkage-gear')).toBeVisible();
  await expect(page.getByTestId('foundry-mechanism-library')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show details' }).click();
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('Four-bar linkage');
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('pin reactions');
  await expect(page.getByTestId('foundry-feasibility')).toContainText('360°');
  await page.getByRole('button', { name: 'Hide details' }).click();
  await expect(page.getByTestId('foundry-target-summary')).toContainText('Range 360°');
  await expect(page.getByTestId('foundry-anchor-marker'), 'Default sandbox keeps non-mechanism markers hidden').toHaveCount(0);
  await expect(page.getByLabel('Foundry mechanism type')).toBeHidden();
  await page.getByText('Mechanism options').click();
  await expect(page.getByTestId('foundry-param-handles'), '4bar exposes direct A/B/C/D joint handles in the WebGL overlay').toHaveAttribute('data-handle-contract', '4bar-A-B-C-D');
  await expect(page.getByTestId('foundry-param-handles'), '4bar overlay handles keep board pivots on the low board-side stack and floating joints on top').toHaveAttribute('data-handle-z-contract', 'board-pivots-bottom-floating-top');
  const handleZMap = await page.getByTestId('foundry-param-handles').getAttribute('data-handle-z-map') ?? '';
  const handleZ = Object.fromEntries(handleZMap.split(',').map(item => { const [id, value] = item.split(':'); return [id, Number(value)]; }));
  expect(handleZ.A, 'A handle is projected on its short board-pivot stack, not the global top layer').toBeLessThan(handleZ.B);
  expect(handleZ.D, 'D handle is projected from its own board-pivot stack and may share the top z when output is the top layer').toBeLessThanOrEqual(handleZ.C);
  await expect(page.getByTestId('foundry-param-handle-A')).toHaveAttribute('data-draggable', 'false');
  await expect(page.getByTestId('foundry-param-handle-D')).toHaveAttribute('data-draggable', 'true');
  const groundBeforeHandleDrag = Number(await page.getByLabel('ground number', { exact: true }).inputValue());
  const groundHandleBox = await page.getByTestId('foundry-param-handle-D').boundingBox();
  expect(groundHandleBox, 'ground handle is visible for direct parametric editing').toBeTruthy();
  await page.mouse.move(groundHandleBox!.x + groundHandleBox!.width / 2, groundHandleBox!.y + groundHandleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(groundHandleBox!.x + groundHandleBox!.width / 2 + 72, groundHandleBox!.y + groundHandleBox!.height / 2 + 18);
  await page.mouse.up();
  await expect.poll(async () => Number(await page.getByLabel('ground number', { exact: true }).inputValue()), { message: 'dragging the D handle updates the physical ground length parameter' }).not.toBe(groundBeforeHandleDrag);

  await page.getByLabel('Foundry mechanism type').selectOption('gear');
  await expect(page.getByTestId('foundry-parametric-editor'), 'Foundry exposes fabrication-backed gear selectors').toBeVisible();
  await page.getByLabel('Drive gear size').selectOption('g40');
  await page.getByLabel('Output gear size').selectOption('g56');
  await page.getByRole('button', { name: 'Add idler gear' }).click();
  await page.getByLabel('Idler gear 1 size').selectOption('g8');
  await expect(threeScene, 'Gear train param editor writes ordered drive/idler/output radii to the shared preview').toHaveAttribute('data-three-gear-radii', '100.00,20.00,140.00');
  await expect(threeScene, 'Gear train axles are generated from the same fitted centers used to draw the gear plates').toHaveAttribute('data-three-gear-center-source', 'fitted-simulation-pitch-centers');
  await expect(threeScene).toHaveAttribute('data-three-gear-center-count', '3');
  await expect(threeScene).toHaveAttribute('data-three-gear-axle-center-contract', 'pin-stacks-use-rendered-gear-centers');
  await expect(threeScene, 'Adjacent gear plates use alternating tooth/gap phase so pitch-center contact does not render as tooth overlap').toHaveAttribute('data-three-gear-mesh-phase-contract', 'alternating-half-tooth-gap-phase');
  await expect(threeScene).toHaveAttribute('data-three-gear-mesh-phases', '0.00,22.50,0.00');
  expect(await threeScene.getAttribute('data-three-gear-axle-centers'), 'Every visible gear axle sits on its rendered gear center').toBe(await threeScene.getAttribute('data-three-gear-centers'));
  expect(Number(await threeScene.getAttribute('data-three-gear-center-max-error')), 'Fitted gear centers preserve fabrication pitch spacing after preview scaling').toBeLessThan(0.75);
  await expect(threeScene, 'Dynamic gear stack uses the same G1/G5/G7 fabrication labels as Blueprint/Assembly').toHaveAttribute('data-three-stack-order', /Drive G5 \/ 5-space gear.*Idler G1 \/ 1-space gear 1.*Output G7 \/ 7-space gear/);

  await page.getByLabel('Foundry mechanism type').selectOption('gear_linkage');
  await expect(page.getByTestId('foundry-parametric-editor'), 'Gear linkage exposes the shared parametric editor').toBeVisible();
  await page.getByLabel('Drive gear size').selectOption('g40');
  await page.getByLabel('Output gear size').selectOption('g56');
  await page.getByLabel('Paired link length').selectOption('6');
  await expect(threeScene, 'Gear linkage param editor keeps output gear and linkage in the fabrication stack').toHaveAttribute('data-three-stack-order', /Drive G5 \/ 5-space gear.*Output G7 \/ 7-space gear.*Drive L6 linkage.*Output L6 linkage.*2-hole bracket/);
  await expect(threeScene, 'Gear linkage crank pin snaps to a real attachment hole on the selected output gear').toHaveAttribute('data-three-linkage-pin-radius', /\d+\.\d+/);

  await page.getByLabel('Foundry mechanism type').selectOption('4bar');
  await expect(page.getByLabel('Input link length'), '4bar exposes visible linkage blank selectors instead of hidden generic numbers').toBeVisible();

  const foundryPhysicalMarkers: Record<string, Array<[string, number]>> = {
    '4bar': [['data-three-part-count', 5], ['data-three-hole-count', 11]],
    cam: [['data-three-cam-count', 1], ['data-three-follower-count', 1], ['data-three-hole-count', 8]],
    gear: [['data-three-gear-count', 2], ['data-three-hole-count', 10]],
    gear_linkage: [['data-three-gear-count', 2], ['data-three-hole-count', 22]],
    planetary_gear: [['data-three-gear-count', 3], ['data-three-hole-count', 13]]
  };

  for (const type of ['4bar', 'cam', 'gear', 'gear_linkage', 'planetary_gear']) {
    await page.getByLabel('Foundry mechanism type').selectOption(type);
    await expect(threeScene, `${type} has its own physical 3D preview template`).toHaveAttribute('data-mechanism-type', type);
    await expect(threeScene, `${type} uses the fabrication stack as the 3D render source`).toHaveAttribute('data-three-stack-source', 'fabricationStackForMechanism');
    await expect(threeScene, `${type} stack has no validation errors`).toHaveAttribute('data-three-stack-validation-errors', '0');
    const stackRoles = await threeScene.getAttribute('data-three-stack-roles');
    expect(stackRoles, `${type} stack starts with a back clip and ends with a front clip`).toMatch(/^clip>.*>clip$/);
    expect(stackRoles, `${type} stack has at least one spacer separating moving layers`).toContain('spacer');
    expect(await threeScene.getAttribute('data-three-rendered-layer-labels'), `${type} rendered labels match fabrication stack labels`).toBe(await threeScene.getAttribute('data-three-stack-order'));
    expect(await threeScene.getAttribute('data-three-rendered-layer-roles'), `${type} rendered roles match fabrication stack roles`).toBe(await threeScene.getAttribute('data-three-stack-roles'));
    expect(await threeScene.getAttribute('data-three-rendered-layer-colors'), `${type} rendered colors match fabrication stack colors`).toBe(await threeScene.getAttribute('data-three-stack-colors'));
    const renderedLayerZ = await threeScene.getAttribute('data-three-rendered-layer-z') ?? '';
    const stackLayerZ = await threeScene.getAttribute('data-three-stack-z') ?? '';
    if (type === 'gear' || type === 'gear_linkage') {
      await expect(threeScene, `${type} keeps meshed gears coplanar instead of separating them by the linear stack list`).toHaveAttribute('data-three-gear-plane-mode', 'coplanar-fixed-axles');
      expect(renderedLayerZ, `${type} gear render z intentionally differs from the printable stack z because each axle has a local spacer stack`).not.toBe(stackLayerZ);
      const roles = (await threeScene.getAttribute('data-three-rendered-layer-roles') ?? '').split('>');
      const zValues = renderedLayerZ.split(',').map(Number);
      const gearZValues = roles.flatMap((role, index) => role === 'gear' ? [zValues[index]] : []);
      expect(new Set(gearZValues.map(z => z.toFixed(2))).size, `${type} all external meshing gears share one pitch plane`).toBe(1);
    } else if (type === '4bar') {
      expect(renderedLayerZ, '4bar draws A/D ground links on one board-side plane while keeping the coupler above them').not.toBe(stackLayerZ);
    } else {
      expect(renderedLayerZ, `${type} rendered z order matches fabrication stack z order`).toBe(stackLayerZ);
    }
    if (type === '4bar') {
      await expect(threeScene, '4bar foundry geometry keeps A-B/B-C/C-D topology from mechanism-reference instead of drawing a floating output rod').toHaveAttribute('data-three-geometry-contract', /Input L2 linkage:A-B.*Coupler L4 linkage:B-C.*Output L2 linkage:C-D/);
      await expect(threeScene, '4bar keeps only physical A/B/C/D pin hardware in the 3D scene').toHaveAttribute('data-three-physical-pin-contract', 'reference-A-B-C-D-only');
      await expect(threeScene).toHaveAttribute('data-three-physical-pin-count', '4');
      await expect(threeScene, '4bar renders recipe spacer sites at A/B/C/D without z-layer collisions').toHaveAttribute('data-three-spacer-render-count', '4');
      await expect(threeScene, '4bar ground pivots keep one board-side spacer and a visible fastener head instead of an outboard/top spacer').toHaveAttribute('data-three-board-pivot-fastener-contract', 'fastener-end>S10-board-side>linkage>fastener-head');
      await expect(threeScene, '4bar ground pivots A and D share one low board-side linkage plane').toHaveAttribute('data-three-fourbar-ground-link-plane', 'A-D-ground-links-coplanar');
      const boardSpacerZ = Object.fromEntries((await threeScene.getAttribute('data-three-board-pivot-spacer-z') ?? '').split(',').map(item => {
        const [id, value] = item.split(':');
        return [id, Number(value)];
      }));
      expect(boardSpacerZ.A, 'A board spacer is below the low ground-link plane').toBeCloseTo(boardSpacerZ.D, 2);
      await expect(threeScene, '4bar pins use per-pivot stack spans so A/D do not protrude through empty z-layers').toHaveAttribute('data-three-pin-stack-policy', 'per-pin-adjacent-stack');
      await expect(threeScene, '4bar ground A-D is a board reference span, not a fabricated moving linkage').toHaveAttribute('data-three-ground-span-mode', 'board-reference');
    }
    await expect(threeScene, `${type} preview keeps stack z-collisions at zero`).toHaveAttribute('data-three-z-collision-count', '0');
    if (type === 'cam') await expect(threeScene, 'Cam follower guide stays board-fixed while the follower moves').toHaveAttribute('data-three-cam-guide-mode', 'fixed-board-guide');
    expect(Number(await threeScene.getAttribute('data-three-spacer-z-gap')), `${type} foundry preview has spacer clearance along z`).toBeGreaterThanOrEqual(FABRICATION_RENDER_LAYER_Z_STEP - 0.01);
    await expect(page.getByTestId('foundry-forces-overlay'), `${type} keeps live force vectors visible`).toHaveAttribute('data-physics-rule', /force|torque|velocity|acceleration|reaction/);
    await expect(page.getByTestId('foundry-velocity-overlay'), `${type} keeps live velocity vectors visible`).toHaveAttribute('data-speed', /[0-9]+\.[0-9]+/);
    for (const [attr, minimumCount] of foundryPhysicalMarkers[type]) {
      expect(Number(await threeScene.getAttribute(attr)), `${type} preview includes ${attr}`).toBeGreaterThanOrEqual(minimumCount);
    }
    if (type === 'planetary_gear') {
      await expect(threeScene, 'Planetary foundry syntax uses a fixed ring, sun input, carrier output set').toHaveAttribute('data-three-planetary-syntax', 'ring-fixed-sun-input-carrier-output');
      await expect(threeScene).toHaveAttribute('data-three-planetary-fixed', 'ring');
      await expect(threeScene).toHaveAttribute('data-three-planetary-input', 'sun');
      await expect(threeScene).toHaveAttribute('data-three-planetary-output', 'carrier');
      await expect(threeScene).toHaveAttribute('data-three-planet-count', '1');
      const radii = (await threeScene.getAttribute('data-three-gear-radii') ?? '').split(',').map(Number);
      expect(radii, 'Planetary foundry exposes sun, one G3 planet, and ring radii from the fabrication convention').toHaveLength(3);
      expect(radii[2], 'Planetary ring pitch radius equals sun + 2*planet pitch radii').toBeCloseTo(radii[0] + 2 * radii[1], 2);
    }
  }
  await page.getByLabel('Foundry mechanism type').selectOption('gear');
  await page.getByRole('button', { name: 'Show details' }).click();
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('Gear train');
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('gear mesh');
  await page.getByRole('button', { name: 'Hide details' }).click();
  expect(Number(await threeScene.getAttribute('data-three-gear-count')), 'Gear preview uses toothed 3D fabrication geometry').toBeGreaterThanOrEqual(2);
  await expect(threeScene, 'Gear train renders as meshed gears only, without fake linkage rods').toHaveAttribute('data-three-gear-train-linkage-mode', 'gear-only-train');
  await expect(threeScene, 'Gear train hardware is limited to fixed board gear axles').toHaveAttribute('data-three-physical-pin-contract', 'fixed-gear-axles-only');
  await expect(threeScene, 'Gear train geometry contract exposes board-fixed gears only').toHaveAttribute('data-three-geometry-contract', /Drive G3 \/ 3-space gear:fixed-board-gear.*Output G3 \/ 3-space gear:fixed-board-gear/);
  await expect(threeScene, 'Gear train fabrication stack exposes both reference G3 gears').toHaveAttribute('data-three-stack-order', /Drive G3 \/ 3-space gear.*Output G3 \/ 3-space gear/);
  expect(Number(await threeScene.getAttribute('data-three-gear-pitch-center')), 'Gear pitch centers are snapped to the sum of fabrication gear radii').toBeCloseTo(Number(await threeScene.getAttribute('data-three-gear-pitch-sum')), 2);
  await expect(threeScene, 'Default gear train uses the reference G3/G3 pitch radii').toHaveAttribute('data-three-gear-radii', '60.00,60.00');
  const gearCount = await threeScene.getAttribute('data-three-gear-count');
  await expect(threeScene, 'Default gear axles use the same fitted centers as the rendered gear plates').toHaveAttribute('data-three-gear-center-source', 'fitted-simulation-pitch-centers');
  await expect(threeScene).toHaveAttribute('data-three-gear-center-count', gearCount ?? '2');
  await expect(threeScene).toHaveAttribute('data-three-gear-axle-center-contract', 'pin-stacks-use-rendered-gear-centers');
  await expect(threeScene, 'Default G3/G3 mesh offsets one gear by half a tooth instead of drawing tooth-on-tooth overlap').toHaveAttribute('data-three-gear-mesh-phases', '0.00,7.50');
  expect(await threeScene.getAttribute('data-three-gear-axle-centers'), 'Default gear axle centers match rendered gear centers').toBe(await threeScene.getAttribute('data-three-gear-centers'));
  expect(Number(await threeScene.getAttribute('data-three-gear-center-max-error')), 'Default fitted gear centers preserve fabrication pitch spacing').toBeLessThan(0.75);
  await expect(threeScene, 'Each visible gear has one real fixed axle, with no orphan pin tower').toHaveAttribute('data-three-physical-pin-count', gearCount ?? '2');
  await expect(threeScene, 'Each G3 axle receives exactly one visible S10 spacer washer').toHaveAttribute('data-three-spacer-render-count', gearCount ?? '2');
  await expect(threeScene, 'Gear axles use board-side spacer then coplanar gear then fastener head').toHaveAttribute('data-three-gear-axle-stack-contract', 'board-side>S10-spacer>gear>fastener-head');
  await expect(threeScene, 'Gear axles span both the gear plate and local S10 washer so gears are not floating off their shafts').toHaveAttribute('data-three-pin-stack-z-sources', 'gear-axles-include-board-side-spacer');
  await expect(threeScene, 'Every fixed gear axle orders lower-z S10 spacer before gear before fastener head').toHaveAttribute('data-three-gear-axle-z-order', /S10<gear<fastener/);
  const gearAxleOrders = (await threeScene.getAttribute('data-three-gear-axle-z-order') ?? '').split(',').filter(Boolean);
  expect(gearAxleOrders.length, 'gear z-order contract covers every visible gear axle').toBe(Number(gearCount ?? '2'));
  expect(gearAxleOrders.every(item => item.endsWith(':S10<gear<fastener')), 'no fixed gear axle is reversed or invalid').toBe(true);
  const gearPlaneZ = Number(await threeScene.getAttribute('data-three-gear-plane-z'));
  const gearSpacerZ = (await threeScene.getAttribute('data-three-gear-board-side-spacer-z') ?? '').split(',').map(item => Number(item.split(':')[1]));
  expect(Math.max(...gearSpacerZ), 'gear spacers sit on the lower-z board side of the gear plate').toBeLessThan(gearPlaneZ);
  const gearPinSpans = (await threeScene.getAttribute('data-three-pin-stack-spans') ?? '').split(',').map(item => Number(item.split(':')[1]));
  expect(Math.min(...gearPinSpans), 'gear axle pins cross the spacer clearance instead of only the thin gear plate').toBeGreaterThan(FABRICATION_RENDER_LAYER_Z_STEP);
  await page.getByLabel('Foundry mechanism type').selectOption('gear_linkage');
  await expect(threeScene, 'Gear-linkage uses paired off-center G3 crank pins').toHaveAttribute('data-three-gear-linkage-mode', 'two-gear-two-link-coupler');
  await expect(threeScene, 'Gear-linkage uses two gear handles, paired L4 rods, and bracket').toHaveAttribute('data-three-gear-train-linkage-mode', 'two-gear-two-link-coupler');
  await expect(threeScene, 'Gear-linkage keeps the drive/output gear mesh coplanar on board axles').toHaveAttribute('data-three-gear-plane-mode', 'coplanar-fixed-axles');
  await expect(threeScene, 'Gear-linkage gear axles include local board-side spacer z in their fastener spans').toHaveAttribute('data-three-pin-stack-z-sources', 'gear-axles-include-board-side-spacer');
  await expect(threeScene, 'Gear-linkage pins are the two fixed gear axles plus two gear crank pins and one shared R connector').toHaveAttribute('data-three-physical-pin-contract', 'fixed-gear-axles-plus-two-crank-links');
  await expect(threeScene, 'Gear-linkage has no orphan hardware tower beyond its five real pin sites').toHaveAttribute('data-three-physical-pin-count', '5');
  await expect(threeScene, 'Gear-linkage geometry maps each layer to its reference role').toHaveAttribute('data-three-geometry-contract', /Drive G3 \/ 3-space gear:fixed-board-gear.*Output G3 \/ 3-space gear:fixed-board-gear.*Drive L4 linkage:B-pin-to-R.*Output L4 linkage:C-pin-to-R.*2-hole bracket:R-connector/);
  await expect(threeScene, 'Gear-linkage stack exposes G3/G3/L4/bracket in reference order').toHaveAttribute('data-three-stack-order', /Drive G3 \/ 3-space gear.*Output G3 \/ 3-space gear.*Drive L4 linkage.*Output L4 linkage.*2-hole bracket/);
  await expect(threeScene).toHaveAttribute('data-three-gear-radii', '60.00,60.00');
  await expect(threeScene).toHaveAttribute('data-three-linkage-pin-radius', '40.00');
  await page.getByLabel('Foundry mechanism type').selectOption('cam');
  expect(Number(await threeScene.getAttribute('data-three-cam-count')), 'Cam follower uses a cam profile, not a generic gear').toBeGreaterThanOrEqual(1);
  expect(Number(await threeScene.getAttribute('data-three-follower-count')), 'Cam follower shows its follower block').toBeGreaterThanOrEqual(1);
  await page.getByLabel('Foundry mechanism type').selectOption('4bar');
  await page.getByLabel('Foundry preset').selectOption('compact');
  await expect(page.getByTestId('foundry-target-summary')).toContainText('Compact');
  await expect(page.getByLabel('ground number')).toHaveValue('120');
  await page.getByLabel('Foundry preset').selectOption('balanced');
  await expect(page.getByTestId('foundry-target-summary')).toContainText('Balanced');
  await expect(page.getByLabel('ground number')).toHaveValue('160');
  await page.getByLabel('Foundry preset').selectOption('compact');

  await page.getByLabel('ground number', { exact: true }).fill('120');
  await page.getByLabel('Input link length').selectOption('2');
  await page.getByLabel('Coupler link length').selectOption('4');
  await page.getByLabel('Output link length').selectOption('2');
  await expect(page.getByTestId('foundry-feasibility')).toContainText(/Motion \d+%/);
  await page.getByRole('button', { name: /Use mechanism/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('design-mechanism-library')).toContainText('Four-bar linkage');
  await expect(page.getByTestId('design-feasibility')).toContainText('360°');

  await clickStage(page, 'Blueprint');
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeEnabled();
  await page.getByRole('button', { name: /Generate package/i }).click();
  const metadata = await downloadMetadataJson(page);
  const foundryMechanism = metadata.sceneSnapshot.mechanisms.find((mechanism: { source?: string }) => mechanism.source === 'foundry');
  expect(foundryMechanism.presetId).toBe('compact');
  expect(foundryMechanism.targetAnchorJointId).toBe('right_hand');
  expect(foundryMechanism.recommendation).toContain('Compact');
  expect(foundryMechanism.foundryExport.simulationSummary).toContain('Motion');

  expectCleanPage(pageErrors, consoleErrors);
});

test('Character edit drawer mutates body layers and skeleton joints into design controls', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByText('Rig setup').click();
  const rigDrawer = page.getByTestId('rig-structure-drawer');
  await expect(rigDrawer.getByRole('button', { name: /^Add layer$/ })).toHaveCount(1);
  await expect(rigDrawer.getByRole('button', { name: /Add body part/i })).toHaveCount(0);

  const selectedPart = page.getByLabel('Selected body part');
  await selectedPart.selectOption('right_arm_lower');
  await page.getByRole('button', { name: /Add layer/i }).click();
  const copiedPartId = await selectedPart.evaluate((select: HTMLSelectElement) => select.value);
  const copiedPartText = await selectedPart.evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent ?? '');
  expect(copiedPartId).toContain('part-');
  expect(copiedPartText).toContain('copy');

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.getByRole('button', { name: '4bar', exact: true }).click();
  const designPartOptions = await page.getByLabel('Mechanism target part').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(designPartOptions.join(' ')).toContain('copy');

  await page.getByRole('button', { name: /Path Editor/i }).click();
  await page.getByText('Rig setup').click();
  await page.getByRole('button', { name: /Remove layer/i }).click();
  await expect(selectedPart).not.toHaveValue(copiedPartId);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  const designPartOptionsAfterRemove = await page.getByLabel('Mechanism target part').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(designPartOptionsAfterRemove.join(' ')).not.toContain(copiedPartText);

  await page.getByRole('button', { name: /Path Editor/i }).click();
  await page.getByLabel('Selected body part').selectOption('right_arm_lower');
  await page.getByText('Rig setup').click();
  const editJoint = page.getByLabel('Edit joint');
  await editJoint.selectOption('right_hand');
  const beforeJoints = await editJoint.evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  await page.getByRole('button', { name: /Add joint/i }).click();
  const afterJoints = await editJoint.evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  const newJointId = afterJoints.find(id => !beforeJoints.includes(id));
  expect(newJointId).toBeTruthy();
  await editJoint.selectOption(newJointId!);
  const jointLocked = page.locator('label').filter({ hasText: 'Locked' }).nth(1).locator('input[type="checkbox"]');
  await jointLocked.check();
  await expect(page.getByRole('button', { name: /Remove joint/i })).toBeDisabled();
  await jointLocked.uncheck();

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.getByLabel('Mechanism target part').selectOption('right_arm_lower');
  const anchorOptionsWithJoint = await page.getByLabel('Mechanism target anchor').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  expect(anchorOptionsWithJoint).toContain(newJointId);

  await page.getByRole('button', { name: /Path Editor/i }).click();
  await page.getByText('Rig setup').click();
  await editJoint.selectOption(newJointId!);
  await page.getByRole('button', { name: /Remove joint/i }).click();
  const anchorOptionsAfterJointRemove = await editJoint.evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  expect(anchorOptionsAfterJointRemove).not.toContain(newJointId);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  const designAnchorOptionsAfterRemove = await page.getByLabel('Mechanism target anchor').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  expect(designAnchorOptionsAfterRemove).not.toContain(newJointId);

  expectCleanPage(pageErrors, consoleErrors);
});

test('Recommendation sheet applies a distinct mechanism and blueprint recipe', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  const initialMechanisms = await page.getByLabel('Mechanism instance').evaluate((select: HTMLSelectElement) => select.options.length);
  await page.getByRole('button', { name: /Recommend/i }).click();
  await expect(page.getByTestId('recommendation-sheet')).toBeVisible();
  await expect(page.getByTestId('recommendation-sheet')).toContainText('Recommended mechanisms');
  await expect(page.getByTestId('recommendation-card-4bar')).toBeVisible();
  await page.getByTestId('recommendation-card-4bar').getByRole('button', { name: /^Use$/ }).click();
  await expect(page.getByTestId('recommendation-sheet')).toHaveCount(0);
  const mechanismOptions = await page.getByLabel('Mechanism instance').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  expect(mechanismOptions).toHaveLength(initialMechanisms + 1);
  expect(new Set(mechanismOptions).size).toBe(mechanismOptions.length);

  await clickStage(page, 'Blueprint');
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeEnabled();
  await page.getByRole('button', { name: /Generate package/i }).click();
  const metadata = await downloadMetadataJson(page);
  expect(metadata.recipes).toHaveLength(initialMechanisms + 1);
  expect(new Set(metadata.recipes.map((recipe: { mechanismId: string }) => recipe.mechanismId)).size).toBe(initialMechanisms + 1);
  const appliedRecommendation = metadata.sceneSnapshot.mechanisms.find((mechanism: { id: string; presetId?: string; source?: string; targetPathId?: string; targetPartId?: string }) => mechanism.source === 'optimized' && mechanism.presetId?.startsWith('recommendation-'));
  expect(appliedRecommendation).toBeTruthy();
  expect(appliedRecommendation?.targetPartId).toBe('right_arm_lower');
  expect(appliedRecommendation?.targetPathId).toBe('path-right-arm');
  const appliedRecipe = metadata.recipes.find((recipe: { mechanismId: string; offsetFromBoardMm?: { x: number; y: number } }) => recipe.mechanismId === appliedRecommendation?.id);
  expect(appliedRecipe).toBeTruthy();
  expect(Math.abs(appliedRecipe?.offsetFromBoardMm?.x ?? Number.NaN)).toBeLessThan(0.01);
  expect(Math.abs(appliedRecipe?.offsetFromBoardMm?.y ?? Number.NaN)).toBeLessThan(0.01);

  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.getByRole('button', { name: /Recommend/i }).click();
  await expect(page.getByTestId('recommendation-sheet')).toBeVisible();
  const enabledApplyButtons = page.getByTestId('recommendation-sheet').locator('button.btn-primary:not(:disabled)');
  await expect(enabledApplyButtons.first()).toBeVisible();
  expect(await enabledApplyButtons.count(), 'at least two fabrication-ready recommendations').toBeGreaterThan(1);
  await enabledApplyButtons.nth(1).click();
  await clickStage(page, 'Blueprint');
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeEnabled();

  expectCleanPage(pageErrors, consoleErrors);
});

test('Foundry toolbar toggles preview, forces, velocity, trail, and sensemaking', async ({ page }) => {
  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Foundry/i }).click();

  await expect(page.getByTestId('foundry-toolbar')).toBeVisible();
  const threeScene = page.getByTestId('foundry-camera-rig');
  await expect(threeScene).toHaveAttribute('data-path-preview', 'hidden');
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await expect(threeScene).toHaveAttribute('data-path-preview', 'shown');
  await expect(threeScene).toHaveAttribute('data-three-path-source', 'moving-joints');
  await expect(threeScene).toHaveAttribute('data-three-path-trace-ids', 'B,C');
  await expect(threeScene).toHaveAttribute('data-three-primary-path-id', 'C');
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await expect(threeScene).toHaveAttribute('data-path-preview', 'hidden');
  await page.getByRole('button', { name: 'Trail' }).click();
  await expect(threeScene).toHaveAttribute('data-trail', 'shown');
  await expect(page.getByTestId('foundry-forces-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Forces' }).click();
  await expect(page.getByTestId('foundry-forces-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: 'Forces' }).click();
  await expect(page.getByTestId('foundry-forces-overlay')).toBeVisible();
  await expect(page.getByTestId('foundry-velocity-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Velocity' }).click();
  await expect(page.getByTestId('foundry-velocity-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: 'Velocity' }).click();
  await expect(page.getByTestId('foundry-velocity-overlay')).toBeVisible();
  await expect(page.getByTestId('foundry-mechanism-library')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show details' }).click();
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('pin reactions');
  await page.getByRole('button', { name: 'Hide details' }).click();
  await expect(page.getByTestId('foundry-mechanism-library')).toHaveCount(0);
  const velocityBeforePlay = await page.getByTestId('foundry-velocity-vector').evaluate((line: SVGLineElement) => [line.getAttribute('x1'), line.getAttribute('y1'), line.getAttribute('x2'), line.getAttribute('y2')].join(','));
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByTestId('foundry-toolbar-state')).toContainText('playing');
  await expect(page.getByTestId('foundry-toolbar-state')).not.toBeVisible();
  await expect.poll(async () => page.getByTestId('foundry-velocity-vector').evaluate((line: SVGLineElement) => [line.getAttribute('x1'), line.getAttribute('y1'), line.getAttribute('x2'), line.getAttribute('y2')].join(',')), { message: 'live velocity vector follows the running mechanism' }).not.toBe(velocityBeforePlay);
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByTestId('foundry-toolbar-state')).toContainText('paused');
  await expect(page.getByTestId('foundry-toolbar-state')).not.toBeVisible();
  await expect(threeScene).toHaveAttribute('data-path-preview', 'hidden');
  await expect(threeScene).toHaveAttribute('data-trail', 'hidden');
  await expect(threeScene).toHaveAttribute('data-layer-forces', 'shown');
  await expect(threeScene).toHaveAttribute('data-layer-velocity', 'shown');
  await expect(threeScene).toHaveAttribute('data-camera-preset', 'iso');
  await expect(page.getByTestId('foundry-camera-readout')).toContainText('3D Isometric');
  await expect(page.getByTestId('foundry-forces-overlay')).toBeVisible();
  await expect(page.getByTestId('foundry-velocity-overlay')).toBeVisible();
});

test('Foundry supports CAD-style 3D camera presets and drag orbit', async ({ page }) => {
  await page.setViewportSize({ width: 901, height: 720 });
  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Foundry/i }).click();

  const rig = page.getByTestId('foundry-camera-rig');
  const preview = page.getByTestId('foundry-preview');
  const overlay = page.getByTestId('foundry-preview-overlay');
  await expect(rig).toHaveAttribute('data-camera-preset', 'iso');
  await expect(rig).toHaveAttribute('data-viewer-contract', 'shared-viewer3d:v1');
  await expect(rig).toHaveAttribute('data-layer-grid', 'shown');
  await expect(rig).toHaveAttribute('data-layer-paths', 'hidden');
  await expect(rig).toHaveAttribute('data-camera-zoom', '0.820');
  await expect(rig).toHaveAttribute('data-anchor-pick-mode', 'three-raycaster-plane');
  await expect(page.getByTestId('foundry-camera-readout')).toContainText('3D Isometric');
  await expect(page.getByTestId('foundry-sim-badge')).toBeVisible();
  await expect(page.getByTestId('foundry-opacity-panel')).toBeVisible();
  await expect(page.getByTestId('stage-right-inspector').getByTestId('foundry-opacity-panel')).toBeVisible();
  await expect(page.getByTestId('foundry-explode-panel')).toBeVisible();
  const explodeSlider = page.getByLabel('Exploded view');
  await expect(explodeSlider).toHaveValue('0');
  const assembledLayerZ = (await rig.getAttribute('data-three-stack-z'))!.split(',').map(Number);
  await explodeSlider.evaluate(input => {
    const slider = input as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(slider, '60');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(rig).toHaveAttribute('data-three-exploded', 'true');
  await expect(rig).toHaveAttribute('data-three-explode-percent', '60');
  const explodedLayerZ = (await rig.getAttribute('data-three-rendered-layer-z'))!.split(',').map(Number);
  expect(explodedLayerZ[0], 'exploded view keeps back clip on the fabrication base plane').toBeCloseTo(assembledLayerZ[0], 2);
  expect(explodedLayerZ.at(-1)!, 'exploded slider fans front layers forward along z').toBeGreaterThan(assembledLayerZ.at(-1)!);
  await explodeSlider.evaluate(input => {
    const slider = input as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(slider, '0');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(rig).toHaveAttribute('data-three-exploded', 'false');
  await expect(page.getByTestId('foundry-toolbar')).toBeVisible();
  const centerPaneBox = await page.getByTestId('stage-canvas-pane').boundingBox();
  expect(centerPaneBox, 'center pane box for overlay containment').toBeTruthy();
  const overlayBoxes = await Promise.all([
    ['camera', page.getByTestId('foundry-camera-controls')] as const,
    ['sim', page.getByTestId('foundry-sim-badge')] as const,
    ['playback', page.getByTestId('foundry-toolbar')] as const
  ].map(async ([name, locator]) => [name, await locator.boundingBox()] as const));
  for (const [name, box] of overlayBoxes) {
    expect(box, `${name} overlay box`).toBeTruthy();
    expect(box!.x, `${name} overlay stays inside center left`).toBeGreaterThanOrEqual(centerPaneBox!.x - 1);
    expect(box!.x + box!.width, `${name} overlay stays inside center right`).toBeLessThanOrEqual(centerPaneBox!.x + centerPaneBox!.width + 1);
    expect(box!.y, `${name} overlay stays inside center top`).toBeGreaterThanOrEqual(centerPaneBox!.y - 1);
    expect(box!.y + box!.height, `${name} overlay stays inside center bottom`).toBeLessThanOrEqual(centerPaneBox!.y + centerPaneBox!.height + 1);
  }
  const topOverlays = overlayBoxes.filter(([name]) => name !== 'playback');
  for (let i = 0; i < topOverlays.length; i++) {
    for (let j = i + 1; j < topOverlays.length; j++) {
      const [aName, a] = topOverlays[i];
      const [bName, b] = topOverlays[j];
      const intersect = a!.x < b!.x + b!.width
        && a!.x + a!.width > b!.x
        && a!.y < b!.y + b!.height
        && a!.y + a!.height > b!.y;
      expect(intersect, `${aName} overlay does not block ${bName}`).toBe(false);
    }
  }
  await preview.evaluate((el: HTMLElement) => { el.style.height = '389px'; });
  await expect.poll(async () => {
    const box = await preview.boundingBox();
    const projectedAspect = Number(await overlay.getAttribute('data-projection-aspect'));
    return box ? Math.abs(projectedAspect - (box.width / box.height)) : 1;
  }, { message: 'overlay physics projection uses the live WebGL preview aspect, not fixed 360/240' }).toBeLessThan(0.01);
  const nonStandardBox = await preview.boundingBox();
  expect(nonStandardBox, 'preview was resized to exercise a non-1.5 projection aspect').toBeTruthy();
  expect(Math.abs((nonStandardBox!.width / nonStandardBox!.height) - 1.5), 'test covers non-360/240 preview proportions').toBeGreaterThan(0.05);
  const overlayCenter = async () => overlay.evaluate((svg: SVGSVGElement) => ({ x: svg.viewBox.baseVal.width / 2, y: svg.viewBox.baseVal.height / 2 }));
  const isoYaw = await rig.getAttribute('data-camera-yaw');
  const vectorOrigin = async () => page.getByTestId('foundry-velocity-vector').evaluate((line: SVGLineElement) => [
    line.getAttribute('x1'),
    line.getAttribute('y1')
  ].join(','));
  const isoVectorOrigin = await vectorOrigin();

  const previewBox = await preview.boundingBox();
  expect(previewBox, 'foundry preview supports direct orbit dragging and anchor picking').toBeTruthy();
  await page.getByTestId('foundry-pick-anchor').click();
  await page.mouse.click(previewBox!.x + previewBox!.width * 0.5, previewBox!.y + previewBox!.height * 0.5);
  const pickedMarker = await page.getByTestId('foundry-anchor-marker').getAttribute('transform');
  const pickedCoords = pickedMarker?.match(/translate\(([-\d.]+) ([-\d.]+)/);
  expect(pickedCoords, 'anchor marker is driven by a 3D raycast into the work plane').toBeTruthy();
  const pickedCenter = await overlayCenter();
  expect(Math.abs(Number(pickedCoords![1]) - pickedCenter.x), 'picked board marker remains visually centered after Three camera projection').toBeLessThan(6);
  expect(Math.abs(Number(pickedCoords![2]) - pickedCenter.y), 'picked board marker remains visually centered after Three camera projection').toBeLessThan(6);

  const zoomBeforeWheel = Number(await rig.getAttribute('data-camera-zoom'));
  await preview.hover();
  await page.mouse.wheel(0, -360);
  await expect.poll(async () => Number(await rig.getAttribute('data-camera-zoom')), { message: 'wheel zoom changes the actual Three camera distance' }).toBeGreaterThan(zoomBeforeWheel);
  await expect(page.getByTestId('foundry-camera-readout')).toContainText('%');
  const zoomAfterWheel = Number(await rig.getAttribute('data-camera-zoom'));
  const panBeforeShiftDrag = {
    x: Number(await rig.getAttribute('data-camera-pan-x')),
    y: Number(await rig.getAttribute('data-camera-pan-y'))
  };
  await page.keyboard.down('Shift');
  await page.mouse.move(previewBox!.x + previewBox!.width * 0.55, previewBox!.y + previewBox!.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(previewBox!.x + previewBox!.width * 0.55, previewBox!.y + previewBox!.height * 0.34);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => Math.hypot(
    Number(await rig.getAttribute('data-camera-pan-x')) - panBeforeShiftDrag.x,
    Number(await rig.getAttribute('data-camera-pan-y')) - panBeforeShiftDrag.y
  ), { message: 'shift-drag pans the CAD workplane' }).toBeGreaterThan(0.01);
  expect(Number(await rig.getAttribute('data-camera-zoom')), 'shift-pan keeps dolly zoom stable').toBeCloseTo(zoomAfterWheel, 2);

  for (const preset of ['front', 'side', 'top', 'iso', 'front'] as const) {
    await page.getByTestId(`foundry-camera-preset-${preset}`).click();
    await expect(rig).toHaveAttribute('data-camera-preset', preset);
    await expect(rig, 'camera presets recenter the workplane after pan so the screen matches the reference view').toHaveAttribute('data-camera-pan-x', '0.000');
    await expect(rig, 'camera presets recenter the workplane after pan so the screen matches the reference view').toHaveAttribute('data-camera-pan-y', '0.000');
    if (preset === 'side') {
      const contract = JSON.parse(await rig.getAttribute('data-viewer-contract-state') ?? '{}');
      expect(contract).toMatchObject({ tab: 'foundry', cameraPreset: 'side', mode: '3d' });
    }
  }
  await expect(page.getByTestId('foundry-camera-readout')).toContainText('3D Front');
  await page.getByTestId('foundry-toggle-grid').click();
  await expect(rig).toHaveAttribute('data-layer-grid', 'hidden');
  await page.getByTestId('foundry-toggle-paths').click();
  await expect(rig).toHaveAttribute('data-layer-paths', 'shown');
  await page.getByTestId('foundry-toggle-paths').click();
  await expect(rig).toHaveAttribute('data-layer-paths', 'hidden');
  await page.getByTestId('foundry-toggle-grid').click();
  await expect(rig).toHaveAttribute('data-layer-grid', 'shown');
  await expect(rig).not.toHaveAttribute('data-camera-yaw', isoYaw ?? '');
  await expect.poll(vectorOrigin, { message: 'physics vector origin is camera-projected with the 3D mechanism joints' }).not.toBe(isoVectorOrigin);

  const yawBeforeDrag = await rig.getAttribute('data-camera-yaw');
  await page.mouse.move(previewBox!.x + previewBox!.width * 0.5, previewBox!.y + previewBox!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(previewBox!.x + previewBox!.width * 0.64, previewBox!.y + previewBox!.height * 0.42);
  await page.mouse.up();

  await expect(rig).toHaveAttribute('data-camera-preset', 'custom');
  await expect(page.getByTestId('foundry-camera-readout')).toContainText('3D Custom view');
  expect(await rig.getAttribute('data-camera-yaw')).not.toBe(yawBeforeDrag);

  await page.getByTestId('foundry-pick-anchor').click();
  await page.mouse.click(previewBox!.x + previewBox!.width * 0.5, previewBox!.y + previewBox!.height * 0.5);
  const orbitPickedMarker = await page.getByTestId('foundry-anchor-marker').getAttribute('transform');
  const orbitPickedCoords = orbitPickedMarker?.match(/translate\(([-\d.]+) ([-\d.]+)/);
  expect(orbitPickedCoords, 'orbit picking remains camera-coherent after custom 3D drag').toBeTruthy();
  const orbitPickedCenter = await overlayCenter();
  expect(Math.abs(Number(orbitPickedCoords![1]) - orbitPickedCenter.x), 'orbit-picked marker remains visually centered after custom Three camera projection').toBeLessThan(6);
  expect(Math.abs(Number(orbitPickedCoords![2]) - orbitPickedCenter.y), 'orbit-picked marker remains visually centered after custom Three camera projection').toBeLessThan(6);
});

test('Cam foundry profile points edit the shared cam simulation profile', async ({ page }) => {
  await page.setViewportSize({ width: 901, height: 720 });
  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Foundry/i }).click();
  await page.getByText('Mechanism options').click();
  await page.getByLabel('Foundry mechanism type').selectOption('cam');

  const rig = page.getByTestId('foundry-camera-rig');
  await expect(rig).toHaveAttribute('data-mechanism-type', 'cam');
  const editor = page.getByTestId('cam-profile-editor');
  await editor.scrollIntoViewIfNeeded();
  await expect(editor).toBeVisible();
  const before = await rig.getAttribute('data-cam-profile');
  const point = page.getByTestId('cam-profile-point-1');
  const box = await point.boundingBox();
  expect(box, 'cam profile point is draggable').toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y - 24);
  await page.mouse.up();
  await expect.poll(async () => rig.getAttribute('data-cam-profile'), { message: 'dragged cam profile is reflected in Three/fabrication shared data' }).not.toBe(before);
});


test('Character import surface omits browser camera capture', async ({ page }) => {
  await page.goto('/');
  await openCharacterScreen(page);
  await expect(page.getByRole('button', { name: /Capture Camera/i })).toHaveCount(0);
  await expect(page.getByTestId('camera-dialog')).toHaveCount(0);

  await page.getByRole('button', { name: /Open Getting Started/i }).click();
  const dialog = page.getByTestId('getting-started-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText('Capture frame');
  await expect(page.getByRole('button', { name: /^Camera$/i })).toHaveCount(0);
});

test('Mobile path editor keeps Draw free path action above the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openWavingArmTemplate(page);

  const drawButton = page.getByRole('button', { name: 'Draw free path', exact: true });
  const canvas = page.getByTestId('path-three-puppet-canvas');
  await expect(drawButton).toBeVisible();
  await expect(page.getByTestId('path-view-switch')).toBeVisible();
  await expect(canvas).toBeVisible();
  const drawBox = await drawButton.boundingBox();
  const canvasBox = await canvas.boundingBox();
  expect(drawBox, 'draw button layout box').toBeTruthy();
  expect(canvasBox, 'path canvas layout box').toBeTruthy();
  expect(drawBox!.y, 'mobile draw action appears before canvas').toBeLessThan(canvasBox!.y);
});


test('Welcome splash uses the MotionSmith logo mark and auto-dismisses', async ({ page }) => {
  await page.goto('/');
  const splash = page.getByTestId('welcome-dialog');
  await expect(splash).toBeVisible();
  const logo = splash.locator('img.motionsmith-logo-mark');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', /AppIcon/);
  await expect(splash).toContainText('MOTIONSMITH');
  await expect(splash).toHaveCount(0, { timeout: 6500 });
  await expect(page.getByTestId('getting-started-dialog')).toBeVisible();
});

test('Mobile welcome modal is logo-only, traps focus, and releases to Getting Started', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const splash = page.getByTestId('welcome-dialog');
  await expect(splash).toBeVisible();
  await expect(splash).toContainText('MOTIONSMITH');
  await expect(splash.getByRole('button')).toHaveCount(0);
  await expect(splash.getByRole('checkbox')).toHaveCount(0);
  await expect(splash.getByLabel('MotionSmith preview video')).toHaveCount(0);
  await expect.poll(() => activeElementIsInDialog(page)).toBe(true);
  const modalState = await page.evaluate(() => ({
    scrollLocked: document.scrollingElement!.scrollHeight <= document.scrollingElement!.clientHeight + 8,
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    shellInert: document.querySelector('.app-shell')?.hasAttribute('inert') ?? false,
    shellHidden: document.querySelector('.app-shell')?.getAttribute('aria-hidden') === 'true'
  }));
  expect(modalState).toEqual({
    scrollLocked: true,
    htmlOverflow: 'hidden',
    shellInert: true,
    shellHidden: true
  });
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    expect(await activeElementIsInDialog(page)).toBe(true);
  }
  await splash.press('Escape');
  await expect(page.getByTestId('welcome-dialog')).toHaveCount(0);
  await expect(page.getByTestId('getting-started-dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.classList.contains('welcome-modal-open'))).toBe(true);
});

test('Shared player dock overlays the canvas, does not take layout space, and can be dragged', async ({ page }) => {
  for (const width of [901, 950, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    await page.goto('/');
    await openWavingArmTemplate(page);
    await page.getByTestId('workspace-steps').getByRole('button', { name: 'Mechanism Design' }).click();
    await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();

    const leftBox = await page.getByTestId('stage-left-pane').boundingBox();
    const rightBox = await page.getByTestId('stage-right-inspector').boundingBox();
    const dockBox = await page.getByTestId('workspace-player-dock').boundingBox();
    const workbenchBox = await page.getByTestId('shared-workbench').boundingBox();
    const frameBox = await page.locator('.editor-stage-frame').boundingBox();
    expect(leftBox, `left pane layout box at ${width}px`).toBeTruthy();
    expect(rightBox, `right inspector layout box at ${width}px`).toBeTruthy();
    expect(dockBox, `player dock layout box at ${width}px`).toBeTruthy();
    expect(workbenchBox, `workbench layout box at ${width}px`).toBeTruthy();
    expect(frameBox, `stage frame layout box at ${width}px`).toBeTruthy();
    await expect(page.getByTestId('stage-player-row')).toHaveCSS('position', 'absolute');
    expect(frameBox!.height, `player dock does not reserve a lower flex row at ${width}px`).toBeGreaterThan(workbenchBox!.height - 40);
    const overlaps = (a: NonNullable<typeof dockBox>, b: NonNullable<typeof dockBox>) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    expect(overlaps(dockBox!, leftBox!), `player dock does not geometrically overlap the workflow pane at ${width}px`).toBe(false);
    expect(overlaps(dockBox!, rightBox!), `player dock does not geometrically overlap the right inspector at ${width}px`).toBe(false);
  }

  const before = await page.getByTestId('workspace-player-dock').boundingBox();
  await page.getByTestId('workspace-player-drag-handle').dragTo(page.getByTestId('stage-canvas-pane'), { targetPosition: { x: 40, y: 40 } });
  const after = await page.getByTestId('workspace-player-dock').boundingBox();
  expect(Math.abs((after!.x - before!.x)) + Math.abs((after!.y - before!.y)), 'player dock moves by dragging the title handle').toBeGreaterThan(20);
});

test('Right inspector scroll does not move the center canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Options/i }).click();

  const center = page.getByTestId('stage-canvas-pane');
  const inspector = page.getByTestId('stage-right-inspector');
  const before = await center.boundingBox();
  await inspector.hover();
  await page.mouse.wheel(0, 900);

  await expect.poll(() => inspector.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const after = await center.boundingBox();
  expect(Math.abs(after!.y - before!.y), 'center canvas stays pinned while right inspector scrolls').toBeLessThan(1);
});

test('Narrow character right inspector remains independently scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto('/');
  await openCharacterScreen(page);

  const inspector = page.getByTestId('stage-right-inspector');
  await inspector.scrollIntoViewIfNeeded();
  await expect(inspector).toBeVisible();
  await expect(page.getByTestId('part-art-controls')).toBeVisible();
  const metrics = await inspector.evaluate(element => ({
    overflowY: getComputedStyle(element).overflowY,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
  expect(metrics.overflowY).toBe('auto');
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

  await inspector.evaluate(element => element.scrollBy(0, 700));
  await expect.poll(() => inspector.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test('Workflow tabs keep left workflow, center canvas, and right inspector roles', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await openWavingArmTemplate(page);

  const workflowRail = page.getByTestId('workspace-steps');
  await expect(workflowRail).toBeVisible();
  await expect(workflowRail).toContainText('Character');
  await expect(workflowRail).not.toContainText('Character Selection');
  await expect(workflowRail).toContainText('Path Editor');
  await expect(workflowRail).toContainText('Foundry');
  await expect(workflowRail).toContainText('Blueprint');
  await expect(workflowRail.getByRole('button', { name: 'Path Editor' })).toHaveAttribute('aria-current', 'step');
  expect(await workflowRail.evaluate(element => getComputedStyle(element).position)).toBe('fixed');

  const assertPaneContract = async (leftText: RegExp | string, centerText: RegExp | string, rightText: RegExp | string, allowedCenterControlSelector = '.canvas-zoom-toolbar', surfaceSelector = 'svg, canvas') => {
    const left = page.getByTestId('stage-left-pane');
    const center = page.getByTestId('stage-canvas-pane');
    const right = page.getByTestId('stage-right-inspector');
    await expect(left).toBeVisible();
    await expect(center).toBeVisible();
    await expect(right).toBeVisible();
    await expect(left).toHaveAttribute('aria-label', 'Workflow');
    await expect(center).toHaveAttribute('aria-label', 'Shared canvas');
    await expect(right).toHaveAttribute('aria-label', 'Selected item inspector');
    await expect(left).toHaveAttribute('data-pane-kind', 'workflow');
    await expect(center).toHaveAttribute('data-pane-kind', 'canvas');
    await expect(right).toHaveAttribute('data-pane-kind', 'inspector');
    await expect(left).toContainText(leftText);
    await expect(center).toContainText(centerText);
    await expect(right).toContainText(rightText);
    const unexpectedCenterControls = await center.locator('button, input, select, textarea').evaluateAll((nodes, selector) => nodes.filter(node => !node.closest(selector as string)).length, allowedCenterControlSelector);
    expect(unexpectedCenterControls, 'center pane only allows stage-owned overlay controls').toBe(0);
    await expect(center.getByTestId('view-lens-hud')).toHaveCount(0);
    await expect(center.getByTestId('toon-renderer-shell')).toHaveCount(0);
    const centerBox = await center.boundingBox();
    const leftBox = await left.boundingBox();
    const rightBox = await right.boundingBox();
    const surfaceBox = await center.locator(surfaceSelector).first().boundingBox();
    expect(centerBox, 'center pane box').toBeTruthy();
    expect(leftBox, 'left pane box').toBeTruthy();
    expect(rightBox, 'right pane box').toBeTruthy();
    expect(surfaceBox, 'center work surface box').toBeTruthy();
    expect(surfaceBox!.x, 'work surface stays inside center left edge').toBeGreaterThanOrEqual(centerBox!.x - 1);
    expect(surfaceBox!.y, 'work surface stays inside center top edge').toBeGreaterThanOrEqual(centerBox!.y - 1);
    expect(surfaceBox!.x + surfaceBox!.width, 'work surface stays inside center right edge').toBeLessThanOrEqual(centerBox!.x + centerBox!.width + 1);
    expect(surfaceBox!.y + surfaceBox!.height, 'work surface stays inside center bottom edge').toBeLessThanOrEqual(centerBox!.y + centerBox!.height + 1);
    expect(centerBox!.width, 'center workspace dominates the side panes').toBeGreaterThan(leftBox!.width);
    expect(centerBox!.width, 'center workspace dominates the inspector').toBeGreaterThan(rightBox!.width);
  };

  await assertPaneContract('Draw path', '3D', 'Selection', '.canvas-zoom-toolbar, .path-view-switch');
  await expect(page.getByTestId('stage-left-pane')).toContainText('Rig setup');
  await expect(page.getByTestId('stage-right-inspector')).not.toContainText(/Add body part|Add layer|Remove layer|Add joint|New IK handle|Parts \+ skeleton/);

  await page.getByRole('button', { name: /Foundry/i }).click();
  await assertPaneContract('Templates', '3D Isometric', 'Mechanism options', '.canvas-zoom-toolbar, .foundry-camera-hud, .foundry-playback-hud');
  await expect(page.getByTestId('stage-left-pane')).toContainText('Use mechanism');

  await page.getByRole('button', { name: /Use mechanism/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await assertPaneContract('Mechanisms', 'Letter sheet', 'Parameters');

  await clickStage(page, 'Blueprint');
  await assertPaneContract('Generate', 'Cut sheet', 'Cut sheet', '.blueprint-document-preview', '.blueprint-document-preview');
  await clickStage(page, 'Assembly');
  await assertPaneContract('Build', 'Generate first.', 'Assembly', '.blueprint-empty-state', '.blueprint-empty-state');

  await page.getByRole('button', { name: /Options/i }).click();
  await assertPaneContract('Settings', 'Letter sheet', 'Appearance');
  const rightInspector = page.getByTestId('stage-right-inspector');
  await rightInspector.evaluate(element => { element.scrollTop = 0; });
  await page.getByTestId('stage-left-pane').getByRole('link', { name: 'Units' }).click();
  await expect.poll(() => rightInspector.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByTestId('options-units')).toBeVisible();
});

test('Workflow rail remains reachable on short desktop and mobile fallback exposes every stage', async ({ page }) => {
  await page.setViewportSize({ width: 901, height: 480 });
  await page.goto('/');
  await openWavingArmTemplate(page);
  const rail = page.getByTestId('workspace-steps');
  await expect(rail).toBeVisible();
  await rail.getByRole('button', { name: 'Options' }).scrollIntoViewIfNeeded();
  const optionsBox = await rail.getByRole('button', { name: 'Options' }).boundingBox();
  expect(optionsBox, 'Options button is reachable in the fixed workflow rail').toBeTruthy();
  expect(optionsBox!.y + optionsBox!.height, 'Options button scrolls inside short viewport').toBeLessThanOrEqual(481);
  await rail.getByRole('button', { name: 'Options' }).click();
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Options' })).toHaveAttribute('aria-current', 'step');

  await page.setViewportSize({ width: 390, height: 820 });
  await page.getByRole('button', { name: 'Path' }).click();
  const mobileNav = page.getByTestId('stage-left-pane').locator('.stage-nav-compact');
  await expect(page.getByTestId('workspace-steps')).toBeHidden();
  for (const name of ['Character', 'Path', 'Foundry', 'Design', 'Blueprint', 'Options']) {
    await expect(mobileNav.getByRole('button', { name })).toBeVisible();
  }
  await expect(mobileNav.getByRole('button', { name: 'Path' })).toHaveAttribute('aria-current', 'step');
  await mobileNav.getByRole('button', { name: 'Foundry' }).click();
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  await page.getByTestId('stage-left-pane').locator('.stage-nav-compact').getByRole('button', { name: 'Options' }).click();
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
});

test('Animation resumes after leaving path drawing mode', async ({ page }) => {
  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await page.getByRole('button', { name: 'Mechanism Design' }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();

  const playerDock = page.getByTestId('workspace-player-dock');
  await expect(playerDock).not.toHaveClass(/is-drawing/);
  const scrubber = page.getByLabel('Workspace scrubber');
  const before = await scrubber.inputValue();
  await expect.poll(() => scrubber.inputValue(), { timeout: 6000, message: 'shared animation resumes after draw mode is cleared' }).not.toBe(before);
});

test('Command menu and shared canvas zoom persist across workflow stages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await openWavingArmTemplate(page);
  const assertZoomInClickable = async (expectedAfterClick: string) => {
    const zoomIn = page.getByLabel('Zoom in');
    await expect(zoomIn).toBeVisible();
    await zoomIn.scrollIntoViewIfNeeded();
    const zoomBox = await zoomIn.boundingBox();
    expect(zoomBox, 'zoom-in button box').toBeTruthy();
    const hitLabel = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return target?.closest('button')?.getAttribute('aria-label') ?? '';
    }, { x: zoomBox!.x + zoomBox!.width / 2, y: zoomBox!.y + zoomBox!.height / 2 });
    expect(hitLabel, 'zoom toolbar is topmost at its click point').toBe('Zoom in');
    await zoomIn.click();
    await expect(page.getByTestId('canvas-zoom-readout')).toHaveText(expectedAfterClick);
  };

  await expect(page.getByTestId('top-command-bar')).toBeVisible();
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('100%');
  await assertZoomInClickable('120%');

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('120%');
  await page.getByTestId('design-three-puppet-view-2d').click();
  await expect(page.getByTestId('design-three-puppet-state')).toHaveAttribute('data-view-mode', '2d');

  await page.getByTestId('design-canvas').hover();
  await page.mouse.wheel(0, -10000);
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('400%');
  await page.getByRole('button', { name: /Path Editor/i }).click();
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('400%');
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('400%');

  await page.getByTestId('top-command-bar').getByText('View', { exact: true }).click();
  await page.getByRole('button', { name: 'Reset View' }).click();
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('100%');
  await expect(page.getByTestId('status-bar')).toContainText('Canvas fitted to sheet');

  await page.evaluate(() => localStorage.setItem('motionsmith.workspace', JSON.stringify({
    stage: 'not-a-stage',
    viewport: { offset: { x: 'bad', y: 0 }, zoom: -10 },
    toolbarVisible: 'yes'
  })));
  await page.getByTestId('top-command-bar').getByText('View', { exact: true }).click();
  await page.getByRole('button', { name: 'Restore Layout' }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('status-bar')).toContainText('ignored invalid workspace viewport');
  await expect(page.getByTestId('status-bar')).toContainText('ignored invalid workspace stage');
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('100%');

  await page.setViewportSize({ width: 899, height: 720 });
  await page.getByRole('button', { name: 'Path' }).click();
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('100%');
  await assertZoomInClickable('120%');
  await page.getByRole('button', { name: 'Design' }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByTestId('top-command-bar').getByText('File', { exact: true }).click();
  let dialogMessage = '';
  page.once('dialog', async dialog => {
    dialogMessage = dialog.message();
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  expect(dialogMessage).toContain('Discard current project');
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('status-bar')).toContainText('Cancelled');

  await page.getByTestId('top-command-bar').getByText('File', { exact: true }).click();
  await page.getByRole('button', { name: 'Recover Autosave…' }).click();
  await expect(page.getByTestId('status-bar')).toContainText(/No autosave found|Recovered browser autosave snapshot/);

  await page.getByRole('button', { name: /Options/i }).click();
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
  await page.getByLabel('Show toolbar').uncheck();
  await expect(page.getByTestId('quick-toolbar')).toHaveCount(0);
  await page.getByLabel('Show toolbar').check();
  await expect(page.getByTestId('quick-toolbar')).toBeVisible();

  await page.getByTestId('top-command-bar').getByText('Edit', { exact: true }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('status-bar')).toContainText('Undo applied');
  await expect(page.getByLabel('Show toolbar')).not.toBeChecked();
  await expect(page.getByTestId('quick-toolbar')).toHaveCount(0);
  await page.getByTestId('top-command-bar').getByText('Edit', { exact: true }).click();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByTestId('status-bar')).toContainText('Redo applied');
  await expect(page.getByLabel('Show toolbar')).toBeChecked();
  await expect(page.getByTestId('quick-toolbar')).toBeVisible();

  await page.getByTestId('workspace-steps').getByRole('button', { name: 'Mechanism Design' }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('canvas-zoom-readout')).toBeVisible();

  await page.getByTestId('top-command-bar').getByText('Help', { exact: true }).click();
  await page.getByRole('button', { name: 'Shortcuts' }).click();
  await expect(page.getByTestId('shortcut-help-dialog')).toBeVisible();
  await expect(page.getByTestId('shortcut-help-dialog')).toContainText('New Project');
  await expect(page.getByTestId('shortcut-help-dialog')).toContainText('Undo');
  const zoomBeforeModalShortcuts = await page.getByTestId('canvas-zoom-readout').textContent();
  await page.keyboard.press('Alt+5');
  await page.keyboard.press('Control+=');
  await expect(page.getByTestId('shortcut-help-dialog')).toBeVisible();
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText(zoomBeforeModalShortcuts ?? '');
  await page.getByTestId('shortcut-help-dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('shortcut-help-dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await page.getByTestId('top-command-bar').getByText('Help', { exact: true }).click();
  await page.getByRole('button', { name: 'About MotionSmith…' }).click();
  await expect(page.getByTestId('about-dialog')).toBeVisible();
  await expect(page.getByTestId('about-dialog')).toContainText('Local only.');
  await expect(page.getByTestId('about-dialog')).toContainText('/ms/ static web');
  await expect(page.getByTestId('about-dialog')).toContainText('browser autosave');
  await page.getByTestId('about-dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('about-dialog')).toHaveCount(0);

  const zoomBeforeShiftPlus = await page.getByTestId('canvas-zoom-readout').textContent();
  await page.keyboard.press('Control+Shift+=');
  await expect.poll(async () => page.getByTestId('canvas-zoom-readout').textContent(), { message: 'shifted plus zoom shortcut updates the shared canvas' }).not.toBe(zoomBeforeShiftPlus);
  await page.keyboard.press('Control+=');
  await expect(page.getByTestId('status-bar')).toContainText(/Canvas zoom/);
  await page.keyboard.press('Alt+5');
  await expect(page.getByRole('heading', { name: 'Blueprint' })).toBeVisible();
});

test('guided classroom lesson opens real baseline and can reset safely', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await importWavingArmLessonProject(page, 'character');
  await expectProjectCounts(page, 14, 1, 1);
  const checklist = page.getByTestId('classroom-checklist');
  await expect(checklist).toContainText('Character');
  await expect(checklist).toContainText('Path');
  await expect(checklist).toContainText('Mechanism');
  for (const item of ['Character', 'Path', 'Mechanism', 'Test']) {
    await expect(checklist.getByRole('checkbox', { name: item })).toHaveAttribute('aria-checked', 'true');
  }
  for (const item of ['Blueprint', 'Assembly']) {
    await expect(checklist.getByRole('checkbox', { name: item })).toHaveAttribute('aria-checked', 'false');
  }

  await page.getByTestId('top-command-bar').getByText('File', { exact: true }).click();
  await page.getByTestId('command-reset-lesson').click();
  await expect(page.getByTestId('status-bar')).toContainText('Lesson reset');
  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await expectProjectCounts(page, 14, 1, 1);
  expectCleanPage(pageErrors, consoleErrors);
});

test('Detached visible mechanisms block browser blueprint generation', async ({ page }) => {
  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.getByRole('button', { name: 'piston', exact: true }).click();
  await page.getByLabel('Mechanism target part').selectOption('head');
  await expect(page.getByLabel('Mechanism target path')).toHaveValue('');

  await clickStage(page, 'Blueprint');
  await expect(page.getByTestId('blueprint-control-panel').getByText(/choose target \+ path/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeDisabled();
});


test('Mechanism Design library chips, target filters, delete, and enabled export work', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await applyFourBarFromFoundry(page);
  await expect(page.getByTestId('design-mechanism-library')).toContainText('Four-bar linkage');

  await page.getByRole('button', { name: 'piston', exact: true }).click();
  await expectProjectCounts(page, 14, 1, 2);
  const selectedMechanismText = await page.getByLabel('Mechanism instance').evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent ?? '');
  expect(selectedMechanismText).toContain('piston');
  await expect(page.getByTestId('design-mechanism-library')).toContainText('Slider piston');
  await expect(page.getByLabel('slider offset number')).toBeVisible();
  await expect(page.getByLabel('rod length number')).toBeVisible();
  await expect(page.getByLabel('Mechanism target part')).toHaveValue('right_arm_lower');
  await expect(page.getByLabel('Mechanism target path')).toHaveValue('path-right-arm');

  await page.getByLabel('Mechanism target part').selectOption('head');
  await expect(page.getByLabel('Mechanism target path')).toHaveValue('');
  const headPathOptions = await page.getByLabel('Mechanism target path').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(headPathOptions).toEqual(['No path']);
  await page.getByLabel('Mechanism target part').selectOption('right_arm_lower');
  const armPathOptions = await page.getByLabel('Mechanism target path').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(armPathOptions.join(' ')).toContain('path-right-arm · 5 pts');
  const anchorOptionValues = await page.getByLabel('Mechanism target anchor').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  expect(anchorOptionValues).toEqual(['', 'right_elbow', 'right_hand']);
  const anchorOptions = await page.getByLabel('Mechanism target anchor').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(anchorOptions.join(' ')).toContain('2 joints');
  expect(anchorOptions.join(' ')).not.toContain('left hand');
  await expect(page.getByLabel('Mechanism target anchor')).toHaveValue('right_hand');
  await expect(page.getByTestId('mechanism-ik-chain-summary')).toContainText('3 joints');
  await page.getByLabel('Mechanism target path').selectOption('path-right-arm');

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expectProjectCounts(page, 14, 1, 1);
  const remainingOptions = await page.getByLabel('Mechanism instance').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(remainingOptions.join(' ')).not.toContain('piston');

  await page.locator('label').filter({ hasText: 'Enabled' }).locator('input[type="checkbox"]').uncheck();
  await clickStage(page, 'Blueprint');
  await expect(page.getByTestId('blueprint-control-panel').getByText('No enabled mechanism to export.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeDisabled();

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.locator('label').filter({ hasText: 'Enabled' }).locator('input[type="checkbox"]').check();
  await page.getByLabel('Mechanism target part').selectOption('right_arm_lower');
  await page.getByLabel('Mechanism target path').selectOption('path-right-arm');
  await page.getByLabel('Mechanism target anchor').selectOption('right_hand');
  await page.getByRole('button', { name: 'Export Blueprint', exact: true }).click();
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeEnabled();
  await page.getByRole('button', { name: /Generate package/i }).click();
  expect((await downloadMetadataJson(page)).recipes).toHaveLength(1);

  expectCleanPage(pageErrors, consoleErrors);
});


test('Mechanism anchor drag snaps to the fabrication grid', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await applyFourBarFromFoundry(page);
  await page.getByTestId('design-three-puppet-view-2d').click();
  const anchor = page.locator('[data-testid^="mechanism-anchor-"]').first();
  await expect(anchor).toBeVisible();
  await anchor.dragTo(page.getByTestId('design-canvas'), { targetPosition: { x: 420, y: 320 } });

  await expect(page.getByLabel('anchor X number')).toBeVisible();
  const anchorPoint = {
    x: Number(await page.getByLabel('anchor X number').inputValue()),
    y: Number(await page.getByLabel('anchor Y number').inputValue())
  };
  expect(Number.isFinite(anchorPoint.x)).toBe(true);
  expect(Number.isFinite(anchorPoint.y)).toBe(true);
  expect(Math.abs(anchorPoint.x % 40)).toBeLessThan(0.01);
  expect(Math.abs(anchorPoint.y % 40)).toBeLessThan(0.01);
  expectCleanPage(pageErrors, consoleErrors);
});

test('Mechanism Design center workspace renders physical 3D templates for every mechanism type', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await applyFourBarFromFoundry(page);
  const designPuppet = page.getByTestId('design-three-puppet-state');
  await expect(designPuppet).toHaveAttribute('data-three-renderer', 'webgl');
  await expect(designPuppet).toHaveAttribute('data-three-engine-stack', 'three-webgl2-imperative');
  await expect(designPuppet).toHaveAttribute('data-physics-kernel', 'rapier3d-compat');
  await expect(designPuppet).toHaveAttribute('data-physics-kernel-runtime', 'ready', { timeout: 60_000 });
  await expect(designPuppet).toHaveAttribute('data-physics-kernel-version', /\d+\.\d+\.\d+/);
  await expect(designPuppet).toHaveAttribute('data-physics-kernel-error', 'none');
  await expect(designPuppet).toHaveAttribute('data-physics-update-policy', 'kinematic-authority-rapier-contact-validation');
  await expect(designPuppet).toHaveAttribute('data-high-throughput-scene-policy', 'viser-style-transform-tree-batched-updates-instancing');
  await expect(designPuppet).toHaveAttribute('data-physics-authority', 'motionsmith-kinematics');
  await expect(designPuppet).toHaveAttribute('data-three-stack-source', 'fabricationStackForMechanism');
  await expect(designPuppet).toHaveAttribute('data-three-stack-mode', 'assembled-spacer-separated');
  await expect(designPuppet).toHaveAttribute('data-three-part-surface', 'solid-cut-plates');
  await expect(designPuppet).toHaveAttribute('data-three-part-art', 'top-texture-decal');
  await expect(designPuppet).toHaveAttribute('data-three-assembly-underlay', 'plate-art-decal');
  await expect(designPuppet).toHaveAttribute('data-three-exploded', 'false');
  await expect(designPuppet).toHaveAttribute('data-three-stack-order', /^Back Clip → .*S10 spacer.*Front Clip$/);
  await expect(designPuppet).toHaveAttribute('data-three-spacer-key', 's10');
  await expect(designPuppet).toHaveAttribute('data-three-spacer-mm', '10x4');
  expect(Number(await designPuppet.getAttribute('data-three-spacer-z-gap')), 'Design center workspace spaces stacked plates along z by the shared S10 spacer layer').toBeGreaterThanOrEqual(FABRICATION_RENDER_LAYER_Z_STEP - 0.01);
  await expect(designPuppet).toHaveAttribute('data-three-stack-validation-errors', '0');
  expect(await designPuppet.getAttribute('data-three-rendered-layer-labels')).toBe(await designPuppet.getAttribute('data-three-stack-order'));
  expect(await designPuppet.getAttribute('data-three-rendered-layer-roles')).toBe(await designPuppet.getAttribute('data-three-stack-roles'));
  expect(await designPuppet.getAttribute('data-three-rendered-layer-colors')).toBe(await designPuppet.getAttribute('data-three-stack-colors'));
  expect(await designPuppet.getAttribute('data-three-rendered-layer-z')).toBe(await designPuppet.getAttribute('data-three-stack-z'));
  await expect(page.getByTestId('design-three-puppet-canvas')).toBeVisible();

  const centerPhysicalMarkers: Record<string, Array<[string, number]>> = {
    '4bar': [['data-three-mechanism-link-count', 5], ['data-three-mechanism-hole-count', 11]],
    piston: [['data-three-slot-count', 1], ['data-three-follower-count', 1]],
    cam: [['data-three-cam-count', 1], ['data-three-follower-count', 1], ['data-three-mechanism-hole-count', 8]],
    gear: [['data-three-gear-count', 2], ['data-three-mechanism-hole-count', 6]],
    gear_linkage: [['data-three-gear-count', 2], ['data-three-mechanism-hole-count', 22]],
    planetary_gear: [['data-three-gear-count', 3], ['data-three-mechanism-hole-count', 13]]
  };

  for (const type of ['4bar', 'piston', 'cam', 'gear', 'gear_linkage', 'planetary_gear']) {
    const before = Object.fromEntries(await Promise.all(centerPhysicalMarkers[type].map(async ([attr]) => [attr, Number(await designPuppet.getAttribute(attr)) || 0])));
    await page.getByRole('button', { name: type, exact: true }).click();
    await expect(designPuppet, `${type} design renderer uses the shared fabrication stack`).toHaveAttribute('data-three-stack-source', 'fabricationStackForMechanism');
    await expect(designPuppet, `${type} design stack stays assembled until explicitly exploded`).toHaveAttribute('data-three-exploded', 'false');
    await expect(designPuppet, `${type} design stack has no validation errors`).toHaveAttribute('data-three-stack-validation-errors', '0');
    expect(await designPuppet.getAttribute('data-three-rendered-layer-labels'), `${type} design rendered labels match fabrication stack labels`).toBe(await designPuppet.getAttribute('data-three-stack-order'));
    const designRenderedZ = await designPuppet.getAttribute('data-three-rendered-layer-z') ?? '';
    const designStackZ = await designPuppet.getAttribute('data-three-stack-z') ?? '';
    if (type === 'gear' || type === 'gear_linkage') {
      await expect(designPuppet, `${type} design preview keeps meshing gear plates coplanar`).toHaveAttribute('data-three-gear-plane-mode', 'coplanar-fixed-axles');
      expect(designRenderedZ, `${type} design render uses a coplanar gear pitch plane instead of the linear stack z for gear plates`).not.toBe(designStackZ);
    } else {
      expect(designRenderedZ, `${type} design rendered z order matches fabrication stack z order`).toBe(designStackZ);
    }
    expect(Number(await designPuppet.getAttribute('data-three-spacer-z-gap')), `${type} design preview has spacer clearance along z`).toBeGreaterThanOrEqual(FABRICATION_RENDER_LAYER_Z_STEP - 0.01);
    await expect.poll(async () => Number(await designPuppet.getAttribute('data-three-scene-object-count')), { message: `${type} adds visible WebGL mechanism geometry to the center workspace` }).toBeGreaterThan(60);
    for (const [attr, minimumCount] of centerPhysicalMarkers[type]) {
      expect(Number(await designPuppet.getAttribute(attr)), `${type} center preview includes ${attr}`).toBeGreaterThanOrEqual(before[attr] + minimumCount);
    }
    if (type === 'planetary_gear') {
      await expect(designPuppet, 'Design preview shares the fixed-ring planetary gear syntax').toHaveAttribute('data-three-planetary-syntax', 'ring-fixed-sun-input-carrier-output');
      await expect(designPuppet).toHaveAttribute('data-three-planetary-output', 'carrier');
      await expect(designPuppet, 'Carrier linkage is drilled as the nearest fabrication linkage blank for the actual carrier radius').toHaveAttribute('data-three-linkage-hole-counts', /driver:3/);
      await expect(designPuppet, 'Carrier linkage uses the generator-supported 2-cell blank for its actual radius').toHaveAttribute('data-three-linkage-template-cells', /driver:2/);
      await expect(designPuppet, 'Linkage holes preserve the fabrication generator pitch instead of stretching to arbitrary scene distance').toHaveAttribute('data-three-linkage-hole-spacing-mm', /driver:20\.00/);
    }
  }

  expect(Number(await designPuppet.getAttribute('data-three-physical-template-count')), 'Center workspace tracks physical templates, not dummy overlays').toBeGreaterThanOrEqual(7);
  await expect(designPuppet, 'Preview advertises exactly the reference authorable mechanism types').toHaveAttribute('data-three-supported-mechanism-types', '4bar,piston,cam,gear,gear_linkage,planetary_gear');
  await expect.poll(async () => Number(await designPuppet.getAttribute('data-three-render-triangles')), { message: 'center WebGL renderer draws real 3D fabrication triangles' }).toBeGreaterThan(0);

  const numAttr = async (attr: string) => Number(await designPuppet.getAttribute(attr));
  const readTelemetry = async () => designPuppet.evaluate((el: HTMLElement) => ({
    primary: Number(el.getAttribute('data-three-primary-rotation-deg') ?? '0'),
    secondary: Number(el.getAttribute('data-three-secondary-rotation-deg') ?? '0'),
    gearRatio: Number(el.getAttribute('data-three-gear-output-ratio') ?? '0'),
    secondarySpeed: Number(el.getAttribute('data-three-secondary-speed') ?? '0'),
    rackX: Number(el.getAttribute('data-three-rack-x') ?? '0'),
    rackY: Number(el.getAttribute('data-three-rack-y') ?? '0')
  }));
  const deltaDeg = (current: number, start: number) => {
    let delta = current - start;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return delta;
  };
  const circularDeltaError = (actual: number, expected: number) => Math.abs(deltaDeg(actual, expected));
  const waitForPrimaryMotionSample = async (start: number, message: string) => {
    let motionSample = await readTelemetry();
    await expect.poll(async () => {
      let maxDelta = 0;
      for (let sample = 0; sample < 6; sample += 1) {
        const telemetry = await readTelemetry();
        const delta = Math.abs(deltaDeg(telemetry.primary, start));
        if (delta > maxDelta) {
          maxDelta = delta;
          motionSample = telemetry;
        }
        if (maxDelta > 6) break;
        await page.waitForTimeout(90);
      }
      return maxDelta;
    }, { message, timeout: 60_000 }).toBeGreaterThan(6);
    return motionSample;
  };
  const stageTransportButton = () => page.getByTestId('stage-left-pane').getByRole('button', { name: /Play|Pause/ }).first();
  const ensureDesignPaused = async () => {
    const button = stageTransportButton();
    if (((await button.textContent()) ?? '').includes('Pause')) await button.click();
    await expect(button).toContainText('Play');
  };
  const ensureDesignPlaying = async () => {
    const button = stageTransportButton();
    if (((await button.textContent()) ?? '').includes('Play')) await button.click();
    await expect(button).toContainText('Pause');
  };
  const setWorkspaceScrubber = async (percent: number) => {
    const scrubber = page.getByLabel('Workspace scrubber');
    await scrubber.evaluate((input, value) => {
      const el = input as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, percent);
    await expect(scrubber).toHaveValue(String(percent));
  };
  const scrubToMotionSample = async (fromPercent: number, toPercent: number, message: string) => {
    await ensureDesignPaused();
    await setWorkspaceScrubber(fromPercent);
    const startTelemetry = await readTelemetry();
    await setWorkspaceScrubber(toPercent);
    let motionSample = await readTelemetry();
    await expect.poll(async () => {
      motionSample = await readTelemetry();
      return Math.abs(deltaDeg(motionSample.primary, startTelemetry.primary));
    }, { message, timeout: 60_000 }).toBeGreaterThan(6);
    return { startTelemetry, motionSample };
  };
  await ensureDesignPaused();
  await page.getByRole('button', { name: 'gear', exact: true }).click();
  await expect(designPuppet).toHaveAttribute('data-three-selected-mechanism-type', 'gear');
  const { startTelemetry: gearStartTelemetry, motionSample: gearTelemetry } = await scrubToMotionSample(10, 20, 'gear scrubber updates the selected central 3D preview');
  const gearStart = gearStartTelemetry.primary;
  const gearSecondaryStart = gearStartTelemetry.secondary;
  const gearPrimaryDelta = deltaDeg(gearTelemetry.primary, gearStart);
  const gearSecondaryDelta = deltaDeg(gearTelemetry.secondary, gearSecondaryStart);
  expect(circularDeltaError(gearSecondaryDelta, gearPrimaryDelta * gearTelemetry.gearRatio), 'gear train rotates by the live physical pitch-radius ratio').toBeLessThan(1.25);

  await page.getByRole('button', { name: 'gear_linkage', exact: true }).click();
  await expect(designPuppet).toHaveAttribute('data-three-selected-mechanism-type', 'gear_linkage');
  await expect(designPuppet).toHaveAttribute('data-three-gear-linkage-mode', 'two-gear-two-link-coupler');
  await expect(designPuppet).toHaveAttribute('data-three-linkage-pin-radius', '40.00');
  const { startTelemetry: gearLinkageStartTelemetry, motionSample: gearLinkageTelemetry } = await scrubToMotionSample(10, 20, 'gear-linkage scrubber updates output gear crank linkage');
  const gearLinkagePrimaryDelta = deltaDeg(gearLinkageTelemetry.primary, gearLinkageStartTelemetry.primary);
  const gearLinkageSecondaryDelta = deltaDeg(gearLinkageTelemetry.secondary, gearLinkageStartTelemetry.secondary);
  expect(circularDeltaError(gearLinkageSecondaryDelta, gearLinkagePrimaryDelta * gearLinkageTelemetry.gearRatio), 'gear-linkage output gear rotates by the live physical pitch-radius ratio').toBeLessThan(1.25);

  expectCleanPage(pageErrors, consoleErrors);
});

test('Simplified shared canvas stays non-destructive and exports blueprint', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const saveSnapshot = async () => {
    await page.getByTestId('top-command-bar').getByText('File', { exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('command-download-snapshot').click()
    ]);
    const path = await download.path();
    expect(path, 'project save path').toBeTruthy();
    return JSON.parse(await readFile(path!, 'utf8'));
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await openWavingArmTemplate(page);

  await expect(page.getByTestId('view-lens-hud')).toHaveCount(0);
  await expect(page.getByTestId('toon-renderer-shell')).toHaveCount(0);
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await expect(page.getByTestId('path-canvas')).toHaveCount(0);
  await page.getByTestId('path-view-2d').click();
  await expect(page.getByTestId('path-canvas')).toBeVisible();
  await expect(page.getByTestId('path-three-puppet-canvas')).toHaveCount(0);
  await page.getByTestId('path-view-3d').click();
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await expect(page.getByTestId('path-canvas')).toHaveCount(0);
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('100%');

  const before = await saveSnapshot();

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('design-canvas')).toBeVisible();
  await expect(page.getByTestId('view-lens-hud')).toHaveCount(0);
  await expect(page.getByTestId('toon-renderer-shell')).toHaveCount(0);

  const after = await saveSnapshot();
  expect(after.parts).toEqual(before.parts);
  expect(after.skeleton).toEqual(before.skeleton);
  expect(after.paths).toEqual(before.paths);
  expect(after.mechanisms).toEqual(before.mechanisms);
  expect(after.settings).toEqual(before.settings);
  expect(after.lastExport).toEqual(before.lastExport);

  await page.setViewportSize({ width: 390, height: 820 });
  await expect(page.getByTestId('stage-canvas-pane')).toBeVisible();
  await expect(page.getByTestId('view-lens-hud')).toHaveCount(0);
  await expect(page.getByTestId('toon-renderer-shell')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 4)).toBe(true);

  await page.setViewportSize({ width: 899, height: 720 });
  await page.getByRole('button', { name: 'Path' }).click();
  const leftBox = await page.getByTestId('stage-left-pane').boundingBox();
  const centerBox = await page.getByTestId('stage-canvas-pane').boundingBox();
  const rightBox = await page.getByTestId('stage-right-inspector').boundingBox();
  expect(leftBox).toBeTruthy();
  expect(centerBox).toBeTruthy();
  expect(rightBox).toBeTruthy();
  expect(centerBox!.y, 'single-column center follows left workflow').toBeGreaterThan(leftBox!.y);
  expect(rightBox!.y, 'single-column inspector follows center canvas').toBeGreaterThan(centerBox!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 4)).toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await applyFourBarFromFoundry(page);
  await clickStage(page, 'Blueprint');
  await expect(page.getByRole('heading', { name: 'Blueprint' })).toBeVisible();
  await expect(page.getByTestId('blueprint-canvas-preview')).toBeVisible();
  await page.getByRole('button', { name: /Generate package/i }).click();
  await expect(page.getByTestId('blueprint-detail-preview')).toContainText('Cut sheet');
  await expect(page.getByTestId('blueprint-svg-preview')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Metadata', exact: true })).toBeVisible();

  expectCleanPage(pageErrors, consoleErrors);
});

test('Shared path view supports 2D zoom and 3D direct orbit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await openWavingArmTemplate(page);

  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  const canvas = page.getByTestId('path-three-puppet-canvas');
  const box = await canvas.boundingBox();
  expect(box, 'path 3D canvas can receive direct viewport gestures').toBeTruthy();
  const zoomBefore = await page.getByTestId('canvas-zoom-readout').textContent();
  const state = page.getByTestId('path-three-puppet-state');
  const cameraZoomBefore = await state.getAttribute('data-camera-zoom');

  await page.mouse.move(box!.x + box!.width * 0.22, box!.y + box!.height * 0.22);
  await page.mouse.wheel(0, -500);
  await expect(page.getByTestId('canvas-zoom-readout')).not.toHaveText(zoomBefore ?? '100%');
  await expect(state).not.toHaveAttribute('data-camera-zoom', cameraZoomBefore ?? '1.000');

  const yawBefore = Number(await state.getAttribute('data-camera-yaw'));
  await page.mouse.move(box!.x + box!.width * 0.18, box!.y + box!.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.31, box!.y + box!.height * 0.28, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs(Number(await state.getAttribute('data-camera-yaw')) - yawBefore)).toBeGreaterThan(1);

  await page.getByTestId('path-view-2d').click();
  await expect(page.getByTestId('path-view-2d')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('path-canvas')).toBeVisible();
  await expect(page.getByTestId('path-three-puppet-state')).toHaveCount(0);
  const svgCanvas = page.getByTestId('path-canvas');
  const svgBox = await svgCanvas.boundingBox();
  expect(svgBox, 'path 2D SceneSketch can receive direct viewport gestures').toBeTruthy();
  const viewBoxBefore = await svgCanvas.getAttribute('viewBox');
  await page.mouse.move(svgBox!.x + svgBox!.width * 0.52, svgBox!.y + svgBox!.height * 0.45);
  await page.mouse.wheel(0, -360);
  await expect(svgCanvas).not.toHaveAttribute('viewBox', viewBoxBefore ?? '');
});

test('Draw mode forces 2D Path view and accepts free path strokes on SceneSketch', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByTestId('path-view-3d').click();
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Draw free path', exact: true })).toHaveClass(/btn-secondary/);
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Drawing free path', exact: true })).toHaveClass(/btn-primary active/);
  await expect(page.getByTestId('path-view-2d')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('path-canvas')).toBeVisible();
  await expect(page.getByTestId('path-three-puppet-canvas')).toHaveCount(0);
  await expect(page.locator('[data-testid="path-canvas"], [data-testid="path-three-puppet-canvas"]')).toHaveCount(1);

  await expect(page.getByTestId('view-lens-hud')).toHaveCount(0);
  await expect(page.getByTestId('toon-renderer-shell')).toHaveCount(0);

  const beforeDraw = Number((await page.getByTestId('free-draw-status').textContent())?.match(/^(\d+)/)?.[1] ?? 0);
  const canvasBox = await page.getByTestId('path-canvas').boundingBox();
  expect(canvasBox, 'path canvas box').toBeTruthy();

  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.45, canvasBox!.y + canvasBox!.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.45 + 34, canvasBox!.y + canvasBox!.height * 0.45 + 22, { steps: 4 });
  await page.mouse.up();

  await expect.poll(async () =>
    Number((await page.getByTestId('free-draw-status').textContent())?.match(/^(\d+)/)?.[1] ?? 0),
    { message: 'draw mode accepts pointer input on simplified canvas' }
  ).toBeGreaterThan(beforeDraw);
});
