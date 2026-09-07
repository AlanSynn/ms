import { expect, test } from '@playwright/test';
import { APP_PATH, saveFile } from './paintingHarness';

for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
  test(`painting notes and search reveal safe controls at ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto(APP_PATH);
    const notes = page.getByTestId('support-whatsNew');
    await expect(notes).toBeVisible();
    await expect(notes.getByRole('heading', { name: 'Paint your character', exact: true })).toBeVisible();
    const images = notes.locator('img[src*="paint-character"], img[src*="draw-object"]');
    await expect(images).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      const image = images.nth(index);
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(200);
      await expect(image).toBeInViewport();
      const bounds = (await image.boundingBox())!;
      expect(bounds.height).toBeLessThanOrEqual(161);
      await notes.screenshot({ path: info.outputPath(`note-${index}-${viewport.width}.png`) });
    }
    await notes.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByTestId('getting-started-dialog').getByRole('button', { name: 'Open starter rig', exact: true }).click();
    const before = await saveFile(page, info, 'before-discovery');
    await page.getByTestId('whats-new-entry').click();
    await notes.locator('article').filter({ has: page.getByRole('heading', { name: 'Paint your character', exact: true }) })
      .getByRole('button', { name: 'Show me: Paint your character', exact: true }).click();
    await expect(page.getByTestId('character-draw-paint')).toBeFocused();
    await expect(page.getByTestId('paint-workspace')).toHaveCount(0);
    for (const [query, id] of [['draw my own object', 'character.drawObject'], ['paint clothes', 'character.drawPaint'], ['print my painting', 'blueprint.pdf']]) {
      await page.getByTestId('find-feature-entry').click();
      const find = page.getByRole('dialog', { name: 'Find a feature', exact: true });
      await find.getByRole('combobox', { name: 'Find a feature' }).fill(query);
      await find.locator(`[data-feature-result="${id}"]`).click();
      await expect(page.locator(`[data-feature-id="${id}"]`)).toBeInViewport();
      await expect(page.getByTestId('paint-workspace')).toHaveCount(0);
    }
    expect((await saveFile(page, info, 'after-discovery')).project).toEqual(before.project);
  });
}
