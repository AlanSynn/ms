import { expect, test, type Locator, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1200, height: 520 },
] as const;

test.beforeEach(async ({ page }) => {
  await page.route('**/onnx/pose_model.int8.ort', route => route.fulfill({
    status: 200,
    contentType: 'application/octet-stream',
    body: Buffer.alloc(1_000_001, 1),
  }));
});

const waitForEditor = async (page: Page) => {
  await page.goto('/');
  await expect(page.locator('#boot-loader')).toHaveCount(0);
  await expect(page.getByTestId('getting-started-dialog')).toBeVisible();
};

const expectNoDocumentHorizontalOverflow = async (page: Page, label: string) => {
  const widths = await page.evaluate(() => ({
    body: [document.body.scrollWidth, document.body.clientWidth],
    document: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
  }));
  expect(widths.body[0], `${label}: body has no horizontal overflow`).toBeLessThanOrEqual(widths.body[1] + 1);
  expect(widths.document[0], `${label}: document has no horizontal overflow`).toBeLessThanOrEqual(widths.document[1] + 1);
};

const expectReachable = async (locator: Locator, label: string) => {
  await expect(locator, `${label} is rendered`).toBeVisible();
  const result = await locator.evaluate((element) => {
    const inside = (rect: DOMRect, bounds: DOMRect) =>
      rect.left >= bounds.left - 1
      && rect.top >= bounds.top - 1
      && rect.right <= bounds.right + 1
      && rect.bottom <= bounds.bottom + 1;
    const viewport = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    let rect = element.getBoundingClientRect();
    if (inside(rect, viewport)) return { reachable: true, via: 'viewport' };

    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const scrollable = /(auto|scroll|overlay)/.test(`${style.overflowX} ${style.overflowY}`)
        && (parent.scrollHeight > parent.clientHeight + 1 || parent.scrollWidth > parent.clientWidth + 1);
      if (!scrollable) continue;
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      rect = element.getBoundingClientRect();
      return {
        reachable: inside(rect, viewport) && inside(rect, parent.getBoundingClientRect()),
        via: parent.getAttribute('data-testid') ?? parent.className ?? parent.tagName,
      };
    }
    return { reachable: false, via: 'no scroll container' };
  });
  expect(result.reachable, `${label} is inside the viewport or its own scroll container (${result.via})`).toBe(true);
};

const openFinalGuidedLesson = async (page: Page) => {
  const dialog = page.getByTestId('getting-started-dialog');
  await dialog.getByTestId('getting-started-card-guided').click();
  const finalChoice = dialog.locator('[data-testid^="guided-project-card-"]').last();
  await expectReachable(finalChoice, 'final guided project choice');
  await finalChoice.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Character', exact: true })).toBeVisible();
};

for (const viewport of VIEWPORTS) {
  const size = `${viewport.width}x${viewport.height}`;

  test(`${size} Getting Started keeps guided choices reachable and Character can reopen it`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await waitForEditor(page);
    await expectNoDocumentHorizontalOverflow(page, `${size} initial modal`);

    let dialog = page.getByTestId('getting-started-dialog');
    const guide = dialog.getByTestId('getting-started-card-guided');
    await expectReachable(guide, `${size} Guide action`);
    await guide.click();
    await expectReachable(dialog.getByRole('button', { name: 'Starters', exact: true }), `${size} Starters action`);
    await expectReachable(dialog.locator('[data-testid^="guided-project-card-"]').last(), `${size} final guided choice`);

    await dialog.getByRole('button', { name: 'Starters', exact: true }).click();
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    await expectReachable(close, `${size} Close action`);
    await close.click();
    await expect(dialog).toHaveCount(0);

    const reopen = page.getByRole('button', { name: 'Open Getting Started' });
    await expectReachable(reopen, `${size} Character Getting Started action`);
    await reopen.click();
    dialog = page.getByTestId('getting-started-dialog');
    await expect(dialog).toBeVisible();
    await openFinalGuidedLesson(page);

    const home = page.getByTestId('app-header-home');
    await expectReachable(home, `${size} Home/logo action`);
    await home.click();
    await expect(page.getByRole('heading', { name: 'Character', exact: true }), `${size} Home/logo returns to Character`).toBeVisible();
    await expect(page.getByTestId('getting-started-dialog'), `${size} Home/logo does not reopen Getting Started`).toHaveCount(0);

    const reopenFromCharacter = page.getByRole('button', { name: 'Open Getting Started' });
    await expectReachable(reopenFromCharacter, `${size} Character Getting Started action after Home`);
    await reopenFromCharacter.click();
    await expect(page.getByTestId('getting-started-dialog'), `${size} Character action reopens Getting Started`).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page, `${size} reopened modal`);
  });

  test(`${size} workbench surfaces remain reachable across enabled stages`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await waitForEditor(page);
    await openFinalGuidedLesson(page);

    const workflow = page.getByTestId('workspace-steps');
    for (const { name, playback } of [
      { name: 'Character', playback: false },
      { name: 'Path Editor', playback: true },
      { name: 'Mechanism Design', playback: true },
      { name: 'Assembly', playback: true },
    ]) {
      const stageButton = workflow.getByRole('button', { name, exact: true });
      await expectReachable(stageButton, `${size} ${name} primary navigation`);
      if (!(await stageButton.isEnabled())) continue;
      await stageButton.click();
      await expect(stageButton, `${size} ${name} opens`).toHaveAttribute('aria-current', 'step');

      await expectNoDocumentHorizontalOverflow(page, `${size} ${name}`);
      await expectReachable(page.getByTestId('stage-canvas-pane'), `${size} ${name} center canvas`);
      await expectReachable(page.getByTestId('stage-right-inspector'), `${size} ${name} inspector`);
      if (playback) await expectReachable(page.getByTestId('workspace-player-dock'), `${size} ${name} playback controls`);
      await expectReachable(page.getByTestId('status-bar'), `${size} ${name} status`);
      await expectReachable(page.getByTestId('app-header-home'), `${size} ${name} Home/logo`);
    }
  });
}
