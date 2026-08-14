import { test, expect } from '@playwright/test';

test('G3 piston Design connection handle stays a hit target after Foundry export', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
  const dialog = page.getByTestId('getting-started-dialog');
  if (await dialog.count()) {
    const starter = dialog.getByRole('button', { name: /Open starter rig/i });
    if (await starter.count()) await starter.click();
    else await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  }
  if (!(await page.getByTestId('character-screen').count())) {
    await page.getByRole('button', { name: /^Character$/i }).click();
  }
  await expect(page.getByTestId('character-screen')).toBeVisible();
  await page.getByRole('button', { name: /Foundry/i }).click();
  await page.getByText('Mechanism options').click();
  await page.getByLabel('Foundry mechanism type').selectOption('piston');
  const rig = page.locator('[data-testid="foundry-camera-rig"][data-viewer-tab="foundry"]');
  await expect(rig).toHaveAttribute('data-mechanism-type', 'piston');
  const role = 'piston.rod-slider-pin';
  const selector = `circle.foundry-connection-hole-hit[data-connection-role="${role}"]`;
  const initial = page.locator(selector).first();
  await expect(initial).toBeVisible();
  await initial.hover();
  await page.mouse.down();
  const candidates = page.locator(selector);
  await expect.poll(() => candidates.count()).toBeGreaterThan(1);
  const alternate = candidates.nth(1);
  await alternate.hover({ force: true });
  await page.mouse.up();
  await expect(rig).toHaveAttribute('data-three-selected-connection-role', role);
  await page.getByRole('button', { name: /Use mechanism/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  const diagnostics = await page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    const surface = element.closest('svg')?.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    const style = getComputedStyle(element);
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    return {
      index: element.getAttribute('data-connection-hole-index'),
      visible: Boolean(bounds.width && bounds.height && style.visibility !== 'hidden' && style.display !== 'none'),
      bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
      withinSurface: Boolean(
        surface &&
        centerX >= surface.left &&
        centerX <= surface.right &&
        centerY >= surface.top &&
        centerY <= surface.bottom,
      ),
      hitTarget: hit === element || Boolean(hit && element.contains(hit)),
    };
  }));
  expect(diagnostics.length).toBeGreaterThan(0);
  expect(diagnostics.every((diagnostic) => diagnostic.visible), 'piston rod handles remain visible').toBe(true);
  expect(diagnostics.every((diagnostic) => diagnostic.withinSurface), 'piston rod handles stay inside the clipped SVG surface').toBe(true);
  expect(diagnostics.every((diagnostic) => diagnostic.hitTarget), 'piston rod handles remain physical hit targets').toBe(true);
});
