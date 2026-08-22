import { expect, test, type Locator, type Page } from '@playwright/test';

const nextTwoFrames = (page: Page) =>
  page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));

const openWavingArm = async (page: Page) => {
  await page.goto('/');
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
  const dialog = page.getByTestId('getting-started-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('getting-started-card-guided').click();
  await dialog.getByTestId('guided-project-card-waving-arm').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-stage="character"]')).toBeVisible();
};

const numericAttribute = async (locator: Locator, name: string) =>
  Number(await locator.getAttribute(name) ?? '0');

const stableSubmissionCount = async (page: Page, rig: Locator) => {
  let previous = -1;
  let stableChecks = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await nextTwoFrames(page);
    const current = await numericAttribute(rig, 'data-three-render-submissions');
    stableChecks = current > 0 && current === previous ? stableChecks + 1 : 0;
    if (stableChecks >= 4) return current;
    previous = current;
  }
  throw new Error('Foundry render submissions did not settle');
};

test('retained Three scenes batch the grid and submit one render per camera move', async ({ page }) => {
  await openWavingArm(page);

  const characterState = page.getByTestId('character-three-puppet-state');
  await expect(characterState).toHaveAttribute('data-three-topology-ready', 'true');
  await expect(characterState).toHaveAttribute('data-three-grid-draw-object-count', '1');
  expect(
    await numericAttribute(characterState, 'data-three-grid-segment-count'),
    'the single grid draw object retains every physical board line',
  ).toBeGreaterThan(1);
  expect(
    await numericAttribute(characterState, 'data-three-part-texture-count'),
    'the guided Character retains real part artwork for the resource-settlement check',
  ).toBeGreaterThan(0);
  await expect(characterState).toHaveAttribute(
    'data-three-pending-initial-scene-resources',
    '0',
  );
  await expect(characterState).toHaveAttribute(
    'data-three-initial-scene-resource-upload',
    'complete',
  );
  await stableSubmissionCount(page, characterState);
  const characterResourcesBeforeOrbit = {
    geometries: await numericAttribute(characterState, 'data-three-renderer-geometry-count'),
    textures: await numericAttribute(characterState, 'data-three-renderer-texture-count'),
  };
  expect(characterResourcesBeforeOrbit.geometries).toBeGreaterThan(0);
  expect(characterResourcesBeforeOrbit.textures).toBeGreaterThan(0);

  const characterPreview = page.getByTestId('character-three-puppet');
  await expect(
    characterPreview,
    'the production preview publishes readiness only after its exact retained scene is submitted',
  ).toHaveAttribute('data-three-initial-scene-ready', 'true');
  const characterHost = characterPreview.locator('.three-puppet-host');
  await expect(characterState).toHaveAttribute('data-three-render-submissions', /[1-9]\d*/);
  const characterBox = await characterHost.boundingBox();
  if (!characterBox) throw new Error('Character preview has no bounds');
  const characterStart = {
    x: characterBox.x + characterBox.width * 0.54,
    y: characterBox.y + characterBox.height * 0.52,
  };
  await page.mouse.move(characterStart.x, characterStart.y);
  await page.mouse.down();
  const characterBeforeMove = await stableSubmissionCount(page, characterState);
  const characterYawBefore = await characterState.getAttribute('data-camera-yaw');
  await page.mouse.move(characterStart.x + 64, characterStart.y - 24);
  await expect.poll(
    () => numericAttribute(characterState, 'data-three-render-submissions'),
    { message: 'one Character camera move reaches the retained Three scene' },
  ).toBe(characterBeforeMove + 1);
  await nextTwoFrames(page);
  expect(
    await numericAttribute(characterState, 'data-three-render-submissions'),
    'Character camera invalidation is coalesced into one renderer submission',
  ).toBe(characterBeforeMove + 1);
  await page.mouse.up();
  await expect(
    characterState,
    'Character commits the durable camera value once when the gesture ends',
  ).not.toHaveAttribute('data-camera-yaw', characterYawBefore ?? '');
  expect(
    await numericAttribute(characterState, 'data-three-render-submissions'),
    'the final React camera commit reuses the already-applied transient view',
  ).toBe(characterBeforeMove + 1);
  expect(
    {
      geometries: await numericAttribute(characterState, 'data-three-renderer-geometry-count'),
      textures: await numericAttribute(characterState, 'data-three-renderer-texture-count'),
    },
    'the readiness upload leaves the complete retained resource set stable through first interaction',
  ).toEqual(characterResourcesBeforeOrbit);

  await page.mouse.move(characterStart.x, characterStart.y);
  await page.mouse.down();
  await page.mouse.move(characterStart.x + 72, characterStart.y + 20);
  await page.mouse.move(characterStart.x, characterStart.y);
  await page.mouse.up();
  await page.getByTestId('workflow-stage-path').click();
  await expect(page.locator('[data-stage="path"]')).toBeVisible();
  await expect(
    page.getByTestId('path-three-puppet-state'),
    'a closed-loop camera drag cannot become a click that clears the selected motion path',
  ).toHaveAttribute('data-path-preview', 'shown');

  await page.getByTestId('workflow-stage-foundry').click();
  await expect(page.locator('[data-stage="foundry"]')).toBeVisible();
  const preview = page.getByTestId('foundry-preview');
  const rig = page.getByTestId('foundry-camera-rig');
  await expect(rig).toHaveAttribute('data-three-render-submissions', /[1-9]\d*/);
  await stableSubmissionCount(page, rig);

  const box = await preview.boundingBox();
  if (!box) throw new Error('Foundry preview has no bounds');
  const start = {
    x: box.x + box.width * 0.54,
    y: box.y + box.height * 0.52,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const beforeMove = await stableSubmissionCount(page, rig);
  const yawBefore = await rig.getAttribute('data-camera-yaw');

  await page.mouse.move(start.x + 64, start.y - 24);
  await expect.poll(
    () => numericAttribute(rig, 'data-three-render-submissions'),
    { message: 'one camera move reaches the retained Three scene' },
  ).toBe(beforeMove + 1);
  await nextTwoFrames(page);
  expect(
    await numericAttribute(rig, 'data-three-render-submissions'),
    'unstable playback descriptor identity does not force a second render',
  ).toBe(beforeMove + 1);

  await page.mouse.up();
  await expect(
    rig,
    'Foundry commits the durable camera value once when the gesture ends',
  ).not.toHaveAttribute('data-camera-yaw', yawBefore ?? '');
  await nextTwoFrames(page);
  expect(
    await numericAttribute(rig, 'data-three-render-submissions'),
    'ending an orbit without a camera change does not submit another frame',
  ).toBe(beforeMove + 1);

  const topologyBeforePlayback = await numericAttribute(rig, 'data-three-dynamic-build-count');
  const submissionsBeforePlayback = await numericAttribute(rig, 'data-three-render-submissions');
  const toolbar = page.getByTestId('foundry-toolbar');
  await toolbar.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(
    () => numericAttribute(rig, 'data-three-render-submissions'),
    { message: 'the stable cadenced subscription continues playback' },
  ).toBeGreaterThan(submissionsBeforePlayback);
  await toolbar.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  expect(
    await numericAttribute(rig, 'data-three-dynamic-build-count'),
    'playback updates retained transforms without rebuilding topology',
  ).toBe(topologyBeforePlayback);
});
