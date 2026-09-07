import { dismissStartupAnnouncement } from './startupHarness';
import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { serializeProject } from '../../utils/project';
import { createFabricationReadyFourBarProject } from '../fixtures/fabricationProject';
import type { FeedbackRequest, FeedbackResponse } from '../../shared/feedbackProtocol';

const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? '/';
const panelFor = (page: Page) => page.getByRole('dialog', { name: 'Feedback', exact: true });
const sent = (number: number, screenshot: 'included' | 'none'): FeedbackResponse => ({
  status: 'sent', issue: { number, url: `https://github.com/AlanSynn/ms/issues/${number}` }, screenshot,
});
const respond = (route: Route, response: FeedbackResponse, status = 200) => route.fulfill({
  status, json: response, headers: { 'Access-Control-Allow-Origin': route.request().headers().origin || '*' },
});

const openApp = async (page: Page) => {
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
  const welcome = page.getByTestId('getting-started-dialog');
  if (await welcome.count()) await welcome.getByRole('button', { name: 'Close', exact: true }).click();
  const project = createFabricationReadyFourBarProject();
  const first = project.paths[project.selectedPathId!];
  const other = { ...first, id: 'feedback-left-motion', partId: 'left_arm_lower', targetAnchorJointId: 'left_hand',
    chainRootJointId: 'left_shoulder', points: first.points.map(point => ({ x: -point.x, y: point.y })) };
  await page.getByTestId('command-menu-file').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('command-load-project').click();
  await (await chooser).setFiles({ name: 'synthetic-feedback.motionsmith', mimeType: 'application/json',
    buffer: Buffer.from(serializeProject({ ...project, paths: { ...project.paths, [other.id]: other },
      pathOrder: [first.id, other.id], settings: { ...project.settings, autosave: false } })) });
  await expect(page.getByTestId('status-bar')).toContainText('Loaded project');
  await page.getByTestId('workflow-stage-path').click();
  await expect(page.getByTestId('path-three-puppet')).toHaveAttribute('data-three-initial-scene-ready', 'true');
};

const snapshot = async (page: Page) => {
  const menu = page.getByTestId('command-menu-file');
  if (!await menu.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) await menu.click();
  const pending = page.waitForEvent('download');
  await page.getByTestId('command-download-snapshot').click();
  const file = await (await pending).path();
  return JSON.parse(await readFile(file!, 'utf8')).project;
};
const openFeedback = async (page: Page, editing = true) => {
  await page.getByTestId('feedback-entry').click();
  const panel = panelFor(page);
  await expect(panel).toBeVisible();
  await expect(editing ? panel.getByTestId('feedback-message') : panel.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await expect(panel.getByTestId('feedback-screenshot')).toBeVisible();
  return panel;
};
const screenshotBytes = (page: Page) => page.getByTestId('feedback-screenshot').evaluate(async (image: HTMLImageElement) =>
  Array.from(new Uint8Array(await (await fetch(image.src)).arrayBuffer())));

test('draft survives close and navigation; removal, rejection and retry preserve project state', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  const requests: FeedbackRequest[] = [];
  const headers: Record<string, string>[] = [];
  await page.route('**/feedback', async route => {
    requests.push(route.request().postDataJSON()); headers.push(route.request().headers());
    await respond(route, requests.length === 1
      ? { status: 'rejected', code: 'rate_limited', message: 'Wait a minute, then Send.' }
      : sent(800001, 'none'), requests.length === 1 ? 429 : 200);
  });
  await openApp(page);
  const before = await snapshot(page);
  expect(Object.keys(before.paths)).toHaveLength(2);
  expect(before.mechanisms).toHaveLength(1);
  let panel = await openFeedback(page);
  await panel.getByRole('radio', { name: 'I have an idea' }).check();
  await panel.getByTestId('feedback-message').fill('Synthetic QA: a larger handle would help.');
  const original = await screenshotBytes(page);
  const oldUrl = await page.getByTestId('feedback-screenshot').getAttribute('src');
  await panel.getByTestId('feedback-message').press('Alt+2');
  await expect(page.locator('.editor-stage-frame[data-stage="path"]')).toBeVisible();
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('feedback-entry')).toBeFocused();
  expect(await page.evaluate(async url => {
    try { await fetch(url!); return false; } catch { return true; }
  }, oldUrl)).toBe(true);
  await page.getByTestId('workflow-stage-assembly').click();
  panel = await openFeedback(page);
  expect(await screenshotBytes(page), 'reopening in another stage keeps the original evidence').toEqual(original);
  await expect(panel.getByTestId('feedback-message')).toHaveValue('Synthetic QA: a larger handle would help.');
  expect(requests).toEqual([]);
  await panel.getByRole('button', { name: 'Enlarge screenshot' }).click();
  await expect(panel.getByRole('button', { name: 'Fit screenshot' })).toBeVisible();
  expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth), 'enlarged evidence scrolls inside its own preview').toBeLessThanOrEqual(1);
  await expect(panel.getByTestId('feedback-send')).toBeInViewport();
  const sendBox = await panel.getByTestId('feedback-send').boundingBox();
  expect(sendBox!.x + sendBox!.width).toBeLessThanOrEqual(1024);
  await panel.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(panel.getByTestId('feedback-screenshot')).toHaveCount(0);
  await expect(panel).toContainText('Posted publicly. Leave out names.');
  await panel.getByTestId('feedback-send').click();
  await expect(panel).toContainText('Wait a minute, then Send.');
  await expect(panel.getByTestId('feedback-message')).toHaveValue('Synthetic QA: a larger handle would help.');
  await panel.getByTestId('feedback-send').click();
  await expect(panel).toContainText('Sent · #800001');
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(Object.keys(requests[0]).sort()).toEqual(['action', 'category', 'context', 'message', 'submissionId']);
  expect(requests[0]).toMatchObject({ action: 'submit', category: 'idea', context: {
    stage: 'path', viewport: { width: 1024, height: 700 },
  } });
  headers.forEach(value => {
    expect(value.authorization).toBeUndefined(); expect(value.cookie).toBeUndefined(); expect(value.referer).toBeUndefined();
  });
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })))
    .not.toContain('Synthetic QA: a larger handle');
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await snapshot(page), 'capture, failed/successful Send, and support navigation never edit the project').toEqual(before);
  await openFeedback(page);
  await expect(panel.getByTestId('feedback-message')).toHaveValue('');
  await panel.getByTestId('feedback-message').fill('Synthetic QA: fresh intended report.');
  await panel.getByRole('button', { name: 'Remove', exact: true }).click();
  await panel.getByTestId('feedback-send').click();
  await expect(panel).toContainText('Sent · #800001');
  expect(requests[2].submissionId).not.toBe(requests[0].submissionId);
});

test('repeated Send and lost receipt offer only status checks and retain the screenshot until confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const requests: FeedbackRequest[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/feedback', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) { await pending; await route.abort('connectionreset'); return; }
    await respond(route, requests.length === 2
      ? { status: 'unknown', code: 'not_found', message: 'Still unconfirmed. Check status later.' }
      : sent(800002, 'included'));
  });
  await openApp(page);
  const before = await snapshot(page);
  let panel = await openFeedback(page);
  await panel.getByTestId('feedback-message').fill('Synthetic QA: a connection disappeared.');
  const original = await screenshotBytes(page);
  // Two immediate form submissions exercise the synchronous lock before the digest awaits.
  await panel.locator('form').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect.poll(() => requests.length).toBe(1);
  await expect(panel.getByTestId('feedback-send')).toBeDisabled();
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  panel = await openFeedback(page, false);
  await expect(panel.getByTestId('feedback-send')).toBeDisabled();
  release();
  await expect(panel.getByRole('button', { name: 'Check status', exact: true })).toBeVisible();
  await expect(panel.getByTestId('feedback-send')).toHaveCount(0);
  await expect(panel.getByTestId('feedback-message')).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
  expect(await screenshotBytes(page)).toEqual(original);
  await panel.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(panel).toContainText('Still unconfirmed. Check status later.');
  await panel.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(panel).toContainText('Sent · #800002');
  expect(requests).toHaveLength(3);
  expect(requests[0].action).toBe('submit');
  expect(requests.slice(1).map(value => value.action)).toEqual(['status', 'status']);
  expect(requests[1]).toEqual(requests[2]);
  expect(Object.keys(requests[1]).sort()).toEqual(['action', 'payloadDigest', 'submissionId']);
  expect(requests[1].submissionId).toEqual(requests[0].submissionId);
  if (requests[0].action === 'submit') {
    expect(requests[0].screenshot?.mime).toBe('image/png');
    expect(Buffer.from(requests[0].screenshot!.base64, 'base64').subarray(0, 8))
      .toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  await expect(panel.getByTestId('feedback-screenshot')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
});

test('offline and expired credentials retain the message and image without false success', async ({ page, context }) => {
  const requests: FeedbackRequest[] = [];
  await page.route('**/feedback', async route => {
    requests.push(route.request().postDataJSON());
    await respond(route, { status: 'rejected', code: 'credentials', message: 'Sending is unavailable. Try later.' }, 503);
  });
  await openApp(page);
  const panel = await openFeedback(page);
  await expect(panel.getByTestId('feedback-send')).toBeDisabled();
  await panel.getByTestId('feedback-message').fill('   ');
  await expect(panel.getByTestId('feedback-send')).toBeDisabled();
  await panel.getByTestId('feedback-message').fill('Synthetic QA: offline report stays on this device.');
  const original = await screenshotBytes(page);
  await context.setOffline(true);
  await panel.getByTestId('feedback-send').click();
  await expect(panel).toContainText('Offline. Reconnect, then Send.');
  expect(requests).toEqual([]);
  await context.setOffline(false);
  await panel.getByTestId('feedback-send').click();
  await expect(panel).toContainText('Sending is unavailable. Try later.');
  expect(await screenshotBytes(page)).toEqual(original);
  await expect(panel.getByTestId('feedback-message')).toHaveValue('Synthetic QA: offline report stays on this device.');
  await expect(panel.getByText(/^Sent ·/)).toHaveCount(0);
  await panel.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(panel).toHaveCount(0);
});

test('intentional capture failure requires explicit text-only Send', async ({ page }) => {
  const requests: FeedbackRequest[] = [];
  await page.route('**/feedback', async route => {
    requests.push(route.request().postDataJSON()); await respond(route, sent(800003, 'none'));
  });
  await openApp(page);
  const before = await snapshot(page);
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toDataURL = () => { throw new DOMException('Synthetic taint', 'SecurityError'); };
  });
  await page.getByTestId('feedback-entry').click();
  const panel = panelFor(page);
  await expect(panel).toContainText('Screenshot unavailable. Send text only.');
  await expect(panel.getByTestId('feedback-screenshot')).toHaveCount(0);
  await panel.getByTestId('feedback-message').fill('Synthetic QA: explicitly sending without unavailable image.');
  expect(requests).toEqual([]);
  await panel.getByRole('button', { name: 'Send text only', exact: true }).click();
  await expect(panel).toContainText('Sent · #800003');
  expect(requests).toHaveLength(1);
  expect(requests[0]).not.toHaveProperty('screenshot');
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
});

test('an inconsistent attachment receipt stays unconfirmed instead of discarding evidence', async ({ page }) => {
  let requests = 0;
  await page.route('**/feedback', async route => { requests++; await respond(route, sent(800004, 'none')); });
  await openApp(page);
  const panel = await openFeedback(page);
  await panel.getByTestId('feedback-message').fill('Synthetic QA: attachment outcome must be honest.');
  const original = await screenshotBytes(page);
  await panel.getByTestId('feedback-send').click();
  await expect(panel).toContainText('Attachment unconfirmed. Check status.');
  await expect(panel.getByText(/^Sent ·/)).toHaveCount(0);
  expect(await screenshotBytes(page)).toEqual(original);
  await expect(panel.getByRole('button', { name: 'Check status', exact: true })).toBeVisible();
  expect(requests).toBe(1);
});
