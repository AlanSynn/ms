import { expect, test, type Locator, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLASSROOM_LESSONS, createLessonProject, serializeProject } from '../../utils/project';
import { APP_COMMANDS, APP_MENU_GROUPS, commandById, type AppCommandId } from '../../utils/appCommands';
import { FOUNDRY_MECHANISM_TYPES } from '../../utils/mechanismTemplates';
import type { ConnectionSelectionRole, Point } from '../../types';


const TEST_ONNX_MODEL_BYTES = Buffer.alloc(1_000_001, 1);
const ONNX_MODEL_ROUTE = '**/onnx/pose_model.onnx';

const EXPECTED_COMPILED_SUPPORT_PATH_KINDS: Record<string, string> = {
  '4bar': 'input-length:linkage>spacer>clip;coupler-length+input-length:clip>linkage>spacer>linkage>clip;coupler-length+output-length:clip>linkage>spacer>linkage>clip;output-length:linkage>spacer>clip',
  piston: 'slider-guide:guide>guide;crank-length:linkage>spacer>clip;crank-length+rod-length:clip>linkage>spacer>linkage>clip;rod-length:clip>linkage>spacer>guide>clip',
  cam: 'cam-follower-contact:cam>follower;follower-guide-slide:follower>guide;cam-axle-fixed:linkage>spacer>spacer>spacer>cam>clip',
  gear: 'gear-0:gear>spacer>clip;gear-1:gear>spacer>clip',
  gear_linkage: 'drive-connector-length:gear>spacer>linkage>clip;drive-connector-length+output-connector-length:clip>linkage>spacer>linkage>clip;output-connector-length:gear>spacer>spacer>spacer>spacer>clip>linkage>clip',
  planetary_gear: 'sun-carrier-pivot-pin:gear>spacer>linkage>clip;planet-carrier-pin:clip>gear>spacer>linkage>clip;ring-gear:gear>spacer>clip'
};

const EXPECTED_COMPILED_PIN_COUNTS: Record<string, number> = {
  '4bar': 4,
  piston: 3,
  cam: 1,
  gear: 2,
  gear_linkage: 3,
  planetary_gear: 3
};

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.includes('Create from image upload')) return;
  await page.route(ONNX_MODEL_ROUTE, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'content-length': String(TEST_ONNX_MODEL_BYTES.length) },
      body: TEST_ONNX_MODEL_BYTES,
    });
  });
});

const expectCleanPage = (pageErrors: string[], consoleErrors: string[]) => {
  expect(pageErrors, 'no uncaught browser exceptions').toEqual([]);
  expect(consoleErrors, 'no browser console errors').toEqual([]);
};

const FOUNDRY_RENDER_CONTRACT_ATTRS = [
  'data-mechanism-type',
  'data-three-stack-order',
  'data-three-stack-layer-count',
  'data-three-stack-roles',
  'data-three-stack-colors',
  'data-three-rendered-layer-labels',
  'data-three-rendered-layer-roles',
  'data-three-rendered-layer-colors',
  'data-three-geometry-contract',
  'data-three-physical-pin-contract',
  'data-three-pin-stack-policy',
  'data-three-spacer-mm',
] as const;

type FoundryRenderContractAttr = (typeof FOUNDRY_RENDER_CONTRACT_ATTRS)[number];
type FoundryRenderContract = Record<FoundryRenderContractAttr, string | null>;

const readFoundryRenderContract = async (rig: Locator): Promise<FoundryRenderContract> =>
  Object.fromEntries(
    await Promise.all(
      FOUNDRY_RENDER_CONTRACT_ATTRS.map(async attr => [attr, await rig.getAttribute(attr)]),
    ),
  ) as FoundryRenderContract;

const expectFoundryRenderContract = async (
  rig: Locator,
  contract: FoundryRenderContract,
  label: string,
) => {
  for (const attr of FOUNDRY_RENDER_CONTRACT_ATTRS) {
    await expect(rig, `${label}: ${attr}`).toHaveAttribute(attr, contract[attr] ?? '');
  }
};

const trophyObjectFile = (name = 'class-trophy.svg') => ({
  name,
  mimeType: 'image/svg+xml',
  buffer: Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="96" height="120" viewBox="0 0 96 120">
      <rect width="96" height="120" fill="white"/>
      <path d="M28 16h40v14c0 18-10 30-20 32-10-2-20-14-20-32V16z" fill="#f59e0b"/>
      <path d="M20 24h8c0 16 6 24 16 28M76 24h-8c0 16-6 24-16 28" fill="none" stroke="#b45309" stroke-width="8" stroke-linecap="round"/>
      <rect x="42" y="62" width="12" height="28" fill="#d97706"/>
      <path d="M30 90h36l6 16H24z" fill="#92400e"/>
    </svg>
  `),
});

const addTrophyObject = async (page: Page, label = 'Class trophy') => {
  await expect(page.getByTestId('character-add-scene-object')).toContainText('Add object');
  await page.getByTestId('scene-object-image-input').setInputFiles(trophyObjectFile());
  const inspector = page.getByTestId('scene-object-inspector');
  await expect(inspector).toContainText('class-trophy');
  await expect(inspector).toContainText('Size · use Scale');
  await expect(inspector.getByLabel('Width number')).toHaveCount(0);
  await expect(inspector.getByLabel('Height number')).toHaveCount(0);
  await inspector.getByLabel('Object name').fill(label);
  await inspector.getByLabel('X number').fill('-160');
  await inspector.getByLabel('Y number').fill('0');
  await expect(inspector).toContainText(label);
};

type ThreeScreenTarget = {
  id: string;
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  radius: number;
  visible: boolean;
};

const readJsonAttribute = async <T>(locator: Locator, attribute: string, fallback: T): Promise<T> => {
  const value = await locator.getAttribute(attribute);
  return value ? JSON.parse(value) as T : fallback;
};

const readThreeScreenTargets = <T extends ThreeScreenTarget = ThreeScreenTarget>(locator: Locator, attribute: string) =>
  readJsonAttribute<T[]>(locator, attribute, []);

const waitForThreeSceneObjectTarget = async (locator: Locator, objectId: string) => {
  let target: ThreeScreenTarget | undefined;
  await expect.poll(async () => {
    const targets = await readThreeScreenTargets(locator, 'data-three-scene-object-screen-targets');
    target = targets.find(item => item.id === objectId && item.visible);
    return target?.id ?? '';
  }, { message: `3D screen target is available for ${objectId}` }).toBe(objectId);
  return target!;
};

const waitForThreeMechanismTarget = async (locator: Locator, mechanismId: string) => {
  let target: ThreeScreenTarget | undefined;
  await expect.poll(async () => {
    const targets = await readThreeScreenTargets(locator, 'data-three-mechanism-screen-targets');
    target = targets.find(item => item.id === mechanismId && item.visible);
    return target?.id ?? '';
  }, { message: `3D screen target is available for mechanism ${mechanismId}` }).toBe(mechanismId);
  return target!;
};

const waitForThreePartTarget = async (locator: Locator, partId: string) => {
  let target: ThreeScreenTarget | undefined;
  await expect.poll(async () => {
    const targets = await readThreeScreenTargets(locator, 'data-three-part-screen-targets');
    target = targets.find(item => item.id === partId && item.visible);
    return target?.id ?? '';
  }, { message: `3D screen target is available for part ${partId}` }).toBe(partId);
  return target!;
};

const clickableThreeTargetPoint = async (page: Page, target: ThreeScreenTarget, hostTestId: string) =>
  page.evaluate(({ target, hostTestId }) => {
    const xs = [
      target.x,
      (target.left + target.right) / 2,
      target.left + Math.min(22, Math.max(8, (target.right - target.left) * 0.22)),
      target.right - Math.min(22, Math.max(8, (target.right - target.left) * 0.22)),
    ];
    const ys = [
      target.y,
      (target.top + target.bottom) / 2,
      target.top + Math.min(22, Math.max(8, (target.bottom - target.top) * 0.22)),
      target.bottom - Math.min(22, Math.max(8, (target.bottom - target.top) * 0.22)),
    ];
    for (const y of ys) {
      for (const x of xs) {
        const element = document.elementFromPoint(x, y);
        if (element?.closest(`[data-testid="${hostTestId}"]`)) return { x, y };
      }
    }
    return { x: target.x, y: target.y };
  }, { target, hostTestId });

const readBlueprintPackage = async (page: Page) => {
  const packageJson = await page.getByTestId('blueprint-export-package-json').textContent();
  expect(packageJson, 'generated package is exposed through a hidden Blueprint harness seam').toBeTruthy();
  return JSON.parse(packageJson!);
};

const downloadMetadataJson = async (page: Page) => {
  const exportedPackage = await readBlueprintPackage(page);
  expect(exportedPackage.metadataJson, 'export metadata is included in the generated package').toBeTruthy();
  return JSON.parse(exportedPackage.metadataJson);
};

const openBlueprintMoreFiles = async (page: Page) => {
  const panel = page.getByTestId('blueprint-control-panel');
  const details = panel.locator('details.blueprint-more-exports').first();
  if (!(await details.count())) return;
  const isOpen = await details.evaluate((element: HTMLDetailsElement) => element.open);
  if (!isOpen) await details.locator('summary').click();
};

const waitForBootLoader = async (page: Page) => {
  await expect(page.locator('#boot-loader'), 'static boot loader releases after AI model warmup').toHaveCount(0, { timeout: 180_000 });
};

const openCharacterScreen = async (page: Page, options: { loadStarter?: boolean } = { loadStarter: true }) => {
  await waitForBootLoader(page);
  let dialog = page.getByTestId('getting-started-dialog');
  if (!(await dialog.count()) && options.loadStarter !== false) {
    await page.getByRole('button', { name: /Open Getting Started/i }).click();
    dialog = page.getByTestId('getting-started-dialog');
    await expect(dialog).toBeVisible();
  }
  if (await dialog.count()) {
    if (options.loadStarter !== false) {
      let starterRig = dialog.getByRole('button', { name: /Open starter rig/i });
      if (!(await starterRig.count())) {
        const startersToggle = dialog.getByRole('button', { name: 'Starters', exact: true });
        if (await startersToggle.count()) await startersToggle.click();
        starterRig = dialog.getByRole('button', { name: /Open starter rig/i });
      }
      await starterRig.click();
    } else {
      let close = dialog.getByRole('button', { name: 'Close', exact: true });
      if (!(await close.count())) {
        const startersToggle = dialog.getByRole('button', { name: 'Starters', exact: true });
        if (await startersToggle.count()) await startersToggle.click();
        close = dialog.getByRole('button', { name: 'Close', exact: true });
      }
      await close.click();
    }
  }
  if (!(await page.getByTestId('character-screen').count())) {
    await page.getByRole('button', { name: /^Character$/i }).click();
  }
  await expect(page.getByTestId('character-screen')).toBeVisible();
};

const switchGettingStartedToStarters = async (page: Page) => {
  const dialog = page.getByTestId('getting-started-dialog');
  const startersToggle = dialog.getByRole('button', { name: 'Starters', exact: true });
  if (await startersToggle.count()) await startersToggle.click();
  await expect(dialog.getByTestId('getting-started-gallery')).toBeVisible();
};

test('Context help opens compact registry popovers', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openCharacterScreen(page, { loadStarter: false });
  const controls = page.getByTestId('character-import-controls');
  await expect(controls).not.toContainText('Keep mechanisms');
  await expect(controls).toContainText('Getting Started');
  await expect(controls).toContainText('Add object');
  const controlsBefore = await controls.boundingBox();
  const imageHelp = page.locator('[data-help-id="character.createFromImage"]').getByTestId('context-help-trigger');
  await expect(imageHelp).toBeVisible();
  await imageHelp.click();
  const popover = page.getByTestId('context-help-popover');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('Turn one picture');
  await expect(imageHelp).toHaveAttribute('aria-expanded', 'true');
  const controlsAfter = await controls.boundingBox();
  expect(Math.abs((controlsAfter?.height ?? 0) - (controlsBefore?.height ?? 0)), 'tooltip overlay does not change import control height').toBeLessThan(1);
  expect(Math.abs((controlsAfter?.y ?? 0) - (controlsBefore?.y ?? 0)), 'tooltip overlay does not move import controls').toBeLessThan(1);
  expect(await popover.evaluate(node => Boolean(node.parentElement?.matches('body'))), 'tooltip popover is portaled to body').toBe(true);
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);

  await page.setViewportSize({ width: 980, height: 360 });
  await page.getByRole('button', { name: /^Options$/i }).click();
  const inspector = page.getByTestId('stage-right-inspector');
  await expect(inspector).toBeVisible();
  await inspector.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const lowerHelp = page
    .locator('[data-help-id="options.strictChecks"]')
    .getByTestId('context-help-trigger');
  await lowerHelp.scrollIntoViewIfNeeded();
  await lowerHelp.click();
  await expect(popover).toBeVisible();
  const lowerBox = await popover.boundingBox();
  expect(lowerBox?.y ?? -1, 'lower tooltip stays inside the top viewport edge').toBeGreaterThanOrEqual(0);
  expect(
    (lowerBox?.y ?? 0) + (lowerBox?.height ?? 0),
    'lower tooltip flips or clamps inside the bottom viewport edge',
  ).toBeLessThanOrEqual(360);
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);

  expectCleanPage(pageErrors, consoleErrors);
});

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
  await expect(page.getByTestId('part-cut-summary')).toContainText(/cut/i);
  await expect(page.getByTestId('part-cut-summary')).not.toContainText(/pts/i);

  await page.getByTestId('part-cut-bake').click();
  const cutDialog = page.getByTestId('cut-outline-dialog');
  await expect(cutDialog).toBeVisible();
  const cutArt = cutDialog.getByTestId('cut-outline-art');
  await expect(cutArt).toBeVisible();
  await expect(cutArt).toHaveAttribute('href', /data:image/);
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
  const parseViewBox = async () => {
    const viewBox = await canvas.getAttribute('viewBox');
    if (!viewBox) throw new Error('Missing cut editor viewBox');
    const [minX, minY, width, height] = viewBox.split(/\s+/).map(Number);
    return { minX, minY, width, height };
  };
  const initialView = await parseViewBox();
  await cutDialog.getByTestId('cut-outline-zoom-in').click();
  await expect.poll(async () => (await parseViewBox()).width, {
    message: 'cut editor zoom-in tightens the editable view',
  }).toBeLessThan(initialView.width);
  const zoomedView = await parseViewBox();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Missing cut editor canvas metrics');
  await expect(canvas).toHaveAttribute('data-cut-tool', 'edit');
  await expect(cutDialog.getByTestId('cut-tool-hint')).toContainText('Drag a point');
  await cutDialog.getByTestId('cut-tool-pan').click();
  await expect(canvas).toHaveAttribute('data-cut-tool', 'pan');
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.45, canvasBox.y + canvasBox.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.58, canvasBox.y + canvasBox.height * 0.52);
  await page.mouse.up();
  await expect.poll(async () => (await parseViewBox()).minX, {
    message: 'blank-canvas drag pans instead of moving a cut point',
  }).not.toBe(zoomedView.minX);
  await cutDialog.getByTestId('cut-outline-fit').click();
  await expect.poll(async () => (await parseViewBox()).width, {
    message: 'fit restores the classroom-friendly part view',
  }).toBeGreaterThan(zoomedView.width);
  await cutDialog.getByTestId('cut-tool-edit').click();
  await expect(canvas).toHaveAttribute('data-cut-tool', 'edit');
  const editedPoint = cutDialog.getByTestId('cut-outline-point-1');
  const beforeClickX = Number(await editedPoint.getAttribute('cx'));
  await canvas.click({ position: { x: 260, y: 140 } });
  await expect.poll(async () => Number(await editedPoint.getAttribute('cx')), { message: 'canvas click moves the selected cut point' }).not.toBe(beforeClickX);
  const pointCountBeforeDraw = await cutDialog.locator('[data-testid^="cut-outline-point-"]').count();
  await cutDialog.getByTestId('cut-tool-draw').click();
  await expect(canvas).toHaveAttribute('data-cut-tool', 'draw');
  await expect(cutDialog.getByTestId('cut-tool-hint')).toContainText('one clean loop');
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.42, canvasBox.y + canvasBox.height * 0.28);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.52, canvasBox.y + canvasBox.height * 0.24, { steps: 3 });
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.58, canvasBox.y + canvasBox.height * 0.38, { steps: 3 });
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.46, canvasBox.y + canvasBox.height * 0.48, { steps: 3 });
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.39, canvasBox.y + canvasBox.height * 0.35, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => cutDialog.locator('[data-testid^="cut-outline-point-"]').count(), {
    message: 'Draw cut replaces the contour with a one-stroke student outline',
  }).not.toBe(pointCountBeforeDraw);
  await cutDialog.getByRole('button', { name: 'Done' }).click();
  await expect(cutDialog).toHaveCount(0);

  const puppet = page.getByTestId('character-three-puppet-state');
  await expect(puppet).toHaveAttribute('data-part-outline-mode', 'model-or-user-contour-with-fabrication-fallback');
  await expect.poll(async () => Number(await puppet.getAttribute('data-three-render-triangles')), { message: 'edited cut contour still renders as 3D solid plates' }).toBeGreaterThan(0);
  expectCleanPage(pageErrors, consoleErrors);
});

test('Character tab owns separate scene objects and later tabs only render them', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openCharacterScreen(page, { loadStarter: false });
  await expect(page.getByTestId('character-scene-object-list')).toBeVisible();
  await expect(page.getByTestId('character-workflow-summary')).toContainText('0 objects');
  await addTrophyObject(page, 'Class trophy');
  await expect(page.getByTestId('character-workflow-summary')).toContainText('1 objects');
  const characterPuppet = page.getByTestId('character-three-puppet-state');
  await expect(characterPuppet).toHaveAttribute('data-scene-object-count', '1');
  await expect(characterPuppet).toHaveAttribute('data-three-scene-prop-count', '1');

  let discardMessage = '';
  page.once('dialog', async dialog => {
    discardMessage = dialog.message();
    await dialog.dismiss();
  });
  await page.getByTestId('top-command-bar').getByText('File', { exact: true }).click();
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  expect(discardMessage).toContain('Discard current project');
  await expect(page.getByTestId('status-bar')).toContainText('Cancelled');

  page.once('dialog', async dialog => dialog.accept());
  await page.getByTestId('top-command-bar').getByText('File', { exact: true }).click();
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  await expect(page.getByTestId('status-bar')).toContainText('New project');

  await openCharacterScreen(page);
  await addTrophyObject(page, 'Class trophy');

  await page.getByRole('button', { name: 'Path Editor', exact: true }).click();
  await expect(page.getByTestId('character-add-scene-object')).toHaveCount(0);
  const pathTarget = page.getByLabel('Motion target');
  await expect(pathTarget).toContainText('Class trophy');
  await pathTarget.selectOption({ label: 'Class trophy' });
  const sceneObjectId = await pathTarget.evaluate((select: HTMLSelectElement) => select.value);
  const sceneObjectPathId = `path-${sceneObjectId}`;
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByTestId('path-view-2d')).toHaveAttribute('aria-pressed', 'true');
  const objectPathCanvas = page.getByTestId('path-canvas');
  const objectPathBox = await objectPathCanvas.boundingBox();
  expect(objectPathBox, 'object path canvas box').toBeTruthy();
  await page.mouse.move(objectPathBox!.x + objectPathBox!.width * 0.42, objectPathBox!.y + objectPathBox!.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(objectPathBox!.x + objectPathBox!.width * 0.5, objectPathBox!.y + objectPathBox!.height * 0.37, { steps: 4 });
  await page.mouse.move(objectPathBox!.x + objectPathBox!.width * 0.58, objectPathBox!.y + objectPathBox!.height * 0.42, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
  await expect(page.locator('[data-testid^="path-scene-object-art-"]')).toBeVisible();
  await page.getByTestId('path-view-3d').click();
  const pathPuppet = page.getByTestId('path-three-puppet-state');
  await expect(pathPuppet).toHaveAttribute('data-scene-object-count', '1');
  await expect(pathPuppet).toHaveAttribute('data-three-scene-prop-count', '1');
  await expect(pathPuppet).toHaveAttribute('data-three-selected-path-id', sceneObjectPathId);
  await expect(page.getByRole('button', { name: 'Add object', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Mechanism Design', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await page.getByRole('button', { name: 'Four-bar linkage', exact: true }).click();
  const objectDesignPreview = page.getByTestId('design-shared-foundry-preview');
  await expect(objectDesignPreview).toBeVisible();
  await expect(page.getByLabel('Mechanism target')).toHaveValue(`object:${sceneObjectId}`);
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue(sceneObjectPathId);
  await expect(objectDesignPreview).toHaveAttribute('data-design-animated-object-count', /[1-9]/);
  const designPuppet = objectDesignPreview.getByTestId('foundry-camera-rig');
  await expect(designPuppet).toHaveAttribute('data-scene-object-count', '1');
  await expect(designPuppet).toHaveAttribute('data-three-scene-prop-count', '1');
  await page.getByRole('button', { name: 'Character', exact: true }).click();
  await page.getByTestId('character-part-item-head').click();
  await page.getByRole('button', { name: 'Mechanism Design', exact: true }).click();
  await expect(designPuppet).toHaveAttribute('data-selected-scene-object-id', '');
  const designPlayer = page.getByTestId('workspace-player-dock');
  await expect(designPlayer).toBeVisible();
  const designPause = designPlayer.getByRole('button', { name: 'Pause', exact: true });
  if (await designPause.isVisible()) await designPause.click();
  await designPlayer.getByRole('button', { name: 'Start over', exact: true }).click();
  const objectCanvasBox = await objectDesignPreview.locator('canvas.foundry-three-canvas').boundingBox();
  expect(objectCanvasBox, 'design Foundry canvas supports object picking').toBeTruthy();
  await expect.poll(async () =>
    designPuppet.evaluate((el, id) => {
      const targets = JSON.parse((el as HTMLElement).dataset.threeSceneObjectScreenTargets || '[]') as Array<{ id: string; x: number; y: number; visible: boolean }>;
      return Boolean(targets.find((target) => target.id === id && target.visible));
    }, sceneObjectId),
    { message: 'Design exposes a clickable screen target for the scene object' },
  ).toBe(true);
  const objectTarget = await designPuppet.evaluate((el, id) => {
    const targets = JSON.parse((el as HTMLElement).dataset.threeSceneObjectScreenTargets || '[]') as Array<{ id: string; x: number; y: number; visible: boolean }>;
    return targets.find((target) => target.id === id && target.visible) ?? null;
  }, sceneObjectId);
  expect(objectTarget, 'design Foundry canvas exposes object screen target').toBeTruthy();
  const designClick = { x: objectTarget!.x, y: objectTarget!.y };
  await page.mouse.click(designClick.x, designClick.y);
  await expect(designPuppet).toHaveAttribute('data-selected-scene-object-id', sceneObjectId);
  const designFoundryRig = page.getByTestId('design-shared-foundry-preview').getByTestId('foundry-camera-rig');
  const yawBefore = await designFoundryRig.getAttribute('data-camera-yaw');
  await page.mouse.move(designClick.x, designClick.y);
  await page.mouse.down();
  await page.mouse.move(designClick.x + 70, designClick.y + 4, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => await designFoundryRig.getAttribute('data-camera-yaw'), { message: 'Design context selection layer routes orbit drags to the Foundry camera' }).not.toBe(yawBefore);
  await expect(page.getByRole('button', { name: 'Add object', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('scene-object-inspector')).toHaveCount(0);
  for (const stageName of ['Foundry', 'Blueprint', 'Assembly']) {
    await clickStage(page, stageName);
    await expect(page.getByTestId('character-add-scene-object')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add object', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('scene-object-inspector')).toHaveCount(0);
  }

  expectCleanPage(pageErrors, consoleErrors);
});

test('Getting Started guided project opens a real editable lesson', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await waitForBootLoader(page);
  const gettingStarted = page.getByTestId('getting-started-dialog');
  await expect(gettingStarted).toBeVisible();
  await expect(gettingStarted.getByTestId('getting-started-hide-session')).toContainText("Don't show again this session");
  await expect(gettingStarted).toContainText('Start.');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).toBeVisible();
  await gettingStarted.getByTestId('getting-started-card-guided').click();
  await expect(gettingStarted).toContainText('Pick a project.');
  await expect(gettingStarted.getByTestId('guided-project-library')).toBeVisible();
  const wavingCard = gettingStarted.getByTestId('guided-project-card-waving-arm');
  await expect(wavingCard).toContainText('Make a hand wave');
  await expect(wavingCard.getByTestId('guided-project-preview-waving-arm')).toBeVisible();
  await expect(wavingCard.getByTestId('guided-project-preview-waving-arm')).toHaveAttribute('data-preview-mode', 'rendered-character-motion');
  await expect(wavingCard.getByTestId('guided-project-preview-waving-arm').locator('svg')).toHaveAttribute('data-motion-preview', 'character-path');
  await expect(wavingCard).toContainText('Change hand path');
  await expect(wavingCard).toContainText('Build four-bar');
  await expect(wavingCard).not.toContainText('Crank turns');
  await expect(wavingCard).toHaveAttribute('data-direct-translation', 'Crank turns -> rocker swings');
  await expect(wavingCard).toHaveAttribute('data-evidence-cue', 'right hand follows the rocker arc');
  await expect(wavingCard).toHaveAttribute('data-expected-answer', 'The board pivots stay fixed');
  await expect(wavingCard).toHaveAttribute('data-clip-slot', 'generated-loop');
  await gettingStarted.getByTestId('guided-project-card-waving-arm').click();

  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await expectProjectCounts(page, 14, 1, 1);
  const makeItYours = page.getByTestId('character-make-it-yours');
  await expect(makeItYours).toBeVisible();
  await expect(makeItYours).toContainText('Make it yours');
  await expect(makeItYours).toContainText('Select a part');
  await expect(makeItYours).toContainText('Place joints');
  await expect(makeItYours).toHaveAttribute('data-change-cue', 'hand path');
  await expect(makeItYours).toHaveAttribute('data-build-cue', 'four-bar');
  await expect(makeItYours).not.toContainText('Change hand path');
  await expect(makeItYours).not.toContainText('Build four-bar');
  await expect(makeItYours).not.toContainText('Crank turns -> rocker swings');
  await expect(page.getByTestId('classroom-checklist')).toHaveCount(0);
  await expect(page.getByTestId('character-three-puppet-state')).toHaveAttribute('data-three-mechanism-count', '0');
  await expect(page.getByTestId('character-three-puppet-toggle-mechanisms')).toHaveCount(0);
  await expect(page.getByTestId('status-bar')).toContainText('Make a hand wave ready');
  await page.getByRole('button', { name: /Foundry/i }).click();
  const foundryInspector = page.getByTestId('stage-right-inspector');
  await expect(foundryInspector.getByTestId('foundry-visible-sensemaking')).toContainText('Crank turns');
  await expect(foundryInspector.getByTestId('foundry-visible-sensemaking')).toHaveAttribute('data-sensemaking-evidence', 'driver crank turns and rocker swings');
  await expect(foundryInspector.getByTestId('foundry-visible-sensemaking')).toHaveAttribute('data-sensemaking-answer', 'The board pivots stay fixed');

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  const designPreview = page.getByTestId('design-shared-foundry-preview');
  await expect(designPreview).toBeVisible();
  await expect(designPreview).toHaveAttribute('data-guided-context-mode', 'single-scene-automata');
  await expect(designPreview).toHaveAttribute('data-guided-context-part-count', '14');
  await expect(designPreview).toHaveAttribute('data-guided-context-path-count', '1');
  await expect(designPreview).toHaveAttribute('data-guided-context-path-id', 'path-right-arm');
  const guidedFoundryRig = designPreview.getByTestId('foundry-camera-rig');
  await expect(guidedFoundryRig).toHaveAttribute('data-mechanism-type', '4bar');
  await expect(guidedFoundryRig).toHaveAttribute('data-layer-paths', 'shown');
  await expect(guidedFoundryRig).toHaveAttribute('data-path-preview', 'shown');
  await expect(guidedFoundryRig).toHaveAttribute('data-three-path-trace-count', /[1-9]/);
  await expect(guidedFoundryRig).toHaveAttribute('data-three-primary-path-id', /\S/);
  const guidedContext = guidedFoundryRig;
  await expect(guidedContext).toHaveAttribute('data-viewer-tab', 'design');
  await expect(guidedContext).toHaveAttribute('data-layer-character', 'shown');
  await expect(guidedContext).toHaveAttribute('data-layer-skeleton', 'absent');
  await expect(guidedContext).toHaveAttribute('data-layer-paths', 'shown');
  await expect(guidedContext).toHaveAttribute('data-layer-mechanisms', 'shown');
  await expect(guidedContext).toHaveAttribute('data-three-automata-part-count', '14');
  expectCleanPage(pageErrors, consoleErrors);
});

test('classroom assessment slug and mechanism example video work end-to-end', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const youtubeRequests: string[] = [];
  await page.route('https://www.youtube-nocookie.com/**', async route => {
    youtubeRequests.push(route.request().url());
    await route.abort();
  });

  await page.goto('/?assessment=motion-journal');
  await waitForBootLoader(page);
  const gettingStarted = page.getByTestId('getting-started-dialog');
  await expect(gettingStarted).toBeVisible();
  await gettingStarted.getByTestId('getting-started-card-guided').click();
  await gettingStarted.getByTestId('guided-project-card-waving-arm').click();

  await page.getByRole('button', { name: /Foundry/i }).click();
  const assessmentPrompt = page.getByTestId('classroom-assessment-prompt').first();
  await expect(assessmentPrompt).toHaveAttribute('data-assessment-key', 'motion-journal');
  await expect(assessmentPrompt).toContainText('What changed');
  const example = page.getByTestId('classroom-example-video').first();
  await expect(example).toContainText('Where: waving hand');
  await expect(example).toContainText('Watch for: two board pivots stay still');
  await expect(example).toContainText('Think: Which two pivots are the anchors?');
  const generatedLoop = example.getByTestId('classroom-generated-loop');
  await expect(generatedLoop).toHaveAttribute('data-clip-slot', 'generated-loop');
  await expect(generatedLoop).toHaveAttribute('data-renderer-source', 'MechanismLinkagePreview');
  await expect(generatedLoop).toHaveAttribute('data-reduced-motion', 'true');
  await expect(generatedLoop.getByTestId('classroom-generated-loop-linkage')).toHaveAttribute('data-mechanism-type', '4bar');
  const reducedMotionPath = generatedLoop.locator('path').first();
  const reducedMotionPathD = await reducedMotionPath.getAttribute('d');
  await page.waitForTimeout(250);
  expect(await reducedMotionPath.getAttribute('d')).toBe(reducedMotionPathD);
  await expect(example.getByTestId('classroom-example-video-frame')).toHaveCount(0);
  expect(youtubeRequests, 'optional video does not load before the teacher/student opens it').toEqual([]);
  await example.getByTestId('classroom-example-video-toggle').click();
  const frame = example.getByTestId('classroom-example-video-frame');
  await expect(frame).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/1Ty_1LF3Qv0$/);
  await expect(example.getByTestId('classroom-video-fallback')).toContainText('Use the generated loop', { timeout: 5000 });

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  const designPrompt = page.getByTestId('design-visible-sensemaking').getByTestId('classroom-assessment-prompt');
  await expect(designPrompt).toHaveAttribute('data-assessment-key', 'motion-journal');
  await expect(designPrompt).toContainText('What changed');

  await page.getByRole('button', { name: /Assembly/i }).click();
  await expect(page.getByRole('heading', { name: 'Assembly' })).toBeVisible();
  await page.getByRole('button', { name: /Generate package/i }).click();
  const assemblyPrompt = page.getByTestId('assembly-guide-preview').getByTestId('classroom-assessment-prompt');
  await expect(assemblyPrompt).toHaveAttribute('data-assessment-key', 'motion-journal');
  await expect(assemblyPrompt).toContainText('What should move freely');

  await page.getByRole('button', { name: /Options/i }).click();
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
  const assessmentKeyInput = page.getByLabel('Assessment key');
  await assessmentKeyInput.fill('school-a-2026');
  await assessmentKeyInput.press('Enter');
  const status = page.getByTestId('options-assessment-status');
  await expect(status).toHaveAttribute('data-requested-assessment-key', 'school-a-2026');
  await expect(status).toHaveAttribute('data-active-assessment-key', 'default');
  await expect(status).toContainText('Using default prompts');

  await page.getByRole('button', { name: /Foundry/i }).click();
  const fallbackPrompt = page.getByTestId('classroom-assessment-prompt').first();
  await expect(fallbackPrompt).toHaveAttribute('data-assessment-key', 'school-a-2026');
  await expect(fallbackPrompt).toContainText('Which two pivots stay fixed');
  expectCleanPage(pageErrors, consoleErrors);
});


const writeWavingArmLessonProject = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motionsmith-lesson-'));
  const path = join(dir, 'waving-arm.motionsmith.json');
  await writeFile(path, serializeProject(createLessonProject('waving-arm')), 'utf8');
  return path;
};

const writeUnoccupiedWavingArmLessonProject = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motionsmith-lesson-'));
  const path = join(dir, 'waving-arm-unoccupied.motionsmith.json');
  const project = createLessonProject('waving-arm');
  project.mechanisms = [];
  project.selectedMechanismId = undefined;
  await writeFile(path, serializeProject(project), 'utf8');
  return path;
};

const importWavingArmLessonProject = async (page: Page, targetStage: 'character' | 'path' = 'path') => {
  await waitForBootLoader(page);
  const projectPath = await writeWavingArmLessonProject();
  const gettingStarted = page.getByTestId('getting-started-dialog');
  if (await gettingStarted.count()) {
    if (await gettingStarted.getByTestId('guided-project-library').count()) {
      await gettingStarted.getByRole('button', { name: 'Starters' }).click();
    }
    await page.getByTestId('getting-started-import-input').setInputFiles(projectPath);
  } else {
    await page.getByTestId('project-file-input').setInputFiles(projectPath);
  }
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
  if (targetStage === 'character') {
    await page.getByRole('button', { name: /^Character$/i }).click();
    await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  }
};

const openWavingArmTemplate = async (page: Page) => {
  await importWavingArmLessonProject(page, 'path');
};

const openUnoccupiedWavingArmTemplate = async (page: Page) => {
  await waitForBootLoader(page);
  const projectPath = await writeUnoccupiedWavingArmLessonProject();
  const gettingStarted = page.getByTestId('getting-started-dialog');
  if (await gettingStarted.count()) {
    if (await gettingStarted.getByTestId('guided-project-library').count()) {
      await gettingStarted.getByRole('button', { name: 'Starters' }).click();
    }
    await page.getByTestId('getting-started-import-input').setInputFiles(projectPath);
  } else {
    await page.getByTestId('project-file-input').setInputFiles(projectPath);
  }
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
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

const expectInsideViewport = async (page: Page, locator: Locator, label: string) => {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, `${label} has a layout box`).toBeTruthy();
  expect(viewport, `${label} has viewport metrics`).toBeTruthy();
  if (!box || !viewport) throw new Error(`Missing metrics for ${label}`);
  expect(box.x, `${label} left edge stays inside viewport`).toBeGreaterThanOrEqual(-1);
  expect(box.y, `${label} top edge stays inside viewport`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${label} right edge stays inside viewport`).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height, `${label} bottom edge stays inside viewport`).toBeLessThanOrEqual(viewport.height + 1);
};

const waitForStableBox = async (page: Page, locator: Locator, label: string) => {
  let previous = await locator.boundingBox();
  expect(previous, `${label} has a layout box`).toBeTruthy();
  if (!previous) throw new Error(`Missing layout box for ${label}`);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const next = await locator.boundingBox();
    expect(next, `${label} keeps a layout box`).toBeTruthy();
    if (!next) throw new Error(`Missing layout box for ${label}`);
    const stable = Math.abs(next.x - previous.x) < 0.5
      && Math.abs(next.y - previous.y) < 0.5
      && Math.abs(next.width - previous.width) < 0.5
      && Math.abs(next.height - previous.height) < 0.5;
    if (stable) return next;
    previous = next;
  }
  return previous;
};

const assertNoDocumentHorizontalOverflow = async (page: Page, label: string) => {
  const metrics = await page.evaluate(() => ({
    bodyOverflow: getComputedStyle(document.body).overflow,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.bodyOverflow, `${label}: body shell remains overflow-hidden`).toBe('hidden');
  expect(metrics.bodyOverflowX, `${label}: body shell keeps horizontal overflow hidden`).toBe('hidden');
  expect(metrics.documentScrollWidth, `${label}: document has no horizontal overflow`).toBeLessThanOrEqual(metrics.documentClientWidth + 1);
  expect(metrics.bodyScrollWidth, `${label}: body has no horizontal overflow`).toBeLessThanOrEqual(metrics.bodyClientWidth + 1);
};

const expectReachableInViewportOrOwnScroller = async (locator: Locator, label: string) => {
  await expect(locator, `${label} is visible`).toBeVisible();
  const result = await locator.evaluate((node) => {
    const margin = 1;
    const insideViewport = (rect: DOMRect) =>
      rect.left >= -margin
      && rect.top >= -margin
      && rect.right <= window.innerWidth + margin
      && rect.bottom <= window.innerHeight + margin;
    const nearestScroller = (element: Element) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent === document.body || parent === document.documentElement) return null;
        const style = getComputedStyle(parent);
        const scrollsY = /(auto|scroll|overlay)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1;
        const scrollsX = /(auto|scroll|overlay)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1;
        if (scrollsY || scrollsX) return parent;
      }
      return null;
    };

    const initialRect = node.getBoundingClientRect();
    if (insideViewport(initialRect)) return { ok: true, via: 'viewport' };

    const scroller = nearestScroller(node);
    if (!scroller) return { ok: false, via: 'none' };

    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = node.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const insideScroller =
      rect.left >= scrollerRect.left - margin
      && rect.top >= scrollerRect.top - margin
      && rect.right <= scrollerRect.right + margin
      && rect.bottom <= scrollerRect.bottom + margin;
    return {
      ok: insideViewport(rect) && insideScroller,
      via: scroller.getAttribute('data-testid') || scroller.className || scroller.tagName,
    };
  });
  expect(result.ok, `${label} is inside viewport or reachable through its own scroll container (${result.via})`).toBe(true);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stageButtonName = (name: string | RegExp) => {
  if (name instanceof RegExp) return name;
  const aliases: Record<string, RegExp> = {
    Character: /Character/i,
    Path: /Path Editor/i,
    Foundry: /Mechanism Foundry|Foundry/i,
    Design: /Mechanism Design|Design/i,
    Blueprint: /Blueprint/i,
    Assembly: /Assembly/i,
    Options: /Options/i
  };
  return aliases[name] ?? new RegExp(`^${escapeRegExp(name)}$`, 'i');
};
const stageRailButton = (page: Page, name: string | RegExp) => page.getByTestId('workspace-steps').getByRole('button', { name: stageButtonName(name) });
const clickStage = async (page: Page, name: string | RegExp) => stageRailButton(page, name).click();
const expectProjectCounts = async (page: Page, parts: number, paths: number, mechanisms: number) => {
  await expect(page.getByTestId('stage-project-card')).toHaveAttribute('aria-label', new RegExp(`${parts} parts, ${paths} paths, ${mechanisms} mechanisms`));
  await expect(page.getByTestId('stage-project-card')).not.toBeVisible();
};

test.describe('Ultragoal anatomy contracts', () => {
test('Ultragoal G003 built-in front character keeps anatomical right on viewer left', async ({ page }) => {
  await page.goto('/');
  await openCharacterScreen(page);
  await page.getByTestId('character-preview-pane').getByRole('button', { name: 'Zoom out' }).click();
  await page.getByTestId('character-preview-pane').getByRole('button', { name: 'Zoom out' }).click();
  await page.getByTestId('character-three-puppet-view-2d').click();

  const puppet = page.getByTestId('character-three-puppet-state');
  await expect(puppet).toHaveAttribute('data-camera-preset', 'front');
  await expect(puppet).toHaveAttribute('data-layer-character', 'shown');

  const expectedLabels = {
    right_hand_part: 'Right hand',
    left_hand_part: 'Left hand',
    right_foot_part: 'Right foot',
    left_foot_part: 'Left foot',
  } as const;
  for (const [id, label] of Object.entries(expectedLabels)) {
    await expect(page.getByTestId(`character-part-item-${id}`), `${id} keeps its anatomical label`).toContainText(label);
  }

  const head = await waitForThreePartTarget(puppet, 'head');
  const torso = await waitForThreePartTarget(puppet, 'torso');
  const rightHand = await waitForThreePartTarget(puppet, 'right_hand_part');
  const leftHand = await waitForThreePartTarget(puppet, 'left_hand_part');
  const rightFoot = await waitForThreePartTarget(puppet, 'right_foot_part');
  const leftFoot = await waitForThreePartTarget(puppet, 'left_foot_part');

  expect(rightHand.id).toBe('right_hand_part');
  expect(leftHand.id).toBe('left_hand_part');
  expect(rightFoot.id).toBe('right_foot_part');
  expect(leftFoot.id).toBe('left_foot_part');
  expect(head.y, 'head renders above torso in front view').toBeLessThan(torso.y);
  expect(torso.y, 'torso renders above both feet in front view').toBeLessThan(Math.min(rightFoot.y, leftFoot.y));
  expect(Math.max(rightHand.y, leftHand.y), 'hands render above feet in front view').toBeLessThan(Math.min(rightFoot.y, leftFoot.y));
  expect(rightHand.x, 'anatomical right hand should appear viewer-left of anatomical left hand').toBeLessThan(leftHand.x);
  expect(rightFoot.x, 'anatomical right foot should appear viewer-left of anatomical left foot').toBeLessThan(leftFoot.x);
});

});

type ConnectionHoleTarget = {
  role: ConnectionSelectionRole;
  kind: 'linkage-hole' | 'gear-attachment-hole';
  partKey: string;
  holeIndex: number;
};

const waitForConnectionHoleTarget = async (
  page: Page,
  role: ConnectionSelectionRole,
  options: { holeIndex?: number; excludeHoleIndex?: number } = {},
) => {
  let target: ConnectionHoleTarget | undefined;
  await expect.poll(async () => {
    target = undefined;
    const markers = page.locator(
      `circle.foundry-connection-hole-hit[data-connection-role="${role}"]`,
    );
    const candidates: Array<{ marker: Locator; target: ConnectionHoleTarget }> = [];
    for (let index = 0; index < await markers.count(); index += 1) {
      const marker = markers.nth(index);
      const holeIndex = Number(await marker.getAttribute('data-connection-hole-index'));
      const kind = await marker.getAttribute('data-connection-kind');
      const partKey = await marker.getAttribute('data-connection-part-key');
      if (
        !Number.isInteger(holeIndex)
        || (kind !== 'linkage-hole' && kind !== 'gear-attachment-hole')
        || !partKey
        || (options.holeIndex !== undefined && holeIndex !== options.holeIndex)
        || (options.excludeHoleIndex !== undefined && holeIndex === options.excludeHoleIndex)
      ) continue;
      candidates.push({ marker, target: { role, kind, partKey, holeIndex } });
    }
    candidates.sort((a, b) => a.target.holeIndex - b.target.holeIndex);
    for (const candidate of candidates) {
      if (!(await candidate.marker.isVisible())) continue;
      const isPhysicalHitTarget = await candidate.marker.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        );
        return hit === element || Boolean(hit && element.parentElement?.contains(hit));
      });
      if (isPhysicalHitTarget) {
        target = candidate.target;
        break;
      }
    }
    return target ? `${target.role}:${target.holeIndex}` : '';
  }, {
    message: `${options.excludeHoleIndex === undefined ? '' : 'non-default '}physical hole affordance is visible for ${role}`,
  }).toContain(`${role}:`);
  return target!;
};

const waitForConnectionCoordinate = async (rig: Locator, role: ConnectionSelectionRole, previous?: Point) => {
  let coordinate: Point | undefined;
  await expect.poll(async () => {
    const coordinates = await readJsonAttribute<Partial<Record<ConnectionSelectionRole, Point>>>(
      rig,
      'data-three-connection-selection-coordinates',
      {},
    );
    coordinate = coordinates[role];
    if (!coordinate || !Number.isFinite(coordinate.x) || !Number.isFinite(coordinate.y)) return false;
    return !previous || coordinate.x !== previous.x || coordinate.y !== previous.y;
  }, {
    message: `canonical connection coordinate ${previous ? 'changes' : 'is available'} for ${role}`,
  }).toBe(true);
  return coordinate!;
};

const connectionSignaturePart = (signature: string | null, role: ConnectionSelectionRole) =>
  (signature ?? '').split('|').find(part => part.startsWith(`${role}:`)) ?? '';

const waitForConnectionSignature = async (rig: Locator, roles: readonly ConnectionSelectionRole[]) => {
  let signature: string | null = null;
  await expect.poll(async () => {
    signature = await rig.getAttribute('data-three-fabrication-export-signature');
    return roles.every(role => connectionSignaturePart(signature, role));
  }, { message: `compiler connection signature contains ${roles.join(' and ')}` }).toBe(true);
  return signature!;
};

const connectionSignatureHoleIndex = (signature: string, role: ConnectionSelectionRole) => {
  const holeIndex = Number(connectionSignaturePart(signature, role).split(':').at(-1));
  expect(Number.isInteger(holeIndex), `compiler signature exposes a hole index for ${role}`).toBe(true);
  return holeIndex;
};

const clickConnectionHoleTarget = async (page: Page, target: ConnectionHoleTarget) => {
  const marker = page.getByTestId(`foundry-connection-hole-${target.role}-${target.holeIndex}`).locator('circle.foundry-connection-hole-hit');
  await expect(marker, `${target.role} hole ${target.holeIndex} is a visible physical overlay affordance`).toHaveAttribute('data-connection-role', target.role);
  await expect(marker).toHaveAttribute('data-connection-kind', target.kind);
  await expect(marker).toHaveAttribute('data-connection-part-key', target.partKey);
  await expect(marker).toHaveAttribute('data-connection-hole-index', String(target.holeIndex));
  await marker.click();
};

test('physical hole selection authors connection role and updates preview/export only through visible affordance', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openCharacterScreen(page);
  await clickStage(page, 'Foundry');
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  const foundryRig = page.getByTestId('foundry-camera-rig');
  await expect(foundryRig).toHaveAttribute('data-mechanism-type', '4bar');

  const beforeExportSignature = await waitForConnectionSignature(foundryRig, ['4bar.input-joint', '4bar.output-joint']);
  const initialInputHoleIndex = connectionSignatureHoleIndex(beforeExportSignature, '4bar.input-joint');
  const initialOutputSignaturePart = connectionSignaturePart(beforeExportSignature, '4bar.output-joint');
  const initialInputHole = await waitForConnectionHoleTarget(page, '4bar.input-joint', { holeIndex: initialInputHoleIndex });
  const beforeInput = await waitForConnectionCoordinate(foundryRig, '4bar.input-joint');
  const foundryParametricEditor = page.getByTestId('foundry-parametric-editor');
  await clickConnectionHoleTarget(page, initialInputHole);
  await expect(foundryRig, 'explicitly selecting the deterministic default records the authored role').toHaveAttribute('data-three-selected-connection-role', '4bar.input-joint');
  await expect(foundryRig).toHaveAttribute('data-three-selected-connection-hole-index', String(initialInputHoleIndex));
  await expect(foundryParametricEditor.getByLabel('Input link length'), 'explicit same-hole authoring locks the accepted input endpoint').toBeDisabled();
  await expect(foundryParametricEditor.getByLabel('Output link length'), 'same-hole input authoring preserves unrelated output default provenance').toBeEnabled();
  await expect(foundryRig, 'same-hole authoring preserves physical geometry/export identity').toHaveAttribute('data-three-fabrication-export-signature', beforeExportSignature);
  const inputHole = await waitForConnectionHoleTarget(page, '4bar.input-joint', { excludeHoleIndex: initialInputHoleIndex });
  expect(inputHole.kind, '4bar input role is authored from linkage holes').toBe('linkage-hole');
  await clickConnectionHoleTarget(page, inputHole);

  await expect(foundryRig, 'preview exposes selected role/kind/part/hole after physical affordance drag').toHaveAttribute('data-three-selected-connection-role', '4bar.input-joint');
  await expect(foundryRig).toHaveAttribute('data-three-selected-connection-kind', 'linkage-hole');
  await expect(foundryRig).toHaveAttribute('data-three-selected-connection-hole-index', String(inputHole.holeIndex));
  await expect(foundryParametricEditor, 'shared editor confirms selected connection but is display-only').toContainText(/Input joint/i);
  const inputConfirmation = foundryParametricEditor.getByTestId('connection-selection-confirmation-4bar.input-joint');
  await expect(inputConfirmation, 'visible confirmation uses one-based physical hole copy').toContainText(`Hole ${inputHole.holeIndex + 1}`);
  await expect(inputConfirmation, 'visible confirmation hides raw linkage key and #index copy').not.toContainText(new RegExp(`${inputHole.partKey}|#${inputHole.holeIndex}`));
  await expect(inputConfirmation).toHaveAttribute('data-connection-role', '4bar.input-joint');
  await expect(inputConfirmation).toHaveAttribute('data-connection-part-key', inputHole.partKey);
  await expect(inputConfirmation).toHaveAttribute('data-connection-hole-index', String(inputHole.holeIndex));
  await expect(foundryParametricEditor.getByTestId('connection-selection-author')).toHaveCount(0);
  await expect(foundryParametricEditor.getByLabel('Input link length'), 'input endpoint size is confirmation-only after physical-hole authoring').toBeDisabled();
  await expect(foundryParametricEditor.getByLabel('Output link length'), 'input authoring does not lock the independent output endpoint').toBeEnabled();
  await expect(foundryParametricEditor.getByLabel('Coupler link length'), 'coupler length remains the editable scalar').toBeEnabled();
  await expect(page.getByTestId('foundry-param-handle-B'), 'B/J1 handle is visible but cannot author an alternate input endpoint scalar').toHaveAttribute('data-draggable', 'false');
  await expect(page.getByTestId('foundry-param-handle-C'), 'input authoring leaves the independent C/J2 output handle available').toHaveAttribute('data-draggable', 'true');

  const afterInput = await waitForConnectionCoordinate(foundryRig, '4bar.input-joint', beforeInput);
  expect(afterInput, 'live preview exposes the selected input coordinate').toBeTruthy();
  expect(afterInput, 'dragging a different physical hole changes the preview coordinate').not.toEqual(beforeInput);
  const afterInputSignature = await foundryRig.getAttribute('data-three-fabrication-export-signature');
  expect(connectionSignaturePart(afterInputSignature, '4bar.output-joint'), 'input authoring preserves the independent output selection').toBe(initialOutputSignaturePart);

  const currentOutputHoleIndex = connectionSignatureHoleIndex(afterInputSignature!, '4bar.output-joint');
  await waitForConnectionHoleTarget(page, '4bar.output-joint', { holeIndex: currentOutputHoleIndex });
  const beforeOutput = await waitForConnectionCoordinate(foundryRig, '4bar.output-joint');
  const outputHole = await waitForConnectionHoleTarget(page, '4bar.output-joint', { excludeHoleIndex: currentOutputHoleIndex });
  await clickConnectionHoleTarget(page, outputHole);

  await expect(foundryRig, 'preview exposes the independently authored output role').toHaveAttribute('data-three-selected-connection-role', '4bar.output-joint');
  await expect(foundryRig).toHaveAttribute('data-three-selected-connection-kind', 'linkage-hole');
  await expect(foundryRig).toHaveAttribute('data-three-selected-connection-hole-index', String(outputHole.holeIndex));
  await expect(foundryParametricEditor.getByLabel('Input link length'), 'output authoring preserves the accepted input lock').toBeDisabled();
  await expect(foundryParametricEditor.getByLabel('Output link length'), 'output endpoint locks only after its own physical-hole authoring').toBeDisabled();
  await expect(page.getByTestId('foundry-param-handle-B')).toHaveAttribute('data-draggable', 'false');
  await expect(page.getByTestId('foundry-param-handle-C'), 'C/J2 locks after the output role is accepted').toHaveAttribute('data-draggable', 'false');
  await waitForConnectionCoordinate(foundryRig, '4bar.output-joint', beforeOutput);
  const afterPreviewExportSignature = await foundryRig.getAttribute('data-three-fabrication-export-signature');
  expect(connectionSignaturePart(afterPreviewExportSignature, '4bar.input-joint'), 'output authoring does not mutate the accepted input signature').toBe(connectionSignaturePart(afterInputSignature, '4bar.input-joint'));
  expect(connectionSignaturePart(afterPreviewExportSignature, '4bar.output-joint'), 'output authoring changes only the output signature').not.toBe(initialOutputSignaturePart);
  expect(afterPreviewExportSignature, 'independent physical holes change the fabrication/export signature before package generation').not.toBe(beforeExportSignature);

  await page.getByRole('button', { name: /Use mechanism/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('design-parametric-editor'), 'Design editor is also display-only for authored hole selections').toContainText(/4bar\.input-joint|Input joint/i);
  await expect(page.getByTestId('design-parametric-editor').getByTestId('connection-selection-author')).toHaveCount(0);
  await clickStage(page, 'Blueprint');
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeEnabled();
  await page.getByRole('button', { name: /Generate package/i }).click();
  const afterExport = await readBlueprintPackage(page);
  expect(afterExport.metadataJson, 'generated export metadata matches the live selected-hole export signature').toContain(String(afterPreviewExportSignature));
  expect(afterExport.metadataJson, 'export persists the dedicated input role instead of generic handles').toContain('4bar.input-joint');
  expect(afterExport.metadataJson, 'export persists the independently authored output role').toContain('4bar.output-joint');
  expect(afterExport.metadataJson).not.toMatch(/"(?:P1|J1|J2|board-hole|gear-center)"/);

  expectCleanPage(pageErrors, consoleErrors);
});

test('gear linkage physical hole selection authors drive/output pins and exports dedicated metadata', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openCharacterScreen(page);
  await clickStage(page, 'Foundry');
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  await page.getByText('Mechanism options').click();
  const mechanismType = page.getByLabel('Foundry mechanism type');

  for (const type of ['gear', 'planetary_gear', 'cam', 'piston']) {
    if (await mechanismType.locator(`option[value="${type}"]`).count()) {
      await mechanismType.selectOption(type);
      const rig = page.getByTestId('foundry-camera-rig');
      await expect(rig, `${type} is selected through the visible Foundry control`).toHaveAttribute('data-mechanism-type', type);
      await expect(page.locator('circle.foundry-connection-hole-hit'), `${type} does not expose authored connection-hole targets`).toHaveCount(0);
      await expect(page.getByTestId('foundry-parametric-editor').getByTestId('connection-selection-author'), `${type} editor has no connection authoring control`).toHaveCount(0);
    }
  }

  await mechanismType.selectOption('gear_linkage');
  const foundryRig = page.getByTestId('foundry-camera-rig');
  await expect(foundryRig).toHaveAttribute('data-mechanism-type', 'gear_linkage');
  await page.getByLabel('Drive gear size').selectOption('g40');
  await page.getByLabel('Output gear size').selectOption('g40');

  const initialSignature = await waitForConnectionSignature(foundryRig, ['gear_linkage.drive-pin', 'gear_linkage.output-pin']);
  const initialDriveHoleIndex = connectionSignatureHoleIndex(initialSignature, 'gear_linkage.drive-pin');
  const initialOutputHoleIndex = connectionSignatureHoleIndex(initialSignature, 'gear_linkage.output-pin');
  await waitForConnectionHoleTarget(page, 'gear_linkage.drive-pin', { holeIndex: initialDriveHoleIndex });
  const initialDriveCoordinate = await waitForConnectionCoordinate(foundryRig, 'gear_linkage.drive-pin');
  const initialDriveSignaturePart = connectionSignaturePart(initialSignature, 'gear_linkage.drive-pin');
  const initialOutputSignaturePart = connectionSignaturePart(initialSignature, 'gear_linkage.output-pin');

  const driveHole = await waitForConnectionHoleTarget(page, 'gear_linkage.drive-pin', { excludeHoleIndex: initialDriveHoleIndex });
  expect(driveHole.kind, 'gear linkage drive pin is authored from gear attachment holes').toBe('gear-attachment-hole');
  expect(driveHole.partKey, 'drive pin hole comes from the selected drive gear blank').toBe('g40');
  await clickConnectionHoleTarget(page, driveHole);

  await expect(foundryRig, 'preview exposes selected drive-pin role after physical affordance drag').toHaveAttribute('data-three-selected-connection-role', 'gear_linkage.drive-pin');
  await expect(foundryRig).toHaveAttribute('data-three-selected-connection-kind', 'gear-attachment-hole');
  await expect(foundryRig).toHaveAttribute('data-three-selected-connection-hole-index', String(driveHole.holeIndex));
  const gearParametricEditor = page.getByTestId('foundry-parametric-editor');
  await expect(gearParametricEditor, 'shared editor confirms selected gear-linkage connection but is display-only').toContainText(/Drive pin/i);
  const driveConfirmation = gearParametricEditor.getByTestId('connection-selection-confirmation-gear_linkage.drive-pin');
  await expect(driveConfirmation, 'visible gear confirmation uses one-based physical hole copy').toContainText(`Hole ${driveHole.holeIndex + 1}`);
  await expect(driveConfirmation, 'visible gear confirmation hides raw gear key and #index copy').not.toContainText(new RegExp(`${driveHole.partKey}|#${driveHole.holeIndex}`));
  await expect(driveConfirmation).toHaveAttribute('data-connection-role', 'gear_linkage.drive-pin');
  await expect(driveConfirmation).toHaveAttribute('data-connection-part-key', driveHole.partKey);
  await expect(driveConfirmation).toHaveAttribute('data-connection-hole-index', String(driveHole.holeIndex));
  await expect(gearParametricEditor.getByTestId('connection-selection-author')).toHaveCount(0);

  const afterDriveCoordinate = await waitForConnectionCoordinate(foundryRig, 'gear_linkage.drive-pin', initialDriveCoordinate);
  const outputAfterDrive = await waitForConnectionCoordinate(foundryRig, 'gear_linkage.output-pin');
  const afterDriveSignature = await foundryRig.getAttribute('data-three-fabrication-export-signature');
  expect(afterDriveCoordinate, 'selecting a non-default drive-pin hole changes the canonical drive coordinate').not.toEqual(initialDriveCoordinate);
  expect(connectionSignaturePart(afterDriveSignature, 'gear_linkage.drive-pin')).toContain(`gear_linkage.drive-pin:${driveHole.partKey}:0:${driveHole.holeIndex}`);
  expect(connectionSignaturePart(afterDriveSignature, 'gear_linkage.drive-pin'), 'drive-pin selection changes its compiler signature').not.toBe(initialDriveSignaturePart);
  expect(connectionSignaturePart(afterDriveSignature, 'gear_linkage.output-pin'), 'drive-pin selection does not mutate output-pin signature').toBe(initialOutputSignaturePart);

  await page.getByLabel('Drive gear size').selectOption('g24');
  await expect.poll(async () => connectionSignaturePart(await foundryRig.getAttribute('data-three-fabrication-export-signature'), 'gear_linkage.drive-pin'), { message: 'stale drive-pin selection is dropped after drive gear geometry changes' }).toBe('');
  const afterDriveGearChangeSignature = await foundryRig.getAttribute('data-three-fabrication-export-signature');
  expect(connectionSignaturePart(afterDriveGearChangeSignature, 'gear_linkage.output-pin'), 'drive gear geometry change preserves the still-valid output-pin selection').toBe(initialOutputSignaturePart);
  const replacementDriveHole = await waitForConnectionHoleTarget(page, 'gear_linkage.drive-pin', { excludeHoleIndex: driveHole.holeIndex });
  expect(replacementDriveHole.partKey, 'recovered drive candidates come from the current drive gear blank').toBe('g24');
  await clickConnectionHoleTarget(page, replacementDriveHole);
  const afterDriveRepairSignature = await waitForConnectionSignature(foundryRig, ['gear_linkage.drive-pin', 'gear_linkage.output-pin']);
  expect(connectionSignaturePart(afterDriveRepairSignature, 'gear_linkage.drive-pin')).toContain(`gear_linkage.drive-pin:g24:0:${replacementDriveHole.holeIndex}`);
  expect(connectionSignaturePart(afterDriveRepairSignature, 'gear_linkage.output-pin'), 'new drive gesture preserves the unrelated output-pin selection').toBe(initialOutputSignaturePart);

  const outputHole = await waitForConnectionHoleTarget(page, 'gear_linkage.output-pin', { excludeHoleIndex: initialOutputHoleIndex });
  expect(outputHole.kind, 'gear linkage output pin is authored from gear attachment holes').toBe('gear-attachment-hole');
  expect(outputHole.partKey, 'output pin hole comes from the selected output gear blank').toBe('g40');
  await clickConnectionHoleTarget(page, outputHole);

  await expect(foundryRig, 'preview exposes selected output-pin role after physical affordance drag').toHaveAttribute('data-three-selected-connection-role', 'gear_linkage.output-pin');
  await expect(foundryRig).toHaveAttribute('data-three-selected-connection-kind', 'gear-attachment-hole');
  await expect(foundryRig).toHaveAttribute('data-three-selected-connection-hole-index', String(outputHole.holeIndex));

  const afterOutputCoordinate = await waitForConnectionCoordinate(foundryRig, 'gear_linkage.output-pin', outputAfterDrive);
  const afterOutputSignature = await foundryRig.getAttribute('data-three-fabrication-export-signature');
  expect(afterOutputCoordinate, 'selecting a non-default output-pin hole changes the canonical output coordinate').not.toEqual(outputAfterDrive);
  expect(connectionSignaturePart(afterOutputSignature, 'gear_linkage.drive-pin'), 'output-pin selection does not mutate drive-pin signature').toBe(connectionSignaturePart(afterDriveRepairSignature, 'gear_linkage.drive-pin'));
  expect(connectionSignaturePart(afterOutputSignature, 'gear_linkage.output-pin')).toContain(`gear_linkage.output-pin:${outputHole.partKey}:1:${outputHole.holeIndex}`);
  expect(connectionSignaturePart(afterOutputSignature, 'gear_linkage.output-pin'), 'output-pin selection changes its compiler signature').not.toBe(initialOutputSignaturePart);

  await page.getByRole('button', { name: /Use mechanism/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('design-parametric-editor'), 'Design confirms the authored gear-linkage selection without authoring controls').toContainText(/gear_linkage\.output-pin|Output pin/i);
  await expect(page.getByTestId('design-parametric-editor').getByTestId('connection-selection-author')).toHaveCount(0);

  await clickStage(page, 'Blueprint');
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeEnabled();
  await page.getByRole('button', { name: /Generate package/i }).click();
  const exportedPackage = await readBlueprintPackage(page);
  expect(exportedPackage.metadataJson, 'export metadata contains the live compiler-derived connection signature').toContain(String(afterOutputSignature));
  expect(exportedPackage.metadataJson, 'export metadata contains the dedicated drive-pin role').toContain('gear_linkage.drive-pin');
  expect(exportedPackage.metadataJson, 'export metadata contains the dedicated output-pin role').toContain('gear_linkage.output-pin');
  expect(exportedPackage.metadataJson, 'export metadata excludes legacy generic connection identifiers').not.toMatch(/\b(?:P1|J1|J2|board-hole|gear-center)\b/);

  expectCleanPage(pageErrors, consoleErrors);
});

test('MotionSmith header logo returns to Character home', async ({ page }) => {
  await page.goto('/');
  await importWavingArmLessonProject(page, 'path');
  await expect(page.locator('h2.current-stage-title', { hasText: 'Path Editor' })).toBeVisible();

  await page.getByTestId('app-header-home').click();

  await expect(page.locator('h2.current-stage-title', { hasText: 'Character' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
});

test('Medium-width desktop keeps editor panes from cutting off the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 948, height: 1398 });
  await page.goto('/');
  await importWavingArmLessonProject(page, 'path');
  await applyFourBarFromFoundry(page);
  await clickStage(page, 'Options');
  await page.getByLabel('Text size').selectOption('large');
  await expect.poll(
    () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
    { message: 'large text size applies at the document root' },
  ).toBe('18px');
  await clickStage(page, 'Design');

  const canvasBox = await page.getByTestId('stage-canvas-pane').boundingBox();
  const rightBox = await page.getByTestId('stage-right-inspector').boundingBox();
  const viewport = page.viewportSize();

  expect(canvasBox, 'center canvas has a layout box').toBeTruthy();
  expect(rightBox, 'right inspector has a layout box').toBeTruthy();
  expect(viewport, 'viewport is available').toBeTruthy();
  expect(canvasBox!.width, 'center canvas stays usable at medium desktop width').toBeGreaterThanOrEqual(280);
  expect(rightBox!.x + rightBox!.width, 'right inspector stays inside the viewport').toBeLessThanOrEqual(viewport!.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 4)).toBe(true);
});


test.describe('Ultragoal warning and responsive contracts', () => {
test('G006 student warning UX hides raw ids and fit scores in Design recommendations', async ({ page }) => {
  await page.goto('/');
  await openUnoccupiedWavingArmTemplate(page);
  await clickStage(page, 'Design');
  await page.getByRole('button', { name: /Recommend/i }).click();
  const sheet = page.getByTestId('recommendation-sheet');
  await expect(sheet).toBeVisible();

  const cards = sheet.locator('[data-testid^="recommendation-card-"]');
  await expect(cards.first(), 'recommendation cards are available for the imported lesson path').toBeVisible();
  await expect.soft(sheet, 'student cards should not expose raw numeric fit scores').not.toContainText(/Fit score\s+\d+\/100/i);
  for (let i = 0; i < await cards.count(); i += 1) {
    const card = cards.nth(i);
    const use = card.getByRole('button', { name: /^Use$/ });
    const blocked = card.getByText(/Blocked|Draw more path|Check/i).first();
    expect.soft(
      (await use.count()) > 0 || (await blocked.count()) > 0,
      `recommendation card ${i + 1} keeps Use or blocked state understandable`,
    ).toBe(true);
  }

  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);

  await page.goto('/');
  await openWavingArmTemplate(page);
  await clickStage(page, 'Design');
  await page.getByRole('button', { name: /Four-bar linkage/i }).click();

  const warningRegion = page.getByTestId('stage-left-pane');
  const warnings = warningRegion.locator('.warning');
  await expect(warnings.first(), 'Design shows the primary student warning near the mechanism list').toBeVisible();

  const warningTexts = (await warnings.allTextContents()).map(text => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const primaryWarning = warningTexts[0] ?? '';
  expect.soft(primaryWarning.length, `primary warning is compact: ${primaryWarning}`).toBeLessThanOrEqual(90);
  expect.soft(primaryWarning, 'primary warning starts with an action or blocker').toMatch(/^(Fix|Choose|Use|Remove|Move|Check|Draw|Add|Unlock|Pick|Select|Blocked|No)\b/i);
  for (const warning of warningTexts) {
    expect.soft(warning, `warning hides mechanism/path/part/object ids: ${warning}`).not.toMatch(/\b(?:mech|path|part|object)[-_][A-Za-z0-9_-]+\b/i);
    expect.soft(warning, `warning hides snake_case ids: ${warning}`).not.toMatch(/\b[a-z]+(?:_[a-z0-9]+)+\b/);
    expect.soft(warning, `warning hides anchor tuples: ${warning}`).not.toMatch(/\b(?:part|object|joint|path):[^\s;]+/i);
    expect.soft(warning, `warning hides raw fit scores: ${warning}`).not.toMatch(/\b(?:Fit\s*)?score\s+\d+\/100\b/i);
  }

  const normalizedWarnings = warningTexts.map(text => text
    .replace(/\bmech[-_][A-Za-z0-9_-]+\b/gi, '<mechanism>')
    .replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, '<id>')
    .replace(/\b(?:part|object|joint|path):[^\s;]+/gi, '<anchor>')
    .replace(/\s+/g, ' ')
    .trim());
  const repeatedEquivalentWarnings = normalizedWarnings.filter((text, index, all) => text && all.indexOf(text) !== index);
  expect.soft(repeatedEquivalentWarnings, 'equivalent warnings appear at most once in the Design warning region').toEqual([]);
});

test('G005 responsive shell keeps primary surfaces reachable without page overflow', async ({ page }) => {
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1200, height: 520 },
  ]) {
    const label = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    await page.goto('/');
    await waitForBootLoader(page);

    await assertNoDocumentHorizontalOverflow(page, `${label} welcome`);
    const gettingStarted = page.getByTestId('getting-started-dialog');
    await expectReachableInViewportOrOwnScroller(gettingStarted, `${label} Getting Started modal`);
    await expectReachableInViewportOrOwnScroller(gettingStarted.getByTestId('getting-started-card-guided'), `${label} Getting Started primary action`);
    await expectReachableInViewportOrOwnScroller(gettingStarted.getByRole('button', { name: 'Open full project' }), `${label} Getting Started footer action`);

    await importWavingArmLessonProject(page, 'path');
    await assertNoDocumentHorizontalOverflow(page, `${label} workbench`);
    await expectReachableInViewportOrOwnScroller(page.locator('header.app-header'), `${label} header`);
    await expectReachableInViewportOrOwnScroller(page.getByTestId('app-header-home'), `${label} home action`);
    await expectReachableInViewportOrOwnScroller(page.getByTestId('shared-workbench'), `${label} shared workbench`);
    await expectReachableInViewportOrOwnScroller(page.getByTestId('stage-canvas-pane'), `${label} center canvas`);
    await expectReachableInViewportOrOwnScroller(page.getByTestId('stage-right-inspector'), `${label} right inspector`);
    await expectReachableInViewportOrOwnScroller(page.getByTestId('stage-player-row'), `${label} playback dock`);
    await expectReachableInViewportOrOwnScroller(page.getByTestId('status-bar'), `${label} status footer`);
  }
});
});

test('character → path → foundry → design → blueprint runs end-to-end in browser', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await expect(page.getByTestId('shared-workbench')).toBeVisible();
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
  await expect(page.getByTestId('character-screen')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.classList.contains('welcome-modal-open'))).toBe(true);
  await expect(page.getByTestId('onnx-cache-status')).toBeVisible();
  await expect(page.getByTestId('onnx-cache-status')).toContainText(/AI ready|Get AI|AI \d+%|Try again/);
  await expect(page.getByTestId('status-bar')).not.toContainText(/parts:|paths:|mechs:|zoom/);

  const gettingStarted = page.getByTestId('getting-started-dialog');
  await expect(gettingStarted).toBeVisible();
  await expect(gettingStarted).toContainText('Start.');
  const starterGallery = gettingStarted.getByTestId('getting-started-gallery');
  await expect(starterGallery).toBeVisible();
  await expect(starterGallery).toContainText('Guide');
  await expect(starterGallery).toContainText('Starter rig');
  await expect(starterGallery).toContainText('Image');
  await expect(starterGallery).not.toContainText('Character file');
  await expect(starterGallery).toContainText('Girl');
  await expect(starterGallery).toContainText('Boy');
  await expect(starterGallery).toContainText('Pick a working motion project.');
  await expect(starterGallery).toContainText('Edit one move');
  await expect(starterGallery).toContainText('Ready to build');
  await expect(starterGallery).toContainText('Start with a simple body.');
  await expect(starterGallery).toContainText('Move arms or legs');
  await expect(starterGallery).toContainText('Ready character art.');
  await expect(starterGallery).toContainText('Draw a path');
  await expect(starterGallery).toContainText('Turn one picture into parts.');
  await gettingStarted.getByTestId('getting-started-card-guided').click();
  await expect(gettingStarted).toContainText('Pick a project.');
  const guidedLibrary = gettingStarted.getByTestId('guided-project-library');
  await expect(guidedLibrary).toBeVisible();
  await expect(gettingStarted.getByTestId('getting-started-gallery')).toHaveCount(0);
  await expect(guidedLibrary).toContainText('Make a hand wave');
  await expect(guidedLibrary).toContainText('Make a head bob');
  await expect(guidedLibrary).toContainText('Make a foot step');
  await expect(guidedLibrary).toContainText('Make gears spin');
  await expect(guidedLibrary.getByTestId('guided-project-card-waving-arm')).toContainText('Change hand path');
  await expect(guidedLibrary.getByTestId('guided-project-card-waving-arm')).toContainText('Build four-bar');
  await expect(guidedLibrary.getByTestId('guided-project-card-head-bob')).toContainText('Change head path');
  await expect(guidedLibrary.getByTestId('guided-project-card-head-bob')).toContainText('Build cam');
  await expect(guidedLibrary.getByTestId('guided-project-card-walking-leg')).toContainText('Change foot path');
  await expect(guidedLibrary.getByTestId('guided-project-card-walking-leg')).toContainText('Build four-bar');
  await expect(guidedLibrary.getByTestId('guided-project-card-spin-gears')).toContainText('Change gear size');
  await expect(guidedLibrary.getByTestId('guided-project-card-spin-gears')).toContainText('Build gear pair');
  await expect(guidedLibrary.locator('[data-testid^="guided-project-card-"]')).toHaveCount(4);
  for (const lesson of CLASSROOM_LESSONS) {
    const preview = guidedLibrary.getByTestId(`guided-project-preview-${lesson.id}`);
    await expect(preview, `${lesson.id} rendered preview is visible`).toBeVisible();
    await expect(preview).toHaveAttribute('data-preview-mode', 'rendered-character-motion');
    await expect(preview.locator('svg')).toHaveAttribute('data-motion-preview', 'character-path');
    await expect(gettingStarted, `${lesson.id} direct translation stays out of Getting Started`).not.toContainText(lesson.sensemaking.directTranslation);
  }
  await gettingStarted.getByRole('button', { name: 'Starters' }).click();
  await expect(gettingStarted).toContainText('Start.');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).toContainText('Guide');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).toContainText('Starter rig');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).toContainText('Image');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Character file');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).toContainText('Girl');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).toContainText('Boy');
  await expect(gettingStarted).toContainText('Open full project');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Package');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Humanoid');
  await expect(gettingStarted.getByTestId('getting-started-gallery').locator('.template-tile')).toHaveCount(5);
  await expect(gettingStarted.getByTestId('getting-started-gallery').locator('.template-icon-slot')).toHaveCount(5);
  await expect(gettingStarted.getByTestId('getting-started-gallery').locator('.starter-thumb')).toHaveCount(2);
  const starterThumbBoxes = await Promise.all(['girl', 'boy'].map(id => gettingStarted.getByTestId(`getting-started-card-${id}`).locator('.starter-thumb').boundingBox()));
  for (const box of starterThumbBoxes) {
    expect(box?.width ?? 0, 'starter thumbnails should be large enough to explain the choice visually').toBeGreaterThanOrEqual(88);
    expect(box?.height ?? 0, 'starter thumbnails should be large enough to explain the choice visually').toBeGreaterThanOrEqual(88);
  }
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Local browser processing');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('rigging');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Waving arm');
  await page.getByRole('button', { name: 'Close' }).click();
  expect(await page.evaluate(() => document.documentElement.classList.contains('welcome-modal-open'))).toBe(false);

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
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
  await expect(page.getByTestId('path-canvas')).toHaveCount(0);
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  const pathPuppet = page.getByTestId('path-three-puppet-state');
  await expect(pathPuppet).toHaveAttribute('data-three-renderer', 'webgl');
  await expect(pathPuppet).toHaveAttribute('data-camera-preset', 'iso');
  await expect(pathPuppet).toHaveAttribute('data-layer-paths', 'shown');
  await expect(pathPuppet).toHaveAttribute('data-three-path-count', '1');
  await expect(pathPuppet).toHaveAttribute('data-three-selected-path-id', 'path-right-arm');
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
  await expect(pathPuppet).toHaveAttribute('data-three-mechanism-count', '0');
  await expect(pathPuppet).toHaveAttribute('data-three-selected-mechanism-type', '');
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
  const e2ePathBox = await pathCanvas.boundingBox();
  expect(e2ePathBox, 'e2e path canvas can receive a one-stroke draw gesture').toBeTruthy();
  await page.mouse.move(e2ePathBox!.x + 260, e2ePathBox!.y + 220);
  await page.mouse.down();
  await page.mouse.move(e2ePathBox!.x + 290, e2ePathBox!.y + 235, { steps: 2 });
  await page.mouse.move(e2ePathBox!.x + 320, e2ePathBox!.y + 250, { steps: 2 });
  await page.mouse.up();
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
  await expect(page.getByTestId('free-draw-status')).toHaveAttribute('data-draw-mode', 'idle');

  await page.getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  await expect(page.getByTestId('foundry-camera-readout')).toContainText('3D Isometric');
  await expect(page.getByTestId('foundry-three-canvas')).toBeVisible();
  const foundryRig = page.getByTestId('foundry-camera-rig');
  await expect(foundryRig).toHaveAttribute('data-three-renderer', 'webgl');
  await expect(foundryRig).toHaveAttribute('data-three-stack-source', 'compileMechanismRenderPlan');
  await expect(foundryRig).toHaveAttribute('data-three-stack-mode', 'assembled-spacer-separated');
  await expect(foundryRig).toHaveAttribute('data-three-exploded', 'false');
  await expect(foundryRig).toHaveAttribute('data-three-stack-order', /^Back Clip → .*S10 spacer.*Front Clip$/);
  await expect(foundryRig).toHaveAttribute('data-three-spacer-key', 's10');
  await expect(foundryRig).toHaveAttribute('data-three-spacer-mm', '10x4');
  expect(Number(await foundryRig.getAttribute('data-three-spacer-render-count'))).toBeGreaterThan(0);
  await expect(foundryRig).toHaveAttribute('data-three-spacer-render-contract', 'compiled-support-path-membership');
  await expect(foundryRig).toHaveAttribute('data-three-pin-stack-policy', 'compiler-support-paths');
  await expect(foundryRig).toHaveAttribute('data-three-pin-stack-spans', /A:[0-9.]+/);
  await expect(foundryRig).toHaveAttribute('data-three-z-collision-count', '0');
  await expect(foundryRig).toHaveAttribute('data-three-stack-colors', /#334155.*#f59e0b/);
  await expect(foundryRig).toHaveAttribute('data-three-stack-validation-errors', '0');
  expect(await foundryRig.getAttribute('data-three-rendered-layer-labels')).toBe(await foundryRig.getAttribute('data-three-stack-order'));
  expect(await foundryRig.getAttribute('data-three-rendered-layer-roles')).toBe(await foundryRig.getAttribute('data-three-stack-roles'));
  expect(await foundryRig.getAttribute('data-three-rendered-layer-colors')).toBe(await foundryRig.getAttribute('data-three-stack-colors'));
  expect(await foundryRig.getAttribute('data-three-rendered-layer-z'), 'Default foundry 4bar uses fabrication stack z so side views cannot show impossible coplanar link overlap').toBe(await foundryRig.getAttribute('data-three-stack-z'));
  await expect(foundryRig).toHaveAttribute('data-three-fourbar-ground-link-plane', 'fabrication-stack-separated');
  await expect(foundryRig).toHaveAttribute('data-three-physical-validation-errors', '0');
  await expect(foundryRig).toHaveAttribute('data-three-preview-renderable', 'ready');
  expect(await foundryRig.getAttribute('data-three-stack-order')).not.toContain('Base board');
  await expect(page.getByTestId('foundry-exploded-guide')).toHaveCount(0);
  await expect(page.getByTestId('foundry-z-layer-labels')).toHaveCount(0);
  await page.getByText('Mechanism options').click();
  await expect(page.getByLabel('Foundry preset')).toHaveValue('balanced');
  await expect(page.getByTestId('foundry-target-summary')).toHaveCount(0);
  await expect(page.getByTestId('stage-left-pane')).not.toContainText(/Board hole|chain|Target .*pts|Range 360|Status 360|balanced default/i);
  await expect(page.getByTestId('foundry-fit-path')).toBeVisible();
  await expect(page.getByTestId('foundry-fit-path-row').getByTestId('context-help-trigger')).toBeVisible();
  await expect(page.getByTestId('foundry-canvas-pane')).toHaveAttribute('data-fit-board-cells', '15');
  await expect(page.getByTestId('foundry-canvas-pane')).toHaveAttribute('data-fit-target-path', /\S+/);
  await page.getByTestId('foundry-fit-path').click();
  await expect(page.getByTestId('foundry-canvas-pane')).toHaveAttribute('data-mechanism-path-preview', 'shown');
  const foundryRenderContract = await readFoundryRenderContract(foundryRig);
  const foundryInspector = page.getByTestId('stage-right-inspector');
  await expect(foundryInspector.getByTestId('foundry-visible-sensemaking')).toContainText('Crank turns');
  await expect(foundryInspector.getByTestId('foundry-visible-sensemaking')).toContainText('rocker swings');
  await expect(foundryInspector).not.toContainText('Preview overlays');
  await expect(page.getByTestId('foundry-mechanism-library')).toHaveCount(0);
  await expect(page.getByTestId('foundry-fabrication-stack')).toContainText(/^Stack\s*Back Clip.*Spacer 10mm.*Front Clip/);
  await expect(page.getByTestId('foundry-fabrication-stack')).not.toContainText(/Base board/);
  await page.getByRole('button', { name: 'Hint' }).click();
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('Four-bar linkage');
  await expect(page.getByTestId('foundry-mechanism-library')).not.toContainText('pin reactions');
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('driver crank turns and rocker swings');
  await expect(page.getByTestId('foundry-mechanism-library')).not.toContainText('Back Clip');
  await expect(page.getByTestId('foundry-mechanism-library')).not.toContainText('Spacer 10mm');
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('Answer: The board pivots stay fixed');
  await page.getByRole('button', { name: 'Hide hint' }).click();
  await expect(page.getByTestId('foundry-anchor-marker'), 'Default sandbox shows only path and mechanism').toHaveCount(0);
  await page.getByTestId('foundry-pick-anchor').click();
  await expect(page.getByTestId('foundry-pick-anchor')).toContainText('Cancel pick');
  const previewBox = await page.getByTestId('foundry-preview').boundingBox();
  expect(previewBox, 'foundry preview supports direct anchor picking').toBeTruthy();
  await page.mouse.click(previewBox!.x + previewBox!.width * 0.52, previewBox!.y + previewBox!.height * 0.52);
  await expect(page.getByTestId('foundry-pick-anchor')).toContainText('Pick anchor');
  await expect(page.getByTestId('foundry-anchor-marker')).toBeVisible();
  await expect(page.getByTestId('foundry-anchor-marker')).toHaveAttribute('transform', /translate\(/);
  const pickedAnchorX = await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').inputValue();
  const pickedAnchorY = await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').inputValue();
  await page.getByRole('button', { name: /Use mechanism/i }).click();

  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mechanisms' })).toBeVisible();
  await expect(page.getByTestId('design-mechanism-library')).toContainText('Four-bar linkage');
  await expect(page.getByTestId('design-visible-sensemaking')).toContainText('Crank turns');
  await expect(page.getByTestId('design-visible-sensemaking')).toContainText('rocker swings');
  await expect(page.getByTestId('design-visible-sensemaking')).toHaveAttribute('data-sensemaking-evidence', 'driver crank turns and rocker swings');
  await expect(page.getByTestId('design-visible-sensemaking')).toHaveAttribute('data-sensemaking-clip', 'generated-loop');
  const designPreview = page.getByTestId('design-shared-foundry-preview');
  await expect(designPreview).toBeVisible();
  await expect(designPreview).toHaveAttribute('data-renderer-source', 'ThreeFoundryPreview');
  await expect(designPreview).toHaveAttribute('data-shared-with', 'foundry-renderer');
  await expect(page.getByTestId('design-canvas')).toHaveCount(0);
  const designRig = designPreview.getByTestId('foundry-camera-rig');
  await expect(designRig).toHaveAttribute('data-three-renderer', 'webgl');
  await expect(designRig).toHaveAttribute('data-mechanism-type', '4bar');
  await expect(designRig).toHaveAttribute('data-viewer-tab', 'design');
  await expect(designRig).toHaveAttribute('data-three-stack-source', 'compileMechanismRenderPlan');
  await expect(designRig).toHaveAttribute('data-three-stack-validation-errors', '0');
  await expect(designRig).toHaveAttribute('data-three-physical-validation-errors', '0');
  await expect(designRig).toHaveAttribute('data-three-preview-renderable', 'ready');
  await expect(designRig).toHaveAttribute('data-three-stack-order', /Input 3-hole link.*Coupler 5-hole link.*Output (3|5|7)-hole link/);
  await expect(designRig).toHaveAttribute('data-three-fourbar-ground-link-plane', 'fabrication-stack-separated');
  await expectFoundryRenderContract(designRig, foundryRenderContract, 'Design consumes the fitted Foundry mechanism contract');
  const designHasWebgl = await designPreview.locator('canvas.foundry-three-canvas').evaluate((canvas: HTMLCanvasElement) => Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')));
  expect(designHasWebgl, 'design stage mounts the shared Foundry WebGL canvas').toBeTruthy();
  await expect.poll(async () => Number(await designRig.getAttribute('data-three-part-count')), { message: 'design automata preview includes physical mechanism parts' }).toBeGreaterThan(0);
  await expect.poll(async () => Number(await designRig.getAttribute('data-three-dynamic-build-count')), { message: 'design automata renderer built real Three geometry' }).toBeGreaterThan(0);
  await expect(page.getByTestId('design-parametric-editor'), 'Design reuses the same fabrication-backed parametric editor after Foundry export').toBeVisible();
  await expect(page.getByLabel('Input link length'), 'Foundry-selected 4bar remains visibly editable in Design').toBeVisible();
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
  const sharedTransport = page.getByTestId('workspace-player-dock').getByRole('button', { name: /Pause|Play/ });
  if ((await sharedTransport.textContent())?.includes('Ⅱ')) await sharedTransport.click();
  const scrubber = page.getByLabel('Workspace scrubber');
  const rotationSamples: number[] = [];
  for (const frame of ['0', '25', '50', '75']) {
    await scrubber.fill(frame);
    await expect.poll(async () => Number.isFinite(Number(await designRig.getAttribute('data-pinion-rotation-deg'))), { message: `Design automata preview accepts scrubber updates at ${frame}%` }).toBe(true);
    rotationSamples.push(Number(await designRig.getAttribute('data-pinion-rotation-deg')));
  }
  expect(Math.max(...rotationSamples) - Math.min(...rotationSamples), 'scrubbing moves the integrated automata mechanism preview in Design').toBeGreaterThan(10);
  if ((await playback.textContent())?.includes('Pause')) await playback.click();
  await expect(page.getByRole('button', { name: 'SVG', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'DXF' })).toBeVisible();
  await expectProjectCounts(page, 14, 1, 1);

  await clickStage(page, 'Blueprint');
  await expect(page.getByRole('heading', { name: 'Blueprint' })).toBeVisible();
  await expect(page.getByTestId('workflow-status-strip')).toContainText('Blueprint');
  await expect(page.getByTestId('blueprint-canvas-preview')).toBeVisible();
  await expect(page.getByTestId('blueprint-svg-preview')).toBeVisible();
  const liveBlueprintSvg = await page.getByTestId('blueprint-svg-preview').innerHTML();
  expect(liveBlueprintSvg).toContain('PRINT · CUT · BUILD');
  expect(liveBlueprintSvg).toContain('CHARACTER SHEET');
  expect(liveBlueprintSvg).toContain('MECHANISM PARTS');
  expect(liveBlueprintSvg).toContain('BOARD');
  expect(liveBlueprintSvg).toContain('data-blueprint-visual-mode="print-sheet-hero"');
  expect(liveBlueprintSvg).toContain('data-blueprint-print-hero');
  expect(liveBlueprintSvg).toContain('data-blueprint-board-summary');
  expect(liveBlueprintSvg).not.toContain('opacity="0.22"');
  await expect(page.getByTestId('blueprint-detail-preview')).toContainText('Build spot');
  await expect(page.getByTestId('blueprint-detail-preview')).toContainText(/Find [A-Z]\d+ · row \d+, column \d+ on the board/);
  await expect(page.getByTestId('blueprint-detail-preview')).toContainText('Parts to cut');
  await expect(page.getByTestId('blueprint-control-panel')).toContainText('Board preview');
  await expect(page.getByTestId('blueprint-detail-preview')).toContainText(/Ready|Fix:/);
  await expect(page.getByTestId('blueprint-sensemaking-label')).toContainText('Crank turns');
  await expect(page.getByTestId('blueprint-sensemaking-label')).toHaveAttribute('data-sensemaking-evidence', 'driver crank turns and rocker swings');
  await expect(page.getByTestId('stage-canvas-pane').getByTestId('assembly-guide-web-preview')).toHaveCount(0);
  await expect(page.getByTestId('stage-right-inspector').getByTestId('assembly-guide-web-preview')).toHaveCount(0);
  await page.getByRole('button', { name: /Generate package/i }).click();
  await expect(page.getByRole('button', { name: 'Download PDF cut sheet default' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download SVG default' })).toBeVisible();
  await expect(page.getByTestId('custom-parts-export-lane')).toBeVisible();
  await expect(page.getByTestId('prefab-board-export-lane')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assembly guide', exact: true })).toHaveCount(0);
  await expect(page.getByText('Teacher files')).toHaveCount(0);
  await expect(page.getByTestId('prefab-board-export-lane')).toContainText('Mechanism');
  await expect(page.getByTestId('blueprint-svg-preview')).toBeVisible();
  const generatedBlueprintSvg = await page.getByTestId('blueprint-svg-preview').innerHTML();
  expect(generatedBlueprintSvg).toContain('PRINT · CUT · BUILD');
  expect(generatedBlueprintSvg).toContain('CHARACTER SHEET');
  expect(generatedBlueprintSvg).toContain('MECHANISM PARTS');
  expect(generatedBlueprintSvg).toContain('BOARD');
  await expect(page.getByTestId('stage-canvas-pane').locator('img[alt="Cut sheet"]')).toHaveCount(0);
  await clickStage(page, 'Assembly');
  await expect(page.locator('h2.current-stage-title', { hasText: 'Assembly' })).toBeVisible();
  await expect(page.getByTestId('workflow-status-strip')).toContainText('Assembly');
  await expect(page.getByTestId('assembly-canvas-preview')).toBeVisible();
  await expect(page.getByTestId('stage-canvas-pane').getByTestId('assembly-readonly-step-strip')).toBeVisible();
  await expect(page.getByTestId('stage-canvas-pane').getByTestId('assembly-guide-web-preview')).toHaveCount(0);
  await expect(page.getByTestId('stage-right-inspector').getByTestId('assembly-guide-web-preview')).toHaveCount(0);
  await expect(page.getByTestId('assembly-mechanism-three-preview')).toBeVisible();
  await expect(page.getByTestId('assembly-mechanism-three-preview')).toHaveAttribute('data-mechanism-scene-contract-stack-source', 'mechanismCompiler');
  await expect(page.getByTestId('assembly-mechanism-three-preview')).toHaveAttribute('data-mechanism-scene-contract-layer-count', /[1-9]/);
  await expect(page.getByTestId('assembly-character-context-ghost')).toHaveCount(0);
  const assemblyRig = page.getByTestId('assembly-mechanism-three-preview').getByTestId('foundry-camera-rig');
  await expect(assemblyRig).toHaveAttribute('data-viewer-tab', 'assembly');
  await expect(assemblyRig).toHaveAttribute('data-viewer-contract-state', /"tab":"assembly"/);
  await expect(assemblyRig).toHaveAttribute('data-three-stack-source', 'compileMechanismRenderPlan');
  await expect(assemblyRig).toHaveAttribute('data-three-exploded', 'false');
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-scene', 'contract-driven');
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-motion-kind', 'none');
  await expectFoundryRenderContract(assemblyRig, foundryRenderContract, 'Assembly consumes the fitted Foundry mechanism contract');
  await expect(page.getByTestId('assembly-scene-sensemaking')).toHaveAttribute('data-sensemaking-evidence', /fabrication stack|character parts/);
  await expect(page.getByTestId('assembly-sensemaking-label')).toContainText('Crank turns');
  await expect(page.getByTestId('assembly-sensemaking-label')).toHaveAttribute('data-sensemaking-answer', 'The board pivots stay fixed');
  await expect(page.getByTestId('assembly-visual-progress')).toBeVisible();
  await expect(page.getByTestId('assembly-step-list')).toContainText('Mount module to board');
  const assemblyWorkbench = page.getByTestId('assembly-readonly-step-strip');
  await page.getByTestId('assembly-step-list').getByRole('button', { name: /Add coupler/i }).click();
  await expect(assemblyWorkbench).toHaveAttribute('data-step-phase', 'assemble-module');
  await expect(assemblyWorkbench).toHaveAttribute('data-board-mode', 'hidden');
  await expect(assemblyWorkbench).toHaveAttribute('data-active-board-coords', '');
  const floatingReferenceCoords = await assemblyWorkbench.getAttribute('data-floating-reference-coords');
  expect(floatingReferenceCoords).toMatch(/^[A-O][1-9]\d?,[A-O][1-9]\d?$/);
  const floatingReferenceList = floatingReferenceCoords!.split(',');
  expect(new Set(floatingReferenceList).size).toBe(2);
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-motion-kind', 'explode_z');
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-floating-reference-coords', floatingReferenceCoords!);
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-rendered-floating-marker-count', `${floatingReferenceList.length}`);
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-rendered-layer-focus', /[0-9]/);
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-board-surface', 'hidden');
  for (const coord of floatingReferenceList) {
    await expect(page.getByTestId('assembly-floating-references')).toContainText(coord);
  }
  await page.getByTestId('assembly-step-list').getByRole('button', { name: /Mount module to board/i }).click();
  await expect(page.getByTestId('assembly-guide-preview')).toContainText('Mount module to board');
  const sharedAssemblyPlayer = page.getByTestId('workspace-player-dock');
  await expect(sharedAssemblyPlayer).toBeVisible();
  await expect(page.getByTestId('assembly-player-overlay')).toHaveCount(0);
  await expect(sharedAssemblyPlayer.getByTestId('workspace-player-prev-step')).toBeVisible();
  await expect(sharedAssemblyPlayer.getByTestId('workspace-player-next-step')).toBeVisible();
  await expect(page.getByTestId('assembly-readonly-step-strip')).toBeVisible();
  await expect(page.getByTestId('assembly-guide-preview')).toContainText(/OK|Fix:/);
  const assemblyPartsDetails = page.getByTestId('assembly-guide-preview').locator('details.blueprint-more-exports').first();
  if (!(await assemblyPartsDetails.evaluate((element: HTMLDetailsElement) => element.open))) await assemblyPartsDetails.locator('summary').click();
  await expect(page.getByTestId('assembly-stack-summary')).toContainText(/^Back Clip.*Spacer 10mm OD \/ 4mm hole.*Front Clip/);
  await expect(page.getByTestId('stage-right-inspector')).toContainText(/row \d+, column \d+/);
  await expect(page.getByTestId('assembly-stack-summary')).not.toContainText(/Base board/);
  await expect(page.getByTestId('prefab-assembly-steps')).toContainText(/Step \d+/);
  await expect(page.getByTestId('prefab-assembly-steps')).toContainText(/board/i);
  await expect(page.getByTestId('prefab-assembly-steps')).toContainText(/Layer \d+/);
  await expect(assemblyWorkbench).toHaveAttribute('data-step-phase', 'mount-to-board');
  await expect(assemblyWorkbench).toHaveAttribute('data-board-mode', 'active');
  await expect(assemblyWorkbench).toHaveAttribute('data-assembly-motion-kind', 'mount_travel_xy');
  await expect(assemblyWorkbench).toHaveAttribute('data-active-board-coords', /[A-O](?:[1-9]|1[0-5]).*[A-O](?:[1-9]|1[0-5])/);
  await expect(assemblyWorkbench).toHaveAttribute('data-floating-reference-coords', '');
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-motion-kind', 'mount_travel_xy');
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-active-board-coords', /[A-O](?:[1-9]|1[0-5]).*[A-O](?:[1-9]|1[0-5])/);
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-rendered-board-marker-count', '2');
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-board-surface', '15x15-hole-board');
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-board-hole-count', '225');
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-board-z', '0.00');
  await sharedAssemblyPlayer.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => Number(await assemblyWorkbench.getAttribute('data-progress')), { message: 'shared player animates the active assembly step' }).toBeGreaterThan(0);
  const pauseAssembly = sharedAssemblyPlayer.getByRole('button', { name: 'Pause' });
  if (await pauseAssembly.count()) await pauseAssembly.click();
  await sharedAssemblyPlayer.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByLabel('Assembly scrubber')).toHaveValue('0');
  await expect.poll(async () => Number(await assemblyWorkbench.getAttribute('data-progress')), { message: 'shared player start-over resets assembly progress' }).toBe(0);
  await page.getByTestId('assembly-step-list').getByRole('button', { name: /Connect character/i }).click();
  await expect(assemblyWorkbench).toHaveAttribute('data-assembly-motion-kind', 'connect_travel_xy');
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-motion-kind', 'connect_travel_xy');
  await page.getByTestId('assembly-step-list').getByRole('button', { name: /Test motion/i }).click();
  await expect(assemblyWorkbench).toHaveAttribute('data-assembly-motion-kind', 'scrub_time');
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-motion-kind', 'scrub_time');
  await clickStage(page, 'Blueprint');
  await expect(page.getByRole('button', { name: 'Download JSON default' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Guide HTML', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Metadata', exact: true })).toHaveCount(0);
  await expect(page.getByText('Teacher files')).toHaveCount(0);
  await expect(page.getByTestId('custom-parts-export-lane').getByRole('button', { name: 'Character SVG', exact: true })).toBeVisible();
  await expect(page.getByTestId('custom-parts-export-lane').getByRole('button', { name: 'Character PDF', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF cut sheet default' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download SVG default' })).toBeVisible();
  await expect(page.getByTestId('stage-canvas-pane').locator('img[alt="Cut sheet"]')).toHaveCount(0);

  const firstExportedPackage = await readBlueprintPackage(page);
  const metadataText = firstExportedPackage.metadataJson ?? '';
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
    recipe.targetPartId === 'right_hand_part' &&
    recipe.targetPathId === 'path-right-arm' &&
    recipe.targetAnchorJointId === 'right_hand' &&
    recipe.targetPartName === 'Right hand' &&
    recipe.steps?.some(step => /Place graph module|Graph family|Parts:|Ready/.test(step)) &&
    recipe.assemblySteps?.some((step: { instruction?: string }) => /Place .* at|Connect .*hole link/.test(step.instruction ?? '')) &&
    Array.isArray(recipe.warnings)
  )).toBe(true);

  const exportedPackage = await readBlueprintPackage(page);
  expect(exportedPackage.assemblyGuideHtml).toContain('assembly guide');
  expect(exportedPackage.assemblyGuideHtml).toContain('Right hand');
  expect(exportedPackage.assemblyGuidePdf.slice(0, 5)).toBe('%PDF-');

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

  expect(exportedPackage.customPartsStl).toContain('solid motionsmith_custom_parts');
  expect(exportedPackage.customPartsStl).toContain('facet normal');

  const [svgDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('custom-parts-export-lane').getByRole('button', { name: 'Character SVG', exact: true }).click()
  ]);
  const svgPath = await svgDownload.path();
  expect(svgPath, 'svg download path').toBeTruthy();
  const svgText = await readFile(svgPath!, 'utf8');
  expect(svgText).toContain('<metadata>');
  expect(svgText).toContain('custom-parts');
  expect(svgText).toContain('fabricablePartOutlinePoints');
  expect(svgText).toContain('Waving arm');
  expect(svgText).toContain('data-part-id="right_arm_lower"');
  expect(svgText).toContain('data-character-print-page="letter"');
  expect(svgText).toContain('data-character-print-mode="whole-character-exploded"');
  expect(svgText).toContain('data-character-exploded-sheet');
  expect(svgText).toContain('width="215.9mm"');
  expect(svgText).toContain('height="279.4mm"');
  expect(svgText).toContain('viewBox="0 0 215.9 279.4"');

  await page.getByTestId('workspace-steps').getByRole('button', { name: 'Options' }).click();
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
  await expect(page.getByTestId('options-fabrication')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Export', exact: true })).toHaveValue('both');
  await expect(page.getByRole('combobox', { name: 'Format', exact: true })).toHaveValue('both');

  expectCleanPage(pageErrors, consoleErrors);
});

test('Assembly shows character pins as a separate board build stage', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await waitForBootLoader(page);
  const gettingStarted = page.getByTestId('getting-started-dialog');
  await gettingStarted.getByTestId('getting-started-card-guided').click();
  await gettingStarted.getByTestId('guided-project-card-waving-arm').click();
  await expectProjectCounts(page, 14, 1, 1);
  await clickStage(page, 'Assembly');
  await expect(page.locator('h2.current-stage-title', { hasText: 'Assembly' })).toBeVisible();
  await expect(page.getByTestId('assembly-mode-switch')).toBeVisible();
  const characterMode = page.getByTestId('assembly-mode-switch').getByRole('button', { name: /^Character$/ });
  await expect(characterMode).toBeEnabled();
  await characterMode.click();
  await expect(page.getByTestId('assembly-lane-switch')).toHaveCount(0);

  const workbench = page.getByTestId('assembly-readonly-step-strip');
  await expect(workbench).toBeVisible();
  await expect(workbench).toHaveAttribute('data-assembly-frame-kind', 'character');
  await expect(page.getByTestId('assembly-character-three-preview')).toBeVisible();
  await expect(page.getByTestId('assembly-three-puppet-canvas')).toHaveCount(0);
  const characterAssemblyThree = page.getByTestId('assembly-character-three-preview').getByTestId('foundry-camera-rig');
  await expect(characterAssemblyThree).toHaveAttribute('data-viewer-tab', 'assembly');
  await expect(characterAssemblyThree).toHaveAttribute('data-three-assembly-scene', 'contract-driven');
  await expect(characterAssemblyThree).toHaveAttribute('data-three-automata-context', 'shown');
  await expect(characterAssemblyThree).toHaveAttribute('data-three-part-art', 'top-texture-decal');
  expect(Number(await characterAssemblyThree.getAttribute('data-three-automata-part-count')), 'Character assembly 3D includes body parts').toBeGreaterThan(0);
  expect(Number(await characterAssemblyThree.getAttribute('data-three-part-art-count')), 'Character assembly preserves part artwork').toBeGreaterThan(0);
  await expect(page.getByTestId('assembly-scene-part-list')).toBeVisible();
  await page.getByTestId('assembly-step-list').getByRole('button', { name: /Fixed pins/i }).click();
  await expect(workbench).toHaveAttribute('data-step-phase', 'fixed-pins');
  await expect(workbench).toHaveAttribute('data-assembly-motion-kind', 'explode_z');
  await expect(workbench).toHaveAttribute('data-active-board-coords', /^[A-O]([1-9]|1[0-5])/);
  await expect(characterAssemblyThree).toHaveAttribute('data-three-exploded', 'false');
  await expect(characterAssemblyThree).toHaveAttribute('data-three-assembly-motion-kind', 'explode_z');
  await expect(characterAssemblyThree).toHaveAttribute('data-three-assembly-board-surface', '15x15-hole-board');
  await expect(characterAssemblyThree).toHaveAttribute('data-three-assembly-board-hole-count', '225');
  await expect(characterAssemblyThree).toHaveAttribute('data-three-assembly-board-z', '0.00');
  expect(Number(await characterAssemblyThree.getAttribute('data-three-assembly-rendered-board-marker-count')), 'Fixed pins render board markers in the shared Foundry rig').toBeGreaterThan(0);
  await page.getByTestId('assembly-step-list').getByRole('button', { name: /Free pivots/i }).click();
  await expect(workbench).toHaveAttribute('data-step-phase', 'free-pivots');
  await expect(workbench).toHaveAttribute('data-assembly-motion-kind', 'explode_z');
  expect(Number(await characterAssemblyThree.getAttribute('data-three-assembly-rendered-floating-marker-count')), 'Free pivots render floating markers in the shared Foundry rig').toBeGreaterThan(0);
  await page.getByTestId('assembly-step-list').getByRole('button', { name: /Attach character/i }).click();
  await expect(workbench).toHaveAttribute('data-step-phase', 'attach-character');
  await expect(workbench).toHaveAttribute('data-assembly-motion-kind', 'connect_travel_xy');
  await expect(characterAssemblyThree).toHaveAttribute('data-three-assembly-motion-kind', 'connect_travel_xy');
  await page.getByTestId('assembly-step-list').getByRole('button', { name: /Test character/i }).click();
  await expect(workbench).toHaveAttribute('data-step-phase', 'test-character');
  await expect(workbench).toHaveAttribute('data-assembly-motion-kind', 'scrub_time');
  await expect(characterAssemblyThree).toHaveAttribute('data-three-assembly-motion-kind', 'scrub_time');
  await expect(page.getByTestId('character-assembly-inspector')).toContainText(/Board pins and moving joints/i);
  await expect(page.getByTestId('assembly-guide-preview')).not.toContainText('Add a mechanism first.');
  await expect(page.getByTestId('stage-canvas-pane').getByTestId('assembly-readonly-step-strip')).toBeVisible();
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
  await switchGettingStartedToStarters(page);
  await expect(page.getByTestId('getting-started-dialog')).not.toContainText('Character file');
  await page.getByRole('button', { name: 'Close' }).click();
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
  await expect(page.getByTestId('character-motion-preset-summary')).toBeVisible();
  await expect(page.getByLabel('Edit joint')).toBeHidden();
  await page.getByText('Edit skeleton').click();
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

test('Character replacement package starts clean without keep-mechanisms toggle', async ({ page }) => {
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
  await expect(page.getByTestId('character-import-controls')).not.toContainText('Keep mechanisms');
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
  await expectProjectCounts(page, 1, 0, 0);

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
  await expect(page.getByTestId('design-shared-foundry-preview')).toBeVisible();
  await expect(page.getByTestId('design-canvas')).toHaveCount(0);
  const anchorXInput = page.getByLabel('anchor X number');
  const anchorYInput = page.getByLabel('anchor Y number');
  await expect(anchorXInput, 'Design keeps off-grid anchor X editable so users can recover after grid pitch changes').toBeEnabled();
  await expect(anchorYInput, 'Design keeps off-grid anchor Y editable so users can recover after grid pitch changes').toBeEnabled();
  await anchorXInput.fill('0');
  await anchorXInput.press('Enter');
  await anchorYInput.fill('100');
  await anchorYInput.press('Enter');
  await clickStage(page, 'Blueprint');
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeEnabled();
  await expect(page.getByTestId('blueprint-control-panel')).toContainText(/Ready\.|Motion \d+%/);
  await page.getByRole('button', { name: /Generate package/i }).click();
  await expect(page.getByRole('button', { name: 'Download JSON default' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download SVG default' })).toBeVisible();
  await expect(page.getByTestId('custom-parts-export-lane').getByRole('button', { name: 'Character SVG', exact: true })).toBeVisible();

  const fabricationPackage = await readBlueprintPackage(page);
  expect(fabricationPackage, 'fabrication package stored in project state').toBeTruthy();
  expect(fabricationPackage.svg, 'physical blueprint SVG is included in the package').toContain('data-blueprint-source="fabrication-contract"');
  expect(fabricationPackage.svg).toContain('data-board-callout');
  expect(fabricationPackage.svg).not.toContain('opacity="0.22"');
  expect(fabricationPackage.svg).not.toContain('data-cut-part');

  const metadata = await downloadMetadataJson(page);
  expect(metadata.profile.gridPitchMm).toBe(25);

  await page.getByRole('button', { name: /Options/i }).click();
  const laterGridPitchInput = page.getByLabel('Grid pitch mm number');
  await expect(laterGridPitchInput, 'Board pitch remains editable after generating a package').toBeEnabled();
  await laterGridPitchInput.fill('30');
  await laterGridPitchInput.press('Enter');
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
  const optionsPreview = page.getByRole('img', { name: 'Options preview canvas' });
  await expect(optionsPreview).toBeVisible();
  await expect(optionsPreview).toContainText(/Letter sheet .* grid/);
  await expect(optionsPreview).toContainText(/theme .* speed .* export/);
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
  await expect(page.getByTestId('rig-structure-hidden')).toHaveCount(0);
  await expect(page.getByTestId('stage-left-pane')).not.toContainText('Rig setup');
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await page.getByRole('button', { name: /Options/i }).click();
  await page.getByLabel('Part panel').check();
  await page.getByRole('button', { name: /Path Editor/i }).click();
  await expect(page.getByTestId('rig-structure-drawer')).toHaveCount(0);
  await expect(page.getByTestId('stage-left-pane')).not.toContainText('Rig setup');
  await page.getByRole('button', { name: /Options/i }).click();

  await page.locator('label').filter({ hasText: 'Dev mode' }).locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /Path Editor/i }).click();
  await expect(page.getByTestId('canvas-debug-visuals')).toBeVisible();
  await page.getByRole('button', { name: /Options/i }).click();

  await page.getByLabel('Enable autosave').check();
  await page.getByLabel('Autosave seconds number').fill('1');
  await page.getByLabel('Autosave seconds number').press('Enter');
  await page.getByLabel('Duration number').fill('6');
  await page.getByLabel('Duration number').press('Enter');
  await page.getByLabel('Timing profile').selectOption('ease-in-out');
  await page.getByLabel('Friction number').fill('0.42');
  await page.getByLabel('Friction number').press('Enter');
  await page.getByLabel('Mass number').fill('1.75');
  await page.getByLabel('Mass number').press('Enter');
  await page.getByLabel('Performance preset').selectOption('high');
  await page.getByLabel('Snap quality').selectOption('high');
  await page.getByLabel('Import details').check();
  await page.getByLabel('Download file').selectOption('svg');
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
  await expect(page.getByTestId('design-shared-foundry-preview')).toBeVisible();
  await expect(page.getByTestId('design-canvas')).toHaveCount(0);
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').fill('0');
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').press('Enter');
  await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').fill('100');
  await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').press('Enter');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('motionsmith.autosave') ?? '{}')?.mechanisms?.[0]?.anchorX), { timeout: 15000 }).toBe(0);
  await clickStage(page, 'Blueprint');
  await page.getByRole('button', { name: /Generate package/i }).click();
  await expect(page.getByRole('button', { name: 'Download JSON default' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download SVG default' })).toBeVisible();
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
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');

  await page.getByLabel('Motion target').selectOption('head');
  await expect(page.getByLabel('Motion target')).toHaveValue('head');
  await expect(page.getByTestId('free-draw-status')).toContainText('No path yet');
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
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
  await expect(page.getByTestId('free-draw-status')).toHaveAttribute('data-draw-mode', 'idle');
  const newHeadPath = pathCanvas.getByTestId('selected-motion-path');
  await expect(newHeadPath).toHaveAttribute('data-path-closed', 'true');
  await expect(newHeadPath).toHaveAttribute('d', /Z$/);
  await expect(page.getByTestId('novice-path-panel').getByRole('button', { name: 'Choose mechanism' })).toHaveCount(0);

  await page.getByLabel('Motion target').selectOption('right_arm_lower');
  await expect(page.getByTestId('free-draw-status')).toContainText('No path yet');
  await expect(page.getByText('No path.')).toBeVisible();
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByTestId('path-view-2d')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(canvasBox!.x + 250, canvasBox!.y + 260);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 290, canvasBox!.y + 245);
  await page.mouse.move(canvasBox!.x + 330, canvasBox!.y + 260);
  await page.mouse.up();
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
  await expect(page.getByText('No path.')).toHaveCount(0);
  await expect(page.getByTestId('quick-rig-helper')).toContainText('Move part');
  await expect(page.getByLabel('Motion start')).toHaveValue('right_elbow');
  await expect(page.getByLabel('Motion handle')).toHaveValue('right_hand');
  await expect(page.getByTestId('ik-chain-summary')).toContainText('Motion ready');
  await page.getByTestId('ik-chain-root-options').getByRole('button', { name: 'right elbow' }).click();
  await expect(page.getByLabel('Motion start')).toHaveValue('right_elbow');
  await page.getByLabel('Motion handle').selectOption('right_elbow');
  await expect(page.getByLabel('Motion handle')).toHaveValue('right_elbow');
  await expect(page.getByLabel('Motion start')).toHaveValue('right_elbow');
  await expect(page.getByTestId('ik-chain-summary')).toContainText('Motion ready');
  await expect(page.getByTestId('fold-direction-control')).toContainText('Pick elbow/knee');
  await expect(page.getByTestId('path-shape-controls')).toBeVisible();
  const selectedMotionPath = pathCanvas.getByTestId('selected-motion-path');
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
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');

  await page.getByTestId('novice-path-panel').getByText('More', { exact: true }).click();
  const stopButtonBeforePreview = page.getByTestId('novice-path-panel').getByRole('button', { name: /Stop/i });
  if (await stopButtonBeforePreview.count()) await stopButtonBeforePreview.click();
  await page.getByLabel('Motion handle').selectOption('right_hand');
  await page.getByTestId('ik-chain-root-options').getByRole('button', { name: 'right shoulder' }).click();
  await expect(page.getByLabel('Motion start')).toHaveValue('right_shoulder');
  await expect(page.getByLabel('Motion handle')).toHaveValue('right_hand');
  await expect(page.getByTestId('ik-chain-summary')).toContainText('Motion ready');
  await page.getByRole('button', { name: 'Fold left', exact: true }).click();
  await expect(page.getByTestId('fold-direction-control')).toContainText('left');
  const upperArmTransformBeforePlay = await page.getByTestId('path-part-right_arm_upper').getAttribute('transform');
  const armTransformBeforePlay = await page.getByTestId('path-part-right_arm_lower').getAttribute('transform');
  await page.getByTestId('novice-path-panel').getByRole('button', { name: /Play/i }).click();
  await expect(page.getByText('Motion target')).toBeVisible();
  await expect(page.getByTestId('path-part-right_arm_upper')).not.toHaveAttribute('transform', upperArmTransformBeforePlay ?? '');
  await expect(page.getByTestId('path-part-right_arm_lower')).not.toHaveAttribute('transform', armTransformBeforePlay ?? '');
  await page.getByTestId('novice-path-panel').getByRole('button', { name: /Stop/i }).click();
  await page.getByTestId('ik-chain-root-options').getByRole('button', { name: 'right elbow' }).click();
  await page.getByLabel('Motion handle').selectOption('right_elbow');
  const artXBefore = await page.getByTestId('path-part-art-right_arm_lower').getAttribute('x');
  await clickStage(page, 'Character');
  await page.getByTestId('character-part-item-right_arm_lower').click();
  await expect(page.getByTestId('character-rig-actions')).toBeVisible();
  await expect(page.getByLabel('Art offset X number')).toBeHidden();
  await page.getByTestId('part-art-controls').locator('summary').click();
  await page.getByLabel('Art offset X number').fill('-12');
  await page.getByLabel('Art offset X number').press('Enter');
  const partLocked = page.locator('label').filter({ hasText: 'Locked' }).first().locator('input[type="checkbox"]');
  await page.getByLabel('Part pivot').selectOption('right_elbow');
  await expect(page.getByLabel('Part pivot')).toHaveValue('right_elbow');
  await partLocked.check();
  await page.getByRole('button', { name: /Path Editor/i }).click();
  await page.getByTestId('path-view-2d').click();
  await expect(page.getByTestId('path-part-art-right_arm_lower')).toHaveAttribute('x', '-12');
  await expect(page.getByTestId('path-part-plate-right_arm_lower')).toHaveAttribute('data-art-offset-x', '-12');
  expect(await page.getByTestId('path-part-art-right_arm_lower').getAttribute('x'), 'art offset control moves the visible path-editor artwork').not.toBe(artXBefore);
  await expect(page.getByRole('button', { name: 'Draw free path', exact: true })).toBeDisabled();
  await page.getByTestId('novice-path-panel').getByText('More', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Trace', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Clear path', exact: true })).toBeDisabled();
  await expect(page.getByText('Unlock target.')).toBeVisible();
  await expect(page.getByLabel('X number').first()).toHaveCount(0);
  await page.getByTestId('path-canvas').click({ position: { x: 260, y: 220 } });
  await expect(page.getByTestId('free-draw-status')).toContainText(/Path ready.*locked/);

  await clickStage(page, 'Character');
  await partLocked.uncheck();
  await page.getByRole('button', { name: /Path Editor/i }).click();
  await page.getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByTestId('foundry-target-summary')).toHaveCount(0);
  await expect(page.getByTestId('stage-left-pane')).not.toContainText(/chain|Board hole|Target .*pts/i);

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
  await expect(page.getByTestId('stage-right-inspector').getByTestId('foundry-visible-sensemaking')).toContainText('Crank turns');
  await expect(page.getByTestId('foundry-mechanism-gallery')).not.toContainText('Crank turns -> rocker swings');
  const foundryMechanismTypeCount = FOUNDRY_MECHANISM_TYPES.length;
  await expect(page.locator('[data-testid^="foundry-mini-simulation-"]')).toHaveCount(foundryMechanismTypeCount);
  await expect(page.locator('[data-testid^="foundry-mini-linkage-"]')).toHaveCount(foundryMechanismTypeCount);
  await expect(page.locator('[data-testid^="foundry-mini-ghost-"]')).toHaveCount(foundryMechanismTypeCount * 2);
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
  await expect(threeScene).toHaveAttribute('data-three-stack-source', 'compileMechanismRenderPlan');
  await expect(threeScene).toHaveAttribute('data-three-stack-mode', 'assembled-spacer-separated');
  await expect(threeScene).toHaveAttribute('data-three-exploded', 'false');
  await expect(threeScene).toHaveAttribute('data-three-base-layer', 'Base board');
  await expect(threeScene).toHaveAttribute('data-three-stack-order', /^Back Clip → .*S10 spacer.*Front Clip$/);
  await expect(threeScene).toHaveAttribute('data-three-spacer-key', 's10');
  await expect(threeScene).toHaveAttribute('data-three-spacer-mm', '10x4');
  expect(Number(await threeScene.getAttribute('data-three-z-collision-count')), 'Foundry has no unsupported canonical z-stack collisions').toBe(0);
  await expect(threeScene).toHaveAttribute('data-three-spacer-render-contract', 'compiled-support-path-membership');
  await expect(threeScene).toHaveAttribute('data-three-pin-stack-policy', 'compiler-support-paths');
  await expect(threeScene).toHaveAttribute('data-three-spacer-render-count', '4');
  const spacerPinIds = (await threeScene.getAttribute('data-three-spacer-pin-ids') ?? '')
    .split(',')
    .map(item => item.split(':')[1])
    .filter(Boolean)
    .sort();
  expect(spacerPinIds, '4bar renders one compiler-owned physical spacer at each A/B/C/D support path regardless of flattened inventory order').toEqual(['A', 'B', 'C', 'D']);
  await expect(threeScene).toHaveAttribute('data-three-board-pivot-spacer-mode', 'compiled-path-spacer');
  await expect(threeScene).toHaveAttribute('data-three-board-pivot-spacer-ids', 'A,D');
  await expect(threeScene).toHaveAttribute('data-three-board-pivot-fastener-contract', 'board>linkage>spacer>retainer');
  await expect(threeScene).toHaveAttribute('data-three-z-collision-count', '0');
  const spanSummary = await threeScene.getAttribute('data-three-pin-stack-spans') ?? '';
  const pinSpans = Object.fromEntries(spanSummary.split(',').map(item => {
    const [id, value] = item.split(':');
    return [id, Number(value)];
  }));
  expect(pinSpans.A, 'Ground pivot A only carries the input link, so its pin is shorter than the B shared-link stack').toBeLessThan(pinSpans.B);
  expect(pinSpans.D, 'Ground pivot D carries only its own output link and local board-side spacer, so it must not protrude through the C shared-link stack').toBeLessThan(pinSpans.C);
  await expect(threeScene, '4bar pins consume the compiler-owned support paths and exact pin spans').toHaveAttribute('data-three-pin-stack-z-sources', 'compiled-support-paths-and-pin-spans');
  await expect(threeScene).toHaveAttribute('data-three-stack-roles', /^clip>.*spacer.*>clip$/);
  await expect(threeScene).toHaveAttribute('data-three-stack-colors', /#334155.*#f59e0b/);
  await expect(threeScene).toHaveAttribute('data-three-stack-validation-errors', '0');
  expect(await threeScene.getAttribute('data-three-rendered-layer-labels')).toBe(await threeScene.getAttribute('data-three-stack-order'));
  expect(await threeScene.getAttribute('data-three-rendered-layer-roles')).toBe(await threeScene.getAttribute('data-three-stack-roles'));
  expect(await threeScene.getAttribute('data-three-rendered-layer-colors')).toBe(await threeScene.getAttribute('data-three-stack-colors'));
  expect(await threeScene.getAttribute('data-three-rendered-layer-z'), '4bar renders the validated fabrication z stack instead of collapsing A/D ground links into an impossible side-view overlap').toBe(await threeScene.getAttribute('data-three-stack-z'));
  await expect(threeScene).toHaveAttribute('data-three-fourbar-ground-link-plane', 'fabrication-stack-separated');
  await expect(threeScene).toHaveAttribute('data-three-physical-validation-errors', '0');
  await expect(threeScene).toHaveAttribute('data-three-preview-renderable', 'ready');
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
  await expect(threeScene, 'Four-bar hardware pins come only from compiler-owned support paths').toHaveAttribute('data-three-physical-pin-contract', 'compiled-support-paths');
  await expect(threeScene).toHaveAttribute('data-three-physical-pin-count', '4');
  await expect(threeScene, 'Generated trace/path is hidden until explicitly requested so it does not read as a floating mechanism part').toHaveAttribute('data-path-preview', 'hidden');
  await expect(page.getByTestId('foundry-physics-readout')).toHaveCount(0);
  await expect(page.getByTestId('stage-right-inspector')).not.toContainText('Preview overlays');
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
  await page.getByRole('button', { name: 'Hint' }).click();
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('Four-bar linkage');
  await expect(page.getByTestId('foundry-mechanism-library')).not.toContainText('pin reactions');
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('driver crank turns and rocker swings');
  await expect(page.getByTestId('foundry-mechanism-library')).not.toContainText('Back Clip');
  await expect(page.getByTestId('foundry-mechanism-library')).not.toContainText('Spacer 10mm');
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('Answer: The board pivots stay fixed');
  await page.getByRole('button', { name: 'Hide hint' }).click();
  await expect(page.getByTestId('foundry-target-summary')).toHaveCount(0);
  await expect(page.getByTestId('foundry-anchor-marker'), 'Default sandbox keeps non-mechanism markers hidden').toHaveCount(0);
  await expect(page.getByLabel('Foundry mechanism type')).toBeHidden();
  await page.getByText('Mechanism options').click();
  await expect(page.getByTestId('foundry-param-handles'), '4bar exposes direct A/B/C/D joint handles in the WebGL overlay').toHaveAttribute('data-handle-contract', 'move-anchor-plus-shape-handles');
  await expect(page.getByTestId('foundry-param-handles'), '4bar overlay handles keep board pivots on the low board-side stack and floating joints on top').toHaveAttribute('data-handle-z-contract', 'board-pivots-bottom-floating-top');
  await expect(page.getByTestId('foundry-param-handles'), '4bar exposes move plus A/B/C/D handles in the WebGL overlay').toHaveAttribute('data-handle-ids', 'M,A,B,C,D');
  await expect(page.getByTestId('foundry-cycle-output-trace'), 'Foundry can switch among candidate motion target points for Mech Path').toBeEnabled();
  await page.getByTestId('foundry-toggle-paths').click();
  await page.getByTestId('foundry-cycle-output-trace').click();
  await expect(threeScene).toHaveAttribute('data-three-primary-path-id', 'B');
  await page.getByTestId('foundry-cycle-output-trace').click();
  await expect(threeScene).toHaveAttribute('data-three-primary-path-id', 'C');
  await page.getByTestId('foundry-toggle-paths').click();
  const handleZMap = await page.getByTestId('foundry-param-handles').getAttribute('data-handle-z-map') ?? '';
  const handleZ = Object.fromEntries(handleZMap.split(',').map(item => { const [id, value] = item.split(':'); return [id, Number(value)]; }));
  expect(handleZ.A, 'A handle is projected on its short board-pivot stack, not the global top layer').toBeLessThan(handleZ.B);
  expect(handleZ.D, 'D handle is projected from its own board-pivot stack and may share the top z when output is the top layer').toBeLessThanOrEqual(handleZ.C);
  await expect(page.getByTestId('foundry-param-handle-A')).toHaveAttribute('data-draggable', 'false');
  await expect(page.getByTestId('foundry-param-handle-D'), 'D ground handle stays visible but locked when every other ground span would jam').toHaveAttribute('data-draggable', 'false');
  const groundHandleBox = await page.getByTestId('foundry-param-handle-D').boundingBox();
  expect(groundHandleBox, 'locked ground handle is still visible as a physical constraint').toBeTruthy();

  await page.getByLabel('Foundry mechanism type').selectOption('gear');
  await expect(page.getByTestId('foundry-parametric-editor'), 'Foundry exposes fabrication-backed gear selectors').toBeVisible();
  await page.getByLabel('Drive gear size').selectOption('g40');
  await page.getByLabel('Output gear size').selectOption('g56');
  await page.getByRole('button', { name: 'Add idler gear' }).click();
  await page.getByLabel('Idler gear 1 size').selectOption('g8');
  await expect(threeScene, 'Gear train param editor writes ordered drive/idler/output radii to the shared preview').toHaveAttribute('data-three-gear-radii', '100.00,20.00,140.00');
  await expect(threeScene, 'Inserted idlers close the endpoint span into an adjacent pitch chain').toHaveAttribute('data-three-gear-train-endpoint-mode', 'idler-connected-pitch-chain');
  await expect(threeScene, 'Gear train axles are generated from the same fitted centers used to draw the gear plates').toHaveAttribute('data-three-gear-center-source', 'fitted-simulation-pitch-centers');
  await expect(threeScene).toHaveAttribute('data-three-gear-center-count', '3');
  await expect(threeScene).toHaveAttribute('data-three-gear-axle-center-contract', 'pin-stacks-use-rendered-gear-centers');
  await expect(threeScene, 'Adjacent gear plates use alternating tooth/gap phase so pitch-center contact does not render as tooth overlap').toHaveAttribute('data-three-gear-mesh-phase-contract', 'alternating-three-quarter-tooth-gap-phase');
  await expect(threeScene).toHaveAttribute('data-three-gear-mesh-phases', '0.00,33.75,0.00');
  expect(await threeScene.getAttribute('data-three-gear-axle-centers'), 'Every visible gear axle sits on its rendered gear center').toBe(await threeScene.getAttribute('data-three-gear-centers'));
  expect(Number(await threeScene.getAttribute('data-three-gear-center-max-error')), 'Fitted gear centers preserve fabrication pitch spacing after preview scaling').toBeLessThan(0.75);
  await expect(threeScene, 'Dynamic gear stack uses the same G1/G5/G7 fabrication labels as Blueprint/Assembly').toHaveAttribute('data-three-stack-order', /Drive G5 \/ 5-space gear.*Idler G1 \/ 1-space gear 1.*Output G7 \/ 7-space gear/);

  await page.getByLabel('Foundry mechanism type').selectOption('gear_linkage');
  await expect(page.getByTestId('foundry-parametric-editor'), 'Gear linkage exposes the shared parametric editor').toBeVisible();
  await page.getByLabel('Drive gear size').selectOption('g40');
  await expect(page.getByLabel('Output gear size').locator('option[value="g56"]'), 'gear-linkage locks gear ratios that cannot close the paired links').toHaveAttribute('disabled', '');
  await page.getByLabel('Output gear size').selectOption('g40');
  await page.getByLabel('Paired link length').selectOption('6');
  await expect(threeScene, 'Gear linkage param editor keeps only full-motion output gear and linkage choices in the fabrication stack').toHaveAttribute('data-three-stack-order', /(?=.*Drive G5 \/ 5-space gear)(?=.*Output G5 \/ 5-space gear)(?=.*Drive connector 7-hole link)(?=.*Output connector 7-hole link)/);
  await expect(threeScene, 'Gear linkage crank pin snaps to a real attachment hole on the selected output gear').toHaveAttribute('data-three-linkage-pin-radius', /\d+\.\d+/);
  await expect(page.getByTestId('foundry-param-handles'), 'Gear linkage keeps the shared move handle even without 4bar-only shape handles').toHaveAttribute('data-handle-ids', 'M');
  await page.getByTestId('foundry-toggle-paths').click();
  await expect(threeScene, 'Gear linkage shows all selectable Mech Path candidates').toHaveAttribute('data-three-path-trace-ids', 'B,C,R');
  await expect(threeScene, 'Gear linkage defaults to the shared linkage output as the Mech Path target').toHaveAttribute('data-three-primary-path-id', 'R');
  const gearLinkageCanvasPane = page.getByTestId('foundry-canvas-pane');
  const gearLinkageAnchorBefore = await gearLinkageCanvasPane.getAttribute('data-fit-anchor-grid');
  const moveHandleBox = await page.getByTestId('foundry-param-handle-M').boundingBox();
  expect(moveHandleBox, 'gear linkage move handle is visible for direct placement').toBeTruthy();
  await page.mouse.move(moveHandleBox!.x + moveHandleBox!.width / 2, moveHandleBox!.y + moveHandleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(moveHandleBox!.x + moveHandleBox!.width / 2 + 80, moveHandleBox!.y + moveHandleBox!.height / 2 + 20);
  await page.mouse.up();
  await expect.poll(async () => gearLinkageCanvasPane.getAttribute('data-fit-anchor-grid'), { message: 'dragging the M handle repositions gear linkage on the fabrication board' }).not.toBe(gearLinkageAnchorBefore);
  await page.getByTestId('foundry-toggle-paths').click();

  await page.getByLabel('Foundry mechanism type').selectOption('4bar');
  await expect(page.getByLabel('Input link length'), '4bar exposes visible linkage blank selectors instead of hidden generic numbers').toBeVisible();

  const foundryPhysicalMarkers: Record<string, Array<[string, number]>> = {
    '4bar': [['data-three-part-count', 5], ['data-three-hole-count', 11]],
    cam: [['data-three-cam-count', 1], ['data-three-follower-count', 1], ['data-three-hole-count', 10]],
    gear: [['data-three-gear-count', 2], ['data-three-hole-count', 8]],
    gear_linkage: [['data-three-gear-count', 2], ['data-three-hole-count', 20]],
    planetary_gear: [['data-three-gear-count', 3], ['data-three-hole-count', 13]]
  };

  for (const type of ['4bar', 'cam', 'gear', 'gear_linkage', 'planetary_gear']) {
    await page.getByLabel('Foundry mechanism type').selectOption(type);
    await expect(threeScene, `${type} has its own physical 3D preview template`).toHaveAttribute('data-mechanism-type', type);
    await expect(threeScene, `${type} uses the fabrication stack as the 3D render source`).toHaveAttribute('data-three-stack-source', 'compileMechanismRenderPlan');
    await expect(threeScene, `${type} stack has no validation errors`).toHaveAttribute('data-three-stack-validation-errors', '0');
    await expect(threeScene, `${type} physical readiness gate is clean`).toHaveAttribute('data-three-physical-validation-errors', '0');
    await expect(threeScene, `${type} preview is renderable only after shared physical validation passes`).toHaveAttribute('data-three-preview-renderable', 'ready');
    await expect(threeScene, `${type} exposes no compiler face-contact gap or overlap`).toHaveAttribute('data-three-support-contact-error-count', '0');
    await expect(threeScene, `${type} exposes no malformed spacer support degree`).toHaveAttribute('data-three-support-spacer-error-count', '0');
    await expect(threeScene, `${type} exposes no spacer or support-path blocker`).toHaveAttribute('data-three-support-blocker-count', '0');
    const supportPathKinds = await threeScene.getAttribute('data-three-support-path-kinds') ?? '';
    expect(supportPathKinds, `${type} browser diagnostics expose every exact compiler-owned plate, spacer, guide, and retainer path`).toBe(EXPECTED_COMPILED_SUPPORT_PATH_KINDS[type]);
    await expect(threeScene, `${type} renderer builds pins only from compiler support paths`).toHaveAttribute('data-three-physical-pin-contract', 'compiled-support-paths');
    await expect(threeScene, `${type} renderer uses compiler path membership instead of local A-F stack inference`).toHaveAttribute('data-three-pin-stack-policy', 'compiler-support-paths');
    await expect(threeScene, `${type} renderer consumes exact compiler pin spans`).toHaveAttribute('data-three-pin-stack-z-sources', 'compiled-support-paths-and-pin-spans');
    await expect(threeScene, `${type} renderer emits exactly one physical pin per pin-bearing support path`).toHaveAttribute('data-three-physical-pin-count', String(EXPECTED_COMPILED_PIN_COUNTS[type]));
    const supportPathPinSpans = (await threeScene.getAttribute('data-three-support-path-pin-spans') ?? '').split(';').filter(Boolean);
    expect(supportPathPinSpans.filter(item => !item.endsWith(':none')).length, `${type} support-path diagnostics retain each compiler pin span`).toBe(EXPECTED_COMPILED_PIN_COUNTS[type]);
    const stackRoles = await threeScene.getAttribute('data-three-stack-roles');
    expect(stackRoles, `${type} flattened inventory contains compiler-owned physical spacers`).toContain('spacer');
    expect(stackRoles, `${type} flattened inventory contains compiler-owned retainers without defining path order`).toContain('clip');
    expect(await threeScene.getAttribute('data-three-rendered-layer-labels'), `${type} rendered labels match fabrication stack labels`).toBe(await threeScene.getAttribute('data-three-stack-order'));
    expect(await threeScene.getAttribute('data-three-rendered-layer-roles'), `${type} rendered roles match fabrication stack roles`).toBe(await threeScene.getAttribute('data-three-stack-roles'));
    expect(await threeScene.getAttribute('data-three-rendered-layer-colors'), `${type} rendered colors match fabrication stack colors`).toBe(await threeScene.getAttribute('data-three-stack-colors'));
    const renderedLayerZ = await threeScene.getAttribute('data-three-rendered-layer-z') ?? '';
    const stackLayerZ = await threeScene.getAttribute('data-three-stack-z') ?? '';
    if (type === 'gear' || type === 'gear_linkage') {
      await expect(threeScene, `${type} reports whether its typed graph actually contains one mesh plane`).toHaveAttribute(
        'data-three-gear-plane-mode',
        type === 'gear' ? 'coplanar-fixed-axles' : 'independent-gear-planes'
      );
      expect(renderedLayerZ, `${type} render z consumes the compiler-owned canonical stack`).toBe(stackLayerZ);
      const roles = (await threeScene.getAttribute('data-three-rendered-layer-roles') ?? '').split('>');
      const zValues = renderedLayerZ.split(',').map(Number);
      const gearZValues = roles.flatMap((role, index) => role === 'gear' ? [zValues[index]] : []);
      if (type === 'gear') expect(new Set(gearZValues.map(z => z.toFixed(2))).size, `${type} all external gear plates share one pitch plane`).toBe(1);
      else expect(gearZValues.length, `${type} exposes gear layer z from the compiled stack`).toBeGreaterThanOrEqual(1);
    } else if (type === 'planetary_gear') {
      await expect(threeScene, 'Planetary keeps the ring, sun, and planet teeth on one mesh plane').toHaveAttribute('data-three-gear-plane-mode', 'planetary-coplanar-ring-sun-planet');
      await expect(threeScene, 'Planetary carrier pins consume exact compiler paths and spans').toHaveAttribute('data-three-pin-stack-z-sources', 'compiled-support-paths-and-pin-spans');
      expect(renderedLayerZ, 'Planetary render z consumes the compiler-owned coplanar gear and carrier stack').toBe(stackLayerZ);
      const roles = (await threeScene.getAttribute('data-three-rendered-layer-roles') ?? '').split('>');
      const zValues = renderedLayerZ.split(',').map(Number);
      const gearZValues = roles.flatMap((role, index) => role === 'gear' ? [zValues[index]] : []);
      expect(new Set(gearZValues.map(z => z.toFixed(2))).size, 'Planetary ring, sun, and planet share one pitch plane').toBe(1);
      await expect(threeScene, 'Planetary central and free owner paths expose exact compiler membership').toHaveAttribute(
        'data-three-planetary-owner-path-kinds',
        'sun-carrier-pivot-pin:gear>spacer>linkage>clip;planet-carrier-pin:clip>gear>spacer>linkage>clip'
      );
      await expect(threeScene, 'Planetary owner paths expose exact canonical plate and spacer faces').toHaveAttribute(
        'data-three-planetary-owner-path-faces',
        'sun-carrier-pivot-pin:0-4>4-5.6>5.6-9.6>9.6-10.4;planet-carrier-pin:-0.8-0>0-4>4-5.6>5.6-9.6>9.6-10.4'
      );
      await expect(threeScene, 'Only the central planetary owner path is board rooted').toHaveAttribute(
        'data-three-planetary-owner-path-roots',
        'sun-carrier-pivot-pin:board;planet-carrier-pin:free'
      );
    } else if (type === '4bar') {
      expect(renderedLayerZ, '4bar uses the fabrication z stack so A/D ground pivots cannot be side-view-collapsed into an impossible overlap').toBe(stackLayerZ);
    } else {
      expect(renderedLayerZ, `${type} rendered z order matches fabrication stack z order`).toBe(stackLayerZ);
    }
    if (type === '4bar') {
      await expect(threeScene, '4bar geometry resolves the three typed source nodes without label-owned A-F axial rules').toHaveAttribute('data-three-geometry-contract', /(?=.*input-link:linkage)(?=.*coupler-link:linkage)(?=.*output-link:linkage)/);
      await expect(threeScene, '4bar pin hardware is projected from compiled support paths').toHaveAttribute('data-three-physical-pin-contract', 'compiled-support-paths');
      await expect(threeScene).toHaveAttribute('data-three-physical-pin-count', '4');
      await expect(threeScene, '4bar renders recipe spacer sites at A/B/C/D without z-layer collisions').toHaveAttribute('data-three-spacer-render-count', '4');
      await expect(threeScene, '4bar ground pivots preserve the exact board, linkage, spacer, retainer order').toHaveAttribute('data-three-board-pivot-fastener-contract', 'board>linkage>spacer>retainer');
      await expect(threeScene, '4bar ground pivots A and D keep fabrication-separated z planes').toHaveAttribute('data-three-fourbar-ground-link-plane', 'fabrication-stack-separated');
      const boardSpacerZ = Object.fromEntries((await threeScene.getAttribute('data-three-board-pivot-spacer-z') ?? '').split(',').map(item => {
        const [id, value] = item.split(':');
        return [id, Number(value)];
      }));
      const pinLayerIndexes = Object.fromEntries((await threeScene.getAttribute('data-three-pin-stack-layer-indexes') ?? '').split(',').map(item => {
        const [id, indexes] = item.split(':');
        return [id, Number(indexes.split('+')[0])];
      }));
      const layerZ = renderedLayerZ.split(',').map(Number);
      expect(Number.isFinite(boardSpacerZ.A), "A board-side spacer is compiled for A's own input-link stack").toBe(true);
      expect(Number.isFinite(boardSpacerZ.D), "D board-side spacer is compiled for D's own output-link stack").toBe(true);
      await expect(threeScene, '4bar pins use compiler support paths so A/D do not protrude through unrelated stacks').toHaveAttribute('data-three-pin-stack-policy', 'compiler-support-paths');
      await expect(threeScene, '4bar ground A-D is a board reference span, not a fabricated moving linkage').toHaveAttribute('data-three-ground-span-mode', 'board-reference');
    }
    await expect(threeScene, `${type} preview keeps stack z-collisions at zero`).toHaveAttribute('data-three-z-collision-count', '0');
    if (type === 'cam') {
      await expect(threeScene, 'Cam follower guide stays board-fixed while the follower moves').toHaveAttribute('data-three-cam-guide-mode', 'fixed-board-guide');
      await expect(threeScene, 'Cam follower contact is sampled from the same rotating cam profile shown in 3D').toHaveAttribute('data-three-cam-contact-mode', 'sampled-profile-on-guide-axis');
      await expect(threeScene, 'Cam preview exposes only the compiler-owned cam axle support path as hardware').toHaveAttribute('data-three-cam-pin-contract', 'compiled-cam-axle-support-path');
      await expect(threeScene).toHaveAttribute('data-three-physical-pin-contract', 'compiled-support-paths');
      await expect(threeScene).toHaveAttribute('data-three-physical-pin-count', '1');
      expect(Number(await threeScene.getAttribute('data-three-cam-contact-error')), 'Cam surface, follower roller, and guide axis stay physically mated').toBeLessThan(0.75);
    }
    expect(Number(await threeScene.getAttribute('data-three-z-collision-count')), `${type} foundry preview has a packed supported z-stack`).toBe(0);
    await expect(page.getByTestId('foundry-forces-overlay'), `${type} keeps live force vectors visible`).toHaveAttribute('data-physics-rule', /force|torque|velocity|acceleration|reaction|contact|gravity|prismatic/);
    await expect(page.getByTestId('foundry-velocity-overlay'), `${type} keeps live velocity vectors visible`).toHaveAttribute('data-speed', /[0-9]+\.[0-9]+/);
    for (const [attr, minimumCount] of foundryPhysicalMarkers[type]) {
      expect(Number(await threeScene.getAttribute(attr)), `${type} preview includes ${attr}`).toBeGreaterThanOrEqual(minimumCount);
    }
    if (type === 'planetary_gear') {
      await expect(threeScene, 'Planetary geometry resolves typed sun, ring, planet, and carrier source nodes rather than recipe labels').toHaveAttribute('data-three-geometry-contract', /(?=.*sun-gear:gear)(?=.*ring-gear:gear)(?=.*planet-gear:gear)(?=.*carrier:linkage)/);
      await expect(threeScene, 'Planetary foundry syntax uses a fixed ring, sun input, carrier output set').toHaveAttribute('data-three-planetary-syntax', 'ring-fixed-sun-input-carrier-output');
      await expect(threeScene).toHaveAttribute('data-three-planetary-fixed', 'ring');
      await expect(threeScene).toHaveAttribute('data-three-planetary-input', 'sun');
      await expect(threeScene).toHaveAttribute('data-three-planetary-output', 'carrier');
      await expect(threeScene, 'Planetary carrier and planet render from the sampled simulation state so the gear stays on the carrier axle at every zoom scale').toHaveAttribute('data-three-planetary-center-source', 'simulation-state-carrier-center');
      await expect(threeScene).toHaveAttribute('data-three-planet-count', '1');
      const radii = (await threeScene.getAttribute('data-three-gear-radii') ?? '').split(',').map(Number);
      expect(radii, 'Planetary foundry exposes sun, one G3 planet, and ring radii from the fabrication convention').toHaveLength(3);
      expect(radii[2], 'Planetary ring pitch radius equals sun + 2*planet pitch radii').toBeCloseTo(radii[0] + 2 * radii[1], 2);
      const phaseControl = page.getByLabel('Foundry phase');
      const phaseBefore = Number(await phaseControl.inputValue());
      const playButton = page.getByTestId('foundry-toolbar').getByRole('button', { name: 'Play', exact: true });
      if (await playButton.count()) await playButton.click();
      await expect(page.getByTestId('foundry-toolbar-state'), 'Planetary preview stays in the running animation loop').toContainText('playing');
      await expect.poll(async () => Number(await phaseControl.inputValue()), { message: 'Planetary carrier animation keeps advancing instead of stopping mid-turn' }).not.toBe(phaseBefore);
      const pauseButton = page.getByTestId('foundry-toolbar').getByRole('button', { name: 'Pause', exact: true });
      if (await pauseButton.count()) await pauseButton.click();
    }
  }
  await page.getByLabel('Foundry mechanism type').selectOption('gear');
  await page.getByRole('button', { name: 'Hint' }).click();
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('Gear train');
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('mesh');
  await page.getByRole('button', { name: 'Hide hint' }).click();
  expect(Number(await threeScene.getAttribute('data-three-gear-count')), 'Gear preview uses toothed 3D fabrication geometry').toBeGreaterThanOrEqual(2);
  await expect(threeScene, 'Gear train renders endpoint gears only, without fake linkage rods').toHaveAttribute('data-three-gear-train-linkage-mode', 'gear-only-train');
  await expect(threeScene, 'Gear train hardware is limited to compiler-owned board gear support paths').toHaveAttribute('data-three-physical-pin-contract', 'compiled-support-paths');
  await expect(threeScene, 'Gear train geometry contract resolves only its typed gear source nodes').toHaveAttribute('data-three-geometry-contract', /(?=.*gear-0:gear)(?=.*gear-1:gear)/);
  await expect(threeScene, 'Gear train fabrication stack exposes both reference G3 gears').toHaveAttribute('data-three-stack-order', /Drive G3 \/ 3-space gear.*Output G3 \/ 3-space gear/);
  expect(Number(await threeScene.getAttribute('data-three-gear-pitch-center')), 'Default gear train keeps A/B at direct pitch contact').toBeCloseTo(Number(await threeScene.getAttribute('data-three-gear-pitch-sum')), 2);
  await expect(threeScene, 'Default gear train uses the reference G3/G3 pitch radii').toHaveAttribute('data-three-gear-radii', '60.00,60.00');
  const gearCount = await threeScene.getAttribute('data-three-gear-count');
  await expect(threeScene, 'Default gear train advertises direct pitch mesh').toHaveAttribute('data-three-gear-train-endpoint-mode', 'direct-pitch-mesh');
  await expect(threeScene, 'Default gear axles use fitted pitch-contact centers').toHaveAttribute('data-three-gear-center-source', 'fitted-simulation-pitch-centers');
  await expect(threeScene, 'Default endpoint gears are coupled by direct mesh').toHaveAttribute('data-three-gear-coupling-mode', 'direct-mesh');
  await expect(threeScene, 'Default endpoint gear output counter-rotates by the pitch ratio').toHaveAttribute('data-three-gear-output-ratio', '-1.000');
  await expect(threeScene).toHaveAttribute('data-three-gear-center-count', gearCount ?? '2');
  await expect(threeScene).toHaveAttribute('data-three-gear-axle-center-contract', 'pin-stacks-use-rendered-gear-centers');
  await expect(threeScene, 'Default meshed endpoint gears claim the active three-quarter-tooth phase').toHaveAttribute('data-three-gear-mesh-phases', '0.00,11.25');
  expect(await threeScene.getAttribute('data-three-gear-axle-centers'), 'Default gear axle centers match rendered gear centers').toBe(await threeScene.getAttribute('data-three-gear-centers'));
  expect(Number(await threeScene.getAttribute('data-three-gear-center-max-error')), 'Default direct mesh reports fitted pitch centers').toBeLessThan(0.01);
  await expect(threeScene, 'Each visible gear has one real fixed axle, with no orphan pin tower').toHaveAttribute('data-three-physical-pin-count', gearCount ?? '2');
  await expect(threeScene, 'Each G3 axle receives exactly one visible S10 spacer washer').toHaveAttribute('data-three-spacer-render-count', gearCount ?? '2');
  await expect(threeScene, 'Gear axle order is owned by each compiled support path').toHaveAttribute('data-three-gear-axle-stack-contract', 'compiled-support-path-order');
  await expect(threeScene, 'Gear axles span the exact compiled gear, spacer, and retainer nodes').toHaveAttribute('data-three-pin-stack-z-sources', 'compiled-support-paths-and-pin-spans');
  const gearAxleOrders = (await threeScene.getAttribute('data-three-gear-axle-z-order') ?? '').split(',').filter(Boolean);
  expect(gearAxleOrders.length, 'gear z-order contract covers every visible gear axle').toBe(Number(gearCount ?? '2'));
  expect(gearAxleOrders.every(item => item.endsWith(':gear>spacer>clip')), 'every fixed gear axle exposes its exact compiler-owned gear, S10 spacer, and retainer sequence').toBe(true);
  const gearPlaneZ = Number(await threeScene.getAttribute('data-three-gear-plane-z'));
  const gearSpacerZ = (await threeScene.getAttribute('data-three-gear-board-side-spacer-z') ?? '').split(',').map(item => Number(item.split(':')[1]));
  expect(gearSpacerZ.every(Number.isFinite), 'gear spacers are emitted from compiled stack metadata').toBe(true);
  const gearPinSpans = (await threeScene.getAttribute('data-three-pin-stack-spans') ?? '').split(',').map(item => Number(item.split(':')[1]));
  expect(Math.min(...gearPinSpans), 'gear axle pins cross the canonical stack instead of only the gear plate').toBeGreaterThan(0);
  await page.getByLabel('Foundry mechanism type').selectOption('gear_linkage');
  await expect(threeScene, 'Gear-linkage uses paired off-center G3 crank pins').toHaveAttribute('data-three-gear-linkage-mode', 'two-gear-two-link-coupler');
  await expect(threeScene, 'Gear-linkage uses two gear handles and paired L4 rods').toHaveAttribute('data-three-gear-train-linkage-mode', 'two-gear-two-link-coupler');
  await expect(threeScene, 'Gear-linkage reports independent gear planes because its typed graph has no mesh constraint').toHaveAttribute('data-three-gear-plane-mode', 'independent-gear-planes');
  await expect(threeScene, 'Gear-linkage pins include only exact compiler path spans').toHaveAttribute('data-three-pin-stack-z-sources', 'compiled-support-paths-and-pin-spans');
  await expect(threeScene, 'Gear-linkage hardware is projected from compiler-owned support paths').toHaveAttribute('data-three-physical-pin-contract', 'compiled-support-paths');
  await expect(threeScene, 'Gear-linkage has one pin for each drive, shared effector, and output support path').toHaveAttribute('data-three-physical-pin-count', '3');
  await expect(threeScene, 'Gear-linkage geometry resolves the two gears and two connector links by typed source node').toHaveAttribute('data-three-geometry-contract', /(?=.*gear-0:gear)(?=.*gear-1:gear)(?=.*connector-link-a:linkage)(?=.*connector-link-b:linkage)/);
  await expect(threeScene, 'Gear-linkage stack exposes G3/G3 plus the two managed connector blanks without duplicate crank links').toHaveAttribute('data-three-stack-order', /Drive G3 \/ 3-space gear.*Output G3 \/ 3-space gear.*Drive connector 5-hole link.*Output connector 5-hole link/);
  await expect(threeScene).toHaveAttribute('data-three-gear-radii', '60.00,60.00');
  await expect(threeScene).toHaveAttribute('data-three-linkage-pin-radius', '40.00');
  await expect(threeScene, 'Gear-linkage endpoint gear centers stay separated until idlers close the pitch chain').toHaveAttribute('data-three-gear-linkage-spacing-contract', 'separated-endpoints-await-idlers');
  await expect(threeScene, 'Gear-linkage endpoint gears are independent driving cranks unless idlers are inserted').toHaveAttribute('data-three-gear-coupling-mode', 'dual-driven-endpoints');
  await expect(threeScene, 'Gear-linkage crank stack semantics come only from compiled support paths').toHaveAttribute('data-three-gear-linkage-crank-stack-contract', 'compiled-support-paths');
  await expect(threeScene, 'Gear-linkage has no extra output bracket beyond the shared R fastener').toHaveAttribute('data-three-gear-linkage-bracket-anchor', 'no-output-bracket');
  const gearLinkagePinOrder = await threeScene.getAttribute('data-three-gear-linkage-pin-z-order');
  expect(gearLinkagePinOrder, 'Each gear-linkage pin exposes its exact compiler-owned gear/link/spacer/retainer sequence').toBe('A:gear>spacer>linkage>clip,B:clip>linkage>spacer>linkage>clip,C:gear>spacer>spacer>spacer>spacer>clip>linkage>clip');
  await page.getByLabel('Foundry mechanism type').selectOption('cam');
  expect(Number(await threeScene.getAttribute('data-three-cam-count')), 'Cam follower uses a cam profile, not a generic gear').toBeGreaterThanOrEqual(1);
  expect(Number(await threeScene.getAttribute('data-three-follower-count')), 'Cam follower shows its follower block').toBeGreaterThanOrEqual(1);
  await page.getByLabel('Foundry mechanism type').selectOption('4bar');
  await page.getByLabel('Foundry preset').selectOption('compact');
  await expect(page.getByLabel('ground number')).toHaveValue('120');
  await page.getByLabel('Foundry preset').selectOption('balanced');
  await expect(page.getByLabel('ground number')).toHaveValue('160');
  await page.getByLabel('Foundry preset').selectOption('compact');

  const linkOptionLabels = await page.getByLabel('Input link length').locator('option').allTextContents();
  expect(linkOptionLabels.join(' '), 'visible 4bar link-size labels name holes, not cells').toMatch(/3-hole/);
  expect(linkOptionLabels.join(' '), 'visible 4bar link-size labels avoid cell wording').not.toMatch(/\bcell\b/i);
  const stackBeforeResize = await threeScene.getAttribute('data-three-stack-order');
  await page.getByLabel('Output link length').selectOption('4');
  await page.getByLabel('Input link length').selectOption('4');
  await page.getByLabel('Coupler link length').selectOption('4');
  await expect(threeScene, '4bar link-size selectors override all three typed linkage layers without relying on flattened inventory order').toHaveAttribute('data-three-stack-order', /(?=.*Input 5-hole link)(?=.*Coupler 5-hole link)(?=.*Output 5-hole link)/);
  expect(await threeScene.getAttribute('data-three-stack-order')).not.toBe(stackBeforeResize);
  expect(await threeScene.getAttribute('data-three-rendered-layer-labels')).toBe(await threeScene.getAttribute('data-three-stack-order'));
  await expect(page.getByLabel('Output link length').locator('option[value="2"]'), 'unsafe 4bar output sizes stay visible but locked instead of breaking the preview').toHaveAttribute('disabled', '');
  await expect(page.getByLabel('Output link length').locator('option[value="2"]')).toContainText(/locked/i);
  await expect(page.getByTestId('mechanism-motion-option-locks')).toContainText(/Locked choices may jam/);
  await expect(page.getByTestId('foundry-motion-warning')).toHaveCount(0);
  await expect(page.getByTestId('stage-left-pane')).not.toContainText(/Motion may jam|No full motion/);
  await expect(page.getByTestId('stage-left-pane')).not.toContainText(/Motion [0-9]+%/);
  await expect(page.getByTestId('stage-left-pane')).not.toContainText(/Range|Status/i);
  await page.getByRole('button', { name: /Use mechanism/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('design-mechanism-library')).toContainText('Four-bar linkage');
  await expect(page.getByTestId('design-mechanism-library')).not.toContainText('360°');

  await clickStage(page, 'Blueprint');
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeEnabled();
  await page.getByRole('button', { name: /Generate package/i }).click();
  const metadata = await downloadMetadataJson(page);
  const foundryMechanism = metadata.sceneSnapshot.mechanisms.find((mechanism: { source?: string }) => mechanism.source === 'foundry');
  expect(foundryMechanism.presetId).toBe('compact');
  expect(foundryMechanism.targetAnchorJointId).toBe('right_hand');
  expect(foundryMechanism.recommendation).toContain('Compact');
  expect(foundryMechanism.foundryExport.simulationSummary).toMatch(/Motion|360°/);

  expectCleanPage(pageErrors, consoleErrors);
});

test.describe('Foundry parameter safety contracts', () => {
test('Foundry clamps feasible numeric parameter edits without adding jam warnings', async ({ page }) => {
  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();

  await page.getByText('Mechanism options').click();
  await page.getByLabel('Foundry mechanism type').selectOption('planetary_gear');

  const phase = page.getByLabel('phase number');
  await expect(phase, 'existing feasible planetary parameter is editable').toBeEnabled();
  const min = Number(await phase.getAttribute('min'));
  const max = Number(await phase.getAttribute('max'));
  expect(Number.isFinite(min) && Number.isFinite(max), 'visible numeric control exposes min/max bounds').toBe(true);
  expect(min, 'numeric parameter has a feasible range').toBeLessThan(max);

  const before = Number(await phase.inputValue());
  await phase.fill(String(max + 1000));
  await phase.press('Enter');

  await expect.poll(async () => Number(await phase.inputValue()), {
    message: 'out-of-range feasible parameter edit clamps or reverts inside visible bounds',
  }).toBeLessThanOrEqual(max);
  const committed = Number(await phase.inputValue());
  expect(committed, 'committed UI value stays above the visible minimum').toBeGreaterThanOrEqual(min);
  expect(committed, 'committed UI value rejects the requested out-of-range value').not.toBe(max + 1000);
  expect(committed === before || committed === max, 'control either reverts to the prior safe value or clamps to the visible maximum').toBe(true);

  await page.getByLabel('Foundry mechanism type').selectOption('4bar');
  await page.getByLabel('Foundry preset').selectOption('compact');
  await page.getByLabel('Output link length').selectOption('4');
  await page.getByLabel('Input link length').selectOption('4');
  await page.getByLabel('Coupler link length').selectOption('4');
  await expect(page.getByLabel('Output link length').locator('option[value="2"]'), 'unsafe 4bar output sizes stay visible but locked instead of breaking the preview').toHaveAttribute('disabled', '');
  await expect(page.getByLabel('Output link length').locator('option[value="2"]')).toContainText(/locked/i);
  await expect(page.getByTestId('mechanism-motion-option-locks')).toContainText(/Locked choices may jam/);
  await expect(page.getByTestId('foundry-motion-warning')).toHaveCount(0);
  await expect(page.getByTestId('stage-left-pane')).not.toContainText(/Motion may jam|No full motion/);
});
});

test('Character tab owns body layer and skeleton edits used by design controls', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await clickStage(page, 'Character');
  await page.getByTestId('character-part-item-right_arm_lower').click();
  await expect(page.getByTestId('character-rig-actions').getByRole('button', { name: /^Add layer$/ })).toBeVisible();
  await expect(page.getByTestId('novice-path-panel')).toHaveCount(0);

  await page.getByRole('button', { name: /Add layer/i }).click();
  await expect(page.getByTestId('character-part-list')).toContainText('copy');
  const copiedPartId = await page.locator('[data-testid^="character-part-item-part-"]').first().getAttribute('data-testid');
  expect(copiedPartId ?? '').toContain('character-part-item-part-');
  const copiedPartText = await page.locator('[data-testid^="character-part-item-part-"]').first().textContent();
  expect(copiedPartText ?? '').toContain('copy');

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.getByRole('button', { name: 'Four-bar linkage', exact: true }).click();
  const designPartOptions = await page.getByLabel('Mechanism target').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(designPartOptions.join(' ')).toContain('copy');

  await clickStage(page, 'Character');
  await page.locator('[data-testid^="character-part-item-part-"]').first().click();
  await page.getByRole('button', { name: /Remove layer/i }).click();
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  const designPartOptionsAfterRemove = await page.getByLabel('Mechanism target').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(designPartOptionsAfterRemove.join(' ')).not.toContain('copy');

  await clickStage(page, 'Character');
  await page.getByTestId('character-part-item-right_arm_lower').click();
  await page.getByText('Edit skeleton').click();
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
  await page.getByLabel('Mechanism target').selectOption('right_arm_lower');
  const anchorOptionsWithJoint = await page.getByLabel('Motion handle').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  expect(anchorOptionsWithJoint).toContain(newJointId);

  await clickStage(page, 'Character');
  await page.getByText('Edit skeleton').click();
  await editJoint.selectOption(newJointId!);
  await page.getByRole('button', { name: /Remove joint/i }).click();
  const anchorOptionsAfterJointRemove = await editJoint.evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  expect(anchorOptionsAfterJointRemove).not.toContain(newJointId);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  const designAnchorOptionsAfterRemove = await page.getByLabel('Motion handle').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  expect(designAnchorOptionsAfterRemove).not.toContain(newJointId);

  await page.getByRole('button', { name: /Path Editor/i }).click();
  await expect(page.getByTestId('stage-left-pane')).not.toContainText('Rig setup');
  await expect(page.getByTestId('stage-left-pane')).not.toContainText(/Add layer|Remove layer|New handle/);

  expectCleanPage(pageErrors, consoleErrors);
});

test.describe('Recommendation driver ownership contracts', () => {
test('Recommendation keeps a limb path on its exact owner and one physical driver', async ({ page }) => {
  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.getByRole('button', { name: /Recommend/i }).click();
  await expect(page.getByTestId('recommendation-sheet')).toBeVisible();

  const enabledOccupiedUses = page.getByTestId('recommendation-sheet').locator('button.btn-primary:not(:disabled)');
  if (await enabledOccupiedUses.count()) {
    await enabledOccupiedUses.first().click();
  } else {
    await page.getByTestId('recommendation-sheet').getByRole('button', { name: 'Close' }).click();
    await page.goto('/');
    await openUnoccupiedWavingArmTemplate(page);
    await page.getByRole('button', { name: /Mechanism Design/i }).click();
    await page.getByRole('button', { name: /Recommend/i }).click();
    await expect(page.getByTestId('recommendation-card-4bar')).toBeVisible();
    await page.getByTestId('recommendation-card-4bar').getByRole('button', { name: /^Use$/ }).click();
  }

  const designPreview = page.getByTestId('design-shared-foundry-preview');
  await expect(designPreview).toHaveAttribute('data-design-motion-source', 'generatedPath');
  await expect(designPreview).toHaveAttribute('data-design-target-joint-id', 'right_hand');
  expect(Number(await designPreview.getAttribute('data-design-target-error')), 'visible character target stays attached to the actual mechanism target').toBeLessThan(0.01);

  await clickStage(page, 'Blueprint');
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeEnabled();
  await page.getByRole('button', { name: /Generate package/i }).click();
  const metadata = await downloadMetadataJson(page);
  const mechanisms = metadata.sceneSnapshot.mechanisms as Array<{
    id: string;
    source?: string;
    presetId?: string;
    targetPartId?: string;
    targetPathId?: string;
    targetAnchorJointId?: string;
    activeVisualPartIds?: string[];
  }>;
  const rightHandDrivers = mechanisms.filter((mechanism) =>
    mechanism.targetPathId === 'path-right-arm' && mechanism.targetAnchorJointId === 'right_hand',
  );
  expect(rightHandDrivers, 'only one mechanism may drive the right_shoulder→right_hand physical target').toHaveLength(1);
  expect(rightHandDrivers[0]).toMatchObject({
    targetPartId: 'right_hand_part',
    targetPathId: 'path-right-arm',
    targetAnchorJointId: 'right_hand',
  });
  expect(rightHandDrivers[0].activeVisualPartIds).toEqual(['right_hand_part']);
});
});

test('Recommendation sheet applies a distinct mechanism and blueprint recipe', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openUnoccupiedWavingArmTemplate(page);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  const initialMechanisms = await page.getByLabel('Mechanism instance').evaluate((select: HTMLSelectElement) => select.options.length);
  await page.getByRole('button', { name: /Recommend/i }).click();
  await expect(page.getByTestId('recommendation-sheet')).toBeVisible();
  await expect(page.getByTestId('recommendation-sheet')).toContainText('Recommended mechanisms');
  await expect(page.getByTestId('recommendation-card-4bar')).toBeVisible();
  const fitPreview = page.getByTestId('recommendation-fit-preview-4bar');
  await expect(fitPreview).toHaveAttribute('data-board-cells', '15');
  await expect(fitPreview).toHaveAttribute('data-user-path-preview', 'shown');
  await expect(fitPreview).toHaveAttribute('data-mechanism-path-preview', 'shown');
  await expect(page.getByTestId('recommendation-linkage-4bar')).toBeVisible();
  await page.getByTestId('recommendation-card-4bar').getByRole('button', { name: /^Use$/ }).click();
  await expect(page.getByTestId('recommendation-sheet')).toHaveCount(0);
  const mechanismOptions = await page.getByLabel('Mechanism instance').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  expect(mechanismOptions).toHaveLength(initialMechanisms + 1);
  expect(new Set(mechanismOptions).size).toBe(mechanismOptions.length);
  const designPreview = page.getByTestId('design-shared-foundry-preview');
  await expect(designPreview).toBeVisible();
  await expect(designPreview.getByTestId('foundry-camera-rig')).toBeVisible();
  await expect(designPreview).toHaveAttribute('data-user-path-preview', 'shown');
  await expect(designPreview).toHaveAttribute('data-mechanism-path-preview', 'shown');
  await expect(designPreview).toHaveAttribute('data-design-motion-source', 'generatedPath');
  expect(Number(await designPreview.getAttribute('data-design-generated-path-count'))).toBeGreaterThanOrEqual(3);
  await expect(designPreview).toHaveAttribute('data-design-target-joint-id', /\S/);
  const targetErrorAttr = await designPreview.getAttribute('data-design-target-error');
  expect(targetErrorAttr).toMatch(/^\d+(\.\d+)?$/);
  const targetError = Number(targetErrorAttr);
  expect(Number.isFinite(targetError)).toBe(true);
  expect(targetError).toBeLessThan(0.01);
  expect(Number(await designPreview.getAttribute('data-design-animated-part-count'))).toBeGreaterThan(0);
  const targetBeforeScrub = `${await designPreview.getAttribute('data-design-target-x')},${await designPreview.getAttribute('data-design-target-y')}`;
  await page.getByLabel('Workspace scrubber').fill('35');
  await expect.poll(async () => `${await designPreview.getAttribute('data-design-target-x')},${await designPreview.getAttribute('data-design-target-y')}`, { message: 'Design character target follows fitted generatedPath through scrubber changes' }).not.toBe(targetBeforeScrub);
  expect(Number(await designPreview.getAttribute('data-design-target-error'))).toBeLessThan(0.01);
  await expect(designPreview.getByTestId('foundry-camera-rig')).toHaveAttribute('data-path-preview', 'shown');

  await clickStage(page, 'Blueprint');
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeEnabled();
  await page.getByRole('button', { name: /Generate package/i }).click();
  const metadata = await downloadMetadataJson(page);
  expect(metadata.recipes).toHaveLength(initialMechanisms + 1);
  expect(new Set(metadata.recipes.map((recipe: { mechanismId: string }) => recipe.mechanismId)).size).toBe(initialMechanisms + 1);
  const appliedRecommendation = metadata.sceneSnapshot.mechanisms.find((mechanism: { id: string; presetId?: string; source?: string; targetPathId?: string; targetPartId?: string; generatedPath?: Array<{ x: number; y: number }> }) => mechanism.source === 'optimized' && mechanism.presetId?.startsWith('recommendation-'));
  expect(appliedRecommendation).toBeTruthy();
  expect(appliedRecommendation?.targetPartId).toBe('right_hand_part');
  expect(appliedRecommendation?.targetPathId).toBe('path-right-arm');
  expect(appliedRecommendation?.generatedPath?.length ?? 0).toBeGreaterThanOrEqual(3);
  const appliedRecipe = metadata.recipes.find((recipe: { mechanismId: string; offsetFromBoardMm?: { x: number; y: number } }) => recipe.mechanismId === appliedRecommendation?.id);
  expect(appliedRecipe).toBeTruthy();
  expect(Math.abs(appliedRecipe?.offsetFromBoardMm?.x ?? Number.NaN)).toBeLessThan(0.01);
  expect(Math.abs(appliedRecipe?.offsetFromBoardMm?.y ?? Number.NaN)).toBeLessThan(0.01);
  await clickStage(page, 'Assembly');
  await expect(page.getByTestId('assembly-mechanism-three-preview')).toBeVisible();
  const assemblyScene = page.getByTestId('assembly-mechanism-three-preview');
  await expect(page.getByTestId('assembly-character-context-ghost')).toHaveCount(0);
  await expect(assemblyScene).toHaveAttribute('data-mechanism-scene-contract-mechanism-id', appliedRecommendation?.id ?? 'missing');
  await expect(assemblyScene).toHaveAttribute('data-mechanism-scene-contract-stack-source', 'mechanismCompiler');
  await expect(assemblyScene).toHaveAttribute('data-mechanism-scene-contract-layer-count', /[1-9]/);

  await page.goto('/');
  await openUnoccupiedWavingArmTemplate(page);
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
  const foundryCanvasPane = page.getByTestId('foundry-canvas-pane');
  await expect(foundryCanvasPane).toHaveAttribute('data-user-path-preview', 'shown');
  await expect(foundryCanvasPane).toHaveAttribute('data-mechanism-path-preview', 'hidden');
  await expect(foundryCanvasPane).toHaveAttribute('data-user-path-basis', 'mechanism-fit-context');
  await expect(foundryCanvasPane).toHaveAttribute('data-user-path-bounds', /-?\d+\.\d{2},-?\d+\.\d{2},-?\d+\.\d{2},-?\d+\.\d{2}/);
  const foundryFitError = Number(await foundryCanvasPane.getAttribute('data-user-to-mech-fit-error'));
  expect(Number.isFinite(foundryFitError)).toBe(true);
  expect(foundryFitError).toBeGreaterThanOrEqual(0);
  await expect(page.getByTestId('foundry-user-path-overlay')).toBeVisible();
  const inspector = page.getByTestId('stage-right-inspector');
  await expect(inspector.getByTestId('foundry-visible-sensemaking')).toContainText('Crank turns');
  await expect(inspector).not.toContainText('Preview overlays');
  await expect(inspector.getByTestId('foundry-fabrication-stack')).toContainText(/^Stack\s*Back Clip.*Spacer 10mm.*Front Clip/);
  await expect(page.getByTestId('stage-left-pane').getByTestId('foundry-fabrication-stack')).toHaveCount(0);
  await expect(inspector.getByTestId('foundry-view-controls')).toBeVisible();
  await expect(inspector.getByTestId('foundry-parametric-editor')).toContainText('Link holes');
  expect(await inspector.evaluate((root) => {
    const topOf = (testId: string) =>
      root.querySelector(`[data-testid="${testId}"]`)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
    return topOf('foundry-visible-sensemaking') < topOf('foundry-fabrication-stack')
      && topOf('foundry-fabrication-stack') < topOf('foundry-view-controls')
      && topOf('foundry-view-controls') < topOf('foundry-parametric-editor');
  }), 'Foundry right pane orders sensemaking, Stack, compact view controls, then editable link sizes').toBe(true);
  await page.getByTestId('foundry-toggle-user-path').click();
  await expect(foundryCanvasPane).toHaveAttribute('data-user-path-preview', 'hidden');
  await expect(page.getByTestId('foundry-user-path-overlay')).toHaveCount(0);
  await page.getByTestId('foundry-toggle-user-path').click();
  await expect(foundryCanvasPane).toHaveAttribute('data-user-path-preview', 'shown');
  await expect(page.getByTestId('foundry-user-path-overlay')).toBeVisible();
  await page.getByTestId('foundry-toggle-paths').click();
  await expect(foundryCanvasPane).toHaveAttribute('data-mechanism-path-preview', 'shown');
  await expect(threeScene).toHaveAttribute('data-path-preview', 'shown');
  await expect(threeScene).toHaveAttribute('data-three-primary-path-bounds', /-?\d+\.\d{2},-?\d+\.\d{2},-?\d+\.\d{2},-?\d+\.\d{2}/);
  await expect(threeScene).toHaveAttribute('data-three-path-source', 'moving-joints');
  await expect(threeScene).toHaveAttribute('data-three-path-trace-ids', 'B,C');
  await expect(threeScene).toHaveAttribute('data-three-primary-path-id', 'C');
  await page.getByTestId('foundry-toggle-paths').click();
  await expect(foundryCanvasPane).toHaveAttribute('data-mechanism-path-preview', 'hidden');
  await expect(threeScene).toHaveAttribute('data-path-preview', 'hidden');
  await page.getByTestId('foundry-toggle-trail').click();
  await expect(threeScene).toHaveAttribute('data-trail', 'shown');
  await expect(page.getByTestId('foundry-forces-overlay')).toBeVisible();
  await page.getByTestId('foundry-toggle-forces').click();
  await expect(page.getByTestId('foundry-forces-overlay')).toHaveCount(0);
  await page.getByTestId('foundry-toggle-forces').click();
  await expect(page.getByTestId('foundry-forces-overlay')).toBeVisible();
  await expect(page.getByTestId('foundry-velocity-overlay')).toBeVisible();
  await page.getByTestId('foundry-toggle-velocity').click();
  await expect(page.getByTestId('foundry-velocity-overlay')).toHaveCount(0);
  await page.getByTestId('foundry-toggle-velocity').click();
  await expect(page.getByTestId('foundry-velocity-overlay')).toBeVisible();
  await expect(page.getByTestId('foundry-mechanism-library')).toHaveCount(0);
  await page.getByRole('button', { name: 'Hint' }).click();
  await expect(page.getByTestId('foundry-mechanism-library')).not.toContainText('pin reactions');
  await page.getByRole('button', { name: 'Hide hint' }).click();
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
  await expect(foundryCanvasPane).toHaveAttribute('data-user-path-preview', 'shown');
  await expect(page.getByTestId('foundry-user-path-overlay')).toBeVisible();
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
  await expect(preview).toHaveClass(/is-picking-anchor/);
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

test('Mechanism Design cam profile edits update the integrated automata preview', async ({ page }) => {
  await page.setViewportSize({ width: 901, height: 720 });
  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Foundry/i }).click();
  await page.getByText('Mechanism options').click();
  await page.getByLabel('Foundry mechanism type').selectOption('cam');
  await page.getByRole('button', { name: /Use mechanism/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();

  const designRig = page.getByTestId('design-shared-foundry-preview').getByTestId('foundry-camera-rig');
  await expect(designRig).toHaveAttribute('data-mechanism-type', 'cam');
  await expect(designRig).toHaveAttribute('data-three-cam-contact-mode', 'sampled-profile-on-guide-axis');
  await expect(designRig).toHaveAttribute('data-three-preview-renderable', 'ready');
  const editor = page.getByTestId('cam-profile-editor');
  await editor.scrollIntoViewIfNeeded();
  await expect(editor).toBeVisible();
  const before = await designRig.getAttribute('data-cam-profile');
  const point = page.getByTestId('cam-profile-point-1');
  const box = await point.boundingBox();
  expect(box, 'Design cam profile point is draggable').toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y - 24);
  await page.mouse.up();
  await expect.poll(async () => designRig.getAttribute('data-cam-profile'), { message: 'Design cam profile edits update the integrated Three automata data' }).not.toBe(before);
  await expect.poll(async () => Number(await designRig.getAttribute('data-three-dynamic-build-count')), { message: 'Design cam edit keeps a real rebuilt Three mechanism' }).toBeGreaterThan(0);
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


test('Startup uses one boot loader and opens Getting Started over Character', async ({ page }) => {
  let releaseModelDownload!: () => void;
  const heldDownload = new Promise<void>(resolve => { releaseModelDownload = resolve; });
  await page.route(ONNX_MODEL_ROUTE, async route => {
    await heldDownload;
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'content-length': String(TEST_ONNX_MODEL_BYTES.length) },
      body: TEST_ONNX_MODEL_BYTES,
    });
  });
  await page.goto('/');
  await expect(page.locator('#boot-loader')).toContainText(/MotionSmith/);
  await expect(page.locator('#boot-loader')).toContainText(/AI model/i);
  releaseModelDownload();
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
  await expect(page.getByTestId('character-screen')).toBeVisible();
  await expect(page.getByTestId('getting-started-dialog')).toBeVisible();
  await page.getByTestId('getting-started-hide-session').locator('input').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.reload();
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
  await expect(page.getByTestId('getting-started-dialog')).toHaveCount(0);
});

test('Bug report opens a GitHub issue draft from any stage', async ({ page }) => {
  await page.goto('/');
  await importWavingArmLessonProject(page, 'character');

  await page.getByTestId('bug-report-button').click();
  const report = page.getByTestId('bug-report-overlay');
  await expect(report).toBeVisible();
  await report.getByLabel('What broke?').fill('Design canvas froze');
  await report.getByLabel('What did you do?').fill('Opened Mechanism Design and scrubbed playback.');
  await report.getByLabel('What should happen?').fill('The character should keep moving.');
  await expect(report.getByLabel(/Email optional/)).toBeVisible();
  await expect(report.getByLabel(/name/i)).toHaveCount(0);

  let href = await report.getByRole('link', { name: /Open issue/ }).getAttribute('href');
  expect(href).toContain('https://github.com/AlanSynn/ms/issues/new');
  let issue = new URL(href!);
  expect(issue.searchParams.get('title')).toBe('Bug: Design canvas froze');
  expect(issue.searchParams.get('body')).toContain('- Stage: Character');
  expect(issue.searchParams.get('body')).toContain('Attach downloaded screenshots here if needed.');

  await clickStage(page, 'Path');
  await expect(report).toBeVisible();
  href = await report.getByRole('link', { name: /Open issue/ }).getAttribute('href');
  issue = new URL(href!);
  expect(issue.searchParams.get('body')).toContain('- Stage: Path Editor');
});

test('Mobile startup shows compact Getting Started with a session opt-out', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
  await expect(page.getByTestId('getting-started-dialog')).toBeVisible();
  await expect(page.getByTestId('character-screen')).toBeVisible();
  const modalState = await page.evaluate(() => ({
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    shellInert: document.querySelector('.app-shell')?.hasAttribute('inert') ?? false,
    shellHidden: document.querySelector('.app-shell')?.getAttribute('aria-hidden') === 'true',
    modalClass: document.documentElement.classList.contains('welcome-modal-open'),
  }));
  expect(modalState).toEqual({
    htmlOverflow: 'hidden',
    shellInert: true,
    shellHidden: true,
    modalClass: true,
  });
  await expect(page.getByTestId('getting-started-hide-session')).toBeVisible();
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
  const before = await waitForStableBox(page, center, 'Options center canvas before inspector wheel');
  await inspector.hover();
  await page.mouse.wheel(0, 900);

  await expect.poll(() => inspector.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const after = await waitForStableBox(page, center, 'Options center canvas after inspector wheel');
  expect(Math.abs(after!.y - before!.y), 'center canvas stays pinned while right inspector scrolls').toBeLessThan(1);
});

test('Narrow character right inspector remains independently scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto('/');
  await openCharacterScreen(page);

  const inspector = page.getByTestId('stage-right-inspector');
  const center = page.getByTestId('stage-canvas-pane');
  await inspector.scrollIntoViewIfNeeded();
  await expect(inspector).toBeVisible();
  await expect(page.getByTestId('part-art-controls')).toBeVisible();
  const metrics = await inspector.evaluate(element => ({
    overflowY: getComputedStyle(element).overflowY,
    overflowX: getComputedStyle(element).overflowX,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(metrics.overflowY).toBe('auto');
  expect(metrics.scrollWidth, 'right inspector content fits without horizontal scrolling').toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

  const before = await waitForStableBox(page, center, 'narrow center canvas before inspector wheel');
  await inspector.evaluate(element => { element.scrollTop = 0; });
  await inspector.hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(() => inspector.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const after = await waitForStableBox(page, center, 'narrow center canvas after inspector wheel');
  expect(Math.abs(after!.y - before!.y), 'narrow layout scroll stays owned by right inspector').toBeLessThan(1);
});

test('Every workflow right inspector uses the shared scroll container', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await openWavingArmTemplate(page);

  for (const stageName of ['Character', 'Path', 'Foundry', 'Design', 'Blueprint', 'Assembly', 'Options']) {
    await clickStage(page, stageName);
    const inspector = page.getByTestId('stage-right-inspector');
    const center = page.getByTestId('stage-canvas-pane');
    await expect(inspector, `${stageName} right inspector is visible`).toBeVisible();
    const before = await waitForStableBox(page, center, `${stageName} center canvas before inspector wheel`);
    const metrics = await inspector.evaluate(element => ({
      overflowX: getComputedStyle(element).overflowX,
      overflowY: getComputedStyle(element).overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }));
    expect(metrics.scrollWidth, `${stageName} right inspector does not horizontally leak`).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.overflowY, `${stageName} right inspector owns vertical scroll`).toBe('auto');
    if (metrics.scrollHeight > metrics.clientHeight + 2) {
      await inspector.evaluate(element => { element.scrollTop = 0; });
      await inspector.hover();
      await page.mouse.wheel(0, 650);
      await expect.poll(() => inspector.evaluate(element => element.scrollTop), { message: `${stageName} inspector scrolls by wheel` }).toBeGreaterThan(0);
    }
    const after = await waitForStableBox(page, center, `${stageName} center canvas after inspector wheel`);
    expect(Math.abs(after.y - before.y), `${stageName} inspector wheel does not move the canvas`).toBeLessThan(1);
  }
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
  await expect(page.getByTestId('stage-left-pane')).not.toContainText('Rig setup');
  await expect(page.getByTestId('stage-left-pane')).not.toContainText(/Add layer|Remove layer|New handle/);

  await page.getByRole('button', { name: /Foundry/i }).click();
  await assertPaneContract('Templates', '3D Isometric', 'Question', '.canvas-zoom-toolbar, .foundry-camera-hud, .foundry-playback-hud');
  await expect(page.getByTestId('stage-left-pane')).toContainText('Use mechanism');

  await page.getByRole('button', { name: /Use mechanism/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await assertPaneContract('Mechanisms', '3D', 'Parameters', '.canvas-zoom-toolbar, .foundry-camera-hud, .foundry-opacity-panel, [data-testid="foundry-explode-panel"], .design-editor-toolbar, .design-view-controls');
  await expect(page.getByTestId('design-shared-foundry-preview')).toBeVisible();

  await clickStage(page, 'Blueprint');
  await assertPaneContract('Make files', '', 'Build spot', '.blueprint-document-preview', '.blueprint-document-preview');
  await clickStage(page, 'Assembly');
  await assertPaneContract('Build', 'Build animation', 'Assembly', '.assembly-readonly-step-strip', '.assembly-readonly-step-strip');

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
  const mobileNav = page.getByTestId('stage-left-pane').locator('.stage-nav-compact');
  await mobileNav.getByRole('button', { name: 'Path' }).click();
  await expect(page.getByTestId('workspace-steps')).toBeHidden();
  for (const name of ['Character', 'Path', 'Foundry', 'Design', 'Blueprint', 'Assembly', 'Options']) {
    await expect(mobileNav.getByRole('button', { name })).toBeVisible();
  }
  await expect(mobileNav.getByRole('button', { name: 'Path' })).toHaveAttribute('aria-current', 'step');
  await mobileNav.getByRole('button', { name: 'Foundry' }).click();
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  await page.getByTestId('stage-left-pane').locator('.stage-nav-compact').getByRole('button', { name: 'Assembly' }).click();
  await expect(page.getByRole('heading', { name: 'Assembly' })).toBeVisible();
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
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveCount(0);
  const designSharedPreview = page.getByTestId('design-shared-foundry-preview');
  await expect(designSharedPreview).toBeVisible();
  const designSharedRig = designSharedPreview.getByTestId('foundry-camera-rig');
  const foundryZoomBefore = Number(await designSharedRig.getAttribute('data-camera-zoom'));
  await designSharedPreview.hover();
  await page.mouse.wheel(0, -10000);
  await expect.poll(async () => Number(await designSharedRig.getAttribute('data-camera-zoom')), { message: 'Design uses the integrated automata wheel zoom instead of the legacy 2D canvas zoom' }).toBeGreaterThan(foundryZoomBefore);
  await page.getByRole('button', { name: /Path Editor/i }).click();
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('120%');
  await assertZoomInClickable('144%');
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByTestId('design-shared-foundry-preview')).toBeVisible();
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveCount(0);
  await page.getByRole('button', { name: /Path Editor/i }).click();
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('144%');

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
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
  await expect(page.getByTestId('status-bar')).toContainText('ignored invalid workspace viewport');
  await expect(page.getByTestId('status-bar')).toContainText('ignored invalid workspace stage');
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('100%');

  await page.setViewportSize({ width: 899, height: 720 });
  await page.getByRole('button', { name: 'Path', exact: true }).click();
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('100%');
  await assertZoomInClickable('120%');
  await page.getByRole('button', { name: 'Design', exact: true }).click();
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
  const modalDesignPreview = page.getByTestId('design-shared-foundry-preview');
  await expect(modalDesignPreview).toBeVisible();
  const modalDesignRig = modalDesignPreview.getByTestId('foundry-camera-rig');
  const zoomBeforeModalShortcuts = await modalDesignRig.getAttribute('data-camera-zoom');

  await page.getByTestId('top-command-bar').getByText('Help', { exact: true }).click();
  await page.getByRole('button', { name: 'Shortcuts' }).click();
  await expect(page.getByTestId('shortcut-help-dialog')).toBeVisible();
  await expect(page.getByTestId('shortcut-help-dialog')).toContainText('New Project');
  await expect(page.getByTestId('shortcut-help-dialog')).toContainText('Undo');
  await page.keyboard.press('Alt+5');
  await page.keyboard.press('Control+=');
  await expect(page.getByTestId('shortcut-help-dialog')).toBeVisible();
  await expect(modalDesignRig).toHaveAttribute('data-camera-zoom', zoomBeforeModalShortcuts ?? '');
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

  await page.getByTestId('workspace-steps').getByRole('button', { name: 'Path Editor' }).click();
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
  const zoomBeforeShiftPlus = await page.getByTestId('canvas-zoom-readout').textContent();
  await page.keyboard.press('Control+Shift+=');
  await expect.poll(async () => page.getByTestId('canvas-zoom-readout').textContent(), { message: 'shifted plus zoom shortcut updates the shared canvas' }).not.toBe(zoomBeforeShiftPlus);
  await page.keyboard.press('Control+=');
  await expect(page.getByTestId('status-bar')).toContainText(/Canvas zoom/);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.setAttribute('data-testid', 'shortcut-typing-guard-input');
    input.style.position = 'fixed';
    input.style.left = '16px';
    input.style.top = '16px';
    document.body.append(input);
  });
  const typingGuardInput = page.getByTestId('shortcut-typing-guard-input');
  await typingGuardInput.focus();
  await page.keyboard.press('Alt+5');
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
  await typingGuardInput.press('a');
  await expect(typingGuardInput).toHaveValue('a');
  await page.evaluate(() => document.querySelector('[data-testid="shortcut-typing-guard-input"]')?.remove());
  await page.keyboard.press('Alt+5');
  await expect(page.getByRole('heading', { name: 'Blueprint' })).toBeVisible();
});

test('Every top menu command is wired to a visible result', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await openWavingArmTemplate(page);

  const commandTestId = (id: AppCommandId) => commandById(id).testId ?? `command-${id.replaceAll('.', '-')}`;
  const menuLabelFor = (id: AppCommandId) => {
    const group = APP_MENU_GROUPS.find(menu => (menu.commandIds as readonly AppCommandId[]).includes(id));
    if (!group) throw new Error(`Missing menu group for ${id}`);
    return group.label;
  };
  const runCommand = async (id: AppCommandId) => {
    await page.getByTestId('top-command-bar').getByText(menuLabelFor(id), { exact: true }).click();
    const command = page.getByTestId(commandTestId(id));
    await expect(command, `${id} is visible in its menu`).toBeVisible();
    await command.click();
  };
  const exercised = new Set<AppCommandId>();
  const run = async (id: AppCommandId) => {
    exercised.add(id);
    await runCommand(id);
  };

  await run('stage.character');
  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await run('stage.path');
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
  await run('stage.foundry');
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  await run('stage.design');
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await run('stage.blueprint');
  await expect(page.getByRole('heading', { name: 'Blueprint' })).toBeVisible();
  await run('stage.assembly');
  await expect(page.getByRole('heading', { name: 'Assembly' })).toBeVisible();
  await run('options.preferences');
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();

  await run('help.shortcuts');
  await expect(page.getByTestId('shortcut-help-dialog')).toBeVisible();
  await page.getByTestId('shortcut-help-dialog').getByRole('button', { name: 'Close' }).click();
  await run('help.about');
  await expect(page.getByTestId('about-dialog')).toBeVisible();
  await page.getByTestId('about-dialog').getByRole('button', { name: 'Close' }).click();

  await run('stage.path');
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('100%');
  await run('view.zoomIn');
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('120%');
  await run('view.zoomOut');
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('100%');
  await run('view.fit');
  await expect(page.getByTestId('status-bar')).toContainText('Canvas fitted to sheet');
  await run('view.reset');
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('100%');
  await run('workspace.saveLayout');
  await expect(page.getByTestId('status-bar')).toContainText('Workspace layout saved');
  await page.evaluate(() => localStorage.setItem('motionsmith.workspace', JSON.stringify({ stage: 'blueprint', viewport: { offset: { x: 10, y: 12 }, zoom: 1.44 }, toolbarVisible: true, partPanelVisible: true })));
  await run('workspace.restoreLayout');
  await expect(page.getByRole('heading', { name: 'Blueprint' })).toBeVisible();
  await expect(page.getByTestId('status-bar')).toContainText('Workspace layout restored');
  await run('workspace.resetLayout');
  await expect(page.getByTestId('status-bar')).toContainText('Workspace layout reset');

  await run('options.preferences');
  await page.getByLabel('Show toolbar').uncheck();
  await run('edit.undo');
  await expect(page.getByLabel('Show toolbar')).toBeChecked();
  await run('edit.redo');
  await expect(page.getByLabel('Show toolbar')).not.toBeChecked();
  await page.getByLabel('Show toolbar').check();

  for (const id of ['project.save', 'project.saveAs', 'project.exportCopy'] as const) {
    exercised.add(id);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      runCommand(id),
    ]);
    expect(download.suggestedFilename(), `${id} downloads a snapshot file`).toMatch(/\.motionsmith\.json$/);
    const downloadedPath = await download.path();
    expect(downloadedPath, `${id} keeps a readable local artifact`).toBeTruthy();
    const snapshot = JSON.parse(await readFile(downloadedPath!, 'utf8'));
    expect(snapshot.version, `${id} exports a MotionSmith project snapshot`).toBe(1);
    expect(Object.keys(snapshot.parts ?? {}).length, `${id} export preserves character parts`).toBeGreaterThan(0);
    expect(snapshot.mechanisms?.length, `${id} export preserves mechanisms`).toBeGreaterThan(0);
  }
  await run('project.exportBlueprint');
  await expect(page.getByRole('heading', { name: 'Blueprint' })).toBeVisible();
  await run('project.resetLesson');
  await expect(page.getByTestId('status-bar')).toContainText('Lesson reset');
  await run('project.recoverAutosave');
  await expect(page.getByTestId('status-bar')).toContainText(/No autosave found|Recovered browser autosave snapshot/);
  exercised.add('project.open');
  const projectPath = await writeWavingArmLessonProject();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    runCommand('project.open'),
  ]);
  expect(chooser.isMultiple(), 'project open uses a single project-file picker').toBe(false);
  await chooser.setFiles(projectPath);
  await expect(page.getByTestId('status-bar')).toContainText('Loaded project waving-arm.motionsmith.json');
  await expectProjectCounts(page, 14, 1, 1);
  exercised.add('project.new');
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('Discard current project');
    await dialog.accept();
  });
  await runCommand('project.new');
  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await expect(page.getByTestId('status-bar')).toContainText('New project');

  expect([...exercised].sort(), 'this audit test exercises every registered command id').toEqual(APP_COMMANDS.map(command => command.id).sort());
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
  const makeItYours = page.getByTestId('character-make-it-yours');
  await expect(makeItYours).toContainText('Select a part');
  await expect(makeItYours).toContainText('Place joints');
  await expect(makeItYours).toHaveAttribute('data-change-cue', 'hand path');
  await expect(makeItYours).toHaveAttribute('data-build-cue', 'four-bar');
  await expect(makeItYours).not.toContainText('Change hand path');
  await expect(makeItYours).not.toContainText('Build four-bar');
  await expect(page.getByTestId('classroom-checklist')).toHaveCount(0);
  await expect(page.getByTestId('character-three-puppet-state')).toHaveAttribute('data-three-mechanism-count', '0');

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
  await page.getByRole('button', { name: 'Slider piston', exact: true }).click();
  await page.getByLabel('Mechanism target').selectOption('head');
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('');
  await page.getByRole('button', { name: 'Cam follower', exact: true }).click();

  await clickStage(page, 'Blueprint');
  await expect(page.getByTestId('blueprint-control-panel').getByText(/choose target \+ path/)).toBeVisible();
  await expect(page.getByTestId('blueprint-control-panel').getByText(/choose target \+ path/)).toHaveCount(1);
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
  await expect(page.getByTestId('design-visible-sensemaking')).toContainText('Crank turns');

  await page.getByRole('button', { name: 'Slider piston', exact: true }).click();
  await expectProjectCounts(page, 14, 1, 2);
  const selectedMechanismText = await page.getByLabel('Mechanism instance').evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent ?? '');
  expect(selectedMechanismText).toContain('piston');
  await expect(page.getByTestId('design-mechanism-library')).toContainText('Slider piston');
  await expect(page.getByTestId('design-visible-sensemaking')).toContainText('Crank turns');
  await expect(page.getByTestId('design-parametric-editor')).toHaveCount(0);
  await expect(page.getByLabel('slider offset number')).toHaveCount(0);
  await expect(page.getByLabel('rod length number')).toHaveCount(0);
  await expect(page.getByLabel('Mechanism target')).toHaveValue('');
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('');

  await page.getByLabel('Mechanism target').selectOption('head');
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('');
  const headPathOptions = await page.getByLabel('Mechanism motion path').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(headPathOptions).toEqual(['No path']);
  await page.getByLabel('Mechanism target').selectOption('right_hand_part');
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('');
  const handPathOptions = await page.getByLabel('Mechanism motion path').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => ({ text: option.textContent ?? '', value: option.value, disabled: option.disabled })));
  expect(handPathOptions.map(option => option.text).join(' ')).toContain('Right hand path');
  expect(handPathOptions.map(option => option.text).join(' ')).not.toContain('pts');
  expect(handPathOptions.find(option => option.value === 'path-right-arm')?.disabled).toBe(true);
  const anchorOptionValues = await page.getByLabel('Motion handle').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  expect(anchorOptionValues).toEqual(['', 'right_hand']);
  const anchorOptions = await page.getByLabel('Motion handle').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(anchorOptions.join(' ')).toContain('1 joint');
  expect(anchorOptions.join(' ')).not.toContain('left hand');
  await expect(page.getByLabel('Motion handle')).toHaveValue('right_hand');
  await expect(page.getByTestId('mechanism-ik-chain-summary')).toHaveCount(0);

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
  await page.getByLabel('Mechanism target').selectOption('right_hand_part');
  await page.getByLabel('Mechanism motion path').selectOption('path-right-arm');
  await page.getByLabel('Motion handle').selectOption('right_hand');
  await page.getByRole('button', { name: 'Export Blueprint', exact: true }).click();
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeEnabled();
  await page.getByRole('button', { name: /Generate package/i }).click();
  expect((await downloadMetadataJson(page)).recipes).toHaveLength(1);

  expectCleanPage(pageErrors, consoleErrors);
});


test('Mechanism Design integrated automata preview keeps placed anchors on the fabrication grid', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await applyFourBarFromFoundry(page);
  const designPreview = page.getByTestId('design-shared-foundry-preview');
  await expect(designPreview).toBeVisible();
  const designRig = designPreview.getByTestId('foundry-camera-rig');
  await expect(designRig).toHaveAttribute('data-three-renderer', 'webgl');
  await expect(designRig).toHaveAttribute('data-three-stack-source', 'compileMechanismRenderPlan');

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

test('Mechanism Design center workspace renders the integrated Foundry automata scene', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await applyFourBarFromFoundry(page);
  const designPreview = page.getByTestId('design-shared-foundry-preview');
  await expect(designPreview).toBeVisible();
  await expect(designPreview).toHaveAttribute('data-renderer-source', 'ThreeFoundryPreview');
  await expect(designPreview).toHaveAttribute('data-shared-with', 'foundry-renderer');
  const designRig = designPreview.getByTestId('foundry-camera-rig');
  const designPuppet = designRig;
  await expect(designPreview).toHaveAttribute('data-user-path-preview', 'shown');
  await expect(designPreview).toHaveAttribute('data-mechanism-path-preview', 'shown');
  await expect(designPuppet).toHaveAttribute('data-layer-paths', 'shown');
  await expect(designRig).toHaveAttribute('data-path-preview', 'shown');
  await expect(page.getByTestId('design-editor-toolbar').getByRole('button', { name: 'Move', exact: true })).toBeVisible();
  await expect(page.getByTestId('design-editor-toolbar').getByRole('button', { name: 'Rotate', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('design-editor-toolbar').getByRole('button', { name: 'Zoom', exact: true })).toBeVisible();
  await expect(page.getByTestId('design-foundry-camera-controls').getByRole('button', { name: 'User path', exact: true })).toBeVisible();
  const editorToolbarBox = await page.getByTestId('design-editor-toolbar').boundingBox();
  const viewControlsBox = await page.getByTestId('design-foundry-camera-controls').boundingBox();
  expect(editorToolbarBox, 'Design editor toolbar has a layout box').toBeTruthy();
  expect(viewControlsBox, 'Design view controls have a layout box').toBeTruthy();
  expect(viewControlsBox!.x, 'Design view/path controls sit to the right of the compact editor toolbar').toBeGreaterThan(editorToolbarBox!.x);
  await page.getByTestId('design-tool-move').click();
  await expect(designPreview).toHaveAttribute('data-design-viewer-tool', 'move');
  const designCanvasBox = await designPreview.locator('canvas.foundry-three-canvas').boundingBox();
  expect(designCanvasBox, 'Design Foundry canvas has a layout box').toBeTruthy();
  const panBefore = await designRig.getAttribute('data-camera-pan-x');
  await page.mouse.move(designCanvasBox!.x + designCanvasBox!.width * 0.5, designCanvasBox!.y + designCanvasBox!.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(designCanvasBox!.x + designCanvasBox!.width * 0.56, designCanvasBox!.y + designCanvasBox!.height * 0.55, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => await designRig.getAttribute('data-camera-pan-x'), { message: 'Design Move tool routes drags to camera pan' }).not.toBe(panBefore);
  await page.getByTestId('design-tool-rotate').click();
  await expect(designPreview).toHaveAttribute('data-design-viewer-tool', 'rotate');
  await page.getByTestId('design-toggle-trace').click();
  await expect(designPreview).toHaveAttribute('data-design-trace-layer', 'hidden');
  await expect(designPuppet).toHaveAttribute('data-layer-paths', 'hidden');
  await expect(page.getByTestId('design-toggle-user-path')).toBeDisabled();
  await expect(page.getByTestId('design-toggle-mechanism-path')).toBeDisabled();
  await page.getByTestId('design-toggle-trace').click();
  await expect(designPreview).toHaveAttribute('data-design-trace-layer', 'shown');
  await expect(designPuppet).toHaveAttribute('data-layer-paths', 'shown');
  await page.getByTestId('design-toggle-user-path').click();
  await expect(designPreview).toHaveAttribute('data-user-path-preview', 'hidden');
  await expect(designPuppet).toHaveAttribute('data-layer-paths', 'shown');
  await page.getByTestId('design-toggle-mechanism-path').click();
  await expect(designPreview).toHaveAttribute('data-mechanism-path-preview', 'hidden');
  await expect(designRig).toHaveAttribute('data-path-preview', 'hidden');
  await expect(designRig).toHaveAttribute('data-three-renderer', 'webgl');
  await expect(designRig).toHaveAttribute('data-three-engine-stack', 'three-webgl2-imperative');
  await expect(designRig).toHaveAttribute('data-physics-kernel', 'rapier3d-compat');
  await expect(designRig).toHaveAttribute('data-physics-kernel-runtime', 'ready', { timeout: 60_000 });
  await expect(designRig).toHaveAttribute('data-physics-kernel-error', 'none');
  await expect(designRig).toHaveAttribute('data-physics-update-policy', 'kinematic-authority-rapier-contact-validation');
  await expect(designRig).toHaveAttribute('data-high-throughput-scene-policy', 'viser-style-transform-tree-batched-updates-instancing');
  await expect(designRig).toHaveAttribute('data-physics-authority', 'motionsmith-kinematics');
  await expect(designRig).toHaveAttribute('data-three-stack-source', 'compileMechanismRenderPlan');
  await expect(designRig).toHaveAttribute('data-three-stack-mode', 'assembled-spacer-separated');
  await expect(designRig).toHaveAttribute('data-three-exploded', 'false');
  const automataSurfaceClearance = Number(await designRig.getAttribute('data-three-automata-surface-clearance'));
  expect(automataSurfaceClearance, 'Design character art surface stays just above the mechanism pin plane instead of floating as an exploded layer').toBeGreaterThan(0);
  expect(automataSurfaceClearance, 'Design character art surface stays just above the mechanism pin plane instead of floating as an exploded layer').toBeLessThanOrEqual(0.06);
  await expect(designRig).toHaveAttribute('data-three-spacer-key', 's10');
  await expect(designRig).toHaveAttribute('data-three-spacer-mm', '10x4');
  await expect(designPreview.locator('canvas.foundry-three-canvas')).toBeVisible();
  await page.getByTestId('design-foundry-camera-controls').getByRole('button', { name: 'Front', exact: true }).click();
  await expect(designRig).toHaveAttribute('data-camera-preset', 'front');
  await expect(designPreview).toHaveAttribute('data-design-motion-source', 'generatedPath');
  await expect(designPreview).toHaveAttribute('data-design-path-fit-status', 'mismatch');
  expect(Number(await designPreview.getAttribute('data-design-target-error'))).toBeLessThan(0.01);
  const headTarget = await waitForThreePartTarget(designRig, 'head');
  const torsoTarget = await waitForThreePartTarget(designRig, 'torso');
  const footTarget = await waitForThreePartTarget(designRig, 'right_foot_part');
  expect(headTarget.y, 'Design front view preserves Character/Path scene orientation: head stays above torso').toBeLessThan(torsoTarget.y);
  expect(torsoTarget.y, 'Design front view preserves Character/Path scene orientation: torso stays above foot').toBeLessThan(footTarget.y);
  const drivenHandBefore = await waitForThreePartTarget(designRig, 'right_hand_part');
  await page.getByLabel('Workspace scrubber').fill('28');
  await expect.poll(async () => {
    const moved = (await readThreeScreenTargets(designRig, 'data-three-part-screen-targets'))
      .find(item => item.id === 'right_hand_part' && item.visible);
    return moved ? Math.hypot(moved.x - drivenHandBefore.x, moved.y - drivenHandBefore.y) : 0;
  }, { message: 'visible Design hand part follows the rendered mechanism path through scrubber changes' }).toBeGreaterThan(2);
  expect(Number(await designPreview.getAttribute('data-design-target-error'))).toBeLessThan(0.01);

  const expectedMarkers: Record<string, Array<[string, number]>> = {
    '4bar': [['data-three-part-count', 3], ['data-three-hole-count', 4]],
    piston: [['data-three-slot-count', 1]],
    cam: [['data-three-cam-count', 1], ['data-three-follower-count', 1]],
    gear: [['data-three-gear-count', 2], ['data-three-hole-count', 2]],
    gear_linkage: [['data-three-gear-count', 2], ['data-three-hole-count', 4]],
    planetary_gear: [['data-three-gear-count', 3], ['data-three-planet-count', 1]]
  };

  const mechanismTemplateButtons = [
    { type: '4bar', label: 'Four-bar linkage' },
    { type: 'piston', label: 'Slider piston' },
    { type: 'cam', label: 'Cam follower' },
    { type: 'gear', label: 'Gear train' },
    { type: 'gear_linkage', label: 'Gear linkage' },
    { type: 'planetary_gear', label: 'Planetary gear' }
  ] as const;
  const readRotation = async () => Number(await designRig.getAttribute('data-pinion-rotation-deg'));

  for (const { type, label } of mechanismTemplateButtons) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(designRig, `${type} design automata preview uses the Foundry mechanism state`).toHaveAttribute('data-mechanism-type', type);
    await expect(designRig, `${type} design renderer uses the shared fabrication stack`).toHaveAttribute('data-three-stack-source', 'compileMechanismRenderPlan');
    await expect(designRig, `${type} design stack stays assembled until explicitly exploded`).toHaveAttribute('data-three-exploded', 'false');
    await expect(designRig, `${type} design stack has no validation errors`).toHaveAttribute('data-three-stack-validation-errors', '0');
    await expect(designRig, `${type} design physical readiness gate is clean`).toHaveAttribute('data-three-physical-validation-errors', '0');
    await expect(designRig, `${type} design preview is renderable`).toHaveAttribute('data-three-preview-renderable', 'ready');
    expect(await designRig.getAttribute('data-three-rendered-layer-labels'), `${type} rendered labels match fabrication stack labels`).toBe(await designRig.getAttribute('data-three-stack-order'));
    expect(Number(await designRig.getAttribute('data-three-z-collision-count')), `${type} Design preview uses the packed supported z-stack`).toBe(0);
    await expect.poll(async () => Number(await designRig.getAttribute('data-three-dynamic-build-count')), { message: `${type} builds visible Three geometry in Design` }).toBeGreaterThan(0);
    for (const [attr, minimumCount] of expectedMarkers[type]) {
      expect(Number(await designRig.getAttribute(attr)), `${type} center preview includes ${attr}`).toBeGreaterThanOrEqual(minimumCount);
    }
    if (type === '4bar') {
      await expect(designRig).toHaveAttribute('data-three-fourbar-ground-link-plane', 'fabrication-stack-separated');
      const anchorXInput = page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]');
      const anchorYInput = page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]');
      await expect(anchorXInput, 'editable Design inspector exposes anchor X after mechanism selection').toBeVisible();
      await expect(anchorYInput, 'editable Design inspector exposes anchor Y after mechanism selection').toBeVisible();
      await anchorXInput.fill('280');
      await anchorYInput.fill('-120');
      await expect(designRig, 'Design keeps rendering the selected editable Foundry instance after inspector edits').toHaveAttribute('data-three-preview-renderable', 'ready');
    }
    if (type === 'gear') {
      await expect(designRig).toHaveAttribute('data-three-gear-train-linkage-mode', 'gear-only-train');
      await expect(designRig).toHaveAttribute('data-three-gear-plane-mode', 'coplanar-fixed-axles');
      const scrubber = page.getByLabel('Workspace scrubber');
      await scrubber.fill('10');
      const startRotation = await readRotation();
      await scrubber.fill('35');
      await expect.poll(async () => Math.abs(await readRotation() - startRotation), { message: 'Design integrated automata preview animates from the same mechanism angle state' }).toBeGreaterThan(10);
    }
    if (type === 'gear_linkage') {
      await expect(designRig).toHaveAttribute('data-three-gear-linkage-mode', 'two-gear-two-link-coupler');
    }
    if (type === 'planetary_gear') {
      await expect(designRig).toHaveAttribute('data-three-planetary-syntax', 'ring-fixed-sun-input-carrier-output');
      await expect(designRig).toHaveAttribute('data-three-planetary-output', 'carrier');
      await expect(designRig).toHaveAttribute('data-three-gear-plane-mode', 'planetary-coplanar-ring-sun-planet');
    }
    if (type === 'cam') {
      await expect(designRig).toHaveAttribute('data-three-cam-contact-mode', 'sampled-profile-on-guide-axis');
    }
  }


  expectCleanPage(pageErrors, consoleErrors);
});

test('shared Design renderer preserves exact compiled support paths for all six fabrication families', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await applyFourBarFromFoundry(page);
  const designRig = page.getByTestId('design-shared-foundry-preview').getByTestId('foundry-camera-rig');
  const mechanisms = [
    { type: '4bar', label: 'Four-bar linkage' },
    { type: 'piston', label: 'Slider piston' },
    { type: 'cam', label: 'Cam follower' },
    { type: 'gear', label: 'Gear train' },
    { type: 'gear_linkage', label: 'Gear linkage' },
    { type: 'planetary_gear', label: 'Planetary gear' },
  ] as const;

  for (const { type, label } of mechanisms) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(designRig, `${type} selects the shared compiled renderer`).toHaveAttribute('data-mechanism-type', type);
    expect(await designRig.getAttribute('data-three-support-path-kinds'), `${type} keeps exact compiled plate/spacer/guide/retainer path semantics`).toBe(EXPECTED_COMPILED_SUPPORT_PATH_KINDS[type]);
    expect(await designRig.getAttribute('data-three-support-contact-error-count'), `${type} has no face-contact gap, overlap, or fabricated midpoint`).toBe('0');
    expect(await designRig.getAttribute('data-three-support-spacer-error-count'), `${type} spacers have exact two-face support membership`).toBe('0');
    expect(await designRig.getAttribute('data-three-support-blocker-count'), `${type} has no compiled support blocker`).toBe('0');
    expect(await designRig.getAttribute('data-three-physical-pin-contract'), `${type} pin geometry comes from compiler support paths`).toBe('compiled-support-paths');
    expect(await designRig.getAttribute('data-three-pin-stack-z-sources'), `${type} pin depth comes from exact compiler spans`).toBe('compiled-support-paths-and-pin-spans');
    expect(await designRig.getAttribute('data-three-physical-pin-count'), `${type} has one rendered pin per pin-bearing support path`).toBe(String(EXPECTED_COMPILED_PIN_COUNTS[type]));
    const spans = (await designRig.getAttribute('data-three-support-path-pin-spans') ?? '').split(';').filter(Boolean);
    expect(spans.filter(item => !item.endsWith(':none')).length, `${type} diagnostics retain every compiler pin span`).toBe(EXPECTED_COMPILED_PIN_COUNTS[type]);
  }

  await expect(designRig, 'Planetary central and free owner paths keep exact compiler membership').toHaveAttribute(
    'data-three-planetary-owner-path-kinds',
    'sun-carrier-pivot-pin:gear>spacer>linkage>clip;planet-carrier-pin:clip>gear>spacer>linkage>clip',
  );
  await expect(designRig, 'Planetary central and free owner paths keep exact canonical faces').toHaveAttribute(
    'data-three-planetary-owner-path-faces',
    'sun-carrier-pivot-pin:0-4>4-5.6>5.6-9.6>9.6-10.4;planet-carrier-pin:-0.8-0>0-4>4-5.6>5.6-9.6>9.6-10.4',
  );
  await expect(designRig, 'Only the planetary sun/carrier path receives a board terminal').toHaveAttribute(
    'data-three-planetary-owner-path-roots',
    'sun-carrier-pivot-pin:board;planet-carrier-pin:free',
  );
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
  await expect(page.getByTestId('design-shared-foundry-preview')).toBeVisible();
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
  await page.getByTestId('stage-left-pane').locator('.stage-nav-compact').getByRole('button', { name: 'Path' }).click();
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
  await expect(page.getByTestId('blueprint-detail-preview')).toContainText('Build spot');
  await expect(page.getByTestId('blueprint-detail-preview')).toContainText('Build, then test.');
  await expect(page.getByTestId('blueprint-svg-preview')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Metadata', exact: true })).toHaveCount(0);
  await expect(page.getByText('Teacher files')).toHaveCount(0);

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
  await expect(state).toHaveAttribute('data-layer-paths', 'shown');
  await expect(state).toHaveAttribute('data-three-path-count', '1');
  await expect(state).toHaveAttribute('data-three-selected-path-id', 'path-right-arm');
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

  const readFreeDrawPointCount = async () => {
    const value = await page.getByTestId('free-draw-status').getAttribute('data-point-count');
    return Number(value ?? 0);
  };
  const beforeDraw = await readFreeDrawPointCount();
  const canvasBox = await page.getByTestId('path-canvas').boundingBox();
  expect(canvasBox, 'path canvas box').toBeTruthy();

  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.45, canvasBox!.y + canvasBox!.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.45 + 34, canvasBox!.y + canvasBox!.height * 0.45 + 22, { steps: 4 });
  await page.mouse.up();

  await expect(page.getByRole('button', { name: 'Draw free path', exact: true })).toHaveClass(/btn-secondary/);
  await expect(page.getByTestId('free-draw-status')).toHaveAttribute('data-draw-mode', 'idle');
  await expect.poll(
    readFreeDrawPointCount,
    { message: 'draw mode accepts pointer input on simplified canvas' }
  ).toBeGreaterThanOrEqual(3);
  const firstDrawCount = await readFreeDrawPointCount();
  expect(firstDrawCount, 'one released stroke creates a compact path').toBeLessThanOrEqual(12);

  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Drawing free path', exact: true })).toHaveClass(/btn-primary active/);
  await expect(page.getByTestId('free-draw-status')).toHaveAttribute('data-draw-mode', 'drawing');
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.62, canvasBox!.y + canvasBox!.height * 0.36);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.62 + 28, canvasBox!.y + canvasBox!.height * 0.36 + 18, { steps: 4 });
  await page.mouse.up();

  await expect(page.getByRole('button', { name: 'Draw free path', exact: true })).toHaveClass(/btn-secondary/);
  await expect(page.getByTestId('free-draw-status')).toHaveAttribute('data-draw-mode', 'idle');
  const secondDrawCount = await readFreeDrawPointCount();
  expect(secondDrawCount, 'redraw replaces previous stroke instead of appending').toBeLessThanOrEqual(firstDrawCount + 1);
  expect(secondDrawCount, 'replacement stroke still has enough points').toBeGreaterThanOrEqual(3);
  expect(beforeDraw, 'fixture starts with an existing path so replacement is a real behavior change').toBeGreaterThan(0);
});
