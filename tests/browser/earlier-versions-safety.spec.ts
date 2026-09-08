import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { ProjectState } from '../../types';
import { createSampleProject, loadProjectSnapshot, serializeProject } from '../../utils/project';
import { readPortableProjectBundle } from '../../runtime/versions/versionPortable';
import { readBrowserAutosaveProbe, type BrowserAutosaveProbe } from './autosaveIndexedDbProbe';
import { dismissStartupAnnouncement } from './startupHarness';

const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? '/';
const DATABASE_NAME = 'motionsmith-persistence';
const STORE_NAME = 'autosave-journal';

type VersionFailureMode = 'none' | 'quota' | 'abort' | 'install-quota';
type VersionSafety = {
  holdRead: (enabled?: boolean) => void;
  releaseRead: () => void;
  pendingReadCount: () => number;
  setWriteFailure: (mode: VersionFailureMode) => void;
};

declare global {
  interface Window {
    __versionSafety: VersionSafety;
  }
}

type StoredManifest = {
  authority: { branchId: string; ownerId: string; lineageId: string; projectId: string; chosenAt: number };
  entries: Array<{ id: string; snapshotId: string; reason: string }>;
};

const fixture = (name: string, id = name): ProjectState => {
  const base = createSampleProject({ includeMechanism: true });
  return loadProjectSnapshot({
    ...base,
    metadata: { ...base.metadata, id, name, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    settings: { ...base.settings, autosave: true },
  });
};

const editHead = async (page: Page, rotation: number) => {
  await page.getByTestId('workflow-stage-character').click();
  await page.getByTestId('character-part-item-head').click();
  const field = page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true });
  await field.fill(String(rotation));
  await field.press('Tab');
  await expect(field).toHaveValue(String(rotation));
};

const openVersions = async (page: Page) => {
  await page.getByTestId('workflow-stage-project').click();
  const currentPanel = page.getByTestId('project-lifecycle-panel');
  const panel = page.getByTestId('earlier-versions-panel');
  await expect.poll(async () => {
    if (await panel.count()) return 'history';
    if (await currentPanel.count()) return 'current';
    return '';
  }).not.toBe('');
  if (await currentPanel.count()) await currentPanel.getByTestId('project-earlier-versions').click();
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('earlier-versions-list')).toBeVisible();
};

const closeVersions = async (page: Page) => {
  await page.getByTestId('workflow-stage-project').click();
  const panel = page.getByTestId('earlier-versions-panel');
  if (await panel.count()) await panel.getByTestId('earlier-versions-close').click();
  await expect(page.getByTestId('project-lifecycle-panel')).toBeVisible();
};

const keepVersionA = async (page: Page) => {
  await openVersions(page);
  await page.locator('#earlier-version-name').fill('Version A');
  await page.getByTestId('earlier-version-keep').click();
  const row = page.getByTestId('earlier-versions-panel').locator('[data-version-reason="manual"]');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-version-status', 'committed');
  return row;
};

const selectVersionA = async (page: Page) => {
  const row = page.getByTestId('earlier-versions-panel').locator('[data-version-reason="manual"]');
  await expect(row).toHaveCount(1);
  await row.locator('[data-earlier-version-select]').click();
  const preview = page.getByTestId('earlier-version-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('data-preview-read-only', 'true');
  await expect(page.getByTestId('earlier-version-viewing')).toHaveText('Viewing earlier version');
  return preview;
};

const acceptRestore = async (page: Page) => {
  const dialog = page.waitForEvent('dialog').then(async confirmation => {
    const message = confirmation.message();
    await confirmation.accept();
    return message;
  });
  await page.getByTestId('earlier-version-restore').click();
  expect(await dialog).toBe('Restore this version? Your current work will be kept.');
};

const waitForBackup = async (page: Page) => {
  await page.getByTestId('workflow-stage-project').click();
  await expect(page.getByTestId('project-backup-status')).toHaveAttribute('data-backup-state', 'saved');
};

const readVersionManifest = async (page: Page): Promise<{ branchId: string; manifest: StoredManifest }> => page.evaluate(async ({ databaseName, storeName }) => {
  const get = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
  });
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
  const transaction = database.transaction(storeName, 'readonly');
  const store = transaction.objectStore(storeName);
  const metadata = await get(store.get('metadata')) as { historyBranchId?: string } | undefined;
  const branchId = metadata?.historyBranchId;
  if (!branchId) throw new Error('Current backup has no version branch');
  const manifest = await get(store.get(`versions:${branchId}:manifest`)) as StoredManifest | undefined;
  if (!manifest) throw new Error('Version manifest is missing');
  database.close();
  return { branchId, manifest };
}, { databaseName: DATABASE_NAME, storeName: STORE_NAME });

const mutateVersionRecord = async (page: Page, key: string, value: unknown) => page.evaluate(async ({ databaseName, storeName, key, value }) => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
  const transaction = database.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(value, key);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB mutation aborted'));
    transaction.onerror = () => undefined;
  });
  database.close();
}, { databaseName: DATABASE_NAME, storeName: STORE_NAME, key, value });

/**
 * Hold only a versions `read` response and let the test change the active
 * project before that response reaches the real hook. The Blob wrapper keeps
 * the production Worker and its IndexedDB code in the path; it only adds a
 * control message for one-shot quota/abort injection.
 */
const installVersionSafetyGate = (page: Page) => page.addInitScript(() => {
  const NativeWorker = window.Worker;
  const pending: Array<() => void> = [];
  const workers = new Set<Worker>();
  let holdRead = false;
  let writeFailure: VersionFailureMode = 'none';

  const releaseRead = () => {
    holdRead = false;
    const waiting = pending.splice(0);
    waiting.forEach(deliver => deliver());
  };
  const setWriteFailure = (mode: VersionFailureMode) => {
    writeFailure = mode;
    for (const worker of workers) worker.postMessage({ id: 0, type: '__motionsmith-version-failure-control', mode });
  };
  window.__versionSafety = {
    holdRead: (enabled = true) => { holdRead = enabled; },
    releaseRead,
    pendingReadCount: () => pending.length,
    setWriteFailure,
  };

  window.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      const name = options?.name ?? '';
      let scriptURL = String(url);
      let blobURL: string | undefined;
      if (name === 'motionsmith-versions') {
        const sourceURL = scriptURL;
        const wrapper = `
          import ${JSON.stringify(sourceURL)};
          const realHandler = self.onmessage;
          let failureMode = 'none';
          let failed = false;
          const originalPut = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function(value, key) {
            const isInstallFailure = failureMode === 'install-quota' && typeof key === 'string' && key.includes(':manifest');
            const isCaptureFailure = failureMode !== 'install-quota' && typeof key === 'string' && key.includes(':snapshot:');
            if (!failed && failureMode !== 'none' && (isInstallFailure || isCaptureFailure)) {
              failed = true;
              if (failureMode === 'quota' || failureMode === 'install-quota') {
                throw new DOMException(
                  failureMode === 'install-quota' ? 'Injected initial storage quota failure' : 'Injected pre-restore quota failure',
                  'QuotaExceededError',
                );
              }
              try { this.transaction.abort(); } catch {}
              throw new DOMException('Injected pre-restore interrupted write', 'AbortError');
            }
            return originalPut.call(this, value, key);
          };
          self.onmessage = event => {
            if (event.data?.type === '__motionsmith-version-failure-control') {
              failureMode = event.data.mode || 'none';
              failed = false;
              return;
            }
            realHandler(event);
          };
        `;
        blobURL = URL.createObjectURL(new Blob([wrapper], { type: 'text/javascript' }));
        scriptURL = blobURL;
      }
      super(scriptURL, options);
      if (name !== 'motionsmith-versions') return;
      const versionWorker = this as Worker;
      workers.add(versionWorker);
      const nativePost = versionWorker.postMessage.bind(versionWorker);
      const requestKinds = new Map<number, string>();
      versionWorker.postMessage = ((message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => {
        if (message && typeof message === 'object' && 'id' in message) {
          const data = message as { id?: unknown; type?: unknown };
          if (typeof data.id === 'number') requestKinds.set(data.id, typeof data.type === 'string' ? data.type : '');
        }
        return nativePost(message, transfer as Transferable[]);
      }) as typeof versionWorker.postMessage;
      let listener: Worker['onmessage'] = null;
      Object.defineProperty(versionWorker, 'onmessage', {
        configurable: true,
        get: () => listener,
        set: next => { listener = next; },
      });
      versionWorker.addEventListener('message', event => {
        const id = (event.data as { id?: unknown } | undefined)?.id;
        const kind = typeof id === 'number' ? requestKinds.get(id) : undefined;
        if (typeof id === 'number') requestKinds.delete(id);
        const captured = listener;
        if (!captured) return;
        const deliver = () => captured.call(versionWorker, event);
        if (kind === 'read' && holdRead) pending.push(deliver);
        else deliver();
      });
      if (writeFailure !== 'none') versionWorker.postMessage({ id: 0, type: '__motionsmith-version-failure-control', mode: writeFailure });
      const nativeTerminate = versionWorker.terminate.bind(versionWorker);
      versionWorker.terminate = () => {
        workers.delete(versionWorker);
        nativeTerminate();
        if (blobURL) URL.revokeObjectURL(blobURL);
      };
    }
  };
});

const startStarter = async (page: Page) => {
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  const dialog = page.getByTestId('getting-started-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Open starter rig', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('character-screen')).toBeVisible();
};

const loadProject = async (page: Page, project: ProjectState, name: string) => {
  const menu = page.getByTestId('command-menu-file');
  if (!await menu.evaluate(node => (node.parentElement as HTMLDetailsElement).open)) await menu.click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('command-load-project').click();
  await (await chooser).setFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(serializeProject(project)),
  });
  await expect(page.getByTestId('status-bar')).toContainText(`Loaded project ${name}`);
};

const holdRestoreRead = async (page: Page) => {
  await page.evaluate(() => window.__versionSafety.holdRead(true));
  await acceptRestore(page);
  await expect.poll(() => page.evaluate(() => window.__versionSafety.pendingReadCount())).toBe(1);
};

const assertBackupUnchanged = (before: BrowserAutosaveProbe, after: BrowserAutosaveProbe) => {
  expect(after.currentRaw).toBe(before.currentRaw);
  expect(after.previousRaw).toBe(before.previousRaw);
  expect(after.metadata).toEqual(before.metadata);
};

test('a delayed restore read cannot replace a later real edit', async ({ page }) => {
  await installVersionSafetyGate(page);
  await startStarter(page);
  await editHead(page, 12);
  await keepVersionA(page);
  await closeVersions(page);
  await editHead(page, 31);

  await openVersions(page);
  await selectVersionA(page);
  await holdRestoreRead(page);

  await page.getByTestId('earlier-version-back').click();
  await editHead(page, 55);
  await page.evaluate(() => window.__versionSafety.releaseRead());
  await expect.poll(() => page.evaluate(() => window.__versionSafety.pendingReadCount())).toBe(0);

  await expect(page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true })).toHaveValue('55');
  const branch = await readVersionManifest(page);
  expect(branch.manifest.entries.map(entry => entry.reason)).toEqual(['manual']);
});

test('a delayed restore read cannot replace a newly opened file', async ({ page }) => {
  await installVersionSafetyGate(page);
  await startStarter(page);
  await editHead(page, 12);
  await keepVersionA(page);
  await closeVersions(page);
  await editHead(page, 31);

  await openVersions(page);
  await selectVersionA(page);
  await holdRestoreRead(page);

  const later = fixture('Later selected file', 'later-file');
  await page.getByTestId('workflow-stage-character').click();
  page.once('dialog', dialog => { void dialog.accept(); });
  await loadProject(page, later, 'later-file.motionsmith');
  await page.evaluate(() => window.__versionSafety.releaseRead());
  await expect.poll(() => page.evaluate(() => window.__versionSafety.pendingReadCount())).toBe(0);

  await editHead(page, 88);
  await expect(page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true })).toHaveValue('88');
  expect((await readVersionManifest(page)).manifest.authority.projectId).toBe(later.metadata.id);
});

test('a delayed failed restore read after Back cannot mark later work failed', async ({ page }) => {
  await installVersionSafetyGate(page);
  await startStarter(page);
  await editHead(page, 12);
  await keepVersionA(page);
  await closeVersions(page);
  await editHead(page, 31);
  await waitForBackup(page);

  const branch = await readVersionManifest(page);
  const selected = branch.manifest.entries.find(entry => entry.reason === 'manual');
  expect(selected).toBeDefined();

  await openVersions(page);
  await selectVersionA(page);
  await mutateVersionRecord(page, `versions:${branch.branchId}:snapshot:${selected!.snapshotId}`, '{corrupted snapshot');
  await holdRestoreRead(page);

  await page.getByTestId('earlier-version-back').click();
  await editHead(page, 55);
  await page.evaluate(() => window.__versionSafety.releaseRead());
  await expect.poll(() => page.evaluate(() => window.__versionSafety.pendingReadCount())).toBe(0);
  await expect(page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true })).toHaveValue('55');

  await openVersions(page);
  await expect(page.getByTestId('earlier-versions-failure')).toHaveCount(0);
});

test('a pre-replacement quota failure keeps current work, exposes fallbacks, and retries New Project', async ({ page }) => {
  await installVersionSafetyGate(page);
  await startStarter(page);
  await editHead(page, 12);
  await keepVersionA(page);
  await closeVersions(page);
  await editHead(page, 31);
  await waitForBackup(page);
  const beforeBackup = await readBrowserAutosaveProbe(page);

  await page.getByTestId('workflow-stage-project').click();
  const currentPanel = page.getByTestId('project-lifecycle-panel');
  await page.evaluate(() => window.__versionSafety.setWriteFailure('quota'));
  const firstConfirmation = page.waitForEvent('dialog').then(async dialog => {
    expect(dialog.message()).toContain('Start a new project?');
    await dialog.accept();
  });
  await currentPanel.getByRole('button', { name: 'New Project', exact: true }).click();
  await firstConfirmation;

  const failure = page.getByTestId('earlier-versions-failure');
  await expect(failure).toBeVisible();
  await expect(failure).toContainText('Injected pre-restore quota failure');
  await expect(failure.getByTestId('earlier-versions-retry')).toBeVisible();
  await expect(failure.getByTestId('earlier-versions-save-current-only')).toBeVisible();
  assertBackupUnchanged(beforeBackup, await readBrowserAutosaveProbe(page));

  const currentOnlyDownload = page.waitForEvent('download');
  await failure.getByTestId('earlier-versions-save-current-only').click();
  const download = await currentOnlyDownload;
  expect(download.suggestedFilename()).toContain('-current-only');
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const currentOnly = await readPortableProjectBundle(JSON.parse(await readFile(downloadPath!, 'utf8')));
  expect(currentOnly.project.parts.head.transform.rotation).toBe(31);

  const retryConfirmation = page.waitForEvent('dialog').then(async dialog => {
    expect(dialog.message()).toContain('Start a new project?');
    await dialog.accept();
  });
  await openVersions(page);
  await expect(page.getByTestId('earlier-versions-failure')).toBeVisible();
  await page.getByTestId('earlier-versions-retry').click();
  await retryConfirmation;
  await expect(page.getByTestId('status-bar')).toContainText('New project');
  await page.getByTestId('workflow-stage-project').click();
  await expect(page.getByTestId('project-empty-state')).toBeVisible();
});

test('an initial version storage failure opens Earlier versions with recovery actions', async ({ page }) => {
  await installVersionSafetyGate(page);
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  const dialog = page.getByTestId('getting-started-dialog');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.__versionSafety.setWriteFailure('install-quota'));
  await dialog.getByRole('button', { name: 'Open starter rig', exact: true }).click();

  const failure = page.getByTestId('earlier-versions-failure');
  await expect(failure).toBeVisible();
  await expect(failure).toContainText('Injected initial storage quota failure');
  await expect(failure.getByTestId('earlier-versions-retry')).toBeVisible();
  await expect(failure.getByTestId('earlier-versions-save-current-only')).toBeVisible();
});

for (const mode of ['quota', 'abort'] as const) {
  test(`pre-restore ${mode} failure keeps current state and backup byte-identical`, async ({ page }) => {
    await installVersionSafetyGate(page);
    await startStarter(page);
    await editHead(page, 12);
    await keepVersionA(page);
    await closeVersions(page);
    await editHead(page, 31);
    await waitForBackup(page);
    const beforeBackup = await readBrowserAutosaveProbe(page);

    await openVersions(page);
    await selectVersionA(page);
    await page.evaluate(failureMode => window.__versionSafety.setWriteFailure(failureMode), mode);
    await acceptRestore(page);
    const failure = page.getByTestId('earlier-versions-failure');
    await expect(failure).toBeVisible();
    await expect(failure).toContainText(mode === 'quota' ? 'Injected pre-restore quota failure' : 'Injected pre-restore interrupted write');
    await expect(failure.getByTestId('earlier-versions-retry')).toBeVisible();
    await expect(failure.getByTestId('earlier-versions-save-current-only')).toBeVisible();
    await expect(page.getByTestId('project-backup-status')).toHaveAttribute('data-backup-state', 'saved');
    assertBackupUnchanged(beforeBackup, await readBrowserAutosaveProbe(page));

    // A failed protection capture must leave the selected source readable.
    await page.evaluate(() => window.__versionSafety.setWriteFailure('none'));
    await closeVersions(page);
    await openVersions(page);
    await selectVersionA(page);
    await expect(page.getByTestId('earlier-version-preview')).toBeVisible();
    await closeVersions(page);
    await editHead(page, 31);
    await expect(page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true })).toHaveValue('31');
    const branch = await readVersionManifest(page);
    expect(branch.manifest.entries.map(entry => entry.reason)).toEqual(['manual']);
  });
}

test('a corrupted selected snapshot cannot restore and leaves current work unchanged', async ({ page }) => {
  await startStarter(page);
  await editHead(page, 12);
  await keepVersionA(page);
  await closeVersions(page);
  await editHead(page, 31);
  await waitForBackup(page);
  const beforeBackup = await readBrowserAutosaveProbe(page);
  const branch = await readVersionManifest(page);
  const selected = branch.manifest.entries.find(entry => entry.reason === 'manual');
  expect(selected).toBeDefined();
  await mutateVersionRecord(page, `versions:${branch.branchId}:snapshot:${selected!.snapshotId}`, '{corrupted snapshot');

  await openVersions(page);
  await page.getByTestId('earlier-versions-panel').locator('[data-version-reason="manual"] [data-earlier-version-select]').click();
  const failure = page.getByTestId('earlier-versions-failure');
  await expect(failure).toBeVisible();
  await expect(failure).toContainText(/integrity check failed|unavailable|corrupt/i);
  await expect(page.getByTestId('earlier-version-preview')).toHaveCount(0);
  await expect(page.getByTestId('project-backup-status')).toHaveAttribute('data-backup-state', 'saved');
  assertBackupUnchanged(beforeBackup, await readBrowserAutosaveProbe(page));

  await page.getByTestId('earlier-versions-close').click();
  await editHead(page, 31);
  await expect(page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true })).toHaveValue('31');
  const after = await readVersionManifest(page);
  expect(after.manifest.entries.map(entry => entry.reason)).toEqual(['manual']);
});
