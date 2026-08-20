import { expect, test, type Page } from '@playwright/test';

const openWavingArm = async (page: Page) => {
  const dialog = page.getByTestId('getting-started-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('getting-started-card-guided').click();
  await dialog.getByTestId('guided-project-card-waving-arm').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('character-screen')).toBeVisible();
};

const waitForEditor = (page: Page) =>
  expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });

const openFoundry = async (page: Page) => {
  await page
    .getByTestId('workspace-steps')
    .getByRole('button', { name: /Mechanism Foundry|Foundry/i })
    .click();
  await expect(page.getByRole('heading', { name: /Mechanism Foundry/i }))
    .toBeVisible();
  await expect(page.getByTestId('foundry-preview')).toBeVisible();
};

test('WebGL unavailable keeps Character and Foundry controls recoverable', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: function (
        this: HTMLCanvasElement,
        contextId: string,
        ...args: unknown[]
      ) {
        if (
          contextId === 'webgl'
          || contextId === 'webgl2'
          || contextId === 'experimental-webgl'
        ) return null;
        return Reflect.apply(nativeGetContext, this, [contextId, ...args]);
      },
    });
  });

  await page.goto('/');
  await waitForEditor(page);
  const character = page.getByTestId('character-three-puppet');
  await expect(character).toHaveAttribute('data-three-renderer-status', 'unavailable');
  await expect(
    character.getByTestId('character-three-puppet-renderer-status'),
  ).toHaveText('3D unavailable');

  await openWavingArm(page);
  await openFoundry(page);
  const foundry = page.getByTestId('foundry-preview');
  await expect(foundry).toHaveAttribute('data-three-renderer-status', 'unavailable');
  await expect(page.getByTestId('foundry-renderer-status')).toHaveText('3D unavailable');
  await expect(
    page.getByTestId('foundry-toolbar').getByRole('button', { name: 'Play', exact: true }),
  ).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test('Foundry restores the same scene after a WebGL context loss', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await waitForEditor(page);
  await openWavingArm(page);
  await openFoundry(page);

  const foundry = page.getByTestId('foundry-preview');
  const canvas = foundry.locator('canvas.foundry-three-canvas');
  await expect(canvas).toBeVisible();
  await expect(foundry).toHaveAttribute('data-three-renderer-status', 'webgl');
  const canvasHandle = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const context = canvasElement.getContext('webgl2')
      ?? canvasElement.getContext('webgl');
    const extension = context?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    (window as typeof window & { __motionsmithLoseContext?: WEBGL_lose_context })
      .__motionsmithLoseContext = extension;
    extension.loseContext();
    return true;
  });
  expect(canvasHandle, 'Chrome exposes WEBGL_lose_context for the recovery check')
    .toBe(true);

  await expect(foundry).toHaveAttribute('data-three-renderer-status', 'restoring');
  await expect(page.getByTestId('foundry-renderer-status')).toHaveText('Restoring 3D…');
  await page.evaluate(() => {
    (window as typeof window & { __motionsmithLoseContext?: WEBGL_lose_context })
      .__motionsmithLoseContext?.restoreContext();
  });
  await expect(foundry).toHaveAttribute('data-three-renderer-status', 'webgl');
  await expect(page.getByTestId('foundry-renderer-status')).toHaveCount(0);
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => Number(
      await page
        .getByTestId('foundry-camera-rig')
        .getAttribute('data-three-renderer-geometry-count')
        ?? '0',
    ))
    .toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});
