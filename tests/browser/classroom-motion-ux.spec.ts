import { expect, test, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';
import type { MechanismType } from '../../types';
import { serializeProject } from '../../utils/project';
import { MECHANISM_TEMPLATE_LIBRARY } from '../../utils/mechanismTemplates';
import { contextHelpFor } from '../../utils/contextHelp';
import { createFabricationReadyFourBarProject } from '../fixtures/fabricationProject';
import { dismissStartupAnnouncement } from './startupHarness';

test.use({ deviceScaleFactor: 2 });

const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? '/';
const DRAW_CUE = 'Draw where the selected part should move, not the shape of the part.';
const evidencePath = (width: number, name: string) =>
  join('artifacts', 'classroom-motion-ux', String(width), name);

const openFixture = async (page: Page) => {
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  const picker = page.waitForEvent('filechooser');
  await page.getByTestId('getting-started-open-project').click();
  await (await picker).setFiles({
    name: 'classroom-motion-cues.motionsmith',
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(createFabricationReadyFourBarProject())),
  });
  await expect(page.getByTestId('status-bar')).toContainText('Loaded project');
};

// Capture actual rendered controls, including body-level help, without editing pixels.
const captureRegion = async (page: Page, targets: Locator[], path: string, textOnly = false) => {
  const boxes = await Promise.all(targets.map(target => textOnly ? target.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const { x, y, width, height } = range.getBoundingClientRect();
    return { x, y, width, height };
  }) : target.boundingBox()));
  expect(boxes.every(Boolean)).toBe(true);
  const viewport = page.viewportSize()!;
  const x = Math.max(0, Math.floor(Math.min(...boxes.map(box => box!.x)) - 8));
  const y = Math.max(0, Math.floor(Math.min(...boxes.map(box => box!.y)) - 8));
  const right = Math.min(viewport.width, Math.ceil(Math.max(...boxes.map(box => box!.x + box!.width)) + 8));
  const bottom = Math.min(viewport.height, Math.ceil(Math.max(...boxes.map(box => box!.y + box!.height)) + 8));
  await page.screenshot({ path, clip: { x, y, width: right - x, height: bottom - y } });
};

for (const viewport of [{ width: 1366, height: 768 }, { width: 1024, height: 700 }]) {
  test(`recommendations explain motion and score without clutter at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await openFixture(page);
    await page.getByTestId('workflow-stage-design').click();
    await page.getByRole('button', { name: /Recommend/i }).click();
    const sheet = page.getByTestId('recommendation-sheet');
    await expect(sheet).toHaveAttribute('data-recommendation-state', 'ready', { timeout: 60_000 });
    await expect(sheet.getByTestId('recommendation-card-gear_linkage')).toBeVisible();
    const cards = sheet.locator('.recommendation-option');
    // This fixture yields two choices; wait for the progressive card mount.
    const count = 2;
    await expect(cards).toHaveCount(count);
    await expect(sheet.locator('svg.recommendation-preview')).toHaveCount(count);
    await expect(sheet).not.toContainText(/Fit score|\/100|%/);
    await expect(sheet.locator('.recommendation-score')).toHaveCount(0);

    for (const card of await cards.all()) {
      const type = (await card.getAttribute('data-testid'))!.replace('recommendation-card-', '') as MechanismType;
      const name = card.getByTestId('recommendation-name');
      const motion = card.getByTestId('recommendation-motion');
      const score = card.getByTestId('recommendation-score');
      await expect(name).toHaveText(MECHANISM_TEMPLATE_LIBRARY[type].label);
      await expect(motion).toHaveText(MECHANISM_TEMPLATE_LIBRARY[type].classroomSensemaking.directTranslation);
      await expect(score).toHaveCount(1);
      await expect(score).toHaveText(/^Recommendation score \d+$/);
      expect(await name.evaluate(element => element.nextElementSibling?.getAttribute('data-testid'))).toBe('recommendation-motion');
      expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

      const help = card.getByRole('button', { name: 'Context help', exact: true });
      await help.scrollIntoViewIfNeeded();
      await help.focus();
      await expect(help).toBeFocused();
      const before = await card.boundingBox();
      await page.keyboard.press('Enter');
      const tooltip = page.getByRole('tooltip');
      await expect(help).toHaveAttribute('aria-expanded', 'true');
      await expect(tooltip).toContainText(contextHelpFor('path.recommendationScore').body);
      await expect(tooltip).toContainText('compare recommendations');
      await expect(tooltip).toContainText('not a grade or a target to maximize');
      await expect(tooltip).toContainText('Choose the motion that best matches what you want to happen.');
      await expect(help).toHaveAttribute('aria-describedby', (await tooltip.getAttribute('id'))!);
      await expect(tooltip).toBeInViewport();
      const after = await card.boundingBox();
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(after![key] - before![key]), `help leaves card ${key} stable`).toBeLessThan(1);
      }
      if (type === 'gear_linkage') {
        await captureRegion(page, [score, tooltip], evidencePath(viewport.width, 'recommendation-score-help.png'));
      }
      await page.keyboard.press('Escape');
      await expect(tooltip).toHaveCount(0);
      await expect(help).toHaveAttribute('aria-expanded', 'false');
      await expect(help).toBeFocused();
    }
    const chosen = sheet.getByTestId('recommendation-card-gear_linkage');
    await captureRegion(page, [chosen.getByTestId('recommendation-score'), chosen.getByRole('button', { name: 'Context help', exact: true })], evidencePath(viewport.width, 'recommendation-score.png'));
    await captureRegion(page, [chosen.getByTestId('recommendation-name'), chosen.getByTestId('recommendation-motion')], evidencePath(viewport.width, 'recommendation-motion.png'), true);
    await sheet.screenshot({ path: evidencePath(viewport.width, 'recommendations.png') });
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test(`drawing cue appears only during a motion stroke at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openFixture(page);
    await page.getByTestId('workflow-stage-path').click();
    const panel = page.getByTestId('novice-path-panel');
    const cue = page.getByTestId('path-draw-cue');
    const draw = panel.locator('[data-feature-id="path.draw"]');
    await expect(cue).toHaveCount(0);
    await draw.click();
    await expect(cue).toHaveText(DRAW_CUE);
    await expect(page.getByText(DRAW_CUE, { exact: true })).toHaveCount(1);
    await expect(cue).toBeInViewport();
    await expect(draw).toHaveAccessibleDescription(DRAW_CUE);
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await captureRegion(page, [draw, cue], evidencePath(viewport.width, 'path-drawing.png'));
    await panel.screenshot({ path: evidencePath(viewport.width, 'path-panel.png') });
    await draw.click();
    await expect(cue).toHaveCount(0);
    await expect(draw).not.toHaveAttribute('aria-describedby');

    await draw.click();
    const canvas = page.locator('.path-canvas-shell canvas.three-puppet-canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const x = box.x + box.width * 0.58;
    const y = box.y + box.height * 0.42;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 32, y - 22, { steps: 4 });
    await page.mouse.move(x + 56, y + 12, { steps: 4 });
    await page.mouse.move(x + 12, y + 35, { steps: 4 });
    await expect(cue).toBeVisible();
    await page.mouse.up();
    await expect(page.getByTestId('free-draw-status')).toHaveAttribute('data-draw-mode', 'idle');
    await expect(page.getByTestId('free-draw-status')).toContainText('Path ready');
    await expect(cue).toHaveCount(0);
  });
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`motion release screenshots load at their note size at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(APP_PATH);
    await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
    const panel = page.getByTestId('support-whatsNew');
    const entry = panel.locator('[data-release-note-id="classroom-motion-cues-v1"]');
    await expect(entry.locator('article')).toHaveCount(3);
    const articles = await entry.locator('article').all();
    for (let index = 0; index < articles.length; index++) {
      const article = articles[index];
      const image = article.getByRole('img');
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
      await expect(image).toBeInViewport();
      expect(await article.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await article.screenshot({ scale: 'css', path: evidencePath(viewport.width, `release-highlight-${index + 1}.png`) });
    }
    await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport();
    await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
  });
}
