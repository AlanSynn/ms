import { expect, test, type Page } from '@playwright/test';
import { dismissStartupAnnouncement } from './startupHarness';
import type { VersionEntry } from '../../runtime/versions/versionTypes';

const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? '/';
const DATABASE_NAME = 'motionsmith-persistence';
const STORE_NAME = 'autosave-journal';
const MINUTE = 60_000;

type VersionManifest = {
  authority: { branchId: string; projectId: string; ownerId: string; lineageId: string; chosenAt: number };
  entries: VersionEntry[];
};

type VersionStorageState = {
  branchId?: string;
  manifest?: VersionManifest;
  autosaveRotation?: number;
};

const readVersionStorage = async (page: Page): Promise<VersionStorageState> => page.evaluate(async ({ databaseName, storeName }) => {
  const request = <T>(operation: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('IndexedDB read failed'));
  });
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const operation = indexedDB.open(databaseName, 1);
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('IndexedDB open failed'));
  });
  const transaction = db.transaction(storeName, 'readonly');
  const store = transaction.objectStore(storeName);
  const metadata = await request(store.get('metadata')) as {
    historyBranchId?: string;
    currentKey?: string;
  } | undefined;
  const keys = (await request(store.getAllKeys())).map(String);
  const branchId = metadata?.historyBranchId ?? keys
    .find(key => key.startsWith('versions:') && key.endsWith(':manifest'))
    ?.slice('versions:'.length, -':manifest'.length);
  const manifest = branchId
    ? await request(store.get(`versions:${branchId}:manifest`)) as VersionManifest | undefined
    : undefined;
  let autosaveRotation: number | undefined;
  if (metadata?.currentKey) {
    const raw = await request(store.get(metadata.currentKey)) as string | undefined;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { parts?: { head?: { transform?: { rotation?: unknown } } } };
        const rotation = parsed.parts?.head?.transform?.rotation;
        if (typeof rotation === 'number') autosaveRotation = rotation;
      } catch {
        // Recovery itself reports malformed snapshots; this probe only waits for a durable value.
      }
    }
  }
  db.close();
  return { branchId, manifest, autosaveRotation };
}, { databaseName: DATABASE_NAME, storeName: STORE_NAME });

const waitForBranch = async (page: Page) => {
  let branchId = '';
  await expect.poll(async () => {
    branchId = (await readVersionStorage(page)).branchId ?? '';
    return branchId;
  }, { message: 'version branch installed in IndexedDB' }).not.toBe('');
  return branchId;
};

const waitForAutosaveRotation = async (page: Page, rotation: number) => {
  await expect.poll(async () => (await readVersionStorage(page)).autosaveRotation ?? null, {
    message: `autosave committed Head rotation ${rotation}`,
  }).toBe(rotation);
  await expect(page.getByTestId('project-backup-status')).toHaveAttribute('data-backup-state', 'saved');
};

const waitForAutomaticCapture = async (page: Page, atOrAfter: number) => {
  let latest: VersionEntry | undefined;
  await expect.poll(async () => {
    const entries = (await readVersionStorage(page)).manifest?.entries ?? [];
    latest = entries
      .filter(entry => entry.reason === 'automatic' && entry.createdAt >= atOrAfter && entry.status === 'committed')
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    return latest?.createdAt ?? 0;
  }, { message: `automatic version committed at or after ${atOrAfter}` }).toBeGreaterThanOrEqual(atOrAfter);
  return latest!;
};

const openVersions = async (page: Page) => {
  await page.getByTestId('workflow-stage-project').click();
  const panel = page.getByTestId('earlier-versions-panel');
  const lifecycle = page.getByTestId('project-lifecycle-panel');
  await expect.poll(async () => {
    if (await panel.count()) return 'versions';
    if (await lifecycle.count()) return 'project';
    return '';
  }, { message: 'Project stage is ready' }).not.toBe('');
  if (await lifecycle.count()) await lifecycle.getByTestId('project-earlier-versions').click();
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('earlier-versions-list')).toBeVisible();
};

const closeVersions = async (page: Page) => {
  if (await page.getByTestId('earlier-versions-panel').count()) {
    await page.getByTestId('earlier-versions-close').click();
  }
  await expect(page.getByTestId('project-lifecycle-panel')).toBeVisible();
};

const editHead = async (page: Page, rotation: number) => {
  await page.getByTestId('workflow-stage-character').click();
  await page.getByTestId('character-part-item-head').click();
  const field = page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true });
  await field.fill(String(rotation));
  await field.press('Tab');
  await expect(field).toHaveValue(String(rotation));
  await page.evaluate(() => new Promise<void>(resolve => queueMicrotask(resolve)));
};

const acceptRestore = async (page: Page) => {
  const message = page.waitForEvent('dialog').then(async dialog => {
    const text = dialog.message();
    await dialog.accept();
    return text;
  });
  await page.getByTestId('earlier-version-restore').click();
  expect(await message).toBe('Restore this version? Your current work will be kept.');
  await expect(page.getByTestId('status-bar')).toContainText('Version restored. Current work was kept.');
};

test('automatic versions retain classroom time coverage through a burst and browser recovery', async ({ page }) => {
  // Keep the page clock behind the real Worker clock. The implementation must
  // retain the later Worker commit time rather than reporting an impossible
  // committedAt before createdAt.
  await page.clock.install({ time: new Date('2020-01-01T00:00:00.000Z') });
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  const entry = page.getByTestId('getting-started-dialog');
  await expect(entry).toBeVisible();
  await entry.getByRole('button', { name: 'Open starter rig', exact: true }).click();
  await expect(entry).toHaveCount(0);
  await expect(page.getByTestId('character-screen')).toBeVisible();

  await openVersions(page);
  await expect(page.getByTestId('earlier-versions-list').locator('[data-version-status="committed"]')).toHaveCount(0);
  await closeVersions(page);
  const branchId = await waitForBranch(page);

  // Selection, stage changes, and presentation preferences are not document
  // edits and must not create automatic versions.
  await page.getByTestId('workflow-stage-character').click();
  await page.getByTestId('character-part-item-head').click();
  await page.getByTestId('workflow-stage-options').click();
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.getByTestId('workflow-stage-project').click();
  await expect(page.getByTestId('project-lifecycle-panel')).toBeVisible();
  await page.clock.fastForward(MINUTE + 1_000);
  await expect(page.getByTestId('project-backup-status')).toHaveAttribute('data-backup-state', 'saved');
  const afterPresentation = (await readVersionStorage(page)).manifest;
  expect(afterPresentation?.authority.branchId).toBe(branchId);
  expect(afterPresentation?.entries ?? []).toHaveLength(0);

  // Keep an explicit checkpoint before the automatic timeline begins.
  await openVersions(page);
  await page.locator('#earlier-version-name').fill('Before timed edits');
  await page.getByTestId('earlier-version-keep').click();
  await expect(page.getByTestId('earlier-versions-panel').locator('[data-version-reason="manual"]')).toHaveCount(1);
  await expect(page.getByTestId('earlier-versions-panel').locator('[data-version-reason="manual"]')).toHaveAttribute('data-version-status', 'committed');
  await closeVersions(page);

  const observedAutomaticIds = new Set<string>();
  const observedCaptures: Array<{ createdAt: number; rotation: number }> = [];
  for (let minute = 1; minute <= 30; minute += 1) {
    const rotation = 10 + minute;
    await editHead(page, rotation);
    await page.getByTestId('workflow-stage-project').click();
    await expect(page.getByTestId('project-backup-status')).toBeVisible();
    const targetTime = await page.evaluate(() => Date.now() + 60_000);
    await page.clock.fastForward(MINUTE);
    await waitForAutosaveRotation(page, rotation);
    const captured = await waitForAutomaticCapture(page, targetTime - 1_000);
    observedAutomaticIds.add(captured.id);
    observedCaptures.push({ createdAt: captured.createdAt, rotation });
  }

  // Several edits arrive before the next boundary. They should coalesce into
  // a later committed automatic state without evicting the older time bucket.
  for (let burst = 0; burst < 8; burst += 1) {
    await editHead(page, 100 + burst);
  }
  await page.getByTestId('workflow-stage-project').click();
  const burstTargetTime = await page.evaluate(() => Date.now() + 60_000);
  await page.clock.fastForward(MINUTE);
  await waitForAutosaveRotation(page, 107);
  const burstCapture = await waitForAutomaticCapture(page, burstTargetTime - 1_000);
  observedAutomaticIds.add(burstCapture.id);
  observedCaptures.push({ createdAt: burstCapture.createdAt, rotation: 107 });

  const finalState = await readVersionStorage(page);
  const finalNow = await page.evaluate(() => Date.now());
  const entries = finalState.manifest?.entries ?? [];
  const automatic = entries.filter(entry => entry.reason === 'automatic');
  expect(
    observedAutomaticIds.size,
    '30 minutes plus the burst each committed an automatic state',
  ).toBeGreaterThanOrEqual(31);
  expect(automatic.length, 'retention keeps a useful automatic history').toBeGreaterThanOrEqual(10);
  expect(automatic.every(entry => entry.status === 'committed' && entry.committedAt >= entry.createdAt)).toBe(true);
  expect(automatic.some(entry => entry.committedAt > entry.createdAt), 'Worker commit time is preserved when its clock is ahead').toBe(true);
  const target = automatic.find(entry => {
    const age = finalNow - entry.createdAt;
    return age >= 10 * MINUTE && age <= 15 * MINUTE;
  });
  expect(target, 'a 10–15 minute old automatic entry remains after the burst').toBeTruthy();
  const expectedRotation = observedCaptures
    .map(capture => ({ ...capture, distance: Math.abs(capture.createdAt - target!.createdAt) }))
    .sort((left, right) => left.distance - right.distance)[0]?.rotation;
  expect(expectedRotation).toBeDefined();

  // A reload leaves the backup unchosen. Recovery is explicit, then the
  // claimed history branch exposes both the kept checkpoint and autosaves.
  await page.clock.setSystemTime(finalNow + MINUTE);
  await page.reload();
  await dismissStartupAnnouncement(page);
  await expect(page.getByTestId('getting-started-dialog')).toBeVisible();
  await expect(page.getByTestId('recover-browser-backup')).toBeVisible();
  await page.getByTestId('recover-browser-backup').click();
  await expect(page.getByTestId('status-bar')).toContainText('Recovered browser backup');

  await openVersions(page);
  const recoveredEntries = (await readVersionStorage(page)).manifest?.entries ?? [];
  expect(recoveredEntries.some(entry => entry.reason === 'manual')).toBe(true);
  expect(recoveredEntries.some(entry => entry.reason === 'automatic')).toBe(true);
  const recoveredTarget = page.getByTestId(`earlier-version-row-${target!.id}`);
  await expect(recoveredTarget).toBeVisible();
  await recoveredTarget.locator('[data-earlier-version-select]').click();
  await expect(page.getByTestId('earlier-version-preview')).toBeVisible();
  await acceptRestore(page);
  await page.getByTestId('workflow-stage-character').click();
  await page.getByTestId('character-part-item-head').click();
  await expect(page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true })).toHaveValue(String(expectedRotation));
});
