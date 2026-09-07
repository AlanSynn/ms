import { expect, test, chromium, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseNoteForVersion, releaseNotesForVersion } from '../../utils/releaseNotes';
import { RELEASE_READ_KEY } from '../../utils/releaseReadState';
import { GETTING_STARTED_SESSION_KEY } from '../../utils/startupFlow';
import { createSampleProject } from '../../utils/project';
import { serializeProjectCompact } from '../../utils/projectSerialization';
import { AUTOSAVE_STORAGE_KEYS } from '../../utils/projectAutosaveFormat';
import { readBrowserAutosaveProbe } from './autosaveIndexedDbProbe';
import { dismissStartupAnnouncement } from './startupHarness';

const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? '/';
const version = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version;
const note = releaseNoteForVersion(version)!;
const notes = releaseNotesForVersion(version);
const highlights = notes.flatMap(entry => entry.highlights);
const notesPanel = (page: Page) => page.getByTestId('support-whatsNew');
const storedViewed = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]') as string[], RELEASE_READ_KEY);
const boot = async (page: Page) => {
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
};
const openManualNotes = async (page: Page) => {
  await page.getByTestId('whats-new-entry').click();
  await expect(notesPanel(page)).toBeVisible();
  await expect(notesPanel(page)).toContainText(note.highlights[0].title);
  await expect(notesPanel(page).getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  return notesPanel(page);
};
const savedProject = async (page: Page) => {
  await page.getByTestId('workflow-stage-project').click();
  const pending = page.waitForEvent('download');
  await page.getByTestId('project-lifecycle-panel').getByRole('button', { name: 'Save Project', exact: true }).click();
  const download = await pending;
  const buffer = await readFile((await download.path())!);
  return { file: { name: download.suggestedFilename(), mimeType: 'application/json', buffer }, project: JSON.parse(buffer.toString()).project };
};

for (const unseen of [false, true]) for (const hidden of [false, true]) for (const backup of [false, true]) {
  test(`startup sequence unseen=${unseen} entryHidden=${hidden} backup=${backup}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const candidate = createSampleProject();
    candidate.metadata.name = 'Previous class backup';
    const backupBytes = serializeProjectCompact(candidate);
    await page.addInitScript(({ unseen, hidden, backup, backupBytes, noteId, readKey, entryKey, backupKey }) => {
      if (!sessionStorage.getItem('qa-startup-installed')) {
        localStorage.setItem(readKey, JSON.stringify(unseen ? ['earlier-update'] : ['earlier-update', noteId]));
        sessionStorage.setItem(entryKey, String(hidden));
        if (backup) localStorage.setItem(backupKey, backupBytes);
        sessionStorage.setItem('qa-startup-installed', 'true');
      }
      const state = { maxDialogs: 0, sequence: [] as string[] };
      (window as typeof window & { qaStartup?: typeof state }).qaStartup = state;
      new MutationObserver(() => {
        const dialogs = [...document.querySelectorAll('[role="dialog"]')];
        state.maxDialogs = Math.max(state.maxDialogs, dialogs.length);
        const id = dialogs[0]?.getAttribute('data-testid');
        if (id && state.sequence.at(-1) !== id) state.sequence.push(id);
      }).observe(document, { childList: true, subtree: true });
    }, { unseen, hidden, backup, backupBytes, noteId: note.id, readKey: RELEASE_READ_KEY,
      entryKey: GETTING_STARTED_SESSION_KEY, backupKey: AUTOSAVE_STORAGE_KEYS.autosave });
    await page.goto(APP_PATH);
    await boot(page);
    if (unseen) {
      await expect(notesPanel(page)).toBeVisible();
      await expect(page.getByTestId('getting-started-dialog')).toHaveCount(0);
      expect(await storedViewed(page)).not.toContain(note.id);
      await expect(notesPanel(page).getByRole('heading', { name: note.highlights[0].title, exact: true })).toBeVisible();
      if (hidden && backup) await page.keyboard.press('Escape');
      else await notesPanel(page).getByRole('button', { name: hidden ? 'Close' : 'Continue', exact: true }).click();
      await expect(notesPanel(page)).toHaveCount(0);
      await expect.poll(() => storedViewed(page)).toContain(note.id);
    }
    const welcome = page.getByTestId('getting-started-dialog');
    if (!hidden) {
      await expect(welcome).toBeVisible();
      const open = welcome.getByTestId('getting-started-open-project');
      await expect(open).toBeInViewport();
      await expect(open).toContainText('Open Project');
      await expect(welcome.getByTestId('getting-started-gallery').locator('button')).toHaveCount(2);
      const boxes = await Promise.all([welcome.getByTestId('getting-started-gallery').boundingBox(), open.boundingBox(), welcome.getByTestId('getting-started-hide-session').boundingBox()]);
      expect(boxes[1]!.y).toBeGreaterThanOrEqual(boxes[0]!.y + boxes[0]!.height);
      expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y + boxes[1]!.height);
      if (backup) {
        await expect(welcome.getByTestId('recover-browser-backup')).toContainText('Previous class backup');
        await expect(welcome.getByTestId('recover-browser-backup')).toContainText('Backup time unavailable');
      } else await expect(welcome.getByTestId('recover-browser-backup')).toHaveCount(0);
      // Viewing prepared guide thumbnails is presentation, never a project choice.
      await welcome.getByTestId('getting-started-card-guided').click();
      await expect(welcome.getByTestId('guided-project-card-waving-arm')).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await expect(page.getByTestId('project-empty-state')).toBeVisible();
    await expect(page.getByTestId('project-lifecycle-panel').getByRole('button', { name: 'Open Project', exact: true })).toHaveClass(/btn-primary/);
    expect(await page.getByTestId('project-file-input').getAttribute('accept')).toContain('.motionsmith');
    await expect(page.getByTestId('project-backup-status')).toHaveAttribute('data-backup-state', 'waiting');
    if (backup) await expect(page.getByTestId('recover-browser-backup')).toContainText('Previous class backup');
    expect(await page.evaluate(key => localStorage.getItem(key), AUTOSAVE_STORAGE_KEYS.autosave)).toBe(backup ? backupBytes : null);
    expect((await readBrowserAutosaveProbe(page)).currentRaw, 'startup does not write defaults or migrate recovery').toBeNull();
    const observed = await page.evaluate(() => (window as typeof window & { qaStartup?: { maxDialogs: number; sequence: string[] } }).qaStartup!);
    expect(observed.maxDialogs).toBe(Number(unseen || !hidden));
    expect(observed.sequence[0]).toBe(unseen ? 'support-whatsNew' : !hidden ? 'getting-started-dialog' : undefined);
    expect(await page.evaluate(key => sessionStorage.getItem(key), GETTING_STARTED_SESSION_KEY)).toBe(String(hidden));
    await page.reload();
    await boot(page);
    await expect(notesPanel(page)).toHaveCount(0);
    await expect(hidden ? page.getByTestId('project-empty-state') : welcome).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), AUTOSAVE_STORAGE_KEYS.autosave)).toBe(backup ? backupBytes : null);
  });
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
  test(`notes and entry reopen without replacing work at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const posts: string[] = [];
    page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
    await page.goto(APP_PATH);
    await dismissStartupAnnouncement(page);
    const welcome = page.getByTestId('getting-started-dialog');
    await welcome.getByTestId('getting-started-card-guided').click();
    await welcome.getByTestId('guided-project-card-waving-arm').click();
    await expect(page.getByTestId('character-screen')).toBeVisible();
    const before = await savedProject(page);
    await page.getByTestId('workflow-stage-path').click();
    await page.getByTestId('header-home').click();
    await expect(welcome).toBeVisible();
    await welcome.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.editor-stage-frame[data-stage="path"]')).toBeVisible();
    const panel = await openManualNotes(page);
    expect(await panel.locator('article').count()).toBe(highlights.length);
    const firstImage = highlights.find(highlight => highlight.image)?.image;
    if (firstImage) {
      const image = panel.getByRole('img', { name: firstImage.alt, exact: true });
      await image.scrollIntoViewIfNeeded();
      await expect(image).toHaveAttribute('alt', firstImage.alt);
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(100);
      expect(new URL((await image.getAttribute('src'))!, page.url()).pathname).toBe(new URL(`${APP_PATH}${firstImage.path}`, page.url()).pathname);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('whats-new-entry')).toBeFocused();
    await expect(page.locator('.editor-stage-frame[data-stage="path"]')).toBeVisible();
    expect((await savedProject(page)).project).toEqual(before.project);
    expect(JSON.stringify(before.project)).not.toContain(RELEASE_READ_KEY);
    expect(JSON.stringify(before.project)).not.toContain(note.id);
    await page.getByTestId('command-menu-file').click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByTestId('command-reset-lesson').click();
    await expect(page.getByTestId('status-bar')).toContainText('Lesson reset');
    expect(await storedViewed(page)).toContain(note.id);
    await page.getByTestId('workflow-stage-project').click();
    const picker = page.waitForEvent('filechooser');
    await page.getByTestId('project-lifecycle-panel').getByRole('button', { name: 'Open Project', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await (await picker).setFiles(before.file);
    await expect(page.getByTestId('status-bar')).toContainText('Loaded project');
    expect(await storedViewed(page)).toContain(note.id);
    await page.reload();
    await dismissStartupAnnouncement(page);
    await expect(notesPanel(page)).toHaveCount(0);
    await expect(page.getByTestId('whats-new-badge')).toHaveCount(0);
    expect(posts).toEqual([]);
  });
}

test('acknowledged update persists after a browser process restart', async ({ baseURL }) => {
  const profile = await mkdtemp(join(tmpdir(), 'motionsmith-notes-profile-'));
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true, baseURL, viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    await page.goto(APP_PATH);
    await dismissStartupAnnouncement(page);
    expect(await storedViewed(page)).toContain(note.id);
    await context.close();
    context = await chromium.launchPersistentContext(profile, { headless: true, baseURL });
    const restarted = await context.newPage();
    await restarted.goto(APP_PATH);
    await boot(restarted);
    await expect(restarted.getByTestId('getting-started-dialog')).toBeVisible();
    await expect(notesPanel(restarted)).toHaveCount(0);
    expect(await storedViewed(restarted)).toContain(note.id);
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});

test('acknowledgement merges across tabs without closing the other visible announcement', async ({ page, context }) => {
  const other = await context.newPage();
  await page.goto(APP_PATH);
  await other.goto(APP_PATH);
  await boot(page); await boot(other);
  await expect(notesPanel(page)).toBeVisible();
  await expect(notesPanel(other)).toBeVisible();
  expect(await storedViewed(page)).not.toContain(note.id);
  await notesPanel(page).getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => storedViewed(other)).toContain(note.id);
  await expect(notesPanel(other)).toBeVisible();
  await other.keyboard.press('Escape');
  await expect(other.getByTestId('getting-started-dialog')).toBeVisible();
});

test('manual update links locate controls without invoking file actions or changing work', async ({ page }) => {
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  await page.getByTestId('getting-started-dialog').getByRole('button', { name: 'Open starter rig', exact: true }).click();
  const before = await savedProject(page);
  let downloads = 0, pickers = 0;
  page.on('download', () => downloads++);
  page.on('filechooser', () => pickers++);
  for (const highlight of highlights.filter(highlight => highlight.destination && !highlight.destination.startsWith('help.'))) {
    const panel = await openManualNotes(page);
    await panel.getByRole('button', { name: `Show me: ${highlight.title}`, exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator('[data-feature-highlighted="true"]')).toBeVisible();
  }
  expect(downloads).toBe(0);
  expect(pickers).toBe(0);
  expect((await savedProject(page)).project).toEqual(before.project);
});

test('enlarged text keeps entry actions reachable by keyboard at 1280×720', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(APP_PATH); await boot(page);
  await page.addStyleTag({ content: 'html { font-size: 32px !important; }' });
  await expect(notesPanel(page)).toBeVisible();
  await notesPanel(page).getByRole('button', { name: 'Continue', exact: true }).click();
  const welcome = page.getByTestId('getting-started-dialog');
  await expect(welcome).toBeVisible();
  const open = welcome.getByRole('button', { name: 'Open Project', exact: true });
  for (let count = 0; count < 8 && !await open.evaluate(element => element === document.activeElement); count++) {
    await page.keyboard.press('Tab');
  }
  await expect(open).toBeFocused();
  await expect(open).toBeInViewport();
  expect(await open.evaluate(element => element.matches(':focus-visible'))).toBe(true);
  const pending = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await pending).setFiles([]);
  await expect(welcome).toBeVisible();
  const preference = welcome.getByTestId('getting-started-hide-session').getByRole('checkbox');
  for (let count = 0; count < 6 && !await preference.evaluate(element => element === document.activeElement); count++) {
    await page.keyboard.press('Tab');
  }
  await expect(preference).toBeFocused();
  await expect(preference).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('entry-enlarged-text.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('project-empty-state')).toBeVisible();
  await expect(page.getByTestId('project-backup-status')).toHaveAttribute('data-backup-state', 'waiting');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const blocked of ['persistent', 'both'] as const) {
  test(`denied ${blocked} note storage keeps acknowledgement in available fallback`, async ({ page }) => {
    await page.addInitScript(({ key, blocked }) => {
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      Storage.prototype.getItem = function(name) {
        if (name === key && (blocked === 'both' || this === localStorage)) throw new DOMException('Storage denied', 'SecurityError');
        return get.call(this, name);
      };
      Storage.prototype.setItem = function(name, value) {
        if (name === key && (blocked === 'both' || this === localStorage)) throw new DOMException('Storage denied', 'SecurityError');
        return set.call(this, name, value);
      };
    }, { key: RELEASE_READ_KEY, blocked });
    await page.goto(APP_PATH);
    await dismissStartupAnnouncement(page);
    await page.getByTestId('getting-started-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByTestId('whats-new-badge')).toHaveCount(0);
    await (await openManualNotes(page)).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByTestId('whats-new-entry')).toBeFocused();
    await expect(page.getByTestId('project-empty-state')).toBeVisible();
    if (blocked === 'persistent') {
      await page.reload(); await boot(page);
      await expect(page.getByTestId('getting-started-dialog')).toBeVisible();
      await expect(notesPanel(page)).toHaveCount(0);
    }
  });
}

test('corrupt preferences and missing screenshot keep notes usable without starting a project', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, '{corrupt'), RELEASE_READ_KEY);
  await page.route('**/release-notes/**', route => route.abort());
  await page.goto(APP_PATH); await boot(page);
  const panel = notesPanel(page);
  await expect(panel).toBeVisible();
  const image = highlights.find(highlight => highlight.image)?.image;
  if (image) {
    const fallback = panel.locator('p[role="img"]').filter({ hasText: image.alt });
    await expect(fallback).toHaveCount(1);
    await fallback.scrollIntoViewIfNeeded();
    await expect(fallback).toBeVisible();
  }
  await panel.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByTestId('getting-started-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('project-empty-state')).toBeVisible();
  expect(await storedViewed(page)).toContain(note.id);
});

for (const viewport of [
  { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 390, height: 844 },
]) {
  test('release history keeps startup actions fixed at ' + viewport.width, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(APP_PATH);
    await boot(page);
    const panel = notesPanel(page);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('MotionSmith v' + version);
    const versions = [...new Set(notes.map(entry => entry.version))];
    expect(await panel.locator('[data-release-version]').evaluateAll(elements =>
      elements.map(element => element.getAttribute('data-release-version')))).toEqual(versions);
    expect(await panel.locator('[data-release-note-id]').evaluateAll(elements =>
      elements.map(element => element.getAttribute('data-release-note-id')))).toEqual(notes.map(entry => entry.id));
    const history = panel.getByRole('region', { name: 'Update history', exact: true });
    const close = panel.getByRole('button', { name: 'Close', exact: true });
    const proceed = panel.getByRole('button', { name: 'Continue', exact: true });
    await expect(close).toBeInViewport();
    await expect(proceed).toBeInViewport();
    const closeBefore = await close.boundingBox();
    const proceedBefore = await proceed.boundingBox();
    await page.screenshot({ path: testInfo.outputPath('history-latest.png') });
    await history.focus();
    await page.keyboard.press('End');
    await expect.poll(() => history.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expect(panel.getByRole('heading', { name: highlights.at(-1)!.title, exact: true })).toBeInViewport();
    await expect(close).toBeInViewport();
    await expect(proceed).toBeInViewport();
    expect(Math.abs((await close.boundingBox())!.y - closeBefore!.y)).toBeLessThan(1);
    expect(Math.abs((await proceed.boundingBox())!.y - proceedBefore!.y)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Rendering/scanning the archive does not acknowledge it before dismissal.
    expect(await storedViewed(page)).not.toContain(note.id);
    await page.screenshot({ path: testInfo.outputPath('history-earlier.png') });
    await page.keyboard.press('Tab');
    await expect(proceed).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('getting-started-dialog')).toBeVisible();
    await expect.poll(() => storedViewed(page)).toContain(note.id);
    await expect.poll(() => storedViewed(page)).toContain(notes.at(-1)!.id);
  });
}

test('read updates remain in history after reopen and only the latest controls startup', async ({ page }) => {
  await page.addInitScript(({ key, id }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify([id]));
  }, { key: RELEASE_READ_KEY, id: note.id });
  await page.goto(APP_PATH); await boot(page);
  await expect(notesPanel(page)).toHaveCount(0);
  await page.getByTestId('getting-started-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('whats-new-badge')).toHaveCount(0);
  const panel = await openManualNotes(page);
  const history = panel.getByRole('region', { name: 'Update history', exact: true });
  expect(await storedViewed(page)).toEqual([note.id]);
  await history.focus();
  await page.keyboard.press('End');
  await expect(panel.getByRole('heading', { name: highlights.at(-1)!.title, exact: true })).toBeInViewport();
  expect(await storedViewed(page)).toEqual([note.id]);
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(() => storedViewed(page)).toContain(notes.at(-1)!.id);
  await page.reload(); await boot(page);
  await expect(notesPanel(page)).toHaveCount(0);
  await page.getByTestId('getting-started-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await openManualNotes(page);
  expect(await panel.locator('[data-release-note-id]').evaluateAll(elements =>
    elements.map(element => element.getAttribute('data-release-note-id')))).toEqual(notes.map(entry => entry.id));
});

test('enlarged text keeps release history and close controls keyboard reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(APP_PATH); await boot(page);
  await page.addStyleTag({ content: 'html { font-size: 32px !important; }' });
  const panel = notesPanel(page);
  const history = panel.getByRole('region', { name: 'Update history', exact: true });
  await history.focus();
  await page.keyboard.press('End');
  await expect.poll(() => history.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
  await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport();
  expect(await history.evaluate(element => element.clientHeight)).toBeGreaterThan(100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
