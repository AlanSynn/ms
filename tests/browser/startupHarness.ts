import { expect, type Page } from '@playwright/test';

/** Use the actual announcement action; no test-only startup suppression. */
export const dismissStartupAnnouncement = async (page: Page) => {
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
  await expect(page.locator([
    '[data-testid="support-whatsNew"]', '[data-testid="getting-started-dialog"]',
    '[data-testid="project-lifecycle-panel"]', '[data-testid="character-screen"]',
  ].join(','))).not.toHaveCount(0);
  const announcement = page.getByTestId('support-whatsNew');
  if (await announcement.count()) {
    await announcement.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(announcement).toHaveCount(0);
  }
};
