import { dismissStartupAnnouncement } from './startupHarness';
import { expect, test, type Dialog, type Locator, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { CLASSROOM_LESSONS, createLessonProject, serializeProject } from '../../utils/project';
import { serializeProjectCompact } from '../../utils/projectSerialization';
import { ENABLED_MECHANISM_TYPES, isMechanismTypeEnabled } from '../../utils/mechanismTemplates';
import { createFabricationReadyFourBarProject } from '../fixtures/fabricationProject';
import { FABRICATION_RENDER_LAYER_Z_STEP } from '../../utils/fabrication';
import { APP_MENU_GROUPS, commandById, type AppCommandId } from '../../utils/appCommands';
import {
  installChromebookAuditInstrumentation,
  applyChromebookEmulation,
  readFeatureRuntimeProbe,
  waitForLifecycleBaseline,
} from './chromebookAuditHarness';
import {
  clearBrowserAutosave,
  moveBrowserAutosaveToLegacyStorage,
  readBrowserAutosaveProbe,
  readBrowserAutosaveProject,
} from './autosaveIndexedDbProbe';

const ENABLED_CLASSROOM_LESSONS = CLASSROOM_LESSONS.filter(lesson => isMechanismTypeEnabled(lesson.mechanismType));

const expectCleanPage = (pageErrors: string[], consoleErrors: string[]) => {
  expect(pageErrors, 'no uncaught browser exceptions').toEqual([]);
  expect(consoleErrors, 'no browser console errors').toEqual([]);
};

const clickOptionalButton = async (button: Locator, label: string) => {
  if (!(await button.count())) return false;
  await expect(button, `${label} is visible before its conditional click`).toBeVisible();
  await expect(button, `${label} is enabled before its conditional click`).toBeEnabled();
  await button.click();
  return true;
};

const openMotionJointOptions = async (page: Page) => {
  const options = page.getByTestId('motion-joint-options');
  if (!await options.evaluate(element => (element as HTMLDetailsElement).open)) {
    await options.locator('summary').click();
  }
};

const recoverBrowserBackup = async (page: Page, activate: () => Promise<void>) => {
  const acceptRecovery = async (dialog: Dialog) => {
    expect(dialog.message()).toContain('Recover browser backup');
    await dialog.accept();
  };
  page.on('dialog', acceptRecovery);
  try {
    await activate();
    await expect(page.getByTestId('status-bar')).toContainText(
      /No browser backup found|Recovered browser backup|Project or backup changed\. Try again\./,
    );
  } finally {
    page.off('dialog', acceptRecovery);
  }
};

const canvasBackingPixelRatio = (canvas: Locator) => canvas.evaluate(element => {
  const rect = element.getBoundingClientRect();
  return (element as HTMLCanvasElement).width / Math.max(1, rect.width);
});

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

const readThreeScreenTargets = async (locator: Locator, attribute: string) => {
  const value = await locator.getAttribute(attribute);
  return JSON.parse(value || '[]') as ThreeScreenTarget[];
};

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
  const details = panel.locator('details').filter({ has: page.locator('summary', { hasText: /^Other cut files$/ }) });
  await expect(details, 'completed Blueprint exposes optional cut files').toBeVisible();
  const isOpen = await details.evaluate((element: HTMLDetailsElement) => element.open);
  if (!isOpen) await details.locator('summary').click();
};

const waitForBootLoader = async (page: Page) => {
  await expect(page.locator('#boot-loader'), 'static boot loader releases before optional AI preparation').toHaveCount(0, { timeout: 180_000 });
};

const openCharacterScreen = async (page: Page, options: { loadStarter?: boolean } = { loadStarter: true }) => {
  await waitForBootLoader(page);
  let dialog = page.getByTestId('getting-started-dialog');
  if (!(await dialog.count()) && options.loadStarter !== false) {
    const openGettingStarted = page.getByRole('button', { name: /Open Getting Started/i });
    await expect(openGettingStarted).toBeVisible();
    await expect(openGettingStarted).toBeEnabled();
    await openGettingStarted.click();
    dialog = page.getByTestId('getting-started-dialog');
    await expect(dialog).toBeVisible();
  }
  if (await dialog.count()) {
    if (options.loadStarter !== false) {
      let starterRig = dialog.getByRole('button', { name: /Open starter rig/i });
      if (!(await starterRig.count())) {
        const startersToggle = dialog.getByRole('button', { name: 'Starters', exact: true });
        await clickOptionalButton(startersToggle, 'Getting Started Starters');
        starterRig = dialog.getByRole('button', { name: /Open starter rig/i });
      }
      await starterRig.click();
    } else {
      let close = dialog.getByRole('button', { name: 'Close', exact: true });
      if (!(await close.count())) {
        const startersToggle = dialog.getByRole('button', { name: 'Starters', exact: true });
        await clickOptionalButton(startersToggle, 'Getting Started Starters');
        close = dialog.getByRole('button', { name: 'Close', exact: true });
      }
      await close.click();
    }
  }
  if (!(await page.getByTestId('character-screen').count())) {
    const character = page.getByRole('button', { name: /^Character$/i });
    await expect(character).toBeVisible();
    await expect(character).toBeEnabled();
    await character.click();
  }
  await expect(page.getByTestId('character-screen')).toBeVisible();
};

const switchGettingStartedToStarters = async (page: Page) => {
  const dialog = page.getByTestId('getting-started-dialog');
  const startersToggle = dialog.getByRole('button', { name: 'Starters', exact: true });
  await clickOptionalButton(startersToggle, 'Getting Started Starters');
  await expect(dialog.getByTestId('getting-started-gallery')).toBeVisible();
};

test('Context help opens compact registry popovers', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openCharacterScreen(page, { loadStarter: false });
  const controls = page.getByTestId('character-import-controls');
  await expect(controls).not.toContainText('Keep mechanisms');
  await expect(controls).toContainText('Getting Started');
  await expect(controls).toContainText('Add object');
  // Measure the help overlay after the existing stage entrance has finished.
  await page.getByTestId('character-screen').evaluate(async node => {
    await Promise.all(node.getAnimations().map(animation => animation.finished));
  });
  const controlsBefore = await waitForStableBox(page, controls, 'character import controls before help');
  const fileHelp = page.locator('[data-help-id="character.loadCharacterFile"]').getByTestId('context-help-trigger');
  await expect(fileHelp).toBeVisible();
  await fileHelp.click();
  const popover = page.getByTestId('context-help-popover');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('Load a rigged character');
  await expect(fileHelp).toHaveAttribute('aria-expanded', 'true');
  const controlsAfter = await waitForStableBox(page, controls, 'character import controls after help');
  expect(Math.abs((controlsAfter?.height ?? 0) - (controlsBefore?.height ?? 0)), 'tooltip overlay does not change import control height').toBeLessThan(1);
  expect(Math.abs((controlsAfter?.y ?? 0) - (controlsBefore?.y ?? 0)), 'tooltip overlay does not move import controls').toBeLessThan(1);
  expect(await popover.evaluate(node => Boolean(node.parentElement?.matches('body'))), 'tooltip popover is portaled to body').toBe(true);
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);

  const bodySidesHelp = page
    .locator('[data-help-id="character.bodySides"]')
    .getByTestId('context-help-trigger');
  await expect(bodySidesHelp).toBeVisible();
  await bodySidesHelp.click();
  await expect(popover).toContainText('Left and right are named from the character\'s point of view.');
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);

  await page.setViewportSize({ width: 980, height: 360 });
  await page.getByRole('button', { name: /^Options$/i }).click();
  const optionsWorkspace = page.getByTestId('options-settings-workspace');
  await expect(optionsWorkspace).toBeVisible();
  await optionsWorkspace.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const lowerHelp = optionsWorkspace
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

test('Character shape editor keeps candidates local until Use shape', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openCharacterScreen(page);
  await page.getByTestId('character-part-item-head').click();
  const summary = page.getByTestId('part-cut-summary');
  const originalSummary = await summary.textContent();
  await page.getByTestId('part-cut-bake').click();
  const editor = page.getByTestId('shape-editor');
  await expect(editor).toBeVisible();
  await expect(summary).toHaveText(originalSummary ?? '');
  const dialogBox = await editor.boundingBox();
  const viewport = page.viewportSize();
  if (!dialogBox || !viewport) throw new Error('Missing shape editor metrics');
  expect(dialogBox.width).toBeGreaterThan(700);
  expect(dialogBox.height).toBeLessThan(viewport.height);
  expect(Math.abs(dialogBox.x + dialogBox.width / 2 - viewport.width / 2)).toBeLessThan(12);
  const canvas = editor.getByTestId('shape-editor-canvas');
  const points = canvas.locator('[data-shape-point]');
  const initialPointCount = await points.count();
  await editor.getByRole('button', { name: 'Add point', exact: true }).click();
  await expect(points).toHaveCount(initialPointCount + 1);
  await expect(summary).toHaveText(originalSummary ?? '');
  await editor.getByRole('button', { name: 'Undo shape', exact: true }).click();
  await expect(points).toHaveCount(initialPointCount);
  await editor.getByRole('button', { name: 'Redo shape', exact: true }).click();
  await expect(points).toHaveCount(initialPointCount + 1);
  const parseView = async () => {
    const [x, y, width, height] = (await canvas.getAttribute('viewBox'))!.split(/\s+/).map(Number);
    return { x, y, width, height };
  };
  const initialView = await parseView();
  await editor.getByRole('slider', { name: 'Shape zoom' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await parseView()).width).toBeLessThan(initialView.width);
  await editor.getByRole('button', { name: 'Pan', exact: true }).click();
  const box = (await canvas.boundingBox())!;
  const beforePan = await parseView();
  await page.mouse.move(box.x + box.width * .45, box.y + box.height * .45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .55);
  await page.mouse.up();
  await expect.poll(async () => (await parseView()).x).not.toBe(beforePan.x);
  await editor.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect.poll(async () => (await parseView()).width).toBeCloseTo(initialView.width, 3);
  await editor.getByRole('button', { name: 'Edit points', exact: true }).click();
  const editedPoint = canvas.locator('[data-shape-point="1"]');
  const pointBox = (await editedPoint.boundingBox())!;
  const beforeX = await editedPoint.getAttribute('cx');
  await page.mouse.move(pointBox.x + pointBox.width / 2, pointBox.y + pointBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(pointBox.x + pointBox.width / 2 + 12, pointBox.y + pointBox.height / 2 - 6);
  await page.mouse.up();
  await expect.poll(() => editedPoint.getAttribute('cx')).not.toBe(beforeX);
  await editor.getByRole('button', { name: 'Reset', exact: true }).click();
  const bounds = await points.evaluateAll(nodes => {
    const xs = nodes.map(node => Number(node.getAttribute('cx'))), ys = nodes.map(node => Number(node.getAttribute('cy')));
    return { left: Math.min(...xs) - 10, top: Math.min(...ys) - 10, right: Math.max(...xs) + 10, bottom: Math.max(...ys) + 10 };
  });
  const view = await parseView();
  const toClient = (x: number, y: number) => ({ x: box.x + (x - view.x) / view.width * box.width, y: box.y + (y - view.y) / view.height * box.height });
  const corners = [toClient(bounds.left, bounds.top), toClient(bounds.right, bounds.top), toClient(bounds.right, bounds.bottom), toClient(bounds.left, bounds.bottom)];
  await editor.getByRole('button', { name: 'Draw outline', exact: true }).click();
  // A crossed candidate remains visible and cannot overwrite the physical part.
  await page.mouse.move(corners[0].x, corners[0].y); await page.mouse.down();
  for (const index of [2, 1, 3, 0]) await page.mouse.move(corners[index].x, corners[index].y);
  await page.mouse.up();
  await expect(editor.getByTestId('use-shape')).toBeDisabled();
  await expect(editor.getByRole('status')).toContainText(/Uncross|overlapping/);
  await expect(summary).toHaveText(originalSummary ?? '');
  await editor.getByRole('button', { name: 'Reset', exact: true }).click();
  // Pointer cancellation discards only this unfinished outline.
  await page.mouse.move(corners[0].x, corners[0].y); await page.mouse.down();
  await page.mouse.move(corners[1].x, corners[1].y);
  await canvas.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true });
  await page.mouse.up();
  await expect(editor.getByTestId('use-shape')).toBeEnabled();
  await page.mouse.move(corners[0].x, corners[0].y); await page.mouse.down();
  for (const corner of [...corners.slice(1), corners[0]]) await page.mouse.move(corner.x, corner.y, { steps: 3 });
  await page.mouse.up();
  await expect(editor.getByTestId('use-shape')).toBeEnabled();
  await expect(summary).toHaveText(originalSummary ?? '');
  await editor.getByTestId('use-shape').click();
  await expect(editor).toHaveCount(0);
  await expect(summary).toHaveText('Custom');
  const puppet = page.getByTestId('character-three-puppet-state');
  await expect.poll(async () => Number(await puppet.getAttribute('data-three-render-triangles'))).toBeGreaterThan(0);
  expectCleanPage(pageErrors, consoleErrors);
});

test('Imported shape editing retains its source guide and Cancel keeps the outline', async ({ page }) => {
  const pageErrors: string[] = [], consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const project = createLessonProject('head-bob');
  const sourceImageFrame = { x: -120, y: -160, width: 240, height: 200 };
  const sourceTextureUrl = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="200"><rect width="240" height="200" fill="#ffca42"/><rect width="120" height="100" fill="#134e8c"/></svg>').toString('base64')}`;
  project.parts.head = { ...project.parts.head, contourSource: 'imported', sourceImageFrame };
  project.characterPackage = {
    id: 'legacy-source-guide', createdAt: '2026-09-07T00:00:00.000Z', sourceImageName: 'source-guide.svg',
    outputDir: '', partsInfo: {}, charCfg: {}, sourceTextureUrl,
  };
  const directory = await mkdtemp(join(tmpdir(), 'motionsmith-shape-source-'));
  const file = join(directory, 'legacy-source-guide.motionsmith.json');
  await writeFile(file, serializeProject(project));
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await importProjectFile(page, file, 'character');
  await page.getByTestId('character-part-item-head').click();
  await expect(page.getByTestId('part-cut-summary')).toHaveText('Imported');
  await page.getByTestId('part-cut-bake').click();
  const editor = page.getByTestId('shape-editor');
  await expect(editor).toBeVisible();
  const original = await editor.locator('.shape-candidate').getAttribute('d');
  await expect(editor.getByTestId('shape-source-image')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Source guide', exact: true }).click();
  const source = editor.getByTestId('shape-source-image');
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute('href', sourceTextureUrl);
  for (const [key, value] of Object.entries(sourceImageFrame)) await expect(source).toHaveAttribute(key, String(value));
  await expect.poll(() => editor.locator('canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) return true;
    return false;
  }), { message: 'retained artwork is drawn by the live shape preview' }).toBe(true);
  await editor.getByRole('button', { name: 'Shrink', exact: true }).click();
  await expect(editor.locator('.shape-candidate')).not.toHaveAttribute('d', original!);
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId('part-cut-summary')).toHaveText('Imported');
  await page.getByTestId('part-cut-bake').click();
  await expect(editor.locator('.shape-candidate')).toHaveAttribute('d', original!);
  await editor.getByRole('button', { name: 'Source guide', exact: true }).click();
  await expect(editor.getByTestId('shape-source-image')).toHaveAttribute('href', sourceTextureUrl);
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  expectCleanPage(pageErrors, consoleErrors);
});

test('Blueprint keeps a painted prop visible beyond the real board', async ({ page }, info) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openCharacterScreen(page);
  await page.getByTestId('character-draw-object').click();
  await page.getByRole('textbox', { name: 'Object name', exact: true }).fill('Moved painted prop');
  await page.getByRole('button', { name: 'Paint color #ef476f', exact: true }).click();
  const paint = page.getByTestId('paint-canvas');
  const paintBox = (await paint.boundingBox())!;
  await page.mouse.move(paintBox.x + paintBox.width * .45, paintBox.y + paintBox.height * .5);
  await page.mouse.down();
  await page.mouse.move(paintBox.x + paintBox.width * .55, paintBox.y + paintBox.height * .5, { steps: 5 });
  await page.mouse.up();
  await page.getByTestId('paint-workspace').getByRole('button', { name: 'Add object', exact: true }).click();
  await page.getByTestId('scene-object-inspector').getByLabel('X number', { exact: true }).fill('500');
  await page.getByTestId('workflow-stage-blueprint').click();
  const piece = page.locator('[data-blueprint-artwork-owner]').last();
  await expect(piece).toHaveAttribute('data-blueprint-artwork-status', 'current');
  const framing = await piece.evaluate((element: SVGGraphicsElement) => {
    const svg = element.ownerSVGElement!;
    const target = element.querySelector('polygon')!.getBoundingClientRect();
    const viewport = svg.getBoundingClientRect();
    const board = svg.querySelector('.blueprint-board-fill')!;
    return {
      inside: target.left >= viewport.left && target.right <= viewport.right
        && target.top >= viewport.top && target.bottom <= viewport.bottom,
      boardWidth: board.getAttribute('width'),
      artwork: Boolean(element.querySelector('image')?.getAttribute('href')),
    };
  });
  expect(framing.inside, 'the moved physical piece is fully visible').toBe(true);
  expect(framing.artwork, 'the visible piece contains retained painting').toBe(true);
  expect(framing.boardWidth, 'fitting never scales up the physical board').toBe('300');
  await expect(page.getByRole('button', { name: 'Download Build PDF', exact: true })).toBeEnabled();
  await expect(page.getByTestId('stage-left-pane')).toContainText('outside sheet bounds');
  await page.getByTestId('blueprint-canvas-preview').screenshot({ path: info.outputPath('moved-painted-prop-blueprint.png') });
});

test('Character tab owns separate scene objects and later tabs only render them', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
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
  await page.getByTestId('command-menu-file').click();
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  expect(discardMessage).toContain('Current work will be kept in Earlier versions and a recovery copy.');
  await expect(page.getByTestId('status-bar')).toContainText('Project unchanged');

  page.once('dialog', async dialog => dialog.accept());
  await page.getByTestId('command-menu-file').click();
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
  const objectPathCanvas = page.getByTestId('path-three-puppet-canvas');
  const objectPathBox = await objectPathCanvas.boundingBox();
  expect(objectPathBox, 'object path canvas box').toBeTruthy();
  await page.mouse.move(objectPathBox!.x + objectPathBox!.width * 0.42, objectPathBox!.y + objectPathBox!.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(objectPathBox!.x + objectPathBox!.width * 0.5, objectPathBox!.y + objectPathBox!.height * 0.37, { steps: 4 });
  await page.mouse.move(objectPathBox!.x + objectPathBox!.width * 0.58, objectPathBox!.y + objectPathBox!.height * 0.42, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
  const objectPathPuppet = page.getByTestId('path-three-puppet-state');
  await expect(objectPathPuppet).toHaveAttribute('data-scene-object-count', '1');
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
  const objectCanvasBox = await objectDesignPreview.locator('canvas.foundry-three-canvas').boundingBox();
  expect(objectCanvasBox, 'design Foundry canvas supports object picking').toBeTruthy();
  const designClick = {
    x: objectCanvasBox!.x + objectCanvasBox!.width * 0.5,
    y: objectCanvasBox!.y + objectCanvasBox!.height * 0.5,
  };
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

test('Getting Started gives Open Project its own row below two starter tiles', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await waitForBootLoader(page);
  const dialog = page.getByTestId('getting-started-dialog');
  const gallery = dialog.getByTestId('getting-started-gallery');
  const fileActions = dialog.getByTestId('getting-started-file-actions');
  const characterFileAction = fileActions.getByTestId('getting-started-open-character');
  const fullProjectAction = dialog.getByTestId('getting-started-open-project');

  await expect(page.getByTestId('character-three-puppet'), 'Getting Started does not mount a hidden Character WebGL scene').toHaveCount(0);
  await expect(gallery.locator('.template-tile')).toHaveCount(2);
  await expect(gallery.getByTestId('getting-started-card-guided')).toBeVisible();
  await expect(gallery.getByTestId('getting-started-card-humanoid')).toBeVisible();
  await expect(gallery).not.toContainText('Character file');
  await expect(characterFileAction).toBeVisible();
  await expect(fullProjectAction).toBeVisible();

  const characterFileBox = await characterFileAction.boundingBox();
  const fullProjectBox = await fullProjectAction.boundingBox();
  const galleryBox = await gallery.boundingBox();
  expect(characterFileBox, 'Character file secondary action has a layout box').toBeTruthy();
  expect(fullProjectBox, 'Open Project has a layout box').toBeTruthy();
  expect(galleryBox, 'starter choices have a layout box').toBeTruthy();
  expect(fullProjectBox!.y, 'Open Project follows the starter choices').toBeGreaterThanOrEqual(galleryBox!.y + galleryBox!.height);
  expect(fullProjectBox!.width, 'Open Project spans the starter-choice row').toBeGreaterThanOrEqual(galleryBox!.width - 2);
  expect(characterFileBox!.y, 'Character file remains a secondary action below Open Project').toBeGreaterThanOrEqual(fullProjectBox!.y + fullProjectBox!.height);

  const characterChooserPromise = page.waitForEvent('filechooser');
  await characterFileAction.click();
  const characterChooser = await characterChooserPromise;
  expect(characterChooser.isMultiple()).toBe(true);
  await characterChooser.setFiles([]);

  const projectChooserPromise = page.waitForEvent('filechooser');
  await fullProjectAction.click();
  const projectChooser = await projectChooserPromise;
  expect(projectChooser.isMultiple()).toBe(false);
  await projectChooser.setFiles([]);

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('project-lifecycle-panel'), 'closing empty entry leaves file actions ready in Project').toBeVisible();
  await expect(page.locator('canvas'), 'empty work does not invent preview geometry').toHaveCount(0);

  expectCleanPage(pageErrors, consoleErrors);
});

test('Getting Started guided project opens a real editable lesson', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
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
  await expect(makeItYours).toContainText('Edit parts');
  await expect(makeItYours).toContainText('Place joints');
  await expect(makeItYours).toContainText('Change path');
  await expect(makeItYours).toContainText('Fit mechanism');
  await expect(makeItYours).toHaveAttribute('data-change-cue', 'hand path');
  await expect(makeItYours).toHaveAttribute('data-build-cue', 'four-bar');
  await expect(makeItYours).not.toContainText('Change hand path');
  await expect(makeItYours).not.toContainText('Build four-bar');
  await expect(makeItYours).not.toContainText('Crank turns -> rocker swings');
  await expect(page.getByTestId('classroom-checklist')).toHaveCount(0);
  await expect(page.getByTestId('character-three-puppet-state')).toHaveAttribute('data-three-mechanism-count', '0');
  await expect(page.getByTestId('character-three-puppet-toggle-mechanisms')).toHaveCount(0);
  await expect(page.getByTestId('status-bar')).toContainText('Make a hand wave ready');
  await clickStage(page, 'Foundry');
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
  await expect(designPreview).toHaveAttribute('data-design-fit-status', 'fit');
  await expect(designPreview).toHaveAttribute('data-design-motion-source', 'linkage-trace');
  expect(Number(await designPreview.getAttribute('data-design-target-error'))).toBeLessThan(0.1);
  expect(Number(await designPreview.getAttribute('data-design-animated-part-count'))).toBeGreaterThanOrEqual(3);
  const guidedHandBefore = await waitForThreePartTarget(guidedFoundryRig, 'right_hand_part');
  await page.getByLabel('Workspace scrubber').fill('35');
  await expect.poll(async () => {
    const moved = (await readThreeScreenTargets(guidedFoundryRig, 'data-three-part-screen-targets'))
      .find(item => item.id === 'right_hand_part' && item.visible);
    return moved ? Math.hypot(moved.x - guidedHandBefore.x, moved.y - guidedHandBefore.y) : 0;
  }, { message: 'guided Design hand follows the physical four-bar output while scrubbing' }).toBeGreaterThan(2);
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
  const designModuleRequests: string[] = [];
  const classroomExampleModuleRequests: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (/\/assets\/MechanismDesign-[^/]+\.js(?:\?|$)/.test(url)) {
      designModuleRequests.push(url);
    }
    if (/\/assets\/ClassroomExampleVideo-[^/]+\.js(?:\?|$)/.test(url)) {
      classroomExampleModuleRequests.push(url);
    }
  });
  const youtubeRequests: string[] = [];
  await page.route('https://www.youtube-nocookie.com/**', async route => {
    youtubeRequests.push(route.request().url());
    await route.abort();
  });

  await page.goto(`${process.env.PLAYWRIGHT_BASE_PATH || '/'}?assessment=motion-journal`);
  await dismissStartupAnnouncement(page);
  await waitForBootLoader(page);
  const gettingStarted = page.getByTestId('getting-started-dialog');
  await expect(gettingStarted).toBeVisible();
  await gettingStarted.getByTestId('getting-started-card-guided').click();
  await gettingStarted.getByTestId('guided-project-card-waving-arm').click();

  await page.getByRole('button', { name: /Foundry/i }).click();
  const assessmentPrompt = page.getByTestId('classroom-assessment-prompt').first();
  await expect(assessmentPrompt).toHaveAttribute('data-assessment-key', 'motion-journal');
  await expect(assessmentPrompt).toContainText('What changed');
  await expect(page.getByTestId('classroom-example-video')).toHaveCount(0);
  await expect.poll(
    () => designModuleRequests.length,
    { message: 'Foundry idle-preloads the next Design adapter' },
  ).toBeGreaterThan(0);
  expect(
    classroomExampleModuleRequests,
    'preloading Design cannot fetch the click-owned classroom example chunk',
  ).toEqual([]);
  await page.getByTestId('foundry-visible-sensemaking').click();
  const example = page.getByTestId('classroom-example-video').first();
  await expect(example).toContainText('Where: waving hand');
  await expect.poll(
    () => classroomExampleModuleRequests.length,
    { message: 'Hint owns the classroom example chunk request' },
  ).toBeGreaterThan(0);
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

  await page.getByTestId('workflow-stage-blueprint').click();
  await expect(page.getByRole('heading', { name: 'Blueprint' })).toBeVisible();
  await page.getByRole('button', { name: 'Download Blueprint PDF', exact: true }).click();
  await page.getByRole('button', { name: /Assembly/i }).click();
  await expect(page.getByRole('heading', { name: 'Assembly' })).toBeVisible();
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

const writeUnfittedWavingArmLessonProject = async () => {
  const project = createLessonProject('waving-arm');
  const path = project.paths['path-right-arm'];
  project.paths[path.id] = {
    ...path,
    points: [
      { x: 500, y: 500 },
      { x: 620, y: 500 },
      { x: 620, y: 620 },
      { x: 500, y: 620 },
    ],
    timedPoints: undefined,
  };
  const dir = await mkdtemp(join(tmpdir(), 'motionsmith-unfitted-lesson-'));
  const projectPath = join(dir, 'unfitted-waving-arm.motionsmith.json');
  await writeFile(projectPath, serializeProject(project), 'utf8');
  return projectPath;
};

const writeHeadBobLessonProject = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motionsmith-hidden-lesson-'));
  const path = join(dir, 'head-bob.motionsmith.json');
  await writeFile(path, serializeProject(createLessonProject('head-bob')), 'utf8');
  return path;
};

const writeFabricationReadyFourBarProject = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motionsmith-fit-'));
  const path = join(dir, 'fabrication-fit.motionsmith.json');
  fabricationReadyFourBarSnapshot ??= serializeProject(createFabricationReadyFourBarProject());
  await writeFile(path, fabricationReadyFourBarSnapshot, 'utf8');
  return path;
};

const largeAutosaveProjectFile = (megabytes: number, generation: 'a' | 'b' = 'a') => {
  const project = createLessonProject('waving-arm');
  const partId = project.partOrder[0];
  project.parts[partId] = {
    ...project.parts[partId],
    originalSvgPath: `memory://${generation.repeat(megabytes * 1024 * 1024)}`,
  };
  project.settings = {
    ...project.settings,
    autosave: true,
    autosaveIntervalSeconds: 60,
  };
  return {
    name: `autosave-${megabytes}mb-${generation}.motionsmith.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProjectCompact(project)),
  };
};

let fabricationReadyFourBarSnapshot: string | undefined;

const importProjectFile = async (page: Page, projectPath: string, targetStage: 'character' | 'path' = 'path') => {
  await waitForBootLoader(page);
  const gettingStarted = page.getByTestId('getting-started-dialog');
  if (await gettingStarted.count()) {
    if (await gettingStarted.getByTestId('guided-project-library').count()) {
      const starters = gettingStarted.getByRole('button', { name: 'Starters' });
      await expect(starters).toBeVisible();
      await expect(starters).toBeEnabled();
      await starters.click();
    }
    await page.getByTestId('project-file-input').setInputFiles(projectPath);
  } else {
    await page.getByTestId('project-file-input').setInputFiles(projectPath);
  }
  await expect(page.getByTestId('status-bar')).toContainText(
    new RegExp(`Loaded project ${basename(projectPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|Project unchanged`),
  );
  if (!(await page.locator('[data-stage="path"]').count())) {
    await page.getByRole('button', { name: /^Path(?: Editor)?$/ }).click();
  }
  await expect(page.locator('[data-stage="path"]')).toBeVisible();
  if (targetStage === 'character') {
    await page.getByRole('button', { name: /^Character$/i }).click();
    await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  }
};

const importWavingArmLessonProject = async (page: Page, targetStage: 'character' | 'path' = 'path') => {
  await importProjectFile(page, await writeWavingArmLessonProject(), targetStage);
};

const importFabricationReadyFourBarProject = async (page: Page, targetStage: 'character' | 'path' = 'path') => {
  await importProjectFile(page, await writeFabricationReadyFourBarProject(), targetStage);
};

const openWavingArmTemplate = async (page: Page) => {
  await importWavingArmLessonProject(page, 'path');
};

const openFabricationReadyFourBar = async (page: Page) => {
  await importFabricationReadyFourBarProject(page, 'path');
};

const applyFourBarFromFoundry = async (page: Page) => {
  await page.getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  const fitPath = page.getByTestId('foundry-fit-path');
  await expect(fitPath).toBeEnabled();
  await fitPath.click();
  await expect(page.getByRole('button', { name: /Use this mechanism/i })).toBeEnabled();
  await page.getByRole('button', { name: /Use this mechanism/i }).click();
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
const clickStage = async (page: Page, name: string | RegExp) => {
  const button = stageRailButton(page, name);
  const testId = await button.getAttribute('data-testid');
  await button.click();
  const target = testId?.replace(/^workflow-stage-/, '');
  if (target && target !== testId) {
    await expect(page.locator(`[data-stage="${target}"]`)).toBeVisible();
  }
};
const expectProjectCounts = async (page: Page, parts: number, paths: number, mechanisms: number) => {
  await expect(page.getByTestId('stage-project-card')).toHaveAttribute('aria-label', new RegExp(`${parts} parts, ${paths} paths, ${mechanisms} mechanisms`));
  await expect(page.getByTestId('stage-project-card')).not.toBeVisible();
};

test('Header and rail Home reopen Getting Started without resetting the project', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  await clickStage(page, 'Foundry');
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  await expect(page.getByTestId('getting-started-dialog')).toHaveCount(0);

  const openAndVerifyHome = async (activate: () => Promise<void>) => {
    await activate();
    const dialog = page.getByTestId('getting-started-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('character-screen')).toHaveCount(0);
    let close = dialog.getByRole('button', { name: 'Close', exact: true });
    if (!(await close.count())) {
      const starters = dialog.getByRole('button', { name: 'Starters', exact: true });
      await expect(starters).toBeVisible();
      await expect(starters).toBeEnabled();
      await starters.click();
      close = dialog.getByRole('button', { name: 'Close', exact: true });
    }
    await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Mechanism Foundry', exact: true }), 'closing Home preserves the active stage').toBeVisible();
    await clickStage(page, 'Character');
    await expect(page.getByTestId('character-screen')).toBeVisible();
    const puppet = page.getByTestId('character-three-puppet-state');
    await expect(puppet).toHaveAttribute('data-part-count', /[1-9]\d*/);
    await clickStage(page, 'Path');
    await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
    await expect(page.getByTestId('path-three-puppet-state')).toHaveAttribute('data-three-path-count', '1');
    await clickStage(page, 'Character');
    await expect(page.getByTestId('character-screen')).toBeVisible();
  };

  await openAndVerifyHome(() => page.getByTestId('header-home').click());
  await clickStage(page, 'Foundry');
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  await openAndVerifyHome(async () => {
    await page.getByTestId('rail-home').focus();
    await page.keyboard.press('Enter');
  });
});

test('character → path → foundry → design → blueprint runs end-to-end in browser', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await expect(page.getByTestId('shared-workbench')).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
  await expect(page.getByTestId('character-screen')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.classList.contains('welcome-modal-open'))).toBe(true);
  await expect(page.getByTestId('onnx-cache-status')).toHaveCount(0);
  await expect(page.getByTestId('status-bar')).not.toContainText(/parts:|paths:|mechs:|zoom/);

  const gettingStarted = page.getByTestId('getting-started-dialog');
  await expect(gettingStarted).toBeVisible();
  await expect(gettingStarted).toContainText('Start.');
  const starterGallery = gettingStarted.getByTestId('getting-started-gallery');
  await expect(starterGallery).toBeVisible();
  const guidePreview = gettingStarted.getByTestId('getting-started-guide-preview');
  await expect(guidePreview).toBeVisible();
  await expect(guidePreview.locator('[data-preview-mode="rendered-character-motion"]')).toBeVisible();
  await expect(guidePreview.locator('svg')).toHaveAttribute('data-motion-preview', 'character-path');
  await expect(starterGallery).toContainText('Guide');
  await expect(starterGallery).toContainText('Starter rig');
  await expect(starterGallery).not.toContainText('Character file');
  await expect(starterGallery).not.toContainText('Image');
  await expect(starterGallery).not.toContainText('Girl');
  await expect(starterGallery).not.toContainText('Boy');
  await expect(gettingStarted.getByTestId('getting-started-card-girl')).toHaveCount(0);
  await expect(gettingStarted.getByTestId('getting-started-card-boy')).toHaveCount(0);
  await expect(starterGallery.getByRole('button', { name: 'Open Guide', exact: true })).toBeVisible();
  await expect(starterGallery.getByRole('button', { name: 'Open starter rig', exact: true })).toBeVisible();
  await expect(starterGallery).not.toContainText('Pick a working motion project.');
  await expect(starterGallery).not.toContainText('Start with a simple body.');
  await expect(gettingStarted.getByTestId('getting-started-file-actions')).toContainText('Character file');
  await expect(gettingStarted.getByRole('button', { name: 'Open Project', exact: true })).toBeVisible();
  await gettingStarted.getByTestId('getting-started-card-guided').click();
  await expect(gettingStarted).toContainText('Pick a project.');
  const guidedLibrary = gettingStarted.getByTestId('guided-project-library');
  await expect(guidedLibrary).toBeVisible();
  await expect(gettingStarted.getByTestId('getting-started-gallery')).toHaveCount(0);
  await expect(guidedLibrary).toContainText('Make a hand wave');
  await expect(guidedLibrary).not.toContainText('Make a head bob');
  await expect(guidedLibrary).toContainText('Make a foot step');
  await expect(guidedLibrary).toContainText('Make gears spin');
  await expect(guidedLibrary.getByTestId('guided-project-card-waving-arm')).toContainText('Change hand path');
  await expect(guidedLibrary.getByTestId('guided-project-card-waving-arm')).toContainText('Build four-bar');
  await expect(guidedLibrary.getByTestId('guided-project-card-head-bob')).toHaveCount(0);
  await expect(guidedLibrary.getByTestId('guided-project-card-walking-leg')).toContainText('Change foot path');
  await expect(guidedLibrary.getByTestId('guided-project-card-walking-leg')).toContainText('Build four-bar');
  await expect(guidedLibrary.getByTestId('guided-project-card-spin-gears')).toContainText('Change gear size');
  await expect(guidedLibrary.getByTestId('guided-project-card-spin-gears')).toContainText('Build gear pair');
  await expect(guidedLibrary.locator('[data-testid^="guided-project-card-"]')).toHaveCount(3);
  for (const lesson of ENABLED_CLASSROOM_LESSONS) {
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
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Character file');
  await expect(gettingStarted.getByTestId('getting-started-file-actions')).toContainText('Character file');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Image');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Girl');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Boy');
  await expect(gettingStarted.getByRole('button', { name: 'Open Project', exact: true })).toBeVisible();
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Package');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Humanoid');
  await expect(gettingStarted.getByTestId('getting-started-gallery').locator('.template-tile')).toHaveCount(2);
  await expect(gettingStarted.getByTestId('getting-started-gallery').locator('.template-icon-slot')).toHaveCount(2);
  await expect(gettingStarted.getByTestId('getting-started-gallery').locator('.starter-thumb')).toHaveCount(0);
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Local browser processing');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('rigging');
  await expect(gettingStarted.getByTestId('getting-started-gallery')).not.toContainText('Waving arm');
  await page.getByRole('button', { name: 'Close' }).click();
  expect(await page.evaluate(() => document.documentElement.classList.contains('welcome-modal-open'))).toBe(false);

  await expect(page.getByTestId('project-lifecycle-panel')).toBeVisible();
  await clickStage(page, 'Character');
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
  await expect(page.getByTestId('novice-path-panel')).toContainText('Edit Right hand');
  await expect(page.getByRole('heading', { name: 'Edit Right hand' })).toBeVisible();
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
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
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await expect(pathPuppet).toHaveAttribute('data-camera-preset', 'front');
  await expect(pathPuppet).toHaveAttribute('data-view-mode', '2d');
  await expect(page.getByTestId('path-shape-controls')).toBeVisible();
  await expect(page.getByLabel('Smoothness number')).toBeVisible();
  const zoomReadout = page.getByTestId('canvas-zoom-readout');
  const readZoomPercent = async () => Number((await zoomReadout.textContent())?.replace('%', '') ?? '0');
  const zoomBefore = await readZoomPercent();
  const pathCanvasForZoom = page.getByTestId('path-three-puppet-canvas');
  const pathBox = await pathCanvasForZoom.boundingBox();
  if (!pathBox) throw new Error('path 2D canvas box missing');
  await page.mouse.move(pathBox.x + pathBox.width * 0.55, pathBox.y + pathBox.height * 0.45);
  await page.mouse.wheel(0, -360);
  await expect.poll(readZoomPercent).toBeGreaterThan(zoomBefore);
  await page.getByTestId('path-view-3d').click();
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
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
  await expect(pathPuppet).toHaveAttribute('data-three-joint-ids', /(^|,)right_elbow(,|$)/);
  expect((await pathPuppet.getAttribute('data-three-joint-ids') ?? '').split(',').filter(Boolean).length).toBeGreaterThanOrEqual(17);
  await page.getByRole('button', { name: 'Drawing free path', exact: true }).click();

  const projectDownloadPromise = page.waitForEvent('download');
  await page.getByTestId('command-menu-file').click();
  await page.getByTestId('command-download-snapshot').click();
  const projectDownload = await projectDownloadPromise;
  expect(projectDownload.suggestedFilename()).toMatch(/\.motionsmith$/);
  const projectDownloadPath = await projectDownload.path();
  expect(projectDownloadPath, 'project download path').toBeTruthy();
  const projectSnapshot = JSON.parse(await readFile(projectDownloadPath!, 'utf8'));
  expect(projectSnapshot.format).toBe('motionsmith-project');
  expect(projectSnapshot.schemaVersion).toBe(2);
  expect(projectSnapshot.project).toBeTruthy();
  expect(projectSnapshot.project.parts).toBeTruthy();
  expect(projectSnapshot.project.skeleton).toBeTruthy();
  expect(projectSnapshot.project.paths).toBeTruthy();
  expect(projectSnapshot.project.mechanisms).toBeTruthy();
  expect(projectSnapshot.project.settings).toBeTruthy();
  await page.getByTestId('project-file-input').setInputFiles(projectDownloadPath!);
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();

  await page.getByTestId('path-view-3d').click();
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByTestId('path-view-2d')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('path-three-puppet-canvas')).toHaveCount(1);
  const pathCanvas = page.getByTestId('path-three-puppet-canvas');
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

  // The authored lesson stroke above remains covered by the path-editor flow;
  // use the deterministic physical trace for the downstream Foundry/Design/
  // Blueprint handoff so this test exercises an actually buildable mechanism.
  let replacementDialogMessage = '';
  page.once('dialog', async dialog => {
    replacementDialogMessage = dialog.message();
    await dialog.accept();
  });
  await openFabricationReadyFourBar(page);
  expect(replacementDialogMessage).toContain('Current work will be kept in Earlier versions and a recovery copy.');

  await clickStage(page, 'Foundry');
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
  await expect(page.getByTestId('foundry-canvas-pane')).toHaveAttribute('data-fit-target-path', 'fabrication-fit-path');
  await page.getByTestId('foundry-fit-path').click();
  await expect(page.getByTestId('foundry-fit-path')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByTestId('foundry-fit-path')).not.toContainText('Cancel');
  await expect(page.getByRole('button', { name: /Use this mechanism/i })).toBeEnabled();
  await expect(page.getByTestId('foundry-canvas-pane')).toHaveAttribute('data-mechanism-path-preview', 'shown');
  await clickStage(page, 'Mechanism Design');
  const fitBeforeUse = page.getByTestId('design-shared-foundry-preview');
  await expect(fitBeforeUse).toHaveAttribute('data-design-fit-status', 'fit');
  await expect(fitBeforeUse).toHaveAttribute('data-design-motion-source', 'linkage-trace');
  await expect(fitBeforeUse).toHaveAttribute('data-design-generated-path-count', /^(?:[1-9][0-9]*)$/);
  await clickStage(page, 'Foundry');
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
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
  await expect(page.getByTestId('foundry-pick-anchor')).toContainText('Cancel attach');
  const previewBox = await page.getByTestId('foundry-preview').boundingBox();
  expect(previewBox, 'foundry preview supports direct anchor picking').toBeTruthy();
  await page.mouse.click(previewBox!.x + previewBox!.width * 0.52, previewBox!.y + previewBox!.height * 0.52);
  await expect(page.getByTestId('foundry-pick-anchor')).toContainText('Attach to part');
  await expect(page.getByTestId('foundry-anchor-marker')).toBeVisible();
  await expect(page.getByTestId('foundry-anchor-marker')).toHaveAttribute('transform', /translate\(/);
  await foundryInspector.getByText('Mechanism options', { exact: true }).click();
  const foundryAnchorXInput = foundryInspector.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]');
  const foundryAnchorYInput = foundryInspector.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]');
  await expect(foundryAnchorXInput).toBeVisible();
  await expect(foundryAnchorYInput).toBeVisible();
  const pickedAnchorX = await foundryAnchorXInput.inputValue();
  const pickedAnchorY = await foundryAnchorYInput.inputValue();
  await page.getByTestId('foundry-fit-path').click();
  await expect(page.getByRole('button', { name: /Use this mechanism/i })).toBeEnabled();
  await page.getByRole('button', { name: /Use this mechanism/i }).click();

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
  await expect(designRig).toHaveAttribute('data-three-stack-source', 'fabricationStackForMechanism');
  await expect(designRig).toHaveAttribute('data-three-stack-validation-errors', '0');
  await expect(designRig).toHaveAttribute('data-three-physical-validation-errors', '0');
  await expect(designRig).toHaveAttribute('data-three-preview-renderable', 'ready');
  await expect(designRig).toHaveAttribute('data-three-stack-order', /Input L2 linkage.*Coupler L4 linkage.*Output L[246] linkage/);
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
  await expect(page.getByTestId('design-fit-button')).toBeVisible();
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
  const blueprintPreview = page.getByTestId('blueprint-build-preview');
  await expect(blueprintPreview).toBeVisible();
  await expect(blueprintPreview).toHaveAttribute('data-build-plan-digest', /^fnv1a32:/);
  await expect(blueprintPreview).toHaveAttribute('data-build-geometry-signature', /^fnv1a32:/);
  await expect(blueprintPreview).toContainText('12 x 12 in / 100% physical model');
  await expect(page.getByTestId('blueprint-detail-preview')).toContainText('Build spot');
  await expect(page.getByTestId('blueprint-control-panel').getByRole('heading', { name: 'Build outputs', exact: true })).toBeVisible();
  await expect(page.getByTestId('blueprint-detail-preview')).toContainText(/OK|Fix:/);
  await expect(page.getByTestId('blueprint-sensemaking-label')).toContainText('Crank turns');
  await expect(page.getByTestId('blueprint-sensemaking-label')).toHaveAttribute('data-sensemaking-evidence', 'driver crank turns and rocker swings');
  await expect(page.getByTestId('stage-canvas-pane').getByTestId('assembly-guide-web-preview')).toHaveCount(0);
  await expect(page.getByTestId('stage-right-inspector').getByTestId('assembly-guide-web-preview')).toHaveCount(0);
  await expect(page.getByTestId('blueprint-character-template')).toBeEnabled();
  await page.getByTestId('blueprint-build-print').click();
  await openBlueprintMoreFiles(page);
  await expect(page.getByRole('button', { name: 'Download SVG default' })).toBeVisible();
  await expect(page.getByTestId('custom-parts-export-lane')).toBeVisible();
  await expect(page.getByTestId('prefab-board-export-lane')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assembly guide', exact: true })).toHaveCount(0);
  await expect(page.getByText('Teacher files')).toHaveCount(0);
  await expect(page.getByTestId('prefab-board-export-lane')).toContainText('Mechanism');
  await expect(blueprintPreview).toBeVisible();
  await expect(page.getByTestId('stage-canvas-pane').locator('img[alt="Cut sheet"]')).toHaveCount(0);
  await clickStage(page, 'Assembly');
  await expect(page.locator('h2.current-stage-title', { hasText: 'Assembly' })).toBeVisible();
  await expect(page.getByTestId('workflow-status-strip')).toContainText('Assembly');
  await expect(page.getByTestId('assembly-canvas-preview')).toBeVisible();
  await expect(page.getByTestId('stage-canvas-pane').getByTestId('assembly-readonly-step-strip')).toBeVisible();
  await expect(page.getByTestId('stage-canvas-pane').getByTestId('assembly-guide-web-preview')).toHaveCount(0);
  await expect(page.getByTestId('stage-right-inspector').getByTestId('assembly-guide-web-preview')).toHaveCount(0);
  await expect(page.getByTestId('assembly-mechanism-three-preview')).toBeVisible();
  await expect(page.getByTestId('assembly-mechanism-three-preview')).toHaveAttribute('data-mechanism-scene-contract-stack-source', 'fabricationStackForMechanism');
  await expect(page.getByTestId('assembly-mechanism-three-preview')).toHaveAttribute('data-mechanism-scene-contract-layer-count', /[1-9]/);
  await expect(page.getByTestId('assembly-character-context-ghost')).toHaveCount(0);
  const assemblyRig = page.getByTestId('assembly-mechanism-three-preview').getByTestId('foundry-camera-rig');
  await expect(assemblyRig).toHaveAttribute('data-viewer-tab', 'assembly');
  await expect(assemblyRig).toHaveAttribute('data-viewer-contract-state', /"tab":"assembly"/);
  await expect(assemblyRig).toHaveAttribute('data-three-stack-source', 'fabricationStackForMechanism');
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
  await expect(assemblyWorkbench).toHaveAttribute('data-floating-reference-coords', /G6.*G10/);
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-motion-kind', 'explode_z');
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-floating-reference-coords', /G6.*G10/);
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-rendered-floating-marker-count', '2');
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-rendered-layer-focus', /[0-9]/);
  await expect(assemblyRig).toHaveAttribute('data-three-assembly-board-surface', 'hidden');
  await expect(page.getByTestId('assembly-floating-references')).toContainText('G6');
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
  await expect(page.getByTestId('assembly-stack-summary')).toContainText(/Input 3-hole link.*Coupler 5-hole link.*Output 3-hole link/);
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
  await clickOptionalButton(pauseAssembly, 'Assembly Pause');
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
  await openBlueprintMoreFiles(page);
  await expect(page.getByRole('button', { name: 'Download JSON default' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Guide HTML', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Metadata', exact: true })).toHaveCount(0);
  await expect(page.getByText('Teacher files')).toHaveCount(0);
  await expect(page.getByTestId('blueprint-control-panel').getByRole('button', { name: 'Download Character SVG', exact: true })).toBeVisible();
  await expect(page.getByTestId('custom-parts-export-lane').getByRole('button', { name: 'Character PDF', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download PDF cut sheet default' })).toHaveCount(0);
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
    recipe.targetPartId === 'right_arm_lower' &&
    recipe.targetPathId === 'fabrication-fit-path' &&
    recipe.targetAnchorJointId === 'right_hand' &&
    recipe.targetPartName === 'Right lower arm' &&
    recipe.steps?.some(step => /Stack:|Connect output/.test(step)) &&
    recipe.assemblySteps?.some((step: { instruction?: string }) => /Set ground pivots|L2|L4/.test(step.instruction ?? '')) &&
    Array.isArray(recipe.warnings)
  )).toBe(true);

  const exportedPackage = await readBlueprintPackage(page);
  expect(exportedPackage.assemblyGuideHtml).toContain('assembly guide');
  expect(exportedPackage.assemblyGuideHtml).toContain('Right lower arm');
  expect(exportedPackage.assemblyGuidePdf).toMatch(/^data:application\/pdf;base64,/);
  expect(Buffer.from(exportedPackage.assemblyGuidePdf.split(',')[1], 'base64').subarray(0, 5).toString()).toBe('%PDF-');

  expect(exportedPackage.customPartsStl, 'ordinary package state does not retain the optional STL').toBe('');
  const [stlDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download character STL' }).click()
  ]);
  expect(stlDownload.suggestedFilename()).toMatch(/custom-parts\.stl$/);
  const stlPath = await stlDownload.path();
  expect(stlPath, 'STL download path').toBeTruthy();
  const stlText = await readFile(stlPath!, 'utf8');
  expect(stlText).toContain('solid motionsmith_custom_parts');
  expect(stlText).toContain('facet normal');

  const [svgDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('blueprint-control-panel').getByRole('button', { name: 'Download Character SVG', exact: true }).click()
  ]);
  const svgPath = await svgDownload.path();
  expect(svgPath, 'svg download path').toBeTruthy();
  const svgText = await readFile(svgPath!, 'utf8');
  expect(svgText).toContain('<metadata>');
  expect(svgText).toContain('custom-parts');
  expect(svgText).toContain('fabricablePartOutlinePoints');
  expect(svgText).toContain('Humanoid starter character');
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

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
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
  await expect(characterAssemblyThree).toHaveAttribute('data-three-assembly-board-instance-count', '225');
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

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openCharacterScreen(page);
  await expect(page.getByTestId('character-processing-panel')).toContainText('Tools');
  await expect(page.getByTestId('character-preview-pane')).toBeVisible();

  const packageChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Load character file', exact: true }).click();
  const packageChooser = await packageChooserPromise;
  expect(packageChooser.isMultiple()).toBe(true);
  await packageChooser.setFiles([]);

  await expect(page.getByRole('button', { name: 'Create from image', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: /Open Getting Started/i }).click();
  await expect(page.getByTestId('getting-started-dialog')).toBeVisible();
  await switchGettingStartedToStarters(page);
  await expect(page.getByTestId('getting-started-dialog')).toContainText('Character file');
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

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();

  const foundryRig = page.getByTestId('foundry-camera-rig');
  await expect(foundryRig).toHaveAttribute('data-three-renderer', 'webgl');
  await expect(foundryRig).toHaveAttribute('data-three-engine-stack', 'three-webgl2-imperative');
  await expect(foundryRig).toHaveAttribute('data-physics-kernel', 'rapier3d-compat');
  await expect(foundryRig).toHaveAttribute('data-physics-kernel-runtime', 'idle');
  await expect(foundryRig).toHaveAttribute('data-physics-kernel-version', 'not-loaded');
  await expect(foundryRig).toHaveAttribute('data-physics-kernel-error', 'none');
  await expect(foundryRig).toHaveAttribute('data-physics-update-policy', 'kinematic-authority-rapier-contact-validation');
  await expect(foundryRig).toHaveAttribute('data-high-throughput-scene-policy', 'viser-style-transform-tree-batched-updates-instancing');
  await expect(foundryRig).toHaveAttribute('data-physics-authority', 'motionsmith-kinematics');
  await expect(foundryRig).toHaveAttribute('data-three-static-grid-mode', 'persistent-scene-layer');
  await expect(foundryRig).toHaveAttribute('data-three-fit-bounds', 'phase-invariant-sweep');
  await expect(foundryRig).toHaveAttribute('data-three-animation-commit-ms', '25.0');
  await expect(foundryRig).toHaveAttribute('data-render-performance-preset', 'balanced');
  await expect(foundryRig).toHaveAttribute('data-render-antialias', 'off');
  await expect(foundryRig).toHaveAttribute('data-repeated-geometry-policy', 'pool-and-instance');
  await expect(foundryRig).toHaveAttribute('data-three-pixel-ratio-cap', '0.50');
  await expect(
    foundryRig,
    'capture the retained-scene baseline only after its first deferred topology build',
  ).toHaveAttribute('data-three-dynamic-build-count', /[1-9]\d*/);
  await expect(foundryRig).toHaveAttribute('data-three-renderer-geometry-count', /[1-9]\d*/);

  const dynamicBuildsBefore = Number(await foundryRig.getAttribute('data-three-dynamic-build-count') ?? '0');
  const geometryCacheBefore = Number(await foundryRig.getAttribute('data-three-geometry-cache-size') ?? '0');
  const materialCacheBefore = Number(await foundryRig.getAttribute('data-three-material-cache-size') ?? '0');
  const poolSizeBefore = Number(await foundryRig.getAttribute('data-three-pool-size') ?? '0');
  const rendererGeometryBefore = Number(await foundryRig.getAttribute('data-three-renderer-geometry-count') ?? '0');
  const rendererTextureBefore = Number(await foundryRig.getAttribute('data-three-renderer-texture-count') ?? '0');
  const phaseControl = page.getByLabel('Foundry phase');
  const phaseBefore = Number(await phaseControl.inputValue());
  await page.getByTestId('foundry-toolbar').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('foundry-toolbar-state')).toContainText('playing');
  await expect(page.getByTestId('foundry-toolbar-state')).not.toBeVisible();
  await expect.poll(async () => Number(await phaseControl.inputValue()), {
    message: 'Foundry advances external-clock samples while retaining its Three topology',
  }).not.toBe(phaseBefore);

  const phaseAfter = Number(await phaseControl.inputValue());
  const dynamicBuildsAfter = Number(await foundryRig.getAttribute('data-three-dynamic-build-count') ?? '0');
  const geometryCacheAfter = Number(await foundryRig.getAttribute('data-three-geometry-cache-size') ?? '0');
  const materialCacheAfter = Number(await foundryRig.getAttribute('data-three-material-cache-size') ?? '0');
  const poolSizeAfter = Number(await foundryRig.getAttribute('data-three-pool-size') ?? '0');
  const rendererGeometryAfter = Number(await foundryRig.getAttribute('data-three-renderer-geometry-count') ?? '0');
  const rendererTextureAfter = Number(await foundryRig.getAttribute('data-three-renderer-texture-count') ?? '0');
  const dynamicBuildsDuringPlayback = dynamicBuildsAfter - dynamicBuildsBefore;
  expect(dynamicBuildsDuringPlayback, 'steady playback updates pooled transforms without rebuilding Three topology').toBe(0);
  expect(geometryCacheAfter - geometryCacheBefore, 'steady playback does not grow the shared geometry cache').toBe(0);
  expect(materialCacheAfter - materialCacheBefore, 'steady playback does not grow the shared material cache').toBe(0);
  expect(poolSizeAfter - poolSizeBefore, 'steady playback retains a bounded object-pool high-water mark').toBe(0);
  expect(rendererGeometryAfter - rendererGeometryBefore, 'steady playback does not retain new renderer geometries').toBe(0);
  expect(rendererTextureAfter - rendererTextureBefore, 'steady playback does not retain new renderer textures').toBe(0);
  expect(Math.abs(phaseAfter - phaseBefore), 'Foundry phase advances during optimized playback').toBeGreaterThan(0);

  await page.getByTestId('foundry-toolbar').getByRole('button', { name: 'Pause', exact: true }).click();
  expectCleanPage(pageErrors, consoleErrors);
});

test('Load package review, accept, discard, and missing-file recovery stay in browser', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openCharacterScreen(page);
  const existingPartCount = await page
    .getByTestId('character-three-puppet-state')
    .getAttribute('data-part-count');
  expect(
    existingPartCount,
    'the current character exposes its part count before package review',
  ).not.toBeNull();

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
  await expect(page.getByTestId('character-three-puppet-state')).toHaveAttribute('data-part-count', existingPartCount!);
  await expect(page.getByText('outlines')).toBeHidden();
  await expect(page.getByText('Checks')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('character-import-review')).toHaveCount(0);
  await page.getByTestId('character-processing-panel').locator('summary').click();
  const editRig = page.getByRole('button', { name: 'Edit rig', exact: true });
  await expect(editRig).toBeVisible();
  await expect(editRig).toBeEnabled();
  await editRig.click();
  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await expect(page.getByTestId('stage-right-inspector').getByText('Anchors')).toBeVisible();
  await expectProjectCounts(page, 14, 1, 0);
  await page.getByRole('button', { name: /^Character$/i }).click();

  await page.getByTestId('blank-package-input').setInputFiles(packageFiles);
  await expect(page.getByTestId('character-import-review').getByText('Ready', { exact: true })).toBeVisible();
  page.once('dialog', async dialog => dialog.accept());
  await page.getByRole('button', { name: 'Use it' }).click();
  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toHaveCount(0);
  await expectProjectCounts(page, 1, 1, 0);
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

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);
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
  page.once('dialog', async dialog => dialog.accept());
  await page.getByRole('button', { name: 'Use it' }).click();

  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toHaveCount(0);
  await expectProjectCounts(page, 1, 1, 1);

  expectCleanPage(pageErrors, consoleErrors);
});

test('Options and validation gates update browser blueprint output', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);
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
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await expect(page.getByTestId('path-three-puppet-state')).toHaveAttribute('data-camera-preset', 'front');
  await page.getByRole('button', { name: 'Drawing free path', exact: true }).click();
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByTestId('design-shared-foundry-preview')).toBeVisible();
  await expect(page.getByTestId('design-canvas')).toHaveCount(0);
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').fill('0');
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').press('Enter');
  await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').fill('100');
  await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').press('Enter');
  await clickStage(page, 'Blueprint');
  await applyFourBarFromFoundry(page);
  await clickStage(page, 'Blueprint');
  await expect(page.getByTestId('blueprint-build-print')).toBeEnabled();
  await expect(page.getByTestId('blueprint-control-panel')).toContainText(/Ready\.|Motion \d+%/);
  await page.getByTestId('blueprint-build-print').click();
  await expect(page.getByTestId('blueprint-character-template')).toBeEnabled();
  await openBlueprintMoreFiles(page);
  await expect(page.getByRole('button', { name: 'Download JSON default' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download SVG default' })).toBeVisible();
  await expect(page.getByTestId('blueprint-control-panel').getByRole('button', { name: 'Download Character SVG', exact: true })).toBeVisible();

  const fabricationPackage = await readBlueprintPackage(page);
  expect(fabricationPackage, 'fabrication package stored in project state').toBeTruthy();
  expect(fabricationPackage.svg, 'physical blueprint SVG is included in the package').toContain('data-blueprint-source="fabrication-contract"');
  expect(fabricationPackage.svg).toContain('data-board-callout');
  expect(fabricationPackage.svg).not.toContain('opacity="0.22"');
  expect(fabricationPackage.svg).not.toContain('data-cut-part');

  const metadata = await downloadMetadataJson(page);
  expect(metadata.profile.gridPitchMm).toBe(25);

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').fill('255');
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').press('Enter');
  await clickStage(page, 'Blueprint');
  await expect(page.getByTestId('blueprint-control-panel').getByText(/anchor off grid/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Snap to hole/ })).toBeVisible();
  await expect(page.getByTestId('blueprint-build-print')).toBeDisabled();

  expectCleanPage(pageErrors, consoleErrors);
});

test('Options parity updates the full-width settings workspace and blueprint defaults', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);
  await applyFourBarFromFoundry(page);
  await page.getByRole('button', { name: /Options/i }).click();
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Options preview canvas' })).toHaveCount(0);
  const optionsWorkspace = page.getByTestId('options-settings-workspace');
  const optionsFrame = page.locator('[data-stage="options"]');
  const optionsLeft = optionsFrame.getByTestId('stage-left-pane');
  const optionsCenter = page.getByTestId('stage-canvas-pane');
  const optionsInspector = page.getByTestId('stage-right-inspector');
  await expect(optionsWorkspace).toBeVisible();
  await expect(optionsInspector).toBeHidden();
  const optionsLayout = await optionsWorkspace.evaluate(element => {
    const grid = element.querySelector('.options-settings-grid');
    const center = element.parentElement;
    const frame = center?.parentElement;
    const left = frame?.querySelector<HTMLElement>('[data-testid="stage-left-pane"]');
    const inspector = frame?.querySelector<HTMLElement>('[data-testid="stage-right-inspector"]');
    const frameBox = frame?.getBoundingClientRect();
    const centerBox = center?.getBoundingClientRect();
    const leftBox = left?.getBoundingClientRect();
    const inspectorBox = inspector?.getBoundingClientRect();
    const sections = [...element.querySelectorAll<HTMLElement>('.settings-section')];
    return {
      columnCount: grid ? getComputedStyle(grid).columnCount : '',
      workspaceWidth: element.getBoundingClientRect().width,
      centerWidth: centerBox?.width ?? 0,
      leftWidth: leftBox?.width ?? 0,
      centerRightGap: frameBox && centerBox
        ? Math.abs(frameBox.right - centerBox.right)
        : Number.POSITIVE_INFINITY,
      inspectorDisplay: inspector ? getComputedStyle(inspector).display : '',
      inspectorWidth: inspectorBox?.width ?? 0,
      workspaceOverflowX: getComputedStyle(element).overflowX,
      workspaceOverflowY: getComputedStyle(element).overflowY,
      workspaceClientWidth: element.clientWidth,
      workspaceScrollWidth: element.scrollWidth,
      workspaceClientHeight: element.clientHeight,
      workspaceScrollHeight: element.scrollHeight,
      sectionsFitHorizontally: sections.every(
        section => section.scrollWidth <= section.clientWidth + 1,
      ),
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(optionsLayout.columnCount, '1366px Options settings use three horizontal columns').toBe('3');
  expect(Math.abs(optionsLayout.workspaceWidth - optionsLayout.centerWidth), 'settings surface fills the center workspace').toBeLessThan(2);
  expect(optionsLayout.centerWidth, 'Options center consumes the former center and inspector width').toBeGreaterThan(optionsLayout.leftWidth * 2);
  expect(optionsLayout.centerRightGap, 'Options center reaches the stage frame right edge').toBeLessThan(2);
  expect(optionsLayout.inspectorDisplay, 'Options removes the empty inspector from layout').toBe('none');
  expect(optionsLayout.inspectorWidth, 'hidden Options inspector reserves no phantom width').toBe(0);
  expect(optionsLayout.workspaceOverflowX, 'Options owns no horizontal scrollbar').toBe('hidden');
  expect(optionsLayout.workspaceOverflowY, 'desktop Options workspace owns vertical scrolling').toBe('auto');
  expect(optionsLayout.workspaceScrollWidth, 'Options cards fit their full-width surface').toBeLessThanOrEqual(optionsLayout.workspaceClientWidth + 1);
  expect(optionsLayout.sectionsFitHorizontally, 'each Options section fits its column').toBe(true);
  expect(optionsLayout.documentScrollWidth, 'Options creates no page-level horizontal overflow').toBeLessThanOrEqual(optionsLayout.documentClientWidth + 1);
  expect(optionsLayout.workspaceScrollHeight, 'lower Options sections require the owned scroll surface').toBeGreaterThan(optionsLayout.workspaceClientHeight);
  await expect(optionsCenter.getByTestId('options-settings-workspace')).toBeVisible();
  for (const section of ['appearance', 'simulation', 'performance', 'debugging', 'workflow', 'fabrication', 'units']) {
    await expect(optionsWorkspace.getByTestId(`options-${section}`)).toHaveCount(1);
  }

  await optionsWorkspace.evaluate(element => { element.scrollTop = 0; });
  const optionsScrollBaseline = await page.evaluate(() => ({
    documentY: window.scrollY,
    workflowY: document.querySelector<HTMLElement>('[data-testid="stage-left-pane"]')?.scrollTop ?? 0,
  }));
  await optionsLeft.getByRole('link', { name: 'Units' }).click();
  await expect.poll(() => optionsWorkspace.evaluate(element => element.scrollTop), {
    message: 'Units anchor scrolls the Options-owned settings surface',
  }).toBeGreaterThan(0);
  await expect.poll(() => optionsWorkspace.evaluate(element => {
    const target = element.querySelector<HTMLElement>('[data-testid="options-units"]');
    if (!target) return false;
    const ownerBox = element.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    return targetBox.top >= ownerBox.top - 1 && targetBox.bottom <= ownerBox.bottom + 1;
  }), { message: 'the lower Units section is fully reachable inside Options' }).toBe(true);
  expect(await page.evaluate(() => window.scrollY), 'desktop anchor does not scroll the page').toBe(optionsScrollBaseline.documentY);
  expect(await optionsLeft.evaluate(element => element.scrollTop), 'desktop anchor does not scroll the workflow pane').toBe(optionsScrollBaseline.workflowY);
  await optionsLeft.getByRole('link', { name: 'Appearance' }).click();
  await expect.poll(() => optionsWorkspace.evaluate(element => element.scrollTop), {
    message: 'Appearance anchor returns the Options surface to its top',
  }).toBeLessThan(2);

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

  await expect.poll(async () => {
    const saved = await readBrowserAutosaveProject(page);
    return {
      autosave: saved?.settings?.autosave,
      interval: saved?.settings?.autosaveIntervalSeconds,
      duration: saved?.settings?.animationDurationMs,
      timing: saved?.settings?.timingProfile,
      friction: saved?.settings?.simulationFriction,
      mass: saved?.settings?.simulationMassKg,
      performance: saved?.settings?.performancePreset,
      snap: saved?.settings?.physicsSnapMode,
      detailed: saved?.settings?.detailedProcessingSteps,
      unit: saved?.settings?.gridUnit,
      profile: saved?.settings?.physicalKit?.profileKey,
      pitch: saved?.settings?.physicalKit?.gridPitchMm,
      cutSheet: saved?.settings?.physicalKit?.cutSheetFileType
    };
  }, { timeout: 15000 }).toEqual({
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

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 2,
    mobile: false,
    screenWidth: 1280,
    screenHeight: 720,
  });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));

  await page.getByRole('button', { name: /Path Editor/i }).click();
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByTestId('path-three-puppet-state')).toHaveAttribute('data-layer-grid', 'shown');
  await expect(page.getByTestId('path-three-puppet-state')).toHaveAttribute('data-three-requested-dpr-cap', '1.00');
  await expect(page.getByTestId('path-three-puppet-state')).toHaveAttribute('data-three-effective-dpr', '1.000');
  await expect.poll(
    () => canvasBackingPixelRatio(page.getByTestId('path-three-puppet-canvas')),
    { message: 'adaptive High starts the shared puppet renderer at safe DPR 1' },
  ).toBeCloseTo(1, 1);
  await expect(page.getByTestId('stage-project-card')).toHaveAttribute('aria-label', /25 millimeter grid/);
  await page.getByRole('button', { name: 'Drawing free path', exact: true }).click();
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByTestId('design-shared-foundry-preview')).toBeVisible();
  await expect(page.getByTestId('design-canvas')).toHaveCount(0);
  const highPerformanceRig = page.getByTestId('design-shared-foundry-preview').getByTestId('foundry-camera-rig');
  await expect(highPerformanceRig).toHaveAttribute('data-render-performance-preset', 'high');
  await expect(highPerformanceRig).toHaveAttribute('data-render-antialias', 'off');
  await expect(highPerformanceRig).toHaveAttribute('data-render-overlay-quality', 'balanced');
  await expect(highPerformanceRig).toHaveAttribute('data-three-animation-commit-ms', '25.0');
  await expect(highPerformanceRig).toHaveAttribute('data-three-pixel-ratio-cap', '2.00');
  await expect(highPerformanceRig).toHaveAttribute('data-three-requested-dpr-cap', '1.00');
  await expect(highPerformanceRig).toHaveAttribute('data-three-effective-dpr', '1.000');
  await expect.poll(
    () => canvasBackingPixelRatio(page.getByTestId('design-shared-foundry-preview').getByTestId('foundry-three-canvas')),
    { message: 'adaptive High starts the shared Foundry renderer at safe DPR 1' },
  ).toBeCloseTo(1, 1);
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').fill('0');
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').press('Enter');
  await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').fill('100');
  await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').press('Enter');
  await expect.poll(async () => (await readBrowserAutosaveProject(page))?.mechanisms?.[0]?.anchorX, { timeout: 15000 }).toBe(0);
  await page.getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  await page.getByTestId('foundry-fit-path').click();
  const twelveBoardFoundry = page.getByTestId('foundry-canvas-pane');
  await expect(twelveBoardFoundry).toHaveAttribute('data-fit-board-cells', '12');
  await expect(twelveBoardFoundry).toHaveAttribute('data-fit-anchor-grid', /\S/);
  await expect(twelveBoardFoundry).toHaveAttribute('data-fit-target-path', 'fabrication-fit-path');
  await expect(page.getByRole('button', { name: /Use this mechanism/i })).toBeDisabled();
  await expect(page.getByText('No valid fabrication fit. Try a shorter path or another mechanism.', { exact: true })).toBeVisible();
  await clickStage(page, 'Mechanism Design');
  const rejectedDesignPreview = page.getByTestId('design-shared-foundry-preview');
  await expect(rejectedDesignPreview).toHaveAttribute('data-design-fit-status', 'rejected');
  await page.getByLabel('Workspace scrubber').fill('15');
  await expect(rejectedDesignPreview).toHaveAttribute('data-design-motion-source', 'linkage-trace');
  expect(Number(await rejectedDesignPreview.getAttribute('data-design-animated-part-count'))).toBeGreaterThan(0);
  const rejectedTargetBefore = `${await rejectedDesignPreview.getAttribute('data-design-target-x')},${await rejectedDesignPreview.getAttribute('data-design-target-y')}`;
  await page.getByLabel('Workspace scrubber').fill('35');
  await expect.poll(async () => `${await rejectedDesignPreview.getAttribute('data-design-target-x')},${await rejectedDesignPreview.getAttribute('data-design-target-y')}`, { message: 'fit rejection blocks export without disconnecting the Design target' }).not.toBe(rejectedTargetBefore);
  await clickStage(page, 'Blueprint');
  await expect(page.getByTestId('blueprint-control-panel')).toContainText('No fabrication-valid path fit.');
  await expect(page.getByTestId('blueprint-build-print')).toBeDisabled();
  await page.getByRole('button', { name: /^Character$/i }).click();
  await expect(page.getByTestId('processing-step-details')).toContainText('Fit sheet');

  expectCleanPage(pageErrors, consoleErrors);
});

test('Autosave keeps cold boot idle and bounds 1/3/5MB writes at 6x CPU', async ({ page, context }, testInfo) => {
  page.on('dialog', async dialog => dialog.accept());
  await installChromebookAuditInstrumentation(context);
  await context.addInitScript(() => {
    type AutosaveWrite = {
      key: string;
      characters: number;
      durationMs: number;
      failed: boolean;
    };
    const target = window as Window & {
      __MOTIONSMITH_AUTOSAVE_WRITES__?: AutosaveWrite[];
    };
    target.__MOTIONSMITH_AUTOSAVE_WRITES__ = [];
    const nativePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const startedAt = performance.now();
      let failed = true;
      try {
        const result = Reflect.apply(
          nativePut,
          this,
          key === undefined ? [value] : [value, key],
        );
        failed = false;
        return result;
      } finally {
        if (
          this.name === 'autosave-journal' &&
          typeof key === 'string' &&
          key.startsWith('snapshot:') &&
          typeof value === 'string'
        ) {
          target.__MOTIONSMITH_AUTOSAVE_WRITES__?.push({
            key,
            characters: value.length,
            durationMs: performance.now() - startedAt,
            failed,
          });
        }
      }
    } as typeof IDBObjectStore.prototype.put;
  });
  const workerRequests: string[] = [];
  page.on('request', request => {
    if (/autosaveWorker-[^/]+\.js/.test(request.url())) workerRequests.push(request.url());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await waitForBootLoader(page);
  await page.waitForTimeout(750);
  expect(workerRequests, 'cold boot requests no autosave worker').toEqual([]);
  const client = await applyChromebookEmulation(page);
  const baseline = await readFeatureRuntimeProbe(page);
  expect(baseline.lifecycle.workers.active).toBe(0);

  const results: Array<{
    megabytes: number;
    outcome: 'saved' | 'quota';
    maxAutosaveWriteMs: number;
    totalStoredCharacters: number;
    retainedGenerations: 0 | 1 | 2;
  }> = [];
  let autosaveAttempts = 0;
  const waitForAutosaveOutcome = async (generation: number) => {
    await expect.poll(async () => {
      const committedGeneration =
        (await readBrowserAutosaveProbe(page)).metadata?.currentGeneration ?? 0;
      if (committedGeneration === generation) return 'saved';
      return (await page.getByTestId('status-bar').textContent())
        ?.includes('Autosave failed: Storage full')
        ? 'quota'
        : 'pending';
    }, { timeout: 30_000 }).toMatch(/saved|quota/);
    return (await readBrowserAutosaveProbe(page)).metadata?.currentGeneration === generation
      ? 'saved' as const
      : 'quota' as const;
  };
  const readAutosaveMeasurement = async () => {
    const writes = await page.evaluate(() => {
    type AutosaveWrite = {
      key: string;
      characters: number;
      durationMs: number;
      failed: boolean;
    };
    return (window as Window & {
      __MOTIONSMITH_AUTOSAVE_WRITES__?: AutosaveWrite[];
    }).__MOTIONSMITH_AUTOSAVE_WRITES__ ?? [];
    });
    const probe = await readBrowserAutosaveProbe(page);
    return {
      maxAutosaveWriteMs: Math.max(0, ...writes.map(item => item.durationMs)),
      attemptedCurrentWrites: writes.length,
      failedCurrentWrites: writes.filter(item => item.failed).length,
      totalStoredCharacters:
        (probe.currentRaw?.length ?? 0) +
        (probe.previousRaw?.length ?? 0) +
        JSON.stringify(probe.metadata ?? {}).length,
      retainedGenerations: (
        !probe.metadata ? 0 : probe.metadata.previousGeneration == null ? 1 : 2
      ) as 0 | 1 | 2,
    };
  };
  for (const megabytes of [1, 3, 5]) {
    await clearBrowserAutosave(page);
    await page.evaluate(() => {
      localStorage.clear();
      const target = window as Window & {
        __MOTIONSMITH_AUTOSAVE_WRITES__?: unknown[];
      };
      target.__MOTIONSMITH_AUTOSAVE_WRITES__ = [];
    });
    const firstInput = await page.getByTestId('getting-started-dialog').count()
      ? page.getByTestId('project-file-input')
      : page.getByTestId('project-file-input');
    if (await page.getByTestId('guided-project-library').count()) {
      await switchGettingStartedToStarters(page);
    }
    await firstInput.setInputFiles(largeAutosaveProjectFile(megabytes, 'a'));
    await expect(page.getByTestId('status-bar')).toContainText(
      `Loaded project autosave-${megabytes}mb-a.motionsmith.json`,
    );
    autosaveAttempts += 1;
    const firstOutcome = await waitForAutosaveOutcome(1);
    await waitForLifecycleBaseline(page, baseline.lifecycle);

    if (firstOutcome === 'quota') {
      const measured = await readAutosaveMeasurement();
      expect(measured.attemptedCurrentWrites, `${megabytes}MB reports its browser quota limit`).toBeGreaterThan(0);
      expect(measured.maxAutosaveWriteMs, `${megabytes}MB rejected write at 6x CPU`).toBeLessThan(100);
      results.push({ megabytes, outcome: 'quota', ...measured });
      continue;
    }

    await page.evaluate(() => {
      const target = window as Window & {
        __MOTIONSMITH_AUTOSAVE_WRITES__?: unknown[];
      };
      target.__MOTIONSMITH_AUTOSAVE_WRITES__ = [];
    });
    const second = largeAutosaveProjectFile(megabytes, 'b');
    await page.getByTestId('project-file-input').setInputFiles(second);
    await expect(page.getByTestId('status-bar')).toContainText(
      `Loaded project autosave-${megabytes}mb-b.motionsmith.json`,
    );
    autosaveAttempts += 1;
    const secondOutcome = await waitForAutosaveOutcome(2);
    await waitForLifecycleBaseline(page, baseline.lifecycle);
    expect(secondOutcome, `${megabytes}MB newest generation survives optional-history quota pressure`).toBe('saved');
    const measured = await readAutosaveMeasurement();
    expect(measured.attemptedCurrentWrites, `${megabytes}MB current generation commits`).toBeGreaterThan(0);
    expect(measured.maxAutosaveWriteMs, `${megabytes}MB IndexedDB put at 6x CPU`).toBeLessThan(100);
    results.push({ megabytes, outcome: 'saved', ...measured });
  }

  expect(results.find(result => result.megabytes === 1)?.outcome).toBe('saved');

  const after = await readFeatureRuntimeProbe(page);
  const acquiredDelta = after.lifecycle.workers.acquired - baseline.lifecycle.workers.acquired;
  const releasedDelta = after.lifecycle.workers.released - baseline.lifecycle.workers.released;
  expect(workerRequests.length, 'autosave worker request count covers autosave attempts').toBeGreaterThanOrEqual(autosaveAttempts);
  expect(acquiredDelta, 'global worker acquisitions include every autosave attempt').toBeGreaterThanOrEqual(autosaveAttempts);
  expect(releasedDelta, 'all acquired workers are released').toBe(acquiredDelta);
  expect(after.lifecycle.workers.active).toBe(baseline.lifecycle.workers.active);

  await page.getByRole('button', { name: /Options/i }).click();
  await page.getByLabel('Theme').selectOption('dark');
  const pagehideMs = await page.evaluate(() => {
    const startedAt = performance.now();
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    return performance.now() - startedAt;
  });
  expect(pagehideMs, 'pagehide only flushes prepared bytes or a small dirty marker').toBeLessThan(50);
  const autosaveReport = testInfo.outputPath('autosave-6x-results.json');
  await writeFile(
    autosaveReport,
    `${JSON.stringify({ results, pagehideMs }, null, 2)}\n`,
    'utf8',
  );
  await testInfo.attach('autosave-6x-results.json', {
    path: autosaveReport,
    contentType: 'application/json',
  });
  await client.detach();
});

test('Autosave quota failure is visible in the status dock', async ({ page, context }) => {
  await context.addInitScript(() => {
    const nativePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (
        this.name === 'autosave-journal' &&
        typeof key === 'string' &&
        key.startsWith('snapshot:')
      ) {
        throw new DOMException('storage full', 'QuotaExceededError');
      }
      return Reflect.apply(
        nativePut,
        this,
        key === undefined ? [value] : [value, key],
      );
    } as typeof IDBObjectStore.prototype.put;
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (/autosave/i.test(key)) {
        throw new DOMException('storage full', 'QuotaExceededError');
      }
      return Reflect.apply(nativeSetItem, this, [key, value]);
    };
  });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openCharacterScreen(page);
  await expect(page.getByTestId('status-bar')).toContainText(
    'Autosave failed: Storage full',
    { timeout: 15_000 },
  );
});

test('Legacy storage namespace migrates to MotionSmith keys without losing autosave or workspace layout', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openCharacterScreen(page);
  const currentPartCount = Number(
    await page
      .getByTestId('character-three-puppet-state')
      .getAttribute('data-part-count')
      ?? '0',
  );
  await page.getByRole('button', { name: /Options/i }).click();
  const autosaveToggle = page.getByLabel('Enable autosave');
  if (!(await autosaveToggle.isChecked())) await autosaveToggle.check();
  await expect.poll(async () =>
    (await readBrowserAutosaveProject(page))?.partOrder?.length ?? 0
  ).toBe(currentPartCount);
  await moveBrowserAutosaveToLegacyStorage(page);
  await page.evaluate(() => {
    localStorage.removeItem('motionsmith.workspace');
    const legacyPrefix = ['mech', 'anim'].join('');
    localStorage.setItem(`${legacyPrefix}.workspace`, JSON.stringify({
      stage: 'character',
      viewport: { offset: { x: 24, y: -12 }, zoom: 1.25 },
      toolbarVisible: false,
      partPanelVisible: false
    }));
  });

  await page.getByTestId('command-menu-file').click();
  await recoverBrowserBackup(page, () => page.getByRole('button', { name: 'Recover' }).click());
  await expect(page.getByTestId('status-bar')).toContainText('Recovered browser backup');
  await expect.poll(async () => Boolean((await readBrowserAutosaveProbe(page)).metadata), { timeout: 5000 }).toBe(true);

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

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');

  await page.getByLabel('Motion target').selectOption('head');
  await expect(page.getByLabel('Motion target')).toHaveValue('head');
  await expect(page.getByTestId('free-draw-status')).toContainText('No path yet');
  await expect(page.getByText('Draw a path.')).toBeVisible();

  await page.getByTestId('path-view-3d').click();
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByTestId('path-view-2d')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('path-three-puppet-canvas')).toHaveCount(1);
  const pathCanvas = page.getByTestId('path-three-puppet-canvas');
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
  const pathState = page.getByTestId('path-three-puppet-state');
  await expect(pathState).toHaveAttribute('data-three-selected-path-id', /path-/);
  await expect(pathState).toHaveAttribute('data-three-selected-path-closed', 'true');
  await expect(page.getByTestId('novice-path-panel').getByRole('button', { name: 'Choose mechanism' })).toHaveCount(0);

  await page.getByLabel('Motion target').selectOption('right_hand_part');
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
  await expect(page.getByText('No path.')).toHaveCount(0);
  await expect(page.getByTestId('quick-rig-helper')).toContainText('Move part');
  await expect(page.getByTestId('ik-chain-summary')).toHaveAttribute('data-chain-root', 'right_shoulder');
  await expect(page.getByTestId('ik-chain-summary')).toHaveAttribute('data-chain-handle', 'right_hand');
  await openMotionJointOptions(page);
  await expect(page.getByLabel('Motion start')).toHaveValue('right_shoulder');
  await expect(page.getByLabel('Motion handle')).toHaveValue('right_hand');
  await expect(page.getByTestId('ik-chain-summary')).toContainText('Motion ready');
  await page.getByRole('button', { name: 'Fold left', exact: true }).click();
  await expect(page.getByTestId('fold-direction-control')).toContainText('left');
  await page.getByTestId('ik-chain-root-options').getByRole('button', { name: 'right elbow' }).click();
  await expect(page.getByLabel('Motion start')).toHaveValue('right_elbow');
  await expect(page.getByLabel('Motion handle')).toHaveValue('right_hand');
  await expect(page.getByLabel('Motion start')).toHaveValue('right_elbow');
  await expect(page.getByTestId('ik-chain-summary')).toContainText('Motion ready');
  await expect(page.getByTestId('ik-chain-summary')).toHaveAttribute('data-chain-kind', 'two-joint-direct');
  await expect(page.getByTestId('fold-direction-control')).toHaveCount(0);
  await expect(page.getByTestId('path-shape-controls')).toBeVisible();
  await page.getByRole('button', { name: 'Closed', exact: true }).click();
  await expect(pathState).toHaveAttribute('data-three-selected-path-closed', 'true');
  await page.getByLabel('Smoothness number').fill('70');
  await page.getByLabel('Smoothness number').press('Enter');
  await expect(pathState).toHaveAttribute('data-three-selected-path-smoothness', '70');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(pathState).toHaveAttribute('data-three-selected-path-closed', 'false');

  await expect(pathState).toHaveAttribute('data-three-selected-path-point-count', /[3-9]/);
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');

  await page.getByTestId('novice-path-panel').getByText('More', { exact: true }).click();
  const stopButtonBeforePreview = page.getByTestId('novice-path-panel').getByRole('button', { name: 'Pause all paths', exact: true });
  await clickOptionalButton(stopButtonBeforePreview, 'Path Stop');
  await openMotionJointOptions(page);
  await page.getByLabel('Motion handle').selectOption('right_hand');
  await page.getByTestId('ik-chain-root-options').getByRole('button', { name: 'right shoulder' }).click();
  await expect(page.getByLabel('Motion start')).toHaveValue('right_shoulder');
  await expect(page.getByLabel('Motion handle')).toHaveValue('right_hand');
  await expect(page.getByTestId('ik-chain-summary')).toContainText('Motion ready');
  await page.getByTestId('novice-path-panel').getByRole('button', { name: /Play/i }).click();
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await expect(pathState).toHaveAttribute('data-three-part-count', /[1-9]/);
  await page.getByTestId('novice-path-panel').getByRole('button', { name: 'Pause all paths', exact: true }).click();
  await openMotionJointOptions(page);
  await page.getByTestId('ik-chain-root-options').getByRole('button', { name: 'right elbow' }).click();
  await expect(page.getByLabel('Motion start')).toHaveValue('right_elbow');
  await expect(page.getByLabel('Motion handle')).toHaveValue('right_hand');
  await clickStage(page, 'Character');
  await page.getByTestId('character-part-item-right_hand_part').click();
  await expect(page.getByTestId('character-rig-actions')).toBeVisible();
  await expect(page.getByLabel('Art offset X number')).toBeHidden();
  await page.getByTestId('part-art-controls').locator('summary').click();
  await page.getByLabel('Art offset X number').fill('-12');
  await page.getByLabel('Art offset X number').press('Enter');
  const partLocked = page.locator('label').filter({ hasText: 'Locked' }).first().locator('input[type="checkbox"]');
  await page.getByTestId('stage-right-inspector').getByText('Edit skeleton', { exact: true }).click();
  await page.getByLabel('Part pivot').selectOption('right_elbow');
  await expect(page.getByLabel('Part pivot')).toHaveValue('right_elbow');
  await partLocked.check();
  await page.getByRole('button', { name: /Path Editor/i }).click();
  await page.getByTestId('path-view-2d').click();
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await expect(page.getByTestId('path-three-puppet-state')).toHaveAttribute('data-camera-preset', 'front');
  await expect(page.getByTestId('path-part-art-right_arm_lower')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Draw free path', exact: true })).toBeDisabled();
  await page.getByTestId('novice-path-panel').getByText('More', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Trace', exact: true })).toBeDisabled();
  await expect(page.getByTestId('novice-path-panel').getByRole('button', { name: 'Clear', exact: true })).toBeDisabled();
  await expect(page.getByText('Unlock target.')).toBeVisible();
  await expect(page.getByLabel('X number').first()).toHaveCount(0);
  await page.getByTestId('path-three-puppet-canvas').click({ position: { x: 260, y: 220 } });
  await expect(page.getByTestId('free-draw-status')).toContainText(/Path ready.*locked/);

  await clickStage(page, 'Character');
  await partLocked.uncheck();
  await page.getByRole('button', { name: /Path Editor/i }).click();
  await page.getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByTestId('foundry-target-summary')).toHaveCount(0);
  await expect(page.getByTestId('stage-left-pane')).not.toContainText(/chain|Board hole|Target .*pts/i);

  expectCleanPage(pageErrors, consoleErrors);
});

test('Mechanism target ownership stays on the arm when a foot path is added', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);

  const readOwnership = async () => {
    const snapshot = (await readBrowserAutosaveProject(page) ?? {}) as {
      mechanisms?: Array<{
        id: string;
        targetPartId?: string;
        targetPathId?: string;
        targetAnchorJointId?: string;
      }>;
      paths?: Record<string, {
        id: string;
        partId?: string;
        targetAnchorJointId?: string;
      }>;
    };
    return {
      mechanisms: (snapshot.mechanisms ?? []).map((mechanism: {
        id: string;
        targetPartId?: string;
        targetPathId?: string;
        targetAnchorJointId?: string;
      }) => ({
        id: mechanism.id,
        targetPartId: mechanism.targetPartId,
        targetPathId: mechanism.targetPathId,
        targetAnchorJointId: mechanism.targetAnchorJointId,
      })),
      paths: Object.values(snapshot.paths ?? {}).map((path: {
        id: string;
        partId?: string;
        targetAnchorJointId?: string;
      }) => ({
        id: path.id,
        partId: path.partId,
        targetAnchorJointId: path.targetAnchorJointId,
      })),
    };
  };

  // The fixture is a sample humanoid with an arm-owned path whose four-bar
  // fit is deterministic, so this exercises the same Fit → Use handoff.
  await openFabricationReadyFourBar(page);
  await page.getByLabel('Motion target').selectOption('right_arm_lower');
  await expect(page.getByLabel('Motion target')).toHaveValue('right_arm_lower');
  await applyFourBarFromFoundry(page);
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();

  await expect.poll(async () => {
    const ownership = await readOwnership();
    return ownership.mechanisms.find(mechanism => mechanism.targetPathId === 'fabrication-fit-path');
  }, { message: 'the fitted mechanism remains bound to the arm path' }).toMatchObject({
    targetPartId: 'right_arm_lower',
    targetPathId: 'fabrication-fit-path',
    targetAnchorJointId: 'right_hand',
  });

  await clickStage(page, 'Foundry');
  const foundryToolbar = page.getByTestId('foundry-toolbar');
  await foundryToolbar.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('foundry-toolbar-state')).toContainText('playing');
  await foundryToolbar.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByTestId('foundry-toolbar-state')).toContainText('paused');

  await clickStage(page, 'Path');
  await page.getByLabel('Motion target').selectOption('right_foot_part');
  await expect(page.getByLabel('Motion target')).toHaveValue('right_foot_part');
  await expect(page.getByTestId('free-draw-status')).toContainText('No path yet');
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByTestId('path-view-2d')).toHaveAttribute('aria-pressed', 'true');
  const pathCanvas = page.getByTestId('path-three-puppet-canvas');
  const canvasBox = await pathCanvas.boundingBox();
  expect(canvasBox, 'foot path canvas receives a second target stroke').toBeTruthy();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.42, canvasBox!.y + canvasBox!.height * 0.56);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.5, canvasBox!.y + canvasBox!.height * 0.6, { steps: 3 });
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.58, canvasBox!.y + canvasBox!.height * 0.54, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
  await expect(page.getByTestId('ik-chain-summary')).toHaveAttribute('data-chain-root', 'right_hip');
  await expect(page.getByTestId('ik-chain-summary')).toHaveAttribute('data-chain-handle', 'right_foot');
  await openMotionJointOptions(page);
  await page.getByLabel('Motion handle').selectOption('right_foot');
  await expect(page.getByLabel('Motion handle')).toHaveValue('right_foot');

  await expect.poll(async () => {
    const ownership = await readOwnership();
    return {
      armMechanism: ownership.mechanisms.find(mechanism => mechanism.targetPathId === 'fabrication-fit-path'),
      footPath: ownership.paths.find(path => path.partId === 'right_foot_part'),
    };
  }, { message: 'adding a foot path does not overwrite arm mechanism ownership' }).toMatchObject({
    armMechanism: {
      targetPartId: 'right_arm_lower',
      targetPathId: 'fabrication-fit-path',
      targetAnchorJointId: 'right_hand',
    },
    footPath: {
      partId: 'right_foot_part',
      targetAnchorJointId: 'right_foot',
    },
  });

  await clickStage(page, 'Foundry');
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  await clickStage(page, 'Design');
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('design-shared-foundry-preview')).toHaveAttribute('data-design-target-joint-id', 'right_hand');

  const finalOwnership = await readOwnership();
  const armMechanism = finalOwnership.mechanisms.find(mechanism => mechanism.targetPathId === 'fabrication-fit-path');
  const footPath = finalOwnership.paths.find(path => path.partId === 'right_foot_part');
  expect(armMechanism).toMatchObject({
    targetPartId: 'right_arm_lower',
    targetPathId: 'fabrication-fit-path',
    targetAnchorJointId: 'right_hand',
  });
  expect(footPath?.id).not.toBe(armMechanism?.targetPathId);
});

test('Foundry sensemaking shows library, partial range, and exported metadata', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);
  await page.getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  await expect(page.getByTestId('stage-right-inspector').getByTestId('foundry-visible-sensemaking')).toContainText('Crank turns');
  await expect(page.getByTestId('foundry-mechanism-gallery')).not.toContainText('Crank turns -> rocker swings');
  await expect(page.locator('[data-testid^="foundry-mini-simulation-"]')).toHaveCount(3);
  await expect(page.locator('[data-testid^="foundry-mini-linkage-"]')).toHaveCount(3);
  await expect(page.locator('[data-testid^="foundry-mini-ghost-"]')).toHaveCount(6);
  await expect(page.getByTestId('foundry-mini-simulation-cam')).toHaveCount(0);
  await expect(page.getByTestId('foundry-mini-simulation-planetary_gear')).toHaveCount(0);
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
  expect(pinSpans.D, 'Ground pivot D carries only its own output link and local board-side spacer, so it must not protrude through the C shared-link stack').toBeLessThan(pinSpans.C);
  await expect(threeScene, '4bar pins include the shared board-side S10 spacer plane so rendered washers are not floating off their fasteners').toHaveAttribute('data-three-pin-stack-z-sources', 'fourbar-board-pivots-include-board-side-spacer');
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
  await expect(page.getByTestId('foundry-velocity-overlay'), 'Velocity vectors stay off until requested').toHaveCount(0);
  await expect(page.getByTestId('foundry-forces-overlay'), 'Force vectors stay off until requested').toHaveCount(0);
  await page.getByTestId('foundry-toggle-velocity').click();
  await page.getByTestId('foundry-toggle-forces').click();
  await expect(page.getByTestId('foundry-velocity-overlay')).toBeVisible();
  await expect(page.getByTestId('foundry-forces-overlay')).toBeVisible();
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
  await expect(page.getByLabel('Foundry mechanism type').locator('option')).toHaveCount(3);
  expect(await page.getByLabel('Foundry mechanism type').locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual([...ENABLED_MECHANISM_TYPES]);
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
  await page.getByLabel('Output gear size').selectOption('g56');
  await page.getByLabel('Paired link length').selectOption('6');
  await expect(threeScene, 'Gear linkage param editor keeps output gear and linkage in the fabrication stack').toHaveAttribute('data-three-stack-order', /Drive G5 \/ 5-space gear.*Output G7 \/ 7-space gear.*Drive L6 linkage.*Output L6 linkage/);
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
    cam: [['data-three-cam-count', 1], ['data-three-follower-count', 1], ['data-three-hole-count', 11]],
    gear: [['data-three-gear-count', 2], ['data-three-hole-count', 10]],
    gear_linkage: [['data-three-gear-count', 2], ['data-three-hole-count', 20]],
    planetary_gear: [['data-three-gear-count', 3], ['data-three-hole-count', 13]]
  };

  for (const type of [...ENABLED_MECHANISM_TYPES] as string[]) {
    await page.getByLabel('Foundry mechanism type').selectOption(type);
    await expect(threeScene, `${type} has its own physical 3D preview template`).toHaveAttribute('data-mechanism-type', type);
    await expect(threeScene, `${type} uses the fabrication stack as the 3D render source`).toHaveAttribute('data-three-stack-source', 'fabricationStackForMechanism');
    await expect(threeScene, `${type} stack has no validation errors`).toHaveAttribute('data-three-stack-validation-errors', '0');
    await expect(threeScene, `${type} physical readiness gate is clean`).toHaveAttribute('data-three-physical-validation-errors', '0');
    await expect(threeScene, `${type} preview is renderable only after shared physical validation passes`).toHaveAttribute('data-three-preview-renderable', 'ready');
    const stackRoles = await threeScene.getAttribute('data-three-stack-roles');
    if (type === 'cam') {
      expect(stackRoles, 'cam stack uses the pegboard gravity module order instead of fake clip endpoints').toMatch(/^linkage>spacer>spacer>spacer>cam>spacer>clip>guide>follower$/);
    } else {
      expect(stackRoles, `${type} stack starts with a back clip and ends with a front clip`).toMatch(/^clip>.*>clip$/);
    }
    expect(stackRoles, `${type} stack has at least one spacer separating moving layers`).toContain('spacer');
    expect(await threeScene.getAttribute('data-three-rendered-layer-labels'), `${type} rendered labels match fabrication stack labels`).toBe(await threeScene.getAttribute('data-three-stack-order'));
    expect(await threeScene.getAttribute('data-three-rendered-layer-roles'), `${type} rendered roles match fabrication stack roles`).toBe(await threeScene.getAttribute('data-three-stack-roles'));
    expect(await threeScene.getAttribute('data-three-rendered-layer-colors'), `${type} rendered colors match fabrication stack colors`).toBe(await threeScene.getAttribute('data-three-stack-colors'));
    const renderedLayerZ = await threeScene.getAttribute('data-three-rendered-layer-z') ?? '';
    const stackLayerZ = await threeScene.getAttribute('data-three-stack-z') ?? '';
    if (type === 'gear' || type === 'gear_linkage') {
      await expect(threeScene, `${type} keeps gear plates coplanar instead of separating them by the linear stack list`).toHaveAttribute('data-three-gear-plane-mode', 'coplanar-fixed-axles');
      expect(renderedLayerZ, `${type} gear render z intentionally differs from the printable stack z because each axle has a local spacer stack`).not.toBe(stackLayerZ);
      const roles = (await threeScene.getAttribute('data-three-rendered-layer-roles') ?? '').split('>');
      const zValues = renderedLayerZ.split(',').map(Number);
      const gearZValues = roles.flatMap((role, index) => role === 'gear' ? [zValues[index]] : []);
      expect(new Set(gearZValues.map(z => z.toFixed(2))).size, `${type} all external gear plates share one pitch plane`).toBe(1);
    } else if (type === 'planetary_gear') {
      await expect(threeScene, 'Planetary keeps the ring, sun, and planet teeth on one mesh plane').toHaveAttribute('data-three-gear-plane-mode', 'planetary-coplanar-ring-sun-planet');
      await expect(threeScene, 'Planetary carrier pins include real local S10 spacers').toHaveAttribute('data-three-pin-stack-z-sources', 'planetary-carrier-pins-include-local-spacers');
      expect(renderedLayerZ, 'Planetary render z differs from the printable stack because the ring/sun/planet mesh coplanarly while the carrier rides one spacer plane above').not.toBe(stackLayerZ);
      const roles = (await threeScene.getAttribute('data-three-rendered-layer-roles') ?? '').split('>');
      const zValues = renderedLayerZ.split(',').map(Number);
      const gearZValues = roles.flatMap((role, index) => role === 'gear' ? [zValues[index]] : []);
      expect(new Set(gearZValues.map(z => z.toFixed(2))).size, 'Planetary ring, sun, and planet share one pitch plane').toBe(1);
    } else if (type === '4bar') {
      expect(renderedLayerZ, '4bar uses the fabrication z stack so A/D ground pivots cannot be side-view-collapsed into an impossible overlap').toBe(stackLayerZ);
    } else {
      expect(renderedLayerZ, `${type} rendered z order matches fabrication stack z order`).toBe(stackLayerZ);
    }
    if (type === '4bar') {
      await expect(threeScene, '4bar foundry geometry keeps A-B/B-C/C-D topology from mechanism-reference instead of drawing a floating output rod').toHaveAttribute('data-three-geometry-contract', /Input L2 linkage:A-B.*Coupler L4 linkage:B-C.*Output L2 linkage:C-D/);
      await expect(threeScene, '4bar keeps only physical A/B/C/D pin hardware in the 3D scene').toHaveAttribute('data-three-physical-pin-contract', 'reference-A-B-C-D-only');
      await expect(threeScene).toHaveAttribute('data-three-physical-pin-count', '4');
      await expect(threeScene, '4bar renders recipe spacer sites at A/B/C/D without z-layer collisions').toHaveAttribute('data-three-spacer-render-count', '4');
      await expect(threeScene, '4bar ground pivots keep one board-side spacer and a visible fastener head instead of an outboard/top spacer').toHaveAttribute('data-three-board-pivot-fastener-contract', 'fastener-end>S10-board-side>linkage>fastener-head');
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
      expect(boardSpacerZ.A, "A board-side spacer sits below A\'s own input-link plane").toBeLessThan(layerZ[pinLayerIndexes.A]);
      expect(boardSpacerZ.D, "D board-side spacer sits below D\'s own output-link plane, not a reused global layer").toBeLessThan(layerZ[pinLayerIndexes.D]);
      await expect(threeScene, '4bar pins use per-pivot stack spans so A/D do not protrude through empty z-layers').toHaveAttribute('data-three-pin-stack-policy', 'per-pin-adjacent-stack');
      await expect(threeScene, '4bar ground A-D is a board reference span, not a fabricated moving linkage').toHaveAttribute('data-three-ground-span-mode', 'board-reference');
    }
    await expect(threeScene, `${type} preview keeps stack z-collisions at zero`).toHaveAttribute('data-three-z-collision-count', '0');
    if (type === 'cam') {
      await expect(threeScene, 'Cam follower guide stays board-fixed while the follower moves').toHaveAttribute('data-three-cam-guide-mode', 'fixed-board-guide');
      await expect(threeScene, 'Cam follower contact is sampled from the same rotating cam profile shown in 3D').toHaveAttribute('data-three-cam-contact-mode', 'sampled-profile-on-guide-axis');
      await expect(threeScene, 'Cam preview uses only the real cam axle and follower-center fastener points').toHaveAttribute('data-three-cam-pin-contract', 'cam-axle-and-follower-center-only');
      await expect(threeScene).toHaveAttribute('data-three-physical-pin-contract', 'cam-axle-and-follower-center-only');
      await expect(threeScene).toHaveAttribute('data-three-physical-pin-count', '2');
      expect(Number(await threeScene.getAttribute('data-three-cam-contact-error')), 'Cam surface, follower roller, and guide axis stay physically mated').toBeLessThan(0.75);
    }
    const foundrySpacerGap = Number(await threeScene.getAttribute('data-three-spacer-z-gap'));
    if (type === 'cam') {
      expect(foundrySpacerGap, 'Cam foundry preview keeps the guide/follower compact against the board-mounted cam plane').toBeLessThan(FABRICATION_RENDER_LAYER_Z_STEP);
    } else {
      expect(foundrySpacerGap, `${type} foundry preview has spacer clearance along z`).toBeGreaterThanOrEqual(FABRICATION_RENDER_LAYER_Z_STEP - 0.01);
    }
    await expect(page.getByTestId('foundry-forces-overlay'), `${type} keeps live force vectors visible`).toHaveAttribute('data-force-magnitude', /\d+\.\d+/);
    await expect(page.getByTestId('foundry-velocity-overlay'), `${type} keeps live velocity vectors visible`).toHaveAttribute('data-speed', /[0-9]+\.[0-9]+/);
    for (const [attr, minimumCount] of foundryPhysicalMarkers[type]) {
      expect(Number(await threeScene.getAttribute(attr)), `${type} preview includes ${attr}`).toBeGreaterThanOrEqual(minimumCount);
    }
    if (type === 'planetary_gear') {
      await expect(threeScene, 'Planetary geometry maps R56/G1/L2/G3 recipe labels to ring/sun/carrier/planet roles').toHaveAttribute('data-three-geometry-contract', /R56 internal ring gear:fixed-ring.*G1 \/ 1-space gear:sun-input.*L2 carrier linkage:sun-planet-carrier.*G3 \/ 3-space gear:planet-on-carrier/);
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
      await clickOptionalButton(playButton, 'Foundry Play');
      await expect(page.getByTestId('foundry-toolbar-state'), 'Planetary preview stays in the running animation loop').toContainText('playing');
      await expect.poll(async () => Number(await phaseControl.inputValue()), { message: 'Planetary carrier animation keeps advancing instead of stopping mid-turn' }).not.toBe(phaseBefore);
      const pauseButton = page.getByTestId('foundry-toolbar').getByRole('button', { name: 'Pause', exact: true });
      await clickOptionalButton(pauseButton, 'Foundry Pause');
    }
  }
  await page.getByLabel('Foundry mechanism type').selectOption('gear');
  await page.getByRole('button', { name: 'Hint' }).click();
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('Gear train');
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('mesh');
  await page.getByRole('button', { name: 'Hide hint' }).click();
  expect(Number(await threeScene.getAttribute('data-three-gear-count')), 'Gear preview uses toothed 3D fabrication geometry').toBeGreaterThanOrEqual(2);
  await expect(threeScene, 'Gear train renders endpoint gears only, without fake linkage rods').toHaveAttribute('data-three-gear-train-linkage-mode', 'gear-only-train');
  await expect(threeScene, 'Gear train hardware is limited to fixed board gear axles').toHaveAttribute('data-three-physical-pin-contract', 'fixed-gear-axles-only');
  await expect(threeScene, 'Gear train geometry contract exposes board-fixed gears only').toHaveAttribute('data-three-geometry-contract', /Drive G3 \/ 3-space gear:fixed-board-gear.*Output G3 \/ 3-space gear:fixed-board-gear/);
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
  await expect(threeScene, 'Gear-linkage uses two gear handles and paired L4 rods').toHaveAttribute('data-three-gear-train-linkage-mode', 'two-gear-two-link-coupler');
  await expect(threeScene, 'Gear-linkage keeps the drive/output gear plates coplanar on board axles').toHaveAttribute('data-three-gear-plane-mode', 'coplanar-fixed-axles');
  await expect(threeScene, 'Gear-linkage gear axles include local board-side spacer z in their fastener spans').toHaveAttribute('data-three-pin-stack-z-sources', 'gear-axles-include-board-side-spacer');
  await expect(threeScene, 'Gear-linkage pins are the two fixed gear axles plus two gear crank pins and one shared R connector').toHaveAttribute('data-three-physical-pin-contract', 'fixed-gear-axles-plus-two-crank-links');
  await expect(threeScene, 'Gear-linkage has no orphan hardware tower beyond its five real pin sites').toHaveAttribute('data-three-physical-pin-count', '5');
  await expect(threeScene, 'Gear-linkage geometry maps each layer to its reference role').toHaveAttribute('data-three-geometry-contract', /Drive G3 \/ 3-space gear:fixed-board-gear.*Output G3 \/ 3-space gear:fixed-board-gear.*Drive L4 linkage:B-pin-to-R.*Output L4 linkage:C-pin-to-R/);
  await expect(threeScene, 'Gear-linkage stack exposes G3/G3/L4/L4 in reference order').toHaveAttribute('data-three-stack-order', /Drive G3 \/ 3-space gear.*Output G3 \/ 3-space gear.*Drive L4 linkage.*Output L4 linkage/);
  await expect(threeScene).toHaveAttribute('data-three-gear-radii', '60.00,60.00');
  await expect(threeScene).toHaveAttribute('data-three-linkage-pin-radius', '40.00');
  await expect(threeScene, 'Gear-linkage endpoint gear centers stay separated until idlers close the pitch chain').toHaveAttribute('data-three-gear-linkage-spacing-contract', 'separated-endpoints-await-idlers');
  await expect(threeScene, 'Gear-linkage endpoint gears are independent driving cranks unless idlers are inserted').toHaveAttribute('data-three-gear-coupling-mode', 'dual-driven-endpoints');
  await expect(threeScene, 'Gear-linkage crank pins pass through real off-center gear holes before spacer-separated links').toHaveAttribute('data-three-gear-linkage-crank-stack-contract', 'B-gear-hole>S10>drive-link;C-gear-hole>S10>S10>output-link;R-drive-link>S10>output-link');
  await expect(threeScene, 'Gear-linkage has no extra output bracket beyond the shared R fastener').toHaveAttribute('data-three-gear-linkage-bracket-anchor', 'no-output-bracket');
  const gearLinkagePinOrder = await threeScene.getAttribute('data-three-gear-linkage-pin-z-order');
  expect(gearLinkagePinOrder, 'drive crank pin stacks gear, S10 spacer, then linkage').toContain('B:gear<S10<linkage');
  expect(gearLinkagePinOrder, 'output crank pin stacks gear, two S10 spacers, then upper output linkage').toContain('C:gear<S10<S10<linkage');
  expect(gearLinkagePinOrder, 'shared R connector stacks the two links with spacer clearance and no bracket').toContain('R:linkage<S10<linkage');
  expect(gearLinkagePinOrder, 'gear-linkage moving pin z-order has no invalid floating stack').not.toContain('invalid');
  await page.getByLabel('Foundry mechanism type').selectOption('4bar');
  await page.getByLabel('Foundry preset').selectOption('compact');
  await expect(page.getByLabel('ground number')).toHaveValue('120');
  await page.getByLabel('Foundry preset').selectOption('balanced');
  await expect(page.getByLabel('ground number')).toHaveValue('160');
  await page.getByLabel('Foundry preset').selectOption('compact');

  await page.getByLabel('ground number', { exact: true }).fill('120');
  const linkOptionLabels = await page.getByLabel('Input link length').locator('option').allTextContents();
  expect(linkOptionLabels.join(' '), 'visible 4bar link-size labels name holes, not cells').toMatch(/3-hole/);
  expect(linkOptionLabels.join(' '), 'visible 4bar link-size labels avoid cell wording').not.toMatch(/\bcell\b/i);
  const stackBeforeResize = await threeScene.getAttribute('data-three-stack-order');
  await page.getByLabel('Input link length').selectOption('4');
  await page.getByLabel('Coupler link length').selectOption('6');
  await page.getByLabel('Output link length').selectOption('4');
  await expect(threeScene, '4bar link-size selectors override the active Foundry instance with changed fabrication link blanks').toHaveAttribute('data-three-stack-order', /Input L4 linkage.*Coupler L6 linkage.*Output L4 linkage/);
  expect(await threeScene.getAttribute('data-three-stack-order')).not.toBe(stackBeforeResize);
  expect(await threeScene.getAttribute('data-three-rendered-layer-labels')).toBe(await threeScene.getAttribute('data-three-stack-order'));
  await page.getByLabel('Input link length').selectOption('2');
  await page.getByLabel('Coupler link length').selectOption('4');
  await page.getByLabel('Output link length').selectOption('2');
  await expect(threeScene, '4bar link-size selectors override the active Foundry instance with exact fabrication link blanks').toHaveAttribute('data-three-stack-order', /Input L2 linkage.*Coupler L4 linkage.*Output L2 linkage/);
  await expect(page.getByTestId('foundry-motion-warning')).toContainText(/Motion may jam|No full motion/);
  await expect(page.getByTestId('stage-left-pane')).not.toContainText(/Motion may jam|No full motion/);
  await expect(page.getByTestId('stage-left-pane')).not.toContainText(/Motion [0-9]+%/);
  await expect(page.getByTestId('stage-left-pane')).not.toContainText(/Range|Status/i);
  await page.getByLabel('Input link length').selectOption('4');
  await page.getByLabel('Coupler link length').selectOption('6');
  await page.getByLabel('Output link length').selectOption('4');
  await page.getByTestId('foundry-fit-path').click();
  await expect(page.getByRole('button', { name: /Use this mechanism/i })).toBeEnabled();
  await page.getByRole('button', { name: /Use this mechanism/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('design-mechanism-library')).toContainText('Four-bar linkage');
  await expect(page.getByTestId('design-mechanism-library')).not.toContainText('360°');

  await clickStage(page, 'Blueprint');
  await expect(page.getByTestId('blueprint-build-print')).toBeEnabled();
  await page.getByTestId('blueprint-build-print').click();
  const metadata = await downloadMetadataJson(page);
  const foundryMechanism = metadata.sceneSnapshot.mechanisms.find((mechanism: { source?: string }) => mechanism.source === 'foundry');
  expect(foundryMechanism.presetId).toBe('compact');
  expect(foundryMechanism.targetAnchorJointId).toBe('right_hand');
  expect(foundryMechanism.recommendation).toContain('Fit path');
  expect(foundryMechanism.foundryExport.simulationSummary).toBe('360°');

  expectCleanPage(pageErrors, consoleErrors);
});

test('Slider edits expose immediate feasibility without auto-fitting link choices', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);
  await clickStage(page, 'Foundry');
  await expect(page.getByRole('heading', { name: 'Foundry' })).toBeVisible();
  await page.getByText('Mechanism options', { exact: true }).click();

  await page.getByLabel('ground number', { exact: true }).fill('120');
  await page.getByLabel('Input link length').selectOption('2');
  await page.getByLabel('Coupler link length').selectOption('4');
  await page.getByLabel('Output link length').selectOption('2');

  await expect(page.getByLabel('ground number', { exact: true })).toHaveValue('120');
  await expect(page.getByLabel('Input link length')).toHaveValue('2');
  await expect(page.getByLabel('Coupler link length')).toHaveValue('4');
  await expect(page.getByLabel('Output link length')).toHaveValue('2');
  await expect(page.getByTestId('foundry-feasibility-status')).toHaveAttribute('data-status', 'may-jam');
  await expect(page.getByTestId('foundry-feasibility-status')).toContainText('May jam');

  await clickStage(page, 'Design');
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('design-feasibility-status')).toBeVisible();
  await page.getByLabel('ground number', { exact: true }).fill('120');
  await page.getByLabel('Input link length').selectOption('2');
  await page.getByLabel('Coupler link length').selectOption('4');
  await page.getByLabel('Output link length').selectOption('2');
  await expect(page.getByTestId('design-feasibility-status')).toHaveAttribute('data-status', 'may-jam');
  await expect(page.getByTestId('design-feasibility-status')).toContainText('May jam');
});

test('Blueprint renders the four visual layers from the canonical build plan', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);
  await clickStage(page, 'Blueprint');
  const legend = page.getByTestId('blueprint-legend');
  await expect(legend).toBeVisible();
  await expect(legend).toContainText('Character');
  await expect(legend).toContainText('Mechanism');
  await expect(legend).toContainText('Board');
  await expect(legend).toContainText('Motion path');
  await expect(legend.locator('.blueprint-legend-swatch')).toHaveCount(4);
  const preview = page.getByTestId('blueprint-build-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('12 x 12 in / 100% physical model');
  await expect(preview).toHaveAttribute('data-build-plan-digest', /^fnv1a32:/);
  await expect(preview).toHaveAttribute('data-build-geometry-signature', /^fnv1a32:/);
  await expect(preview.getByRole('img', { name: /build drawing/i })).toBeVisible();
  await expect(page.getByTestId('blueprint-three-puppet-canvas')).toHaveCount(0);
});

test('Character tab owns body layer and skeleton edits used by design controls', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
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

test('Recommendation worker and job stay unloaded until explicit request', async ({ page }) => {
  const recommendationWorkerRequests: string[] = [];
  const recommendationJobRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('mechanismRecommendationWorker')) {
      recommendationWorkerRequests.push(request.url());
    }
    if (request.url().includes('mechanismRecommendationJob')) {
      recommendationJobRequests.push(request.url());
    }
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  const recommend = page.getByRole('button', { name: /Recommend/i });
  await expect(recommend).toHaveAttribute('data-recommendation-worker', 'on-demand');
  expect(recommendationWorkerRequests, 'Design entry starts no recommendation worker').toEqual([]);
  expect(recommendationJobRequests, 'closed recommendation sheet starts no fit job').toEqual([]);

  const nextPaintMs = await recommend.evaluate((button: HTMLButtonElement) =>
    new Promise<number>((resolve) => {
      const started = performance.now();
      button.addEventListener('click', () => {
        requestAnimationFrame(() => resolve(performance.now() - started));
      }, { once: true });
      button.click();
    }),
  );
  expect(nextPaintMs, 'Recommend click yields its loading sheet promptly').toBeLessThan(100);
  const sheet = page.getByTestId('recommendation-sheet');
  await expect(sheet).toBeVisible();
  await expect.poll(
    () => recommendationJobRequests.length,
    { message: 'opening recommendations loads the heavy fit job in its dedicated worker' },
  ).toBeGreaterThan(0);
  expect(recommendationWorkerRequests.length, 'Recommend owns its worker only after the click').toBeGreaterThan(0);
  await expect(page.getByTestId('recommendation-card-gear_linkage')).toBeVisible({ timeout: 60_000 });
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toBeHidden();
});

test('Design Fit runs in a disposable worker without blocking its next paint', async ({ page }) => {
  const optimizerWorkerRequests: string[] = [];
  const optimizerJobRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('mechanismOptimizerWorker')) {
      optimizerWorkerRequests.push(request.url());
    }
    if (request.url().includes('mechanismOptimizerJob')) {
      optimizerJobRequests.push(request.url());
    }
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  const fit = page.getByTestId('design-fit-button');
  await expect(fit).toHaveAttribute('data-optimizer-worker', 'on-demand');
  expect(optimizerWorkerRequests, 'Design entry starts no optimizer worker').toEqual([]);
  expect(optimizerJobRequests, 'Design starts no optimizer job before explicit Fit').toEqual([]);
  const nextPaintMs = await fit.evaluate((button: HTMLButtonElement) =>
    new Promise<number>((resolve) => {
      const started = performance.now();
      button.addEventListener('click', () => {
        requestAnimationFrame(() => resolve(performance.now() - started));
      }, { once: true });
      button.click();
    }),
  );
  expect(nextPaintMs, 'Fit click yields a painted busy state promptly').toBeLessThan(100);
  await expect(fit).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => optimizerJobRequests.length, {
    message: 'explicit Fit loads the heavy optimizer job in its dedicated worker',
  }).toBeGreaterThan(0);
  await expect(fit).toHaveAttribute('aria-busy', 'false', { timeout: 120_000 });
  expect(optimizerWorkerRequests.length, 'Fit owns its worker only after the click').toBeGreaterThan(0);
  await expect.poll(async () => {
    const project = await readBrowserAutosaveProject(page);
    return project?.mechanisms?.find(
      (mechanism: { id?: string }) => mechanism.id === project?.selectedMechanismId,
    )?.source;
  }, { message: 'worker result commits one optimized mechanism' }).toBe('optimized');
});

test('Trace lazily streams bounded GIF frames and releases them on close', async ({ page }) => {
  const pageErrors: string[] = [];
  const gifWorkerRequests: string[] = [];
  const gifBytes: number[] = [
    ...Array.from('GIF89a', character => character.charCodeAt(0)),
    0x00, 0x05, // 1280px logical width
    0x80, 0x02, // 640px logical height
    0x80, 0x00, 0x00,
    0x00, 0x00, 0x00,
    0xff, 0xff, 0xff,
  ];
  for (let frame = 0; frame < 600; frame += 1) {
    gifBytes.push(
      0x21, 0xf9, 0x04, 0x00, 0x05, 0x00, 0x00, 0x00,
      0x2c,
      0x00, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x00,
      0x00,
      0x02, 0x02, 0x44, 0x01, 0x00,
    );
  }
  gifBytes.push(0x3b);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (request.url().includes('gifFrameWorker')) gifWorkerRequests.push(request.url());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  await page.getByTestId('novice-path-panel').getByText('More', { exact: true }).click();
  await page.getByRole('button', { name: 'Trace', exact: true }).click();
  const modal = page.getByTestId('tracking-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute(
    'data-media-policy',
    'max-800px-20fps-180-samples-one-bitmap',
  );
  expect(gifWorkerRequests, 'opening Trace does not load the GIF decoder').toEqual([]);

  const chooser = page.waitForEvent('filechooser');
  await modal.getByRole('button', { name: 'Load Media', exact: true }).click();
  await (await chooser).setFiles({
    name: 'bounded-large.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from(gifBytes),
  });
  await expect.poll(() => gifWorkerRequests.length, {
    message: 'selecting a GIF lazily loads its decoder worker',
  }).toBeGreaterThan(0);
  const canvas = modal.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(async () => Number(await canvas.getAttribute('width'))).toBeGreaterThan(1);
  expect(Number(await canvas.getAttribute('width'))).toBeLessThanOrEqual(800);
  expect(Number(await canvas.getAttribute('height'))).toBeGreaterThan(1);
  expect(Number(await canvas.getAttribute('height'))).toBeLessThanOrEqual(480);
  const timeline = modal.locator('input[type="range"]');
  await expect(timeline).toBeVisible();
  expect(Number(await timeline.getAttribute('max'))).toBe(179);
  await expect(canvas).toHaveAttribute('data-gif-delivered-frame', '0');
  const frameLabel = modal.getByText(/^Frame \d+ \/ \d+$/).first();
  const lastFrame = Number(await timeline.getAttribute('max'));
  const synchronousSeek = await timeline.evaluate((input, targetFrame) => {
    const range = input as HTMLInputElement;
    const modalRoot = range.closest('[data-testid="tracking-modal"]');
    const renderedCanvas = modalRoot?.querySelector('canvas');
    const label = range.parentElement?.querySelector('span');
    const deliveredBefore = Number(renderedCanvas?.getAttribute('data-gif-delivered-frame') ?? '-1');
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    nativeValueSetter?.call(range, String(targetFrame));
    range.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      deliveredBefore,
      rangeValue: Number(range.value),
      label: label?.textContent ?? '',
    };
  }, lastFrame);
  expect(synchronousSeek.rangeValue, 'GIF scrubber stays on the bitmap that is actually displayed').toBe(synchronousSeek.deliveredBefore);
  expect(synchronousSeek.label, 'GIF frame label does not advance on request').toMatch(
    new RegExp(`^Frame ${synchronousSeek.deliveredBefore + 1} /`),
  );
  await expect(canvas).toHaveAttribute('data-gif-delivered-frame', String(lastFrame));
  await expect(frameLabel).toHaveText(new RegExp(`^Frame ${lastFrame + 1} /`));
  const frameBefore = await frameLabel.textContent();
  await modal.getByTitle('Play').click();
  await expect.poll(() => frameLabel.textContent(), {
    message: 'GIF playback advances the canvas/timeline without a React frame array',
  }).not.toBe(frameBefore);
  await modal.getByTitle('Stop').click();
  await modal.getByRole('button', { name: 'Close trace' }).click();
  await expect(modal).toHaveCount(0);

  await page.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(page.getByTestId('tracking-modal')).toContainText('Browse');
  expect(gifWorkerRequests).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('Trace bounds classroom video decode and releases the media element on close', async ({ page }) => {
  const pageErrors: string[] = [];
  const gifWorkerRequests: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (request.url().includes('gifFrameWorker')) gifWorkerRequests.push(request.url());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  await page.getByTestId('novice-path-panel').getByText('More', { exact: true }).click();
  await page.getByRole('button', { name: 'Trace', exact: true }).click();
  const modal = page.getByTestId('tracking-modal');
  await expect(modal).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await modal.getByRole('button', { name: 'Load Media', exact: true }).click();
  await (await chooser).setFiles(join(process.cwd(), 'tests/fixtures/trace-video-sample.mp4'));

  const canvas = modal.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('width', '800');
  await expect(canvas).toHaveAttribute('height', '450');
  const timeline = modal.locator('input[type="range"]');
  await expect(timeline).toBeVisible();
  expect(Number(await timeline.getAttribute('max'))).toBeLessThan(180);
  expect(gifWorkerRequests, 'MP4 metadata and playback do not load the GIF decoder').toEqual([]);

  await modal.getByRole('button', { name: 'Close trace' }).click();
  await expect(modal).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('Recommendation sheet replaces the path owner and blueprint recipe', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  const initialMechanismIds = await page.getByLabel('Mechanism instance').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  const initialMechanisms = initialMechanismIds.length;
  await page.getByRole('button', { name: /Recommend/i }).click();
  await expect(page.getByTestId('recommendation-sheet')).toBeVisible();
  await expect(page.getByTestId('recommendation-sheet')).toContainText('Recommended mechanisms');
  await expect(page.getByTestId('recommendation-card-gear_linkage')).toBeVisible({ timeout: 60_000 });
  const fitPreview = page.getByTestId('recommendation-fit-preview-gear_linkage');
  await expect(fitPreview).toHaveAttribute('data-board-cells', '15');
  await expect(fitPreview).toHaveAttribute('data-user-path-preview', 'shown');
  await expect(fitPreview).toHaveAttribute('data-mechanism-path-preview', 'shown');
  await expect(fitPreview).toHaveAttribute('data-ghost-preview', 'hidden');
  await expect(fitPreview).toHaveAttribute('data-trace-samples', '12');
  await expect(fitPreview.locator('.mechanism-choice-ghost')).toHaveCount(0);
  await expect(page.getByTestId('recommendation-linkage-gear_linkage')).toBeVisible();
  await page.getByTestId('recommendation-card-gear_linkage').getByRole('button', { name: /^Use$/ }).click();
  await expect(page.getByTestId('recommendation-sheet')).toBeHidden();
  const mechanismOptions = await page.getByLabel('Mechanism instance').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  expect(mechanismOptions).toHaveLength(initialMechanisms);
  expect(new Set(mechanismOptions).size).toBe(mechanismOptions.length);
  expect(mechanismOptions).toEqual(initialMechanismIds);
  const designPreview = page.getByTestId('design-shared-foundry-preview');
  await expect(designPreview).toBeVisible();
  await expect(designPreview.getByTestId('foundry-camera-rig')).toBeVisible();
  await expect(designPreview).toHaveAttribute('data-user-path-preview', 'shown');
  await expect(designPreview).toHaveAttribute('data-mechanism-path-preview', 'shown');
  await expect(designPreview).toHaveAttribute('data-design-motion-source', 'linkage-trace');
  await expect(designPreview).toHaveAttribute('data-design-fit-status', 'unfitted');
  expect(Number(await designPreview.getAttribute('data-design-generated-path-count'))).toBeGreaterThanOrEqual(3);
  expect(Number(await designPreview.getAttribute('data-design-generated-path-error'))).toBeLessThan(1);
  await expect(designPreview).toHaveAttribute('data-design-target-joint-id', /\S/);
  const targetErrorAttr = await designPreview.getAttribute('data-design-target-error');
  expect(targetErrorAttr).toMatch(/^\d+(\.\d+)?$/);
  const targetError = Number(targetErrorAttr);
  expect(Number.isFinite(targetError)).toBe(true);
  expect(targetError).toBeGreaterThan(1);
  expect(Number(await designPreview.getAttribute('data-design-animated-part-count'))).toBeGreaterThan(0);
  const targetBeforeScrub = `${await designPreview.getAttribute('data-design-target-x')},${await designPreview.getAttribute('data-design-target-y')}`;
  await page.getByLabel('Workspace scrubber').fill('35');
  await expect.poll(async () => `${await designPreview.getAttribute('data-design-target-x')},${await designPreview.getAttribute('data-design-target-y')}`, { message: 'Design character target follows the physical linkage trace through scrubber changes' }).not.toBe(targetBeforeScrub);
  expect(Number(await designPreview.getAttribute('data-design-target-error'))).toBeGreaterThan(1);
  await expect(designPreview.getByTestId('foundry-camera-rig')).toHaveAttribute('data-path-preview', 'shown');

  await clickStage(page, 'Blueprint');
  await expect(page.getByTestId('blueprint-build-print')).toBeEnabled();
  await page.getByTestId('blueprint-build-print').click();
  const metadata = await downloadMetadataJson(page);
  expect(metadata.recipes).toHaveLength(initialMechanisms);
  expect(new Set(metadata.recipes.map((recipe: { mechanismId: string }) => recipe.mechanismId)).size).toBe(initialMechanisms);
  const appliedRecommendation = metadata.sceneSnapshot.mechanisms.find((mechanism: { id: string; presetId?: string; source?: string; targetPathId?: string; targetPartId?: string; generatedPath?: Array<{ x: number; y: number }> }) => mechanism.source === 'optimized' && mechanism.presetId?.startsWith('recommendation-'));
  expect(appliedRecommendation).toBeTruthy();
  expect(appliedRecommendation?.targetPartId).toBe('right_arm_lower');
  expect(appliedRecommendation?.targetPathId).toBe('fabrication-fit-path');
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
  await expect(assemblyScene).toHaveAttribute('data-mechanism-scene-contract-stack-source', 'fabricationStackForMechanism');
  await expect(assemblyScene).toHaveAttribute('data-mechanism-scene-contract-layer-count', /[1-9]/);

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.getByRole('button', { name: /Recommend/i }).click();
  const wavingRecommendations = page.getByTestId('recommendation-sheet');
  await expect(wavingRecommendations).toBeVisible();
  const readyGear = page.getByTestId('recommendation-card-gear');
  const blockedFourBar = page.getByTestId('recommendation-card-4bar');
  await expect(readyGear).toBeVisible({ timeout: 60_000 });
  await expect(blockedFourBar).toHaveCount(0);
  await expect(readyGear.getByRole('button', { name: /^Use$/ })).toBeEnabled();
  expect(await wavingRecommendations.locator('button.btn-primary:not(:disabled)').count()).toBeGreaterThan(0);
  await wavingRecommendations.getByRole('button', { name: 'Close', exact: true }).click();
  await clickStage(page, 'Blueprint');
  await expect(page.getByTestId('blueprint-control-panel')).toContainText('Ready.');
  await expect(page.getByTestId('blueprint-build-print')).toBeEnabled();

  expectCleanPage(pageErrors, consoleErrors);
});

test('Foundry toolbar toggles preview, forces, velocity, trail, and sensemaking', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
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
  await expect(page.getByTestId('foundry-forces-overlay')).toHaveCount(0);
  await page.getByTestId('foundry-toggle-forces').click();
  await expect(page.getByTestId('foundry-forces-overlay')).toBeVisible();
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
  await expect(threeScene).toHaveAttribute('data-layer-forces', 'hidden');
  await expect(threeScene).toHaveAttribute('data-layer-velocity', 'hidden');
  await expect(threeScene).toHaveAttribute('data-camera-preset', 'iso');
  await expect(page.getByTestId('foundry-camera-readout')).toContainText('3D Isometric');
  await expect(page.getByTestId('foundry-forces-overlay')).toHaveCount(0);
  await expect(page.getByTestId('foundry-velocity-overlay')).toHaveCount(0);
});

test('Foundry defers Rapier until physics diagnostics are requested', async ({ page }) => {
  const rapierRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/assets\/rapier-[^/]+\.js(?:\?|$)/.test(request.url())) {
      rapierRequests.push(request.url());
    }
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Foundry/i }).click();

  const rig = page.getByTestId('foundry-camera-rig');
  await expect(rig).toHaveAttribute('data-physics-kernel-runtime', 'idle');
  expect(rapierRequests).toEqual([]);

  await page.getByTestId('foundry-toggle-forces').click();
  await expect(rig).toHaveAttribute('data-physics-kernel-runtime', 'ready', {
    timeout: 60_000,
  });
  await expect(rig).toHaveAttribute('data-physics-kernel-version', /\d+\.\d+\.\d+/);
  expect(rapierRequests).toHaveLength(1);
});

test('Every visible path-fit trigger owns and releases the shared fit worker', async ({ page, context }) => {
  await installChromebookAuditInstrumentation(context);
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);
  await page.evaluate(() => {
    const target = window as typeof window & { __FIT_WORKER_REQUESTS__?: string[] };
    target.__FIT_WORKER_REQUESTS__ = [];
    window.addEventListener('motionsmith:chromebook-worker-request', (event) => {
      const detail = (event as CustomEvent<{ name?: string; type?: string }>).detail;
      if (detail?.name === 'motionsmith-mechanism-fit') {
        target.__FIT_WORKER_REQUESTS__?.push(detail.type ?? 'unknown');
      }
    });
  });
  const requestedFits = () => page.evaluate(() =>
    (window as typeof window & { __FIT_WORKER_REQUESTS__?: string[] })
      .__FIT_WORKER_REQUESTS__ ?? [],
  );

  await page.getByRole('button', { name: /Foundry/i }).click();
  const foundryBaseline = await readFeatureRuntimeProbe(page);
  await page.getByTestId('foundry-fit-path').click();
  await expect(page.getByTestId('foundry-fit-path')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: /Use this mechanism/i })).toBeEnabled();
  await waitForLifecycleBaseline(page, foundryBaseline.lifecycle);
  const afterFoundryFit = await readFeatureRuntimeProbe(page);
  expect(afterFoundryFit.lifecycle.workers.acquired).toBeGreaterThan(
    foundryBaseline.lifecycle.workers.acquired,
  );
  expect(afterFoundryFit.lifecycle.workers.released).toBeGreaterThan(
    foundryBaseline.lifecycle.workers.released,
  );
  expect(await requestedFits(), 'Foundry requests one path fit').toEqual(['fit']);

  await page.getByRole('button', { name: /Use this mechanism/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('design-fit-button'))
    .toHaveAttribute('data-optimizer-worker', 'on-demand');
  await expect(page.getByRole('button', { name: /Recommend/i }))
    .toHaveAttribute('data-recommendation-worker', 'on-demand');
  const designBaseline = await readFeatureRuntimeProbe(page);
  const pathOwnerMechanismId = await page.getByLabel('Mechanism instance').inputValue();
  expect(await requestedFits(), 'Use validates the fabrication sheet before committing').toEqual(['fit', 'fit']);

  await page.getByTestId('design-add-gear_linkage').click();
  await expectProjectCounts(page, 14, 1, 2);
  await waitForLifecycleBaseline(page, designBaseline.lifecycle);
  const afterFamilyFit = await readFeatureRuntimeProbe(page);
  const familyAcquiredDelta = afterFamilyFit.lifecycle.workers.acquired - designBaseline.lifecycle.workers.acquired;
  const familyReleasedDelta = afterFamilyFit.lifecycle.workers.released - designBaseline.lifecycle.workers.released;
  expect(familyAcquiredDelta).toBe(familyReleasedDelta);
  expect(afterFamilyFit.lifecycle.workers.active).toBeLessThanOrEqual(
    designBaseline.lifecycle.workers.active,
  );
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('');
  expect(await requestedFits(), 'an owned target leaves the additional kit unbound without another fit').toEqual(['fit', 'fit']);

  await page.getByLabel('Mechanism instance').selectOption(pathOwnerMechanismId);
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('fabrication-fit-path');
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('All paths will be kept.');
    await dialog.accept();
  });
  await page.getByLabel('Mechanism target').selectOption('head');
  await expect.poll(requestedFits, {
    message: 'the accepted unbound target requests a fabrication board fit',
  }).toEqual(['fit', 'fit', 'fit']);
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('');
  await expect.poll(async () => (await readFeatureRuntimeProbe(page)).lifecycle.workers.active, {
    message: 'fit worker releases before the next lifecycle baseline is captured',
  }).toBe(0);
  const targetBaseline = await readFeatureRuntimeProbe(page);
  await page.getByLabel('Mechanism target').selectOption('right_arm_lower');
  await expect.poll(requestedFits, {
    message: 'reattaching the arm requests its path fit',
  }).toEqual(['fit', 'fit', 'fit', 'fit']);
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue(/\S+/);
  await expect(page.getByTestId('status-bar')).toContainText('Fit ready');
  await waitForLifecycleBaseline(page, targetBaseline.lifecycle);
  const afterTargetFit = await readFeatureRuntimeProbe(page);
  expect(afterTargetFit.lifecycle.workers.acquired).toBeGreaterThan(
    targetBaseline.lifecycle.workers.acquired,
  );
  expect(afterTargetFit.lifecycle.workers.released).toBeGreaterThan(
    targetBaseline.lifecycle.workers.released,
  );

  expect(await requestedFits(), 'reattaching the arm requests its path fit').toEqual(['fit', 'fit', 'fit', 'fit']);
});

test('Classroom playback is opt-in and pauses across stage or hidden-tab boundaries', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  const player = page.getByTestId('workspace-player-dock');
  await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await player.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  await clickStage(page, 'Design');
  await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await player.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('Foundry M B C D drags stay local until one pointerup commit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Foundry/i }).click();
  await page.getByTestId('foundry-fit-path').click();
  await expect(page.getByTestId('foundry-fit-path')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByTestId('foundry-fit-path')).not.toContainText('Cancel');
  await expect(page.getByTestId('foundry-canvas-pane')).not.toHaveAttribute(
    'data-fit-target-path',
    '',
  );
  await page.evaluate(() => {
    (window as typeof window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
        projectActionCounts?: Record<string, number>;
      };
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__ = { projectActionCounts: {} };
  });

  const pane = page.getByTestId('foundry-canvas-pane');
  const upsertCount = () => page.evaluate(() => (
    (window as typeof window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
        projectActionCounts?: Record<string, number>;
      };
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__?.projectActionCounts?.upsert_mechanism ?? 0
  ));

  for (const [index, handleId] of ['B', 'C', 'D', 'M'].entries()) {
    const handle = page.getByTestId(`foundry-param-handle-${handleId}`);
    const beforeBox = await handle.boundingBox();
    expect(beforeBox, `${handleId} handle is visible`).toBeTruthy();
    const beforeCount = await upsertCount();
    const center = {
      x: beforeBox!.x + beforeBox!.width / 2,
      y: beforeBox!.y + beforeBox!.height / 2,
    };
    await page.mouse.move(center.x, center.y);
    await handle.hover();
    await page.mouse.down();
    const moveX = handleId === 'M' ? 100 : 30 + index * 4;
    const moveY = handleId === 'M' ? 40 : 14 + index * 3;
    await page.mouse.move(
      center.x + moveX,
      center.y + moveY,
      { steps: 6 },
    );
    await expect(pane).toHaveAttribute('data-foundry-gesture-draft', 'active');
    expect(await upsertCount(), `${handleId} pointermove has no ProjectAction`).toBe(beforeCount);
    await expect.poll(async () => {
      const current = await handle.boundingBox();
      return current
        ? Math.hypot(current.x - beforeBox!.x, current.y - beforeBox!.y)
        : 0;
    }, {
      message: `${handleId} receives a local visual update before pointerup`,
    }).toBeGreaterThan(1);
    await page.mouse.up();
    await expect(pane).toHaveAttribute('data-foundry-gesture-draft', 'idle');
    await expect.poll(upsertCount, {
      message: `${handleId} pointerup performs one canonical commit`,
    }).toBe(beforeCount + 1);
  }

  const cancelHandle = page.getByTestId('foundry-param-handle-B');
  const cancelBox = await cancelHandle.boundingBox();
  expect(cancelBox, 'B remains available for cancellation').toBeTruthy();
  const countBeforeCancel = await upsertCount();
  await page.mouse.move(
    cancelBox!.x + cancelBox!.width / 2,
    cancelBox!.y + cancelBox!.height / 2,
  );
  await cancelHandle.hover();
  await page.mouse.down();
  await page.mouse.move(cancelBox!.x + 45, cancelBox!.y + 30, { steps: 4 });
  await expect(pane).toHaveAttribute('data-foundry-gesture-draft', 'active');
  await cancelHandle.dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  await expect(pane).toHaveAttribute('data-foundry-gesture-draft', 'idle');
  expect(await upsertCount(), 'pointercancel discards the draft without a ProjectAction')
    .toBe(countBeforeCancel);
});

test('Shared inspector sliders keep pointer moves local until one canonical commit', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  const slider = page.getByLabel('anchor X slider');
  await expect(slider).toHaveAttribute('data-gesture-commit', 'pointerup');
  await page.evaluate(() => {
    (window as typeof window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
        projectActionCounts?: Record<string, number>;
      };
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__ = { projectActionCounts: {} };
  });
  const upsertCount = () => page.evaluate(() => (
    (window as typeof window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
        projectActionCounts?: Record<string, number>;
      };
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__?.projectActionCounts?.upsert_mechanism ?? 0
  ));
  const valueBefore = await slider.inputValue();
  await slider.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse' });
  await slider.evaluate((input: HTMLInputElement) => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    for (const value of ['32', '48', '64', '80']) {
      valueSetter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  expect(await upsertCount(), 'slider pointermove has no ProjectAction').toBe(0);
  await expect.poll(() => slider.inputValue(), {
    message: 'slider draft paints before canonical commit',
  }).not.toBe(valueBefore);
  await slider.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse' });
  await expect.poll(upsertCount, {
    message: 'slider pointerup performs one canonical commit',
  }).toBe(1);
});

test('Foundry supports CAD-style 3D camera presets and drag orbit', async ({ page }) => {
  await page.setViewportSize({ width: 901, height: 720 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
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
  await page.getByTestId('foundry-toggle-velocity').click();
  await expect(page.getByTestId('foundry-velocity-vector')).toBeVisible();
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

  const orbitAnchorMarker = page.getByTestId('foundry-anchor-marker');
  const orbitAnchorGrid = await page.getByTestId('foundry-canvas-pane').getAttribute('data-fit-anchor-grid');
  expect(orbitAnchorGrid, 'orbit picking retains a valid snapped board hole').toMatch(/^-?\d+,-?\d+$/);
  const currentAnchorTransform = await orbitAnchorMarker.getAttribute('transform');
  const currentAnchorCoords = currentAnchorTransform?.match(/translate\(([-\d.]+) ([-\d.]+)/);
  expect(currentAnchorCoords, 'current snapped anchor has projected SVG coordinates').toBeTruthy();
  const anchorOverlay = page.getByTestId('foundry-preview-overlay');
  const overlayBox = await anchorOverlay.boundingBox();
  expect(overlayBox, 'foundry overlay is measurable for projected anchor picking').not.toBeNull();
  const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] = (await anchorOverlay.getAttribute('viewBox') ?? '')
    .trim()
    .split(/\s+/)
    .map(Number);
  const viewBoxScale = Math.min(
    overlayBox!.width / viewBoxWidth,
    overlayBox!.height / viewBoxHeight,
  );
  const viewBoxOffsetX = (overlayBox!.width - viewBoxWidth * viewBoxScale) / 2;
  const viewBoxOffsetY = (overlayBox!.height - viewBoxHeight * viewBoxScale) / 2;
  const projectedAnchorClientX = overlayBox!.x +
    viewBoxOffsetX + (Number(currentAnchorCoords![1]) - viewBoxX) * viewBoxScale;
  const projectedAnchorClientY = overlayBox!.y +
    viewBoxOffsetY + (Number(currentAnchorCoords![2]) - viewBoxY) * viewBoxScale;
  await page.getByTestId('foundry-pick-anchor').click();
  await page.mouse.click(projectedAnchorClientX, projectedAnchorClientY);
  const orbitPickedMarker = await orbitAnchorMarker.getAttribute('transform');
  const orbitPickedCoords = orbitPickedMarker?.match(/translate\(([-\d.]+) ([-\d.]+)/);
  expect(orbitPickedCoords, 'orbit picking remains camera-coherent after custom 3D drag').toBeTruthy();
  await expect.poll(
    async () => {
      const marker = await page.getByTestId('foundry-anchor-marker').getAttribute('transform');
      const coords = marker?.match(/translate\(([-\d.]+) ([-\d.]+)/);
      return coords ? Math.abs(Number(coords[1]) - Number(currentAnchorCoords![1])) : Number.POSITIVE_INFINITY;
    },
    { message: 'orbit-picked marker remains visually centered after custom Three camera projection' },
  ).toBeLessThan(6);
  await expect.poll(
    async () => {
      const marker = await page.getByTestId('foundry-anchor-marker').getAttribute('transform');
      const coords = marker?.match(/translate\(([-\d.]+) ([-\d.]+)/);
      return coords ? Math.abs(Number(coords[2]) - Number(currentAnchorCoords![2])) : Number.POSITIVE_INFINITY;
    },
    { message: 'orbit-picked marker remains visually centered after custom Three camera projection' },
  ).toBeLessThan(6);
});

test('Foundry and Design hide every disabled mechanism creation choice', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Foundry/i }).click();
  await page.getByText('Mechanism options').click();

  const foundryTypeOptions = page.getByLabel('Foundry mechanism type').locator('option');
  await expect(foundryTypeOptions).toHaveCount(3);
  expect(await foundryTypeOptions.evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual([...ENABLED_MECHANISM_TYPES]);
  await expect(page.getByTestId('foundry-mechanism-gallery')).not.toContainText(/Cam follower|Planetary gear|Slider piston/);

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  const designPane = page.getByTestId('stage-left-pane');
  for (const label of ['Four-bar linkage', 'Gear train', 'Gear linkage']) {
    await expect(designPane.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  for (const label of ['Slider piston', 'Cam follower', 'Planetary gear']) {
    await expect(designPane.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  }

  await designPane.getByRole('button', { name: /Recommend/i }).click();
  const recommendationSheet = page.getByTestId('recommendation-sheet');
  await expect(recommendationSheet).toBeVisible();
  await expect(recommendationSheet).toHaveAttribute('data-recommendation-state', 'ready', { timeout: 60_000 });
  for (const type of ['piston', 'cam', 'planetary_gear']) {
    await expect(recommendationSheet.getByTestId(`recommendation-card-${type}`)).toHaveCount(0);
  }
});

test('Mechanism Design cam profile edits update the integrated automata preview', async ({ page }) => {
  await page.setViewportSize({ width: 901, height: 720 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await importProjectFile(page, await writeHeadBobLessonProject());
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.locator('[data-stage="design"]')).toBeVisible();

  const designRig = page.getByTestId('design-shared-foundry-preview').getByTestId('foundry-camera-rig');
  await expect(designRig).toHaveAttribute('data-mechanism-type', 'cam');
  await expect(designRig).toHaveAttribute('data-three-cam-contact-mode', 'sampled-profile-on-guide-axis');
  await expect(designRig).toHaveAttribute('data-three-preview-renderable', 'ready');
  const editor = page.getByTestId('cam-profile-editor');
  await editor.scrollIntoViewIfNeeded();
  await expect(editor).toBeVisible();
  const before = await designRig.getAttribute('data-cam-profile');
  await page.evaluate(() => {
    (window as typeof window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
        projectActionCounts?: Record<string, number>;
      };
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__ = { projectActionCounts: {} };
  });
  const upsertCount = () => page.evaluate(() => (
    (window as typeof window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
        projectActionCounts?: Record<string, number>;
      };
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__?.projectActionCounts?.upsert_mechanism ?? 0
  ));
  const point = page.getByTestId('cam-profile-point-1');
  const box = await point.boundingBox();
  expect(box, 'Design cam profile point is draggable').toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y - 24);
  expect(await upsertCount(), 'cam pointermove has no ProjectAction').toBe(0);
  await page.mouse.up();
  await expect.poll(upsertCount, {
    message: 'cam pointerup performs one canonical commit',
  }).toBe(1);
  await expect.poll(async () => designRig.getAttribute('data-cam-profile'), { message: 'Design cam profile edits update the integrated Three automata data' }).not.toBe(before);
  await expect.poll(async () => Number(await designRig.getAttribute('data-three-dynamic-build-count')), { message: 'Design cam edit keeps a real rebuilt Three mechanism' }).toBeGreaterThan(0);
});


test('Character import surface omits browser camera capture', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
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
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
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


test('School build has no image-recognition surface or network request', async ({ page }) => {
  const forbiddenRequests: string[] = [];
  page.on('request', request => {
    if (/(?:\/onnx\/|pose_model\.onnx|onnxruntime|ort(?:\.bundle|-wasm)|webOnnx)/i.test(request.url())) {
      forbiddenRequests.push(request.url());
    }
  });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  const bootText = await page.evaluate(() => document.getElementById('boot-loader')?.textContent ?? '');
  if (bootText) {
    expect(bootText).toMatch(/MotionSmith/);
    expect(bootText).toMatch(/workspace/i);
  }
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
  const gettingStarted = page.getByTestId('getting-started-dialog');
  await expect(gettingStarted).toBeVisible();
  await expect(
    page.getByTestId('character-screen'),
    'Getting Started keeps the deferred Character stage unmounted',
  ).toHaveCount(0);
  await expect(gettingStarted).toContainText('Character file');
  await expect(gettingStarted.getByText('Image', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('onnx-cache-status')).toHaveCount(0);
  await expect(page.getByTestId('onnx-input')).toHaveCount(0);
  await expect(page.getByTestId('getting-started-onnx-input')).toHaveCount(0);
  await gettingStarted.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(gettingStarted).toHaveCount(0);
  await expect(page.getByTestId('project-lifecycle-panel')).toBeVisible();
  await clickStage(page, 'Character');
  await expect(page.getByTestId('character-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create from image', exact: true })).toHaveCount(0);
  expect(forbiddenRequests, 'school workflow never requests image-recognition assets').toEqual([]);
});

test('Mobile startup shows compact Getting Started with a session opt-out', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
  await expect(page.getByTestId('getting-started-dialog')).toBeVisible();
  await expect(page.getByTestId('character-screen')).toHaveCount(0);
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
  await page.getByTestId('getting-started-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('project-lifecycle-panel')).toBeVisible();
});

test('Shared player dock overlays the canvas, does not take layout space, and can be dragged', async ({ page }) => {
  for (const width of [901, 950, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
    await dismissStartupAnnouncement(page);
    await openWavingArmTemplate(page);
    await page.getByTestId('workspace-steps').getByRole('button', { name: 'Mechanism Design' }).click();
    await expect(page.locator('[data-stage="design"]')).toBeVisible();

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

test('Options settings scroll inside the center workspace without moving its panes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Options/i }).click();

  const center = page.getByTestId('stage-canvas-pane');
  const workflow = page.getByTestId('stage-left-pane');
  const settings = page.getByTestId('options-settings-workspace');
  await expect(page.getByTestId('stage-right-inspector')).toBeHidden();
  const beforeCenter = await waitForStableBox(page, center, 'Options center settings before wheel');
  const beforeWorkflow = await waitForStableBox(page, workflow, 'Options workflow before wheel');
  await settings.hover();
  await page.mouse.wheel(0, 900);

  await expect.poll(() => settings.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const afterCenter = await waitForStableBox(page, center, 'Options center settings after wheel');
  const afterWorkflow = await waitForStableBox(page, workflow, 'Options workflow after wheel');
  expect(Math.abs(afterCenter.y - beforeCenter.y), 'center settings pane stays pinned while its content scrolls').toBeLessThan(1);
  expect(Math.abs(afterWorkflow.y - beforeWorkflow.y), 'workflow pane stays pinned while settings scroll').toBeLessThan(1);
});

test('Options uses one reachable column at the 900px fallback without phantom panes', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 768 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  await page.getByTestId('stage-left-pane')
    .locator('.stage-nav-compact')
    .getByRole('button', { name: 'Options' })
    .click();
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();

  const frame = page.locator('[data-stage="options"]');
  const center = frame.getByTestId('stage-canvas-pane');
  const inspector = frame.getByTestId('stage-right-inspector');
  const workspace = frame.getByTestId('options-settings-workspace');
  const layout = await workspace.evaluate(element => {
    const grid = element.querySelector<HTMLElement>('.options-settings-grid');
    const centerElement = element.parentElement;
    const inspectorElement = centerElement?.parentElement
      ?.querySelector<HTMLElement>('[data-testid="stage-right-inspector"]');
    const centerBox = centerElement?.getBoundingClientRect();
    const workspaceBox = element.getBoundingClientRect();
    return {
      columnCount: grid ? getComputedStyle(grid).columnCount : '',
      workspaceOverflowY: getComputedStyle(element).overflowY,
      centerMinHeight: centerElement ? getComputedStyle(centerElement).minHeight : '',
      centerHeight: centerBox?.height ?? 0,
      workspaceHeight: workspaceBox.height,
      inspectorDisplay: inspectorElement ? getComputedStyle(inspectorElement).display : '',
      inspectorWidth: inspectorElement?.getBoundingClientRect().width ?? 0,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(layout.columnCount, 'Options collapses to one column at the inclusive 900px breakpoint').toBe('1');
  expect(layout.workspaceOverflowY, 'mobile Options follows document scrolling').toBe('visible');
  expect(layout.centerMinHeight, 'Options overrides the generic 360px mobile canvas minimum').toBe('0px');
  expect(Math.abs(layout.centerHeight - layout.workspaceHeight), 'Options has no empty canvas row around its settings').toBeLessThan(2);
  expect(layout.inspectorDisplay, 'mobile Options keeps the empty inspector out of layout').toBe('none');
  expect(layout.inspectorWidth, 'mobile Options inspector reserves no phantom width').toBe(0);
  expect(layout.documentScrollWidth, 'mobile Options has no horizontal page overflow').toBeLessThanOrEqual(layout.documentClientWidth + 1);
  await expect(inspector).toBeHidden();
  await expect(center.getByRole('img', { name: 'Options preview canvas' })).toHaveCount(0);

  const documentScrollBefore = await page.evaluate(() => window.scrollY);
  await frame.getByTestId('stage-left-pane').getByRole('link', { name: 'Units' }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY), {
    message: 'mobile Units anchor scrolls the document-owned fallback',
  }).toBeGreaterThan(documentScrollBefore);
  expect(await workspace.evaluate(element => element.scrollTop), 'mobile workspace does not create nested scrolling').toBe(0);
  await expectInsideViewport(page, frame.getByTestId('options-units'), 'mobile Options Units section');
  await expectInsideViewport(page, page.getByLabel('Grid units'), 'mobile Options Grid units control');
});

test('Narrow character right inspector remains independently scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
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

test('Selected-item stages share the right scroll container while Options uses center', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);

  for (const stageName of ['Character', 'Path', 'Foundry', 'Design', 'Blueprint', 'Assembly']) {
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

  await clickStage(page, 'Options');
  await expect(page.getByTestId('stage-right-inspector'), 'Options has no empty selected-item inspector').toBeHidden();
  await expect(page.getByTestId('stage-canvas-pane').getByTestId('options-settings-workspace')).toBeVisible();
});

test('Workflow tabs keep their stage-owned pane roles', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
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

  await assertPaneContract('Edit Right hand', '3D', 'Right hand', '.canvas-zoom-toolbar, .path-view-switch');
  await expect(page.getByTestId('stage-left-pane')).not.toContainText('Rig setup');
  await expect(page.getByTestId('stage-left-pane')).not.toContainText(/Add layer|Remove layer|New handle/);

  await page.getByRole('button', { name: /Foundry/i }).click();
  await assertPaneContract('Templates', '3D Isometric', 'Question', '.canvas-zoom-toolbar, .foundry-camera-hud, .foundry-playback-hud');
  await expect(page.getByTestId('stage-left-pane')).toContainText('Use this mechanism');

  await page.getByTestId('foundry-fit-path').click();
  await expect(page.getByRole('button', { name: /Use this mechanism/i })).toBeEnabled();
  await page.getByRole('button', { name: /Use this mechanism/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await assertPaneContract('Mechanisms', '3D', 'Parameters', '.canvas-zoom-toolbar, .foundry-camera-hud, .foundry-opacity-panel, [data-testid="foundry-explode-panel"]');
  await expect(page.getByTestId('design-shared-foundry-preview')).toBeVisible();

  await clickStage(page, 'Blueprint');
  await assertPaneContract('Blueprint', '', 'Build spot', '.blueprint-document-preview', '.blueprint-document-preview');
  await clickStage(page, 'Assembly');
  await assertPaneContract('Steps', 'Build animation', 'Assembly', '.assembly-readonly-step-strip', '.assembly-readonly-step-strip');

  await page.getByRole('button', { name: /Options/i }).click();
  const optionsLeft = page.getByTestId('stage-left-pane');
  const optionsCenter = page.getByTestId('stage-canvas-pane');
  const optionsInspector = page.getByTestId('stage-right-inspector');
  const optionsWorkspace = page.getByTestId('options-settings-workspace');
  await expect(optionsLeft).toContainText('Settings');
  await expect(optionsCenter).toContainText('Appearance');
  await expect(optionsInspector).toBeHidden();
  await optionsWorkspace.evaluate(element => { element.scrollTop = 0; });
  await page.getByTestId('stage-left-pane').getByRole('link', { name: 'Units' }).click();
  await expect.poll(() => optionsWorkspace.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByTestId('options-units')).toBeVisible();
});

test('Fullscreen desktop layouts keep every workflow pane inside the viewport', async ({ page }) => {
  const viewports = [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ];
  const stages: Array<[string, string]> = [
    ['Character', 'Character'],
    ['Path', 'Path Editor'],
    ['Foundry', 'Foundry'],
    ['Design', 'Mechanism Design'],
    ['Blueprint', 'Blueprint'],
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
    await dismissStartupAnnouncement(page);
    await openWavingArmTemplate(page);
    const pauseButton = page.getByTestId('workspace-player-dock').getByRole('button', { name: 'Pause', exact: true });
    if (await pauseButton.count()) await pauseButton.click();

    for (const [stageName, heading] of stages) {
      await clickStage(page, stageName);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();

      const header = page.locator('header.app-header');
      const rail = page.getByTestId('workspace-steps');
      const center = page.getByTestId('stage-canvas-pane');
      const inspector = page.getByTestId('stage-right-inspector');
      const status = page.getByTestId('status-bar');
      const surface = center.locator('canvas, svg, img').first();
      await expect(header, `${stageName} header at ${viewport.width}×${viewport.height}`).toBeVisible();
      await expect(rail, `${stageName} rail at ${viewport.width}×${viewport.height}`).toBeVisible();
      await expect(center, `${stageName} center at ${viewport.width}×${viewport.height}`).toBeVisible();
      await expect(surface, `${stageName} surface at ${viewport.width}×${viewport.height}`).toBeVisible();
      await expect(inspector, `${stageName} inspector at ${viewport.width}×${viewport.height}`).toBeVisible();
      await expect(status, `${stageName} status at ${viewport.width}×${viewport.height}`).toBeVisible();
      await expectInsideViewport(page, header, `${stageName} header`);
      await expectInsideViewport(page, rail, `${stageName} workflow rail`);
      await expectInsideViewport(page, center, `${stageName} center canvas`);
      await expectInsideViewport(page, surface, `${stageName} work surface`);
      await expectInsideViewport(page, inspector, `${stageName} right inspector`);
      await expectInsideViewport(page, status, `${stageName} bottom status`);

      const documentMetrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(documentMetrics.scrollWidth, `${stageName} does not create horizontal page overflow at ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(documentMetrics.clientWidth + 1);

      const inspectorMetrics = await inspector.evaluate(element => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(inspectorMetrics.scrollWidth, `${stageName} inspector stays horizontally contained`).toBeLessThanOrEqual(inspectorMetrics.clientWidth + 1);
      if (inspectorMetrics.scrollHeight > inspectorMetrics.clientHeight + 2) {
        const before = await center.boundingBox();
        expect(before, `${stageName} center before inspector scroll has a layout box`).toBeTruthy();
        await inspector.evaluate(element => {
          element.scrollTop = Math.min(640, element.scrollHeight - element.clientHeight);
        });
        await expect.poll(() => inspector.evaluate(element => element.scrollTop), { message: `${stageName} inspector scrolls independently` }).toBeGreaterThan(0);
        const after = await center.boundingBox();
        expect(after, `${stageName} center after inspector scroll has a layout box`).toBeTruthy();
        expect(Math.abs(after!.x - before!.x) + Math.abs(after!.y - before!.y), `${stageName} inspector scroll does not move the center`).toBeLessThan(1);
      }
    }
  }
});

test('Workflow rail remains reachable on short desktop and mobile fallback exposes every stage', async ({ page }) => {
  await page.setViewportSize({ width: 901, height: 480 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  const rail = page.getByTestId('workspace-steps');
  await expect(rail).toBeVisible();
  await expect(page.locator('.stage-nav-compact')).toHaveCount(0);
  await rail.getByRole('button', { name: 'Options' }).scrollIntoViewIfNeeded();
  const optionsBox = await rail.getByRole('button', { name: 'Options' }).boundingBox();
  expect(optionsBox, 'Options button is reachable in the fixed workflow rail').toBeTruthy();
  expect(optionsBox!.y + optionsBox!.height, 'Options button scrolls inside short viewport').toBeLessThanOrEqual(481);
  await rail.getByRole('button', { name: 'Options' }).click();
  await expect(page.locator('[data-stage="options"]')).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Options' })).toHaveAttribute('aria-current', 'step');

  await page.setViewportSize({ width: 390, height: 820 });
  const mobileNav = page.getByTestId('stage-left-pane').locator('.stage-nav-compact');
  await expect(mobileNav).toHaveCount(1);
  await mobileNav.getByRole('button', { name: 'Path' }).click();
  await expect(page.getByTestId('workspace-steps')).toBeHidden();
  for (const name of ['Project', 'Character', 'Path', 'Foundry', 'Design', 'Blueprint', 'Assembly', 'Options']) {
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
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  const playerDock = page.getByTestId('workspace-player-dock');
  const scrubber = page.getByLabel('Workspace scrubber');
  await playerDock.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(playerDock.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect.poll(() => scrubber.inputValue(), {
    message: 'draw mode settles the shared scrubber at the start',
  }).toBe('0');
  const duringDraw = await scrubber.inputValue();
  await expect.poll(async () => {
    await page.waitForTimeout(100);
    return scrubber.inputValue();
  }, { message: 'shared animation stays paused during draw mode' }).toBe(duringDraw);
  await page.getByRole('button', { name: 'Drawing free path', exact: true }).click();

  await expect(playerDock).not.toHaveClass(/is-drawing/);
  const before = await scrubber.inputValue();
  await expect.poll(() => scrubber.inputValue(), { timeout: 6000, message: 'shared animation resumes after draw mode is cleared' }).not.toBe(before);
});

test('Command menu and shared canvas zoom persist across workflow stages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
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

  await page.getByTestId('command-menu-file').click();
  const dialogMessage = page.waitForEvent('dialog').then(async dialog => {
    const message = dialog.message();
    await dialog.dismiss();
    return message;
  });
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  expect(await dialogMessage).toContain('Current work will be kept in Earlier versions and a recovery copy.');
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('status-bar')).toContainText('Project unchanged');

  await page.getByTestId('command-menu-file').click();
  await recoverBrowserBackup(page, () => page.getByRole('button', { name: 'Recover' }).click());

  await page.getByRole('button', { name: /Options/i }).click();
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
  const durationField = page.getByLabel('Duration number', { exact: true });
  const durationBefore = await durationField.inputValue();
  const durationAfter = durationBefore === '6' ? '7' : '6';
  await durationField.fill(durationAfter);
  await durationField.press('Enter');
  await page.getByLabel('Show toolbar').uncheck();
  await expect(page.getByTestId('quick-toolbar')).toHaveCount(0);
  await page.getByLabel('Show toolbar').check();
  await expect(page.getByTestId('quick-toolbar')).toBeVisible();

  await page.getByTestId('top-command-bar').getByText('Edit', { exact: true }).click();
  await page.getByTestId('command-edit-undo').click();
  await expect(page.getByTestId('status-bar')).toContainText('Undo applied');
  await expect(durationField).toHaveValue(durationBefore);
  await expect(page.getByLabel('Show toolbar')).toBeChecked();
  await expect(page.getByTestId('quick-toolbar')).toBeVisible();
  await page.getByTestId('top-command-bar').getByText('Edit', { exact: true }).click();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByTestId('status-bar')).toContainText('Redo applied');
  await expect(durationField).toHaveValue(durationAfter);
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
  await expect(page.getByTestId('about-dialog')).toContainText('Projects stay local.');
  await expect(page.getByTestId('about-dialog')).toContainText('classroom static web');
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
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);

  const commandTestId = (id: AppCommandId) => commandById(id).testId ?? `command-${id.replaceAll('.', '-')}`;
  const menuGroupFor = (id: AppCommandId) => {
    const group = APP_MENU_GROUPS.find(menu => (menu.commandIds as readonly AppCommandId[]).includes(id));
    if (!group) throw new Error(`Missing menu group for ${id}`);
    return group;
  };
  const runCommand = async (id: AppCommandId) => {
    const group = menuGroupFor(id);
    const menu = page.getByTestId(`command-menu-${group.id}`);
    await expect(menu).toHaveText(group.label);
    await menu.click();
    const command = page.getByTestId(commandTestId(id));
    await expect(command, `${id} is visible in its menu`).toBeVisible();
    await command.click();
  };
  const exercised = new Set<AppCommandId>();
  const run = async (id: AppCommandId) => {
    exercised.add(id);
    await runCommand(id);
  };

  await run('stage.project');
  await expect(page.getByTestId('project-lifecycle-panel')).toBeVisible();
  await expect(page.getByTestId('project-lifecycle-panel').getByRole('button', { name: 'Save Project', exact: true })).toBeVisible();
  await run('project.keepVersion');
  await expect(page.getByTestId('status-bar')).toContainText('Version kept in this browser');
  await run('project.versions');
  await expect(page.getByTestId('earlier-versions-panel')).toBeVisible();
  await expect(page.getByTestId('earlier-versions-list').locator('[data-version-status="committed"]')).toHaveCount(1);
  await page.getByTestId('earlier-versions-close').click();
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

  for (const [id, title] of [
    ['help.findFeature', 'Find a feature'], ['help.feedback', 'Feedback'], ['help.whatsNew', "What's new"],
  ] as const) {
    await run(id);
    const panel = page.getByRole('dialog', { name: title, exact: true });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
  }

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
  const friction = page.getByLabel('Friction number', { exact: true });
  const originalFriction = await friction.inputValue();
  await friction.fill('0.87');
  await friction.press('Tab');
  await page.getByLabel('Show toolbar').uncheck();
  await run('edit.undo');
  await expect(friction).toHaveValue(originalFriction);
  await expect(page.getByLabel('Show toolbar')).not.toBeChecked();
  await run('edit.redo');
  await expect(friction).toHaveValue('0.87');
  await expect(page.getByLabel('Show toolbar')).not.toBeChecked();
  await page.getByLabel('Show toolbar').check();

  for (const id of ['project.save'] as const) {
    exercised.add(id);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      runCommand(id),
    ]);
    expect(download.suggestedFilename(), `${id} downloads a snapshot file`).toMatch(/\.motionsmith$/);
    const downloadedPath = await download.path();
    expect(downloadedPath, `${id} keeps a readable local artifact`).toBeTruthy();
    const snapshot = JSON.parse(await readFile(downloadedPath!, 'utf8'));
    expect(snapshot.format, `${id} exports the portable project format`).toBe('motionsmith-project');
    expect(snapshot.schemaVersion, `${id} exports the current portable schema`).toBe(2);
    expect(snapshot.project, `${id} wraps the project in the portable envelope`).toBeTruthy();
    expect(Object.keys(snapshot.project?.parts ?? {}).length, `${id} export preserves character parts`).toBeGreaterThan(0);
    expect(snapshot.project?.mechanisms?.length, `${id} export preserves mechanisms`).toBeGreaterThan(0);
  }
  await run('project.resetLesson');
  await expect(page.getByTestId('status-bar')).toContainText('Project unchanged');
  await recoverBrowserBackup(page, () => run('project.recoverAutosave'));
  exercised.add('project.open');
  const projectPath = await writeWavingArmLessonProject();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    runCommand('project.open'),
  ]);
  expect(chooser.isMultiple(), 'project open uses a single project-file picker').toBe(false);
  await chooser.setFiles(projectPath);
  await expect(page.getByTestId('status-bar')).toContainText(/Loaded project waving-arm\.motionsmith\.json|Project unchanged/);
  await expectProjectCounts(page, 14, 1, 1);
  exercised.add('project.new');
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('Current work will be kept in Earlier versions and a recovery copy.');
    await dialog.accept();
  });
  await runCommand('project.new');
  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await expect(page.getByTestId('status-bar')).toContainText('New project');

  expect([...exercised].sort(), 'this audit test exercises every visible menu command id').toEqual(APP_MENU_GROUPS.flatMap(group => [...group.commandIds]).sort());
});

test('guided classroom lesson opens real baseline and can reset safely', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await importWavingArmLessonProject(page, 'character');
  await expectProjectCounts(page, 14, 1, 1);
  const makeItYours = page.getByTestId('character-make-it-yours');
  await expect(makeItYours).toContainText('Edit parts');
  await expect(makeItYours).toContainText('Place joints');
  await expect(makeItYours).toHaveAttribute('data-change-cue', 'hand path');
  await expect(makeItYours).toHaveAttribute('data-build-cue', 'four-bar');
  await expect(makeItYours).not.toContainText('Change hand path');
  await expect(makeItYours).not.toContainText('Build four-bar');
  await expect(page.getByTestId('classroom-checklist')).toHaveCount(0);
  await expect(page.getByTestId('character-three-puppet-state')).toHaveAttribute('data-three-mechanism-count', '0');

  await page.getByTestId('command-menu-file').click();
  await page.getByTestId('command-reset-lesson').click();
  await expect(page.getByTestId('status-bar')).toContainText('Project unchanged');
  await expect(page.getByRole('heading', { name: 'Character' })).toBeVisible();
  await expectProjectCounts(page, 14, 1, 1);
  expectCleanPage(pageErrors, consoleErrors);
});

test('Detaching a mechanism keeps it off and exposes Blueprint recovery', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.getByRole('button', { name: 'Gear linkage', exact: true }).click();
  await expect(page.getByLabel('Mechanism instance').locator('option:checked')).toContainText('Gear linkage');
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Mechanism target').selectOption('head');
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('');
  await expect.poll(async () => (await readBrowserAutosaveProject(page))?.mechanisms[0]?.enabled).toBe(false);

  await clickStage(page, 'Blueprint');
  await expect(page.getByTestId('blueprint-control-panel')).toContainText('Gear linkage · No path · Off');
  await expect(page.getByTestId('blueprint-control-panel').getByRole('button', { name: 'Connect path for Gear linkage' })).toBeVisible();
});

test('Unfitted classroom path stays blocked until a fabrication-valid fit exists', async ({ page }) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await importProjectFile(page, await writeUnfittedWavingArmLessonProject());
  await page.getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByTestId('foundry-fit-path')).toBeEnabled();
  await page.getByTestId('foundry-fit-path').click();
  await expect(page.getByTestId('foundry-fit-path-row')).toContainText('Fit motion');
  await expect(page.getByText('No valid fabrication fit. Try a shorter path or another mechanism.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Use this mechanism/i })).toBeDisabled();
  await expect.poll(async () => {
    const mechanism = (await readBrowserAutosaveProject(page))?.mechanisms?.[0];
    return {
      status: mechanism?.fabricationMetadata?.pathFit?.status,
      generatedPath: mechanism?.generatedPath,
    };
  }).toEqual({ status: 'rejected', generatedPath: undefined });

  await clickStage(page, 'Design');
  const designPreview = page.getByTestId('design-shared-foundry-preview');
  await expect(designPreview).toHaveAttribute('data-design-fit-status', 'rejected');
  await expect(designPreview).toHaveAttribute('data-design-motion-source', 'linkage-trace');
  await expect(designPreview).toHaveAttribute('data-design-generated-path-count', '0');
  expect(Number(await designPreview.getAttribute('data-design-animated-part-count'))).toBeGreaterThan(0);
  const rejectedTargetBefore = `${await designPreview.getAttribute('data-design-target-x')},${await designPreview.getAttribute('data-design-target-y')}`;
  await page.getByLabel('Workspace scrubber').fill('35');
  await expect.poll(async () => `${await designPreview.getAttribute('data-design-target-x')},${await designPreview.getAttribute('data-design-target-y')}`, { message: 'unfitted path keeps physical Design motion while Blueprint remains blocked' }).not.toBe(rejectedTargetBefore);
  await clickStage(page, 'Blueprint');
  await expect(page.getByTestId('blueprint-control-panel')).toContainText('No fabrication-valid path fit.');
  await expect(page.getByTestId('blueprint-build-print')).toBeDisabled();
});


test('Mechanism Design library chips, target filters, delete, and enabled export work', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);
  await applyFourBarFromFoundry(page);
  await expect(page.getByTestId('design-mechanism-library')).toContainText('Four-bar linkage');
  await expect(page.getByTestId('design-visible-sensemaking')).toContainText('Crank turns');

  await page.getByRole('button', { name: 'Gear linkage', exact: true }).click();
  await expectProjectCounts(page, 14, 1, 2);
  const selectedMechanismText = await page.getByLabel('Mechanism instance').evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent ?? '');
  expect(selectedMechanismText).toContain('Gear linkage');
  await expect(page.getByTestId('design-mechanism-library')).toContainText('Gear linkage');
  await expect(page.getByTestId('design-visible-sensemaking')).toContainText('Two driven gears');
  await expect(page.getByLabel('Drive gear size')).toBeVisible();
  await expect(page.getByLabel('Paired link length')).toBeVisible();
  await expect(page.getByLabel('Mechanism target')).toHaveValue('');
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expectProjectCounts(page, 14, 1, 1);
  const remainingOptions = await page.getByLabel('Mechanism instance').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(remainingOptions.join(' ')).not.toContain('Gear linkage');

  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('All paths will be kept.');
    await dialog.accept();
  });
  await page.getByLabel('Mechanism target').selectOption('head');
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('');
  const headPathOptions = await page.getByLabel('Mechanism motion path').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(headPathOptions).toEqual(['No path']);
  await page.getByLabel('Mechanism target').selectOption('right_arm_lower');
  const armPathOptions = await page.getByLabel('Mechanism motion path').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(armPathOptions.join(' ')).toContain('Right lower arm path');
  expect(armPathOptions.join(' ')).not.toContain('pts');
  const anchorOptionValues = await page.getByLabel('Motion handle').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  expect(anchorOptionValues).toEqual(['', 'right_elbow', 'right_hand']);
  const anchorOptions = await page.getByLabel('Motion handle').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(anchorOptions.join(' ')).toContain('right elbow · 2 joints');
  expect(anchorOptions.join(' ')).toContain('right hand · 3 joints');
  expect(anchorOptions.join(' ')).not.toContain('left hand');
  await expect(page.getByLabel('Motion handle')).toHaveValue('right_hand');
  await expect(page.getByTestId('mechanism-ik-chain-summary')).toHaveCount(0);
  const armPathId = await page.getByLabel('Mechanism motion path').inputValue();
  expect(armPathId).toBeTruthy();
  await page.getByLabel('Mechanism motion path').selectOption(armPathId);

  await expect(page.getByTestId('design-shared-foundry-preview')).toHaveAttribute('data-design-motion-source', 'linkage-trace');
  const enabledCheckbox = page.locator('label').filter({ hasText: 'Enabled' }).locator('input[type="checkbox"]');
  await enabledCheckbox.uncheck();
  await expect(enabledCheckbox).not.toBeChecked();
  await clickStage(page, 'Blueprint');
  await expect(page.getByTestId('blueprint-build-print')).toBeEnabled();
  await page.getByTestId('blueprint-build-print').click();
  expect((await downloadMetadataJson(page)).recipes).toHaveLength(0);

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.locator('label').filter({ hasText: 'Enabled' }).locator('input[type="checkbox"]').check();
  await page.getByLabel('Mechanism target').selectOption('right_arm_lower');
  await page.getByLabel('Mechanism motion path').selectOption(armPathId);
  await page.getByLabel('Motion handle').selectOption('right_hand');
  await applyFourBarFromFoundry(page);
  await page.getByRole('button', { name: 'Blueprint', exact: true }).last().click();
  await expect(page.getByTestId('blueprint-build-print')).toBeEnabled();
  await page.getByTestId('blueprint-build-print').click();
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

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);
  await applyFourBarFromFoundry(page);
  const designPreview = page.getByTestId('design-shared-foundry-preview');
  await expect(designPreview).toBeVisible();
  const designRig = designPreview.getByTestId('foundry-camera-rig');
  await expect(designRig).toHaveAttribute('data-three-renderer', 'webgl');
  await expect(designRig).toHaveAttribute('data-three-stack-source', 'fabricationStackForMechanism');

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

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);
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
  await expect(designRig).toHaveAttribute('data-physics-kernel-runtime', 'idle');
  await expect(designRig).toHaveAttribute('data-physics-kernel-error', 'none');
  await expect(designRig).toHaveAttribute('data-physics-update-policy', 'kinematic-authority-rapier-contact-validation');
  await expect(designRig).toHaveAttribute('data-high-throughput-scene-policy', 'viser-style-transform-tree-batched-updates-instancing');
  await expect(designRig).toHaveAttribute('data-physics-authority', 'motionsmith-kinematics');
  await expect(designRig).toHaveAttribute('data-three-stack-source', 'fabricationStackForMechanism');
  await expect(designRig).toHaveAttribute('data-three-stack-mode', 'assembled-spacer-separated');
  await expect(designRig).toHaveAttribute('data-three-exploded', 'false');
  await expect(designRig).toHaveAttribute('data-three-spacer-key', 's10');
  await expect(designRig).toHaveAttribute('data-three-spacer-mm', '10x4');
  await expect(designPreview.locator('canvas.foundry-three-canvas')).toBeVisible();
  await page.getByTestId('design-foundry-camera-controls').getByRole('button', { name: 'Front', exact: true }).click();
  await expect(designRig).toHaveAttribute('data-camera-preset', 'front');
  await expect(designPreview).toHaveAttribute('data-design-motion-source', 'linkage-trace');
  await expect(designPreview).toHaveAttribute('data-design-fit-status', 'fit');
  expect(Number(await designPreview.getAttribute('data-design-generated-path-error'))).toBeLessThan(1);
  expect(Number(await designPreview.getAttribute('data-design-target-error'))).toBeGreaterThan(1);
  const headTarget = await waitForThreePartTarget(designRig, 'head');
  const torsoTarget = await waitForThreePartTarget(designRig, 'torso');
  const footTarget = await waitForThreePartTarget(designRig, 'right_foot_part');
  expect(headTarget.y, 'Design front view preserves Character/Path scene orientation: head stays above torso').toBeLessThan(torsoTarget.y);
  expect(torsoTarget.y, 'Design front view preserves Character/Path scene orientation: torso stays above foot').toBeLessThan(footTarget.y);
  const drivenHandBefore = await waitForThreePartTarget(designRig, 'right_hand_part');
  const designTopologyBefore = Number(await designRig.getAttribute('data-three-dynamic-build-count') ?? '0');
  const designGeometryCacheBefore = Number(await designRig.getAttribute('data-three-geometry-cache-size') ?? '0');
  const designMaterialCacheBefore = Number(await designRig.getAttribute('data-three-material-cache-size') ?? '0');
  const designPoolBefore = Number(await designRig.getAttribute('data-three-pool-size') ?? '0');
  await page.getByLabel('Workspace scrubber').fill('28');
  await expect.poll(async () => {
    const moved = (await readThreeScreenTargets(designRig, 'data-three-part-screen-targets'))
      .find(item => item.id === 'right_hand_part' && item.visible);
    return moved ? Math.hypot(moved.x - drivenHandBefore.x, moved.y - drivenHandBefore.y) : 0;
  }, { message: 'visible Design hand part follows the fitted mechanism/IK output when scrubbed' }).toBeGreaterThan(2);
  expect(Number(await designRig.getAttribute('data-three-dynamic-build-count') ?? '0'), 'Design scrub changes rigid-part transforms without rebuilding topology').toBe(designTopologyBefore);
  expect(Number(await designRig.getAttribute('data-three-geometry-cache-size') ?? '0'), 'Design scrub retains its geometry cache').toBe(designGeometryCacheBefore);
  expect(Number(await designRig.getAttribute('data-three-material-cache-size') ?? '0'), 'Design scrub retains its material cache').toBe(designMaterialCacheBefore);
  expect(Number(await designRig.getAttribute('data-three-pool-size') ?? '0'), 'Design scrub retains its object pool').toBe(designPoolBefore);
  expect(Number(await designPreview.getAttribute('data-design-target-error'))).toBeGreaterThan(1);

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
    { type: 'gear', label: 'Gear train' },
    { type: 'gear_linkage', label: 'Gear linkage' }
  ] as const;
  const readRotation = async () => Number(await designRig.getAttribute('data-pinion-rotation-deg'));

  for (const { type, label } of mechanismTemplateButtons) {
    const templateButton = page.getByRole('button', { name: label, exact: true });
    await expect(templateButton).toBeVisible();
    await expect(templateButton).toBeEnabled();
    await templateButton.scrollIntoViewIfNeeded();
    await templateButton.click();
    await expect(designRig, `${type} design automata preview uses the Foundry mechanism state`).toHaveAttribute('data-mechanism-type', type);
    await expect(designRig, `${type} design preview is renderable only after shared physical validation passes`).toHaveAttribute('data-three-preview-renderable', 'ready');
    await expect(designRig, `${type} design renderer uses the shared fabrication stack`).toHaveAttribute('data-three-stack-source', 'fabricationStackForMechanism');
    await expect(designRig, `${type} design stack stays assembled until explicitly exploded`).toHaveAttribute('data-three-exploded', 'false');
    await expect(designRig, `${type} design stack has no validation errors`).toHaveAttribute('data-three-stack-validation-errors', '0');
    await expect(designRig, `${type} design physical readiness gate is clean`).toHaveAttribute('data-three-physical-validation-errors', '0');
    expect(await designRig.getAttribute('data-three-rendered-layer-labels'), `${type} rendered labels match fabrication stack labels`).toBe(await designRig.getAttribute('data-three-stack-order'));
    const designSpacerGap = Number(await designRig.getAttribute('data-three-spacer-z-gap'));
    expect(designSpacerGap, `${type} preview has spacer clearance along z`).toBeGreaterThanOrEqual(FABRICATION_RENDER_LAYER_Z_STEP - 0.01);
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
      await anchorXInput.scrollIntoViewIfNeeded();
      await anchorXInput.fill('280');
      await anchorYInput.scrollIntoViewIfNeeded();
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
  }


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
    await page.getByTestId('command-menu-file').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('command-download-snapshot').click()
    ]);
    const path = await download.path();
    expect(path, 'project save path').toBeTruthy();
    return JSON.parse(await readFile(path!, 'utf8'));
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openFabricationReadyFourBar(page);

  await expect(page.getByTestId('view-lens-hud')).toHaveCount(0);
  await expect(page.getByTestId('toon-renderer-shell')).toHaveCount(0);
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await page.getByTestId('path-view-2d').click();
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await expect(page.getByTestId('path-three-puppet-state')).toHaveAttribute('data-camera-preset', 'front');
  await page.getByTestId('path-view-3d').click();
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await expect(page.getByTestId('path-three-puppet-state')).toHaveAttribute('data-camera-preset', 'iso');
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
  const [blueprintDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('blueprint-build-print').click()
  ]);
  expect(blueprintDownload.suggestedFilename()).toMatch(/-blueprint\.pdf$/);
  const blueprintPath = await blueprintDownload.path();
  expect(blueprintPath, 'native Blueprint PDF download path').toBeTruthy();
  const blueprintPdf = await readFile(blueprintPath!, 'latin1');
  expect(blueprintPdf).toContain('/MediaBox [0 0 864 864]');
  expect(blueprintPdf).toContain('sheet=12x12in scale=1');
  expect((blueprintPdf.match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
  await expect(page.getByTestId('blueprint-detail-preview')).toContainText('Build spot');
  await expect(page.getByTestId('blueprint-detail-preview')).toContainText('12 x 12 in / 100% scale');
  await expect(page.getByTestId('blueprint-export-package-json')).toBeAttached();
  await expect(page.getByTestId('blueprint-build-preview')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Metadata', exact: true })).toHaveCount(0);
  await expect(page.getByText('Teacher files')).toHaveCount(0);

  expectCleanPage(pageErrors, consoleErrors);
});

test('Shared path view supports 2D zoom and 3D direct orbit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
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
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await expect(state).toHaveAttribute('data-camera-preset', 'front');
  const frontCanvas = page.getByTestId('path-three-puppet-canvas');
  const frontBox = await frontCanvas.boundingBox();
  expect(frontBox, 'path front view can receive direct viewport gestures').toBeTruthy();
  const frontZoomBefore = await state.getAttribute('data-camera-zoom');
  await page.mouse.move(frontBox!.x + frontBox!.width * 0.52, frontBox!.y + frontBox!.height * 0.45);
  await page.mouse.wheel(0, -360);
  await expect(state).not.toHaveAttribute('data-camera-zoom', frontZoomBefore ?? '1.000');
});

test('Draw mode forces the front Path view and accepts free path strokes on Three', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  await page.getByTestId('path-view-3d').click();
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Draw free path', exact: true })).toHaveClass(/btn-secondary/);
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Drawing free path', exact: true })).toHaveClass(/btn-primary active/);
  await expect(page.getByTestId('path-view-2d')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
  await expect(page.getByTestId('path-three-puppet-state')).toHaveAttribute('data-camera-preset', 'front');

  await expect(page.getByTestId('view-lens-hud')).toHaveCount(0);
  await expect(page.getByTestId('toon-renderer-shell')).toHaveCount(0);

  const readFreeDrawPointCount = async () => {
    const value = await page.getByTestId('free-draw-status').getAttribute('data-point-count');
    return Number(value ?? 0);
  };
  const beforeDraw = await readFreeDrawPointCount();
  const canvasBox = await page.getByTestId('path-three-puppet-canvas').boundingBox();
  expect(canvasBox, 'path canvas box').toBeTruthy();

  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.45, canvasBox!.y + canvasBox!.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.45 + 34, canvasBox!.y + canvasBox!.height * 0.45 + 22, { steps: 4 });
  await expect(page.getByTestId('path-three-puppet-state')).toHaveAttribute('data-path-gesture-draft', 'active');
  await page.mouse.up();

  await expect(page.getByRole('button', { name: 'Draw free path', exact: true })).toHaveClass(/btn-secondary/);
  await expect(page.getByTestId('free-draw-status')).toHaveAttribute('data-draw-mode', 'idle');
  await expect.poll(
    readFreeDrawPointCount,
    { message: 'draw mode accepts pointer input on the shared front scene' }
  ).toBeGreaterThanOrEqual(3);
  const firstDrawCount = await readFreeDrawPointCount();
  expect(firstDrawCount, 'one released stroke creates a compact path').toBeLessThanOrEqual(12);

  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Drawing free path', exact: true })).toHaveClass(/btn-primary active/);
  await expect(page.getByTestId('free-draw-status')).toHaveAttribute('data-draw-mode', 'drawing');
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.62, canvasBox!.y + canvasBox!.height * 0.36);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.62 + 28, canvasBox!.y + canvasBox!.height * 0.36 + 18, { steps: 4 });
  await expect(page.getByTestId('path-three-puppet-state')).toHaveAttribute('data-path-gesture-draft', 'active');
  await page.mouse.up();

  await expect(page.getByRole('button', { name: 'Draw free path', exact: true })).toHaveClass(/btn-secondary/);
  await expect(page.getByTestId('free-draw-status')).toHaveAttribute('data-draw-mode', 'idle');
  const secondDrawCount = await readFreeDrawPointCount();
  expect(secondDrawCount, 'redraw replaces previous stroke instead of appending').toBeLessThanOrEqual(firstDrawCount + 1);
  expect(secondDrawCount, 'replacement stroke still has enough points').toBeGreaterThanOrEqual(3);
  expect(beforeDraw, 'fixture starts with an existing path so replacement is a real behavior change').toBeGreaterThan(0);
  await page.getByTestId('top-command-bar').getByText('Edit', { exact: true }).click();
  await page.getByTestId('command-edit-undo').click();
  await expect.poll(readFreeDrawPointCount, {
    message: 'one undo restores the entire prior stroke because the gesture commits once',
  }).toBe(firstDrawCount);
});

test('Path point drag stays transient and commits one undo entry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
  await dismissStartupAnnouncement(page);
  await openWavingArmTemplate(page);
  await page.getByTestId('path-view-2d').click();

  const state = page.getByTestId('path-three-puppet-state');
  type PathPointTarget = {
    id: string;
    x: number;
    y: number;
    visible: boolean;
  };
  const readTargets = async () => JSON.parse(
    await state.getAttribute('data-three-path-point-screen-targets') ?? '[]',
  ) as PathPointTarget[];
  await expect.poll(async () => (await readTargets()).filter((target) => target.visible).length)
    .toBeGreaterThan(0);
  const before = (await readTargets()).find((target) => target.visible)!;

  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x + 42, before.y + 24, { steps: 8 });
  await expect(state).toHaveAttribute('data-path-gesture-draft', 'active');
  await page.mouse.up();
  await expect(state).toHaveAttribute('data-path-gesture-draft', 'idle');

  await expect.poll(async () => {
    const moved = (await readTargets()).find((target) => target.id === before.id);
    return moved ? Math.hypot(moved.x - before.x, moved.y - before.y) : 0;
  }).toBeGreaterThan(10);

  await page.getByTestId('top-command-bar').getByText('Edit', { exact: true }).click();
  await page.getByTestId('command-edit-undo').click();
  await expect.poll(async () => {
    const restored = (await readTargets()).find((target) => target.id === before.id);
    return restored ? Math.hypot(restored.x - before.x, restored.y - before.y) : 999;
  }, {
    message: 'one undo restores the pre-gesture handle position',
  }).toBeLessThan(2);
});
