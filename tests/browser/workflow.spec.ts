import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const expectCleanPage = (pageErrors: string[], consoleErrors: string[]) => {
  expect(pageErrors, 'no uncaught browser exceptions').toEqual([]);
  expect(consoleErrors, 'no browser console errors').toEqual([]);
};

const downloadMetadataJson = async (page) => {
  const [metadataDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Metadata', exact: true }).click()
  ]);
  const metadataPath = await metadataDownload.path();
  expect(metadataPath, 'metadata download path').toBeTruthy();
  return JSON.parse(await readFile(metadataPath!, 'utf8'));
};

const openWavingArmTemplate = async (page) => {
  await page.getByRole('button', { name: /Open Waving arm/i }).click();
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
};

test('character → path → foundry → design → blueprint runs end-to-end in browser', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'MechAnim' })).toBeVisible();
  await expect(page.getByText('Draw the path. Build the motion.')).toBeVisible();
  await expect(page.getByTestId('template-gallery')).toContainText('Waving arm');
  await expect(page.getByTestId('template-gallery')).toContainText('Girl starter');
  await expect(page.getByTestId('template-gallery')).toContainText('Boy starter');
  await expect(page.getByTestId('template-gallery')).toContainText('Blank character');
  await expect(page.getByText('Local on-device processing.')).toBeVisible();
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= document.scrollingElement!.clientHeight + 8)).toBe(true);
  expect(await page.locator('.starter-thumb').evaluateAll(images => images.every(img => (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(page.getByText('parts_info.json package artifact')).toBeHidden();
  await expect(page.getByTestId('onboarding-import-input')).toBeAttached();
  const openTemplateButton = page.getByRole('button', { name: /Open Waving arm/i });
  const girlStarterButton = page.getByRole('button', { name: /Create from girl/i });
  const boyStarterButton = page.getByRole('button', { name: /Create from boy/i });
  const loadPackageButton = page.getByRole('button', { name: /Load package/i });
  const runOnnxButton = page.getByRole('button', { name: /Create from image/i });
  const cameraButton = page.getByRole('button', { name: /Capture Camera/i });
  const importProjectButton = page.getByRole('button', { name: /Import project/i });
  await page.keyboard.press('Tab');
  await expect(openTemplateButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(girlStarterButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(boyStarterButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(loadPackageButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(runOnnxButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cameraButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(importProjectButton).toBeFocused();

  const forbiddenRuntimeImports = await page.locator('script[src], script[type="importmap"]').evaluateAll(nodes =>
    nodes.map(node => ({ src: node.getAttribute('src'), type: node.getAttribute('type') }))
  );
  expect(forbiddenRuntimeImports).not.toContainEqual(expect.objectContaining({ type: 'importmap' }));
  expect(forbiddenRuntimeImports.every(item => !item.src || item.src.startsWith('/'))).toBe(true);

  await openWavingArmTemplate(page);
  await expect(page.getByTestId('workspace-steps')).toContainText('Path Editor');
  await expect(page.getByTestId('editor-sidebar')).toContainText('Shared canvas');
  await expect(page.getByTestId('shared-workbench')).toBeVisible();
  await expect(page.getByTestId('workspace-player-dock')).toBeVisible();
  await expect(page.getByTestId('novice-path-panel')).toContainText('Draw the motion path');
  await expect(page.getByText('Choose a body part, press Draw free path')).toBeVisible();
  await expect(page.getByTestId('free-draw-status')).toContainText(/5 points .*path-right-arm/);
  await expect(page.getByTestId('path-canvas').getByText('Letter sheet · 2cm grid')).toBeVisible();
  await expect(page.getByTestId('skeleton-joint-right_elbow')).toBeVisible();
  expect(await page.locator('[data-testid^="skeleton-joint-"]').count()).toBeGreaterThanOrEqual(17);

  const [projectDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Save/i }).click()
  ]);
  expect(projectDownload.suggestedFilename()).toMatch(/\.mechanim\.json$/);
  const projectDownloadPath = await projectDownload.path();
  expect(projectDownloadPath, 'project download path').toBeTruthy();
  const projectSnapshot = JSON.parse(await readFile(projectDownloadPath!, 'utf8'));
  expect(projectSnapshot.parts).toBeTruthy();
  expect(projectSnapshot.skeleton).toBeTruthy();
  expect(projectSnapshot.paths).toBeTruthy();
  expect(projectSnapshot.mechanisms).toBeTruthy();
  expect(projectSnapshot.settings).toBeTruthy();
  await page.locator('header label').filter({ hasText: 'Import' }).locator('input[type="file"]').setInputFiles(projectDownloadPath!);
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();

  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  const pathCanvas = page.getByTestId('path-canvas');
  await expect(pathCanvas).toBeVisible();
  await pathCanvas.click({ position: { x: 260, y: 220 } });
  await pathCanvas.click({ position: { x: 320, y: 250 } });
  await expect(page.getByTestId('free-draw-status')).toContainText(/7 points .*path-right-arm/);

  await page.getByRole('button', { name: /Mechanism Foundry/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Foundry' })).toBeVisible();
  await expect(page.getByText('Sandbox preview')).toBeVisible();
  await page.getByText('Mechanism options').click();
  await expect(page.getByLabel('Foundry preset')).toHaveValue('balanced');
  const foundryTargetSummary = page.getByTestId('foundry-target-summary');
  await expect(foundryTargetSummary).toBeVisible();
  await expect(foundryTargetSummary).toContainText(/anchor/);
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('Four-bar linkage');
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('Sensemaking:');
  const landingText = await foundryTargetSummary.textContent();
  const landing = landingText?.match(/Export lands at (-?\d+), (-?\d+) \(([^)]+)\)/);
  expect(landing, 'foundry export landing summary').toBeTruthy();
  await page.getByRole('button', { name: /Use this mechanism/i }).click();

  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByText('Mechanism instances')).toBeVisible();
  await expect(page.getByTestId('design-mechanism-library')).toContainText('Four-bar linkage');
  await expect(page.getByTestId('design-canvas').getByText('Letter sheet · 2cm grid')).toBeVisible();
  const persistedPathCount = await page.getByTestId('design-canvas').locator('path').evaluateAll(paths =>
    paths.filter(path => (path.getAttribute('d') ?? '').includes('M 70.00 60.00') && (path.getAttribute('d') ?? '').includes('L 130.00 84.00')).length
  );
  expect(persistedPathCount, 'drawn path persists into mechanism design canvas').toBeGreaterThan(0);
  await expect(page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]')).toHaveValue(landing![1]);
  await expect(page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]')).toHaveValue(landing![2]);
  await expect(page.getByRole('button', { name: /Fit path/i })).toBeVisible();
  const playback = page.getByRole('button', { name: /Play|Pause/ }).first();
  await expect(playback).toBeVisible();
  await expect(page.getByTestId('design-part-right_arm')).not.toHaveAttribute('transform', 'translate(98 24) rotate(18)');
  if ((await playback.textContent())?.includes('Pause')) await playback.click();
  await expect(page.getByRole('button', { name: 'SVG', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'DXF' })).toBeVisible();
  await expect(page.getByText(/1 mechanisms/)).toBeVisible();

  await page.getByRole('button', { name: /Blueprint Export/i }).click();
  await expect(page.getByRole('heading', { name: 'Blueprint Export' })).toBeVisible();
  await expect(page.getByTestId('workflow-status-strip')).toContainText('Blueprint Export');
  await expect(page.getByTestId('blueprint-canvas-preview')).toBeVisible();
  await expect(page.getByTestId('assembly-guide-preview')).toContainText('Assembly guide preview');
  await expect(page.getByText('Validation')).toBeVisible();
  await expect(page.getByText('Fabrication state ready.')).toBeVisible();
  await page.getByRole('button', { name: /Generate package/i }).click();
  await expect(page.getByText(/Default export:/)).toBeVisible();
  await expect(page.getByText(/Board (?!pending)/)).toHaveCount(1);
  await expect(page.getByTestId('assembly-guide-preview')).toContainText(/Target Right arm · path path-right-arm · anchor right_(hand|elbow)/);
  await expect(page.getByTestId('assembly-guide-preview')).toContainText('Warnings: none');
  await expect(page.getByRole('button', { name: 'JSON', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'SVG', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guide', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Metadata', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'PDF', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF cut sheet default' })).toBeVisible();
  await expect(page.getByAltText('fabrication SVG preview')).toBeVisible();

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
  const metadata = JSON.parse(metadataText);
  expect(metadata.profile.gridPitchMm).toBe(20);
  expect(metadata.profile.profileKey).toBe('letter-15x15-2cm');
  expect(metadata.recipes).toHaveLength(1);
  expect(new Set(metadata.recipes.map((recipe: { mechanismId: string }) => recipe.mechanismId)).size).toBe(1);
  expect(metadata.recipes.every((recipe: { board: unknown; sceneAnchor: unknown; boardCoordinate?: string; requiredParts?: unknown[] }) => recipe.board && recipe.sceneAnchor && recipe.boardCoordinate && recipe.requiredParts?.length)).toBe(true);
  expect(metadata.recipes.some((recipe: { targetPartId?: string; targetPathId?: string; targetAnchorJointId?: string; targetPartName?: string; steps?: string[]; warnings?: string[] }) =>
    recipe.targetPartId === 'right_arm' &&
    recipe.targetPathId === 'path-right-arm' &&
    /^right_(hand|elbow)$/.test(recipe.targetAnchorJointId ?? '') &&
    recipe.targetPartName === 'Right arm' &&
    recipe.steps?.some(step => step.includes('Connect output')) &&
    Array.isArray(recipe.warnings)
  )).toBe(true);

  const [guideDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Guide', exact: true }).click()
  ]);
  expect(guideDownload.suggestedFilename()).toMatch(/assembly\.html$/);
  const guidePath = await guideDownload.path();
  expect(guidePath, 'guide download path').toBeTruthy();
  const guideText = await readFile(guidePath!, 'utf8');
  expect(guideText).toContain('assembly guide');
  expect(guideText).toContain('Board coordinate:');
  expect(guideText).toContain('Target:');
  expect(guideText).toContain('Right arm');
  expect(guideText).toContain('path-right-arm');
  expect(guideText).toContain('right_');
  expect(guideText).toContain('Required parts');

  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'PDF', exact: true }).click()
  ]);
  expect(pdfDownload.suggestedFilename()).toMatch(/assembly\.pdf$/);
  const pdfPath = await pdfDownload.path();
  expect(pdfPath, 'pdf download path').toBeTruthy();
  const pdfHeader = (await readFile(pdfPath!)).subarray(0, 5).toString('utf8');
  expect(pdfHeader).toBe('%PDF-');

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

  const [svgDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'SVG', exact: true }).click()
  ]);
  const svgPath = await svgDownload.path();
  expect(svgPath, 'svg download path').toBeTruthy();
  const svgText = await readFile(svgPath!, 'utf8');
  expect(svgText).toContain('<metadata>');
  expect(svgText).toContain('gridPitchMm');
  expect(svgText).toContain('20');
  expect(svgText).toContain('Sample articulated character');
  metadata.recipes.forEach((recipe: { mechanismId: string }) => expect(svgText).toContain(recipe.mechanismId));

  await page.getByRole('button', { name: /Options/i }).click();
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
  await expect(page.getByTestId('options-fabrication')).toBeVisible();
  await expect(page.getByLabel('Default export format')).toHaveValue('both');

  expectCleanPage(pageErrors, consoleErrors);
});

test('Character Selection processing controls route to real browser workflows', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await expect(page.getByTestId('character-processing-panel')).toContainText('Processing Steps');
  await page.getByText('Advanced import tools').click();

  const skeletonChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Process Image (Skeleton)', exact: true }).click();
  expect((await skeletonChooserPromise).isMultiple()).toBe(false);

  const bodyPartsChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Generate Body Parts', exact: true }).click();
  expect((await bodyPartsChooserPromise).isMultiple()).toBe(false);

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

  await page.getByRole('button', { name: 'Edit Parts / Skeleton / Boxes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
  await page.getByText('Advanced part setup').click();
  await expect(page.getByLabel('Edit joint')).toBeVisible();

  expectCleanPage(pageErrors, consoleErrors);
});

test('Create from image upload creates a reviewed character package in browser', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'MechAnim' })).toBeVisible();
  const runOnnxButton = page.getByRole('button', { name: /Create from image/i });
  await runOnnxButton.focus();
  await expect(runOnnxButton).toBeFocused();
  const [onnxChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.keyboard.press('Enter')
  ]);
  await onnxChooser.setFiles('tests/fixtures/stick-character.png');

  await expect(page.getByText('review generated package')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/parts · .*joints · ready to review/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept package' })).toBeVisible();

  await page.getByRole('button', { name: 'Accept package' }).click();
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
  await expect(page.getByTestId('novice-path-panel')).toContainText('Draw the motion path');
  await expect(page.getByText('Choose a body part, press Draw free path')).toBeVisible();
  await expect(page.getByText(/0 mechanisms/)).toBeVisible();

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
  await expect(page.getByRole('heading', { name: 'MechAnim' })).toBeVisible();

  const packageFiles = [
    'tests/fixtures/package/parts_info.json',
    'tests/fixtures/package/char_cfg.yaml',
    'tests/fixtures/package/body.png'
  ];
  const loadPackageButton = page.getByRole('button', { name: /Load package/i });
  await loadPackageButton.focus();
  await expect(loadPackageButton).toBeFocused();
  const [packageChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.keyboard.press('Enter')
  ]);
  await packageChooser.setFiles(packageFiles);
  await expect(page.getByText('review generated package')).toBeVisible();
  await expect(page.getByText('Character package ready. Review before accepting.')).toBeVisible();
  await expect(page.getByText('SVG provenance metadata present')).toBeHidden();
  await expect(page.getByText('Technical checks')).toBeVisible();
  await page.getByText('Technical checks').click();
  await expect(page.getByText('SVG provenance metadata present')).toBeVisible();
  await expect(page.getByText('plain load clears stale mechanisms')).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText('review generated package')).toHaveCount(0);

  await page.getByTestId('blank-package-input').setInputFiles(packageFiles);
  await expect(page.getByText('review generated package')).toBeVisible();
  await page.getByRole('button', { name: 'Accept package' }).click();
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
  await expect(page.getByText(/1 parts .* 0 paths .* 0 mechanisms/)).toBeVisible();
  await expect(page.getByText('No path for this part yet. Draw or track a path before fitting a mechanism.')).toBeVisible();

  await page.getByRole('button', { name: /Character Selection/i }).click();
  await page.getByTestId('blank-package-input').setInputFiles('tests/fixtures/package/char_cfg.yaml');
  await expect(page.getByRole('heading', { name: 'MechAnim' })).toBeVisible();
  await expect(page.getByText('Character package import failed')).toBeVisible();
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
  await expect(page.getByText(/6 parts .* 1 paths .* 1 mechanisms/)).toBeVisible();
  await page.getByRole('button', { name: /Character Selection/i }).click();
  await page.getByLabel('Replace current character and preserve compatible mechanisms').check();
  await page.getByTestId('blank-package-input').setInputFiles([
    'tests/fixtures/package-compatible/parts_info.json',
    'tests/fixtures/package-compatible/char_cfg.yaml',
    'tests/fixtures/package-compatible/body.png'
  ]);
  await expect(page.getByText('review generated package')).toBeVisible();
  await expect(page.getByText('1 mechanisms preserved; 1 matching paths rebound.')).toBeVisible();
  await expect(page.getByText('replacement preserves compatible mechanisms')).toBeHidden();
  await page.getByText('Technical checks').click();
  await expect(page.getByText('replacement preserves compatible mechanisms')).toBeVisible();
  await page.getByRole('button', { name: 'Accept package' }).click();

  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByText(/1 parts .* 1 paths .* 1 mechanisms/)).toBeVisible();
  await expect(page.getByText('Mechanism instances')).toBeVisible();
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
  await page.getByRole('button', { name: /Options/i }).click();
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
  await page.getByLabel('Grid pitch mm number').fill('25');
  await page.getByLabel('Grid pitch mm number').press('Enter');
  await page.getByLabel('Default export format').selectOption('json');
  await expect(page.getByLabel('Default export format')).toHaveValue('json');

  await page.getByRole('button', { name: /Path Editor/i }).click();
  await expect(page.getByTestId('path-canvas').getByText('Letter sheet · 2.5cm grid')).toBeVisible();
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByTestId('design-canvas').getByText('Letter sheet · 2.5cm grid')).toBeVisible();
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').fill('0');
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').press('Enter');
  await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').fill('100');
  await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').press('Enter');
  await page.getByRole('button', { name: /Blueprint Export/i }).click();
  await expect(page.getByText('Fabrication state ready.')).toBeVisible();
  await page.getByRole('button', { name: /Generate package/i }).click();
  await expect(page.getByRole('button', { name: 'Download JSON default' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download SVG default' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'SVG', exact: true })).toBeVisible();

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
  await page.getByRole('button', { name: /Blueprint Export/i }).click();
  await expect(page.getByTestId('blueprint-control-panel').getByText(/anchor off grid/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Snap anchor to board hole/ })).toBeVisible();
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
  await page.getByRole('button', { name: /Options/i }).click();
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
  for (const section of ['appearance', 'simulation', 'performance', 'debugging', 'workflow', 'fabrication', 'units']) {
    await expect(page.getByTestId(`options-${section}`)).toBeVisible();
  }

  await page.getByLabel('Theme').selectOption('dark');
  await expect(page.locator('main[data-theme="dark"]')).toBeVisible();
  await page.getByLabel('Show toolbar').uncheck();
  await expect(page.getByTestId('quick-toolbar')).toHaveCount(0);
  await page.getByLabel('Show toolbar').check();
  await expect(page.getByTestId('quick-toolbar')).toBeVisible();

  await page.getByLabel('Show Part Properties Panel').uncheck();
  await page.getByRole('button', { name: /Path Editor/i }).click();
  await expect(page.getByTestId('novice-path-panel')).toHaveCount(0);
  await expect(page.getByTestId('path-canvas')).toBeVisible();
  await page.getByRole('button', { name: /Options/i }).click();
  await page.getByLabel('Show Part Properties Panel').check();

  await page.getByLabel('Enable Debug Visuals').check();
  await page.getByRole('button', { name: /Path Editor/i }).click();
  await expect(page.getByTestId('canvas-debug-visuals')).toBeVisible();
  await page.getByRole('button', { name: /Options/i }).click();

  await page.getByLabel('Enable autosave').check();
  await page.getByLabel('Autosave interval seconds number').fill('1');
  await page.getByLabel('Autosave interval seconds number').press('Enter');
  await page.getByLabel('Animation Duration number').fill('6');
  await page.getByLabel('Animation Duration number').press('Enter');
  await page.getByLabel('Timing profile').selectOption('ease-in-out');
  await page.getByLabel('Performance preset').selectOption('high');
  await page.getByLabel('Physics snap mode').selectOption('high');
  await page.getByLabel('Show Detailed Processing Steps').check();
  await page.getByLabel('Cut-sheet file type').selectOption('svg');
  await page.getByLabel('Grid unit system').selectOption('inch');
  await page.getByLabel('Board profile').selectOption('letter-12x12-2cm');
  await page.getByLabel('Grid pitch mm number').fill('25');
  await page.getByLabel('Grid pitch mm number').press('Enter');
  await page.getByLabel('Default export format').selectOption('json');
  await expect(page.getByTestId('grid-cell-readout')).toContainText('0.98 in');

  await expect.poll(async () => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('mechanim.autosave') ?? '{}');
    return {
      autosave: saved.settings?.autosave,
      interval: saved.settings?.autosaveIntervalSeconds,
      duration: saved.settings?.animationDurationMs,
      timing: saved.settings?.timingProfile,
      performance: saved.settings?.performancePreset,
      snap: saved.settings?.physicsSnapMode,
      detailed: saved.settings?.detailedProcessingSteps,
      unit: saved.settings?.gridUnit,
      profile: saved.settings?.physicalKit?.profileKey,
      pitch: saved.settings?.physicalKit?.gridPitchMm,
      cutSheet: saved.settings?.physicalKit?.cutSheetFileType
    };
  }), { timeout: 5000 }).toEqual({
    autosave: true,
    interval: 1,
    duration: 6000,
    timing: 'ease-in-out',
    performance: 'high',
    snap: 'high',
    detailed: true,
    unit: 'inch',
    profile: 'letter-12x12-2cm',
    pitch: 25,
    cutSheet: 'svg'
  });

  await page.getByRole('button', { name: /Path Editor/i }).click();
  await expect(page.getByTestId('scene-grid-label')).toContainText('Letter sheet · 2.5cm grid');
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByTestId('design-canvas').getByTestId('scene-grid-label')).toContainText('Letter sheet · 2.5cm grid');
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').fill('0');
  await page.locator('label').filter({ hasText: 'anchor X' }).locator('input[type="number"]').press('Enter');
  await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').fill('100');
  await page.locator('label').filter({ hasText: 'anchor Y' }).locator('input[type="number"]').press('Enter');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('mechanim.autosave') ?? '{}')?.mechanisms?.[0]?.anchorX), { timeout: 5000 }).toBe(0);
  await page.getByRole('button', { name: /Blueprint Export/i }).click();
  await page.getByRole('button', { name: /Generate package/i }).click();
  await expect(page.getByRole('button', { name: 'Download JSON default' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download SVG default' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download SVG cut sheet default' })).toBeVisible();
  const metadata = await downloadMetadataJson(page);
  expect(metadata.profile.profileKey).toBe('letter-12x12-2cm');
  expect(metadata.profile.boardCells).toBe(12);
  expect(metadata.profile.gridPitchMm).toBe(25);
  expect(metadata.profile.cutSheetFileType).toBe('svg');
  await page.getByRole('button', { name: /Character Selection/i }).click();
  await expect(page.getByTestId('processing-step-details')).toContainText('Normalize to the physical sheet');

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
  await expect(page.getByText('No path for this part yet. Draw or track a path before fitting a mechanism.')).toBeVisible();

  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
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
  await expect(page.getByRole('button', { name: /Next: choose mechanism/i })).toBeEnabled();
  await page.getByRole('button', { name: 'Drawing free path', exact: true }).click();

  await page.getByLabel('Selected body part').selectOption('right_arm');
  await expect(page.getByTestId('free-draw-status')).toContainText(/5 points .*path-right-arm/);
  await expect(page.getByText('No path for this part yet. Draw or track a path before fitting a mechanism.')).toHaveCount(0);
  await expect(page.getByTestId('quick-rig-helper')).toContainText('Easy IK setup');
  await expect(page.getByLabel('Anchor point')).toHaveValue('right_shoulder');
  await expect(page.getByLabel('IK handle')).toHaveValue('right_hand');
  await page.getByRole('button', { name: 'Fold left', exact: true }).click();
  await expect(page.getByTestId('fold-direction-control')).toContainText('left');
  await page.getByLabel('IK handle').selectOption('right_elbow');
  await expect(page.getByLabel('IK handle')).toHaveValue('right_elbow');
  await expect(page.getByTestId('path-shape-controls')).toBeVisible();
  await page.getByRole('button', { name: 'Closed', exact: true }).click();
  await expect(pathCanvas.locator('path[stroke="#5a6cff"]').first()).toHaveAttribute('d', /Z$/);
  await page.getByLabel('Smoothness number').fill('70');
  await page.getByLabel('Smoothness number').press('Enter');
  await expect(pathCanvas.locator('path[stroke="#5a6cff"]').first()).toHaveAttribute('d', /Q/);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(pathCanvas.locator('path[stroke="#5a6cff"]').first()).not.toHaveAttribute('d', /Z$/);

  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  const firstArmPoint = pathCanvas.locator('circle[stroke="#5a6cff"]').first();
  const firstArmPointBox = await firstArmPoint.boundingBox();
  expect(firstArmPointBox, 'first arm point can start a free-draw stroke').toBeTruthy();
  await page.mouse.move(firstArmPointBox!.x + firstArmPointBox!.width / 2, firstArmPointBox!.y + firstArmPointBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstArmPointBox!.x + firstArmPointBox!.width / 2 + 34, firstArmPointBox!.y + firstArmPointBox!.height / 2 + 18);
  await page.mouse.up();
  await expect(page.getByTestId('free-draw-status')).toContainText(/7 points .*path-right-arm/);

  await page.getByText('Path options').click();
  const stopButtonBeforePreview = page.getByRole('button', { name: /Stop/i });
  if (await stopButtonBeforePreview.count()) await stopButtonBeforePreview.click();
  const armTransformBeforePlay = await page.getByTestId('path-part-right_arm').getAttribute('transform');
  await page.getByRole('button', { name: /Play/i }).click();
  await expect(page.getByText('IK target')).toBeVisible();
  await expect(page.getByTestId('path-part-right_arm')).not.toHaveAttribute('transform', armTransformBeforePlay ?? '');
  await page.getByRole('button', { name: /Stop/i }).click();
  await page.getByText('Advanced part setup').click();
  const partLocked = page.locator('label').filter({ hasText: 'Locked' }).first().locator('input[type="checkbox"]');
  await partLocked.check();
  await expect(page.getByRole('button', { name: 'Drawing free path', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Track from video', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Clear path', exact: true })).toBeDisabled();
  await expect(page.getByLabel('X number').first()).toBeDisabled();
  await page.getByTestId('path-canvas').click({ position: { x: 260, y: 220 } });
  await expect(page.getByTestId('free-draw-status')).toContainText(/7 points .*path-right-arm.*locked part/);

  await partLocked.uncheck();
  await page.locator('label').filter({ hasText: 'Selected part anchor' }).locator('select').selectOption('right_elbow');
  await expect(page.locator('label').filter({ hasText: 'Selected part anchor' }).locator('select')).toHaveValue('right_elbow');
  await page.getByRole('button', { name: /Mechanism Foundry/i }).click();
  await expect(page.getByTestId('foundry-target-summary')).toContainText('anchor right_elbow');
  await expect(page.getByTestId('foundry-target-summary')).toContainText('IK handle right_elbow');

  expectCleanPage(pageErrors, consoleErrors);
});

test('Mechanism Foundry sensemaking shows library, partial range, and exported metadata', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Mechanism Foundry/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Foundry' })).toBeVisible();
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('Four-bar linkage');
  await expect(page.getByTestId('foundry-feasibility')).toContainText('360° valid sampled motion');
  await expect(page.getByTestId('foundry-target-summary')).toContainText('Valid Range: 360° valid');
  await expect(page.getByTestId('foundry-target-summary')).toContainText(/Motion Point: \d+, \d+/);
  await expect(page.getByLabel('Foundry mechanism type')).toBeHidden();
  await page.getByText('Mechanism options').click();

  await page.getByLabel('Foundry mechanism type').selectOption('gear');
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('Gear train');
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('ratio sign');
  await page.getByLabel('Foundry mechanism type').selectOption('4bar');
  await page.getByLabel('Foundry preset').selectOption('compact');
  await expect(page.getByTestId('foundry-target-summary')).toContainText('smaller footprint');
  await expect(page.getByLabel('ground number')).toHaveValue('120');
  await page.getByLabel('Foundry preset').selectOption('balanced');
  await expect(page.getByTestId('foundry-target-summary')).toContainText('general purpose linkage');
  await expect(page.getByLabel('ground number')).toHaveValue('180');
  await page.getByLabel('Foundry preset').selectOption('compact');

  for (const label of ['ground', 'crank', 'coupler', 'rocker / gear']) {
    await page.getByLabel(`${label} number`, { exact: true }).fill('30');
  }
  await expect(page.getByTestId('foundry-feasibility')).toContainText(/Partial motion \d+%/);
  await page.getByRole('button', { name: /Use this mechanism/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('design-mechanism-library')).toContainText('Four-bar linkage');
  await expect(page.getByTestId('design-feasibility')).toContainText(/Partial motion \d+%/);

  await page.getByRole('button', { name: /Blueprint Export/i }).click();
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeEnabled();
  await page.getByRole('button', { name: /Generate package/i }).click();
  const metadata = await downloadMetadataJson(page);
  const foundryMechanism = metadata.sceneSnapshot.mechanisms.find((mechanism: { source?: string }) => mechanism.source === 'foundry');
  expect(foundryMechanism.presetId).toBe('compact');
  expect(foundryMechanism.targetAnchorJointId).toBe('right_hand');
  expect(foundryMechanism.recommendation).toContain('smaller footprint');
  expect(foundryMechanism.foundryExport.simulationSummary).toContain('Partial motion');

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
  await page.getByText('Advanced part setup').click();

  const selectedPart = page.getByLabel('Selected body part');
  await selectedPart.selectOption('right_arm');
  await page.getByRole('button', { name: /Add layer/i }).click();
  const copiedPartId = await selectedPart.evaluate((select: HTMLSelectElement) => select.value);
  const copiedPartText = await selectedPart.evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent ?? '');
  expect(copiedPartId).toContain('part-');
  expect(copiedPartText).toContain('copy');

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  const designPartOptions = await page.getByLabel('Mechanism target part').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(designPartOptions.join(' ')).toContain('copy');

  await page.getByRole('button', { name: /Path Editor/i }).click();
  await page.getByText('Advanced part setup').click();
  await page.getByRole('button', { name: /Remove layer/i }).click();
  await expect(selectedPart).not.toHaveValue(copiedPartId);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  const designPartOptionsAfterRemove = await page.getByLabel('Mechanism target part').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(designPartOptionsAfterRemove.join(' ')).not.toContain(copiedPartText);

  await page.getByRole('button', { name: /Path Editor/i }).click();
  await page.getByLabel('Selected body part').selectOption('right_arm');
  await page.getByText('Advanced part setup').click();
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
  await page.getByLabel('Mechanism target part').selectOption('right_arm');
  const anchorOptionsWithJoint = await page.getByLabel('Mechanism target anchor').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  expect(anchorOptionsWithJoint).toContain(newJointId);

  await page.getByRole('button', { name: /Path Editor/i }).click();
  await page.getByText('Advanced part setup').click();
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
  await page.getByRole('button', { name: /Get recommendations/i }).click();
  await expect(page.getByTestId('recommendation-sheet')).toBeVisible();
  await expect(page.getByTestId('recommendation-sheet')).toContainText('Mechanism Recommendations for Right arm');
  await expect(page.getByTestId('recommendation-card-4bar')).toBeVisible();
  await page.getByTestId('recommendation-sheet').getByRole('button', { name: /Apply this/i }).first().click();
  await expect(page.getByTestId('recommendation-sheet')).toHaveCount(0);
  const mechanismOptions = await page.getByLabel('Mechanism instance').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.value));
  expect(mechanismOptions).toHaveLength(initialMechanisms + 1);
  expect(new Set(mechanismOptions).size).toBe(mechanismOptions.length);

  await page.getByRole('button', { name: /Blueprint Export/i }).click();
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeEnabled();
  await page.getByRole('button', { name: /Generate package/i }).click();
  const metadata = await downloadMetadataJson(page);
  expect(metadata.recipes).toHaveLength(initialMechanisms + 1);
  expect(new Set(metadata.recipes.map((recipe: { mechanismId: string }) => recipe.mechanismId)).size).toBe(initialMechanisms + 1);
  expect(metadata.sceneSnapshot.mechanisms.some((mechanism: { presetId?: string; source?: string }) => mechanism.source === 'optimized' && mechanism.presetId?.startsWith('recommendation-'))).toBe(true);

  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.getByRole('button', { name: /Get recommendations/i }).click();
  await expect(page.getByTestId('recommendation-sheet')).toBeVisible();
  const enabledApplyButtons = page.getByTestId('recommendation-sheet').locator('button.btn-primary:not(:disabled)');
  await expect(enabledApplyButtons.first()).toBeVisible();
  expect(await enabledApplyButtons.count(), 'at least two fabrication-ready recommendations').toBeGreaterThan(1);
  await enabledApplyButtons.nth(1).click();
  await page.getByRole('button', { name: /Blueprint Export/i }).click();
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeEnabled();

  expectCleanPage(pageErrors, consoleErrors);
});

test('Foundry toolbar toggles preview, forces, velocity, trail, and sensemaking', async ({ page }) => {
  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Mechanism Foundry/i }).click();

  await expect(page.getByTestId('foundry-toolbar')).toBeVisible();
  await expect(page.getByTestId('foundry-path-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Path Preview' }).click();
  await expect(page.getByTestId('foundry-path-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Trail' }).click();
  await expect(page.getByTestId('foundry-trail-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Forces' }).click();
  await expect(page.getByTestId('foundry-forces-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Velocity' }).click();
  await expect(page.getByTestId('foundry-velocity-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Show Sensemaking' }).click();
  await expect(page.getByTestId('foundry-mechanism-library')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to Gallery' }).click();
  await expect(page.getByTestId('foundry-mechanism-library')).toContainText('Sensemaking:');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByTestId('foundry-toolbar-state')).toContainText('playing');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByTestId('foundry-toolbar-state')).toContainText('paused');
});

test('Camera capture dialog uses browser getUserMedia and reports permission denial', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException('Permission denied', 'NotAllowedError');
        }
      }
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Capture Camera/i }).click();
  await expect(page.getByTestId('camera-dialog')).toBeVisible();
  await expect(page.getByTestId('camera-error')).toContainText('Camera permission denied');
  await expect(page.getByRole('button', { name: /Capture frame/i })).toBeDisabled();
});

test('Camera capture waits for live preview and stops stream after handoff', async ({ page }) => {
  await page.addInitScript(() => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
    const stops: string[] = [];
    (window as unknown as { __cameraStops: string[] }).__cameraStops = stops;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => stops.push('stopped') }]
        })
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      get() {
        return (this as HTMLVideoElement & { __stream?: unknown }).__stream;
      },
      set(value) {
        const video = this as HTMLVideoElement & { __stream?: unknown };
        video.__stream = value;
        window.setTimeout(() => {
          Object.defineProperty(video, 'videoWidth', { configurable: true, value: 16 });
          Object.defineProperty(video, 'videoHeight', { configurable: true, value: 16 });
          video.dispatchEvent(new Event('loadedmetadata'));
          video.dispatchEvent(new Event('canplay'));
        }, 0);
      }
    });
    HTMLMediaElement.prototype.play = async () => undefined;
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type: string, options?: unknown) {
      const ctx = originalGetContext.call(this, type, options as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
      if (type === '2d' && ctx) ctx.drawImage = (() => undefined) as CanvasRenderingContext2D['drawImage'];
      return ctx;
    } as HTMLCanvasElement['getContext'];
    HTMLCanvasElement.prototype.toBlob = function(callback: BlobCallback, type?: string) {
      const bytes = Uint8Array.from(atob(png), char => char.charCodeAt(0));
      callback(new Blob([bytes], { type: type ?? 'image/png' }));
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Capture Camera/i }).click();
  await expect(page.getByTestId('camera-dialog')).toBeVisible();
  await expect(page.getByText(/Camera Ready/i)).toBeVisible();
  await page.getByRole('button', { name: /Capture frame/i }).click();
  await expect(page.getByTestId('camera-dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __cameraStops: string[] }).__cameraStops.length)).toBeGreaterThan(0);
});

test('Mobile path editor keeps Draw free path action above the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openWavingArmTemplate(page);

  const drawButton = page.getByRole('button', { name: 'Draw free path', exact: true });
  const canvas = page.getByTestId('path-canvas');
  await expect(drawButton).toBeVisible();
  await expect(canvas).toBeVisible();
  const drawBox = await drawButton.boundingBox();
  const canvasBox = await canvas.boundingBox();
  expect(drawBox, 'draw button layout box').toBeTruthy();
  expect(canvasBox, 'path canvas layout box').toBeTruthy();
  expect(drawBox!.y, 'mobile draw action appears before canvas').toBeLessThan(canvasBox!.y);
});

test('Shared player dock stays inside the editor content at medium desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: 'Rail mechanism parameters' }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();

  const railBox = await page.getByTestId('editor-sidebar').boundingBox();
  const dockBox = await page.getByTestId('workspace-player-dock').boundingBox();
  expect(railBox, 'sidebar layout box').toBeTruthy();
  expect(dockBox, 'player dock layout box').toBeTruthy();
  expect(dockBox!.x, 'player dock does not overlap the fixed sidebar').toBeGreaterThanOrEqual(railBox!.x + railBox!.width);
});

test('Animation resumes after leaving path drawing mode', async ({ page }) => {
  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: 'Draw free path', exact: true }).click();
  await page.getByRole('button', { name: 'Mechanism Design' }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();

  const scrubber = page.getByLabel('Workspace scrubber');
  const before = await scrubber.inputValue();
  await expect.poll(() => scrubber.inputValue(), { timeout: 1500 }).not.toBe(before);
});

test('Command menu and shared canvas zoom persist across workflow stages', async ({ page }) => {
  await page.goto('/');
  await openWavingArmTemplate(page);

  await expect(page.getByTestId('top-command-bar')).toBeVisible();
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('100%');
  await page.getByLabel('Zoom in').click();
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('120%');

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('canvas-zoom-readout')).toHaveText('120%');

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

  await page.evaluate(() => localStorage.setItem('mechanim.workspace', JSON.stringify({
    stage: 'not-a-stage',
    viewport: { offset: { x: 'bad', y: 0 }, zoom: -10 },
    toolbarVisible: 'yes'
  })));
  await page.getByTestId('top-command-bar').getByText('View', { exact: true }).click();
  await page.getByRole('button', { name: 'Restore Workspace Layout' }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('status-bar')).toContainText('ignored invalid workspace viewport');
  await expect(page.getByTestId('status-bar')).toContainText('ignored invalid workspace stage');

  await page.getByTestId('top-command-bar').getByText('File', { exact: true }).click();
  let dialogMessage = '';
  page.once('dialog', async dialog => {
    dialogMessage = dialog.message();
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'New', exact: true }).click();
  expect(dialogMessage).toContain('Start a new project');
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect(page.getByTestId('status-bar')).toContainText('New project cancelled');

  await page.getByTestId('top-command-bar').getByText('File', { exact: true }).click();
  await page.getByRole('button', { name: 'Recover Autosave…' }).click();
  await expect(page.getByTestId('status-bar')).toContainText(/No autosave snapshot found|Recovered autosave snapshot/);

  await page.getByTestId('top-command-bar').getByText('Edit', { exact: true }).click();
  await page.getByRole('button', { name: 'Back (Undo)' }).click();
  await expect(page.getByTestId('status-bar')).toContainText('Undo is not available in the browser build yet.');
});

test('Detached visible mechanisms block browser blueprint generation', async ({ page }) => {
  await page.goto('/');
  await openWavingArmTemplate(page);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.getByRole('button', { name: 'piston', exact: true }).click();
  await page.getByLabel('Mechanism target part').selectOption('head');
  await expect(page.getByLabel('Mechanism target path')).toHaveValue('');

  await page.getByRole('button', { name: /Blueprint Export/i }).click();
  await expect(page.getByTestId('blueprint-control-panel').getByText(/choose a target part and path before blueprint export/)).toBeVisible();
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
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByTestId('design-mechanism-library')).toContainText('Four-bar linkage');

  await page.getByRole('button', { name: 'piston', exact: true }).click();
  await expect(page.getByText(/2 mechanisms/)).toBeVisible();
  const selectedMechanismText = await page.getByLabel('Mechanism instance').evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent ?? '');
  expect(selectedMechanismText).toContain('piston');
  await expect(page.getByTestId('design-mechanism-library')).toContainText('Slider piston');
  await expect(page.getByLabel('slider offset number')).toBeVisible();
  await expect(page.getByLabel('rod length number')).toBeVisible();

  await page.getByLabel('Mechanism target part').selectOption('head');
  await expect(page.getByLabel('Mechanism target path')).toHaveValue('');
  const headPathOptions = await page.getByLabel('Mechanism target path').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(headPathOptions).toEqual(['No target path']);
  await page.getByLabel('Mechanism target part').selectOption('right_arm');
  const armPathOptions = await page.getByLabel('Mechanism target path').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(armPathOptions.join(' ')).toContain('path-right-arm · 5 pts');
  const anchorOptions = await page.getByLabel('Mechanism target anchor').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(anchorOptions).toEqual(['Part anchor default', 'right_shoulder', 'right_elbow', 'right_hand']);
  expect(anchorOptions.join(' ')).not.toContain('left_hand');
  await expect(page.getByLabel('Mechanism target anchor')).toHaveValue('right_hand');
  await page.getByLabel('Mechanism target path').selectOption('path-right-arm');

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(/1 mechanisms/)).toBeVisible();
  const remainingOptions = await page.getByLabel('Mechanism instance').evaluate((select: HTMLSelectElement) => Array.from(select.options).map(option => option.textContent ?? ''));
  expect(remainingOptions.join(' ')).not.toContain('piston');

  await page.locator('label').filter({ hasText: 'Enabled' }).locator('input[type="checkbox"]').uncheck();
  await page.getByRole('button', { name: /Blueprint Export/i }).click();
  await expect(page.getByTestId('blueprint-control-panel').getByText('No enabled mechanism to export.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Generate package/i })).toBeDisabled();

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await page.locator('label').filter({ hasText: 'Enabled' }).locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Export Blueprint', exact: true }).click();
  await page.getByRole('button', { name: /Generate package/i }).click();
  expect((await downloadMetadataJson(page)).recipes).toHaveLength(1);

  expectCleanPage(pageErrors, consoleErrors);
});
