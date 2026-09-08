import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { dismissStartupAnnouncement } from './startupHarness';
import { createSampleProject } from '../../utils/project';
import type { ProjectState } from '../../types';
import type { VersionAuthority, VersionBranchInfo, VersionEntry } from '../../runtime/versions/versionTypes';
import type { VersionJobs } from '../../runtime/versions/versionJobs';
import { VERSION_POLICY } from '../../runtime/versions/versionPolicy';

const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? '/';
const DATABASE_NAME = 'motionsmith-persistence';
const STORE_NAME = 'autosave-journal';
const CATALOG_KEY = 'versions:catalog';
const ACTIVE_WRITER_KEY = 'versions:active-writer';
const CHOSEN_AT_KEY = 'versions:chosen-at';
const METADATA_KEY = 'metadata';

type FailureMode = 'none' | 'quota' | 'abort';
type JobReply<T> = { ok: true; result: T } | { ok: false; error: string };

type StorageSnapshot = {
  keys: string[];
  catalog?: VersionBranchInfo[];
  manifests: Record<string, unknown>;
  activeOwner?: string;
  chosenAt?: number;
  metadata?: Record<string, unknown>;
  currentRaw?: string;
  previousRaw?: string;
};

type StorageSession = {
  context: BrowserContext;
  page: Page;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const projectFixture = (id = 'storage-project', name = 'Storage fixture'): ProjectState => {
  const project = createSampleProject();
  return {
    ...project,
    metadata: {
      ...project.metadata,
      id,
      name,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
};

const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
const versionImage = (index: number) => `data:image/png;base64,${Buffer.concat([
  ONE_PIXEL_PNG,
  Buffer.from([index & 0xff, (index >> 8) & 0xff]),
]).toString('base64')}`;

const assetLimitProject = (partIndexes: readonly number[], id = 'asset-limit-project'): ProjectState => {
  const base = createSampleProject();
  const template = base.parts.head;
  const parts = Object.fromEntries(partIndexes.map((index, order) => {
    const partId = `asset-part-${index}`;
    return [partId, {
      ...template,
      id: partId,
      name: `Asset part ${index}`,
      textureUrl: versionImage(index * 2),
      maskUrl: versionImage(index * 2 + 1),
      anchorJointId: 'neck',
      zIndex: order,
    }];
  }));
  return {
    ...base,
    metadata: {
      ...base.metadata,
      id,
      name: 'Asset limit fixture',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    parts,
    partOrder: Object.keys(parts),
    sceneObjects: {},
    sceneObjectOrder: [],
    paths: {},
    pathOrder: [],
    mechanisms: [],
    selectedPartId: undefined,
    selectedPathId: undefined,
    selectedMechanismId: undefined,
    selectedSceneObjectId: undefined,
    characterPackage: undefined,
  };
};

const rotated = (project: ProjectState, rotation: number): ProjectState => {
  const next = clone(project);
  next.parts.head.transform.rotation = rotation;
  next.metadata.updatedAt = new Date(1_700_000_000_000 + rotation * 1_000).toISOString();
  return next;
};

const authority = (
  branchId: string,
  ownerId: string,
  projectId: string,
  chosenAt: number,
  lineageId = `lineage-${branchId}`,
): VersionAuthority => ({ branchId, ownerId, lineageId, projectId, chosenAt });

const manifestKey = (branchId: string) => `versions:${branchId}:manifest`;
const snapshotKey = (branchId: string, id: string) => `versions:${branchId}:snapshot:${id}`;
const assetKey = (branchId: string, id: string) => `versions:${branchId}:asset:${id}`;

const findWorkerAsset = async () => {
  const assetDir = join(process.cwd(), 'dist', 'assets');
  const files = (await readdir(assetDir)).filter(file => /^projectVersionsWorker-[^/]+\.js$/.test(file));
  if (!files.length) throw new Error(`Production versions Worker is missing from ${assetDir}`);
  const withTimes = await Promise.all(files.map(async file => ({ file, mtime: (await stat(join(assetDir, file))).mtimeMs })));
  withTimes.sort((left, right) => right.mtime - left.mtime || right.file.localeCompare(left.file));
  return `assets/${withTimes[0].file}`;
};

const openStorageFixture = async (browser: Browser, baseURL: string | undefined): Promise<StorageSession> => {
  const context = await browser.newContext({
    baseURL,
    acceptDownloads: true,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const fixtureURL = new URL(APP_PATH, baseURL ?? 'http://127.0.0.1:5173/').href;
  await page.route(fixtureURL, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><head><title>Version storage fixture</title></head><body></body></html>',
  }));
  await page.goto(fixtureURL);
  return { context, page };
};

const invokeVersionJob = async <K extends keyof VersionJobs>(
  page: Page,
  workerAsset: string,
  type: K,
  input: VersionJobs[K]['input'],
  mode: FailureMode = 'none',
): Promise<JobReply<VersionJobs[K]['output']>> => page.evaluate(async ({ workerAsset, type, input, mode }) => {
  const workerURL = new URL(workerAsset, location.href).href;
  let objectURL: string | undefined;
  let scriptURL = workerURL;
  if (mode !== 'none') {
    const failure = mode === 'quota'
      ? `throw new DOMException('Injected storage quota failure', 'QuotaExceededError');`
      : `try { this.transaction.abort(); } catch {} throw new DOMException('Injected interrupted write', 'AbortError');`;
    const wrapper = `
      import ${JSON.stringify(workerURL)};
      const realHandler = self.onmessage;
      const originalPut = IDBObjectStore.prototype.put;
      self.__motionsmithVersionFailureInjected = false;
      IDBObjectStore.prototype.put = function(value, key) {
        if (!self.__motionsmithVersionFailureInjected && typeof key === 'string' && key.includes(':snapshot:')) {
          self.__motionsmithVersionFailureInjected = true;
          ${failure}
        }
        return originalPut.call(this, value, key);
      };
      self.onmessage = event => realHandler(event);
    `;
    objectURL = URL.createObjectURL(new Blob([wrapper], { type: 'text/javascript' }));
    scriptURL = objectURL;
  }
  const worker = new Worker(scriptURL, { type: 'module' });
  const response = await new Promise<{ result?: unknown; error?: string }>((resolve) => {
    worker.onmessage = event => resolve(event.data as { result?: unknown; error?: string });
    worker.onerror = event => resolve({ error: event.message || 'Versions Worker failed.' });
    worker.onmessageerror = () => resolve({ error: 'Versions Worker returned unreadable data.' });
    worker.postMessage({ id: 1, type, input });
  });
  worker.terminate();
  if (objectURL) URL.revokeObjectURL(objectURL);
  return response.error ? { ok: false, error: response.error } : { ok: true, result: response.result };
}, { workerAsset, type, input, mode }) as Promise<JobReply<VersionJobs[K]['output']>>;

const expectJob = async <K extends keyof VersionJobs>(
  page: Page,
  workerAsset: string,
  type: K,
  input: VersionJobs[K]['input'],
  mode: FailureMode = 'none',
) => {
  const reply = await invokeVersionJob(page, workerAsset, type, input, mode);
  expect(reply.ok, reply.ok ? undefined : reply.error).toBe(true);
  return (reply as { ok: true; result: VersionJobs[K]['output'] }).result;
};

const expectJobError = async <K extends keyof VersionJobs>(
  page: Page,
  workerAsset: string,
  type: K,
  input: VersionJobs[K]['input'],
  message: RegExp,
  mode: FailureMode = 'none',
) => {
  const reply = await invokeVersionJob(page, workerAsset, type, input, mode);
  expect(reply.ok).toBe(false);
  expect((reply as { ok: false; error: string }).error).toMatch(message);
  return reply as { ok: false; error: string };
};

const readStorage = async (page: Page, branchIds: string[] = []): Promise<StorageSnapshot> => page.evaluate(async ({ databaseName, storeName, catalogKey, activeWriterKey, chosenAtKey, metadataKey, branchIds }) => {
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
  const metadata = await request(store.get(metadataKey)) as (Record<string, unknown> & { currentKey?: string; previousKey?: string }) | undefined;
  const currentRaw = metadata?.currentKey ? await request(store.get(metadata.currentKey)) as string | undefined : undefined;
  const previousRaw = metadata?.previousKey ? await request(store.get(metadata.previousKey)) as string | undefined : undefined;
  const result: StorageSnapshot = {
    keys: (await request(store.getAllKeys())).map(String),
    catalog: await request(store.get(catalogKey)) as VersionBranchInfo[] | undefined,
    manifests: Object.fromEntries(await Promise.all(branchIds.map(async branchId => [
      branchId,
      await request(store.get(`versions:${branchId}:manifest`)),
    ]))),
    activeOwner: await request(store.get(activeWriterKey)) as string | undefined,
    chosenAt: await request(store.get(chosenAtKey)) as number | undefined,
    metadata,
    currentRaw,
    previousRaw,
  };
  db.close();
  return result;
}, {
  databaseName: DATABASE_NAME,
  storeName: STORE_NAME,
  catalogKey: CATALOG_KEY,
  activeWriterKey: ACTIVE_WRITER_KEY,
  chosenAtKey: CHOSEN_AT_KEY,
  metadataKey: METADATA_KEY,
  branchIds,
});

type StoreMutation = { operation: 'put' | 'delete'; key: string; value?: unknown };

const mutateStorage = async (page: Page, mutations: StoreMutation[]) => page.evaluate(async ({ databaseName, storeName, mutations }) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const operation = indexedDB.open(databaseName, 1);
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('IndexedDB open failed'));
  });
  const transaction = db.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  for (const mutation of mutations) {
    if (mutation.operation === 'delete') store.delete(mutation.key);
    else store.put(mutation.value, mutation.key);
  }
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB mutation aborted'));
    transaction.onerror = () => undefined;
  });
  db.close();
}, { databaseName: DATABASE_NAME, storeName: STORE_NAME, mutations });

const captureInput = (
  source: ProjectState,
  currentAuthority: VersionAuthority,
  id: string,
  createdAt: number,
  reason: VersionEntry['reason'] = 'manual',
  name?: string,
) => ({
  authority: currentAuthority,
  source,
  id,
  projectId: source.metadata.id,
  createdAt,
  reason,
  description: `Captured ${id}`,
  ...(name ? { name } : {}),
});

const closeSession = async (session: StorageSession) => session.context.close();

test('production Worker installs, captures, and reloads committed metadata with on-demand selected reads', async ({ browser, baseURL }) => {
  const workerAsset = await findWorkerAsset();
  const session = await openStorageFixture(browser, baseURL);
  try {
    const project = projectFixture();
    const currentAuthority = authority('reload-branch', 'reload-owner', project.metadata.id, 1, 'reload-lineage');
    await expectJob(session.page, workerAsset, 'install', {
      authority: currentAuthority,
      projectName: project.metadata.name,
    });
    await expectJob(session.page, workerAsset, 'capture', captureInput(rotated(project, 12), currentAuthority, 'version-a', 10_000, 'manual', 'Working arm'));
    await expectJob(session.page, workerAsset, 'capture', captureInput(rotated(project, 31), currentAuthority, 'version-b', 20_000, 'automatic'));

    const beforeReload = await readStorage(session.page, [currentAuthority.branchId]);
    const manifest = beforeReload.manifests[currentAuthority.branchId] as {
      authority: VersionAuthority;
      projectName: string;
      entries: VersionEntry[];
    };
    expect(manifest.authority).toEqual(currentAuthority);
    expect(manifest.projectName).toBe(project.metadata.name);
    expect(manifest.entries.map(entry => entry.id)).toEqual(['version-b', 'version-a']);
    expect(manifest.entries.every(entry => entry.status === 'committed' && entry.committedAt >= entry.createdAt)).toBe(true);
    expect(beforeReload.catalog).toEqual([
      expect.objectContaining({ branchId: currentAuthority.branchId, projectId: project.metadata.id, projectName: project.metadata.name, versions: 2 }),
    ]);

    await session.page.reload();
    const afterReload = await expectJob(session.page, workerAsset, 'list', { branchId: currentAuthority.branchId });
    expect(afterReload.map(entry => entry.id)).toEqual(['version-b', 'version-a']);
    const selected = await expectJob(session.page, workerAsset, 'read', { branchId: currentAuthority.branchId, id: 'version-a' });
    expect(selected.entry.id).toBe('version-a');
    expect(selected.entry.name).toBe('Working arm');
    expect(selected.project.metadata.id).toBe(project.metadata.id);
    expect(selected.project.parts.head.transform.rotation).toBe(12);
  } finally {
    await closeSession(session);
  }
});

test('historical assets stay readable through sibling deletion and explicit branch removal preserves backup bodies', async ({ browser, baseURL }) => {
  const workerAsset = await findWorkerAsset();
  const session = await openStorageFixture(browser, baseURL);
  try {
    const project = projectFixture('asset-project', 'Asset fixture');
    const currentAuthority = authority('asset-branch', 'asset-owner', project.metadata.id, 1, 'asset-lineage');
    await expectJob(session.page, workerAsset, 'install', { authority: currentAuthority, projectName: project.metadata.name });
    const first = await expectJob(session.page, workerAsset, 'capture', captureInput(rotated(project, 4), currentAuthority, 'asset-a', 10_000));
    const second = await expectJob(session.page, workerAsset, 'capture', captureInput(rotated(project, 8), currentAuthority, 'asset-b', 20_000));
    const firstEntry = first.find(entry => entry.id === 'asset-a')!;
    const secondEntry = second.find(entry => entry.id === 'asset-b')!;
    expect(firstEntry.assetIds).toEqual(secondEntry.assetIds);
    expect(firstEntry.assetIds.length).toBeGreaterThan(0);

    await expectJob(session.page, workerAsset, 'update', { authority: currentAuthority, id: 'asset-b', change: 'remove' });
    const afterSiblingRemoval = await readStorage(session.page, [currentAuthority.branchId]);
    for (const id of firstEntry.assetIds) expect(afterSiblingRemoval.keys).toContain(assetKey(currentAuthority.branchId, id));
    const surviving = await expectJob(session.page, workerAsset, 'read', { branchId: currentAuthority.branchId, id: 'asset-a' });
    expect(surviving.project.parts.head.transform.rotation).toBe(4);

    const backupCurrent = '{"format":"backup-current"}';
    const backupPrevious = '{"format":"backup-previous"}';
    await mutateStorage(session.page, [
      { operation: 'put', key: 'backup-current-key', value: backupCurrent },
      { operation: 'put', key: 'backup-previous-key', value: backupPrevious },
      {
        operation: 'put',
        key: METADATA_KEY,
        value: {
          historyBranchId: currentAuthority.branchId,
          previousHistoryBranchId: currentAuthority.branchId,
          currentKey: 'backup-current-key',
          previousKey: 'backup-previous-key',
        },
      },
    ]);
    const catalog = (await readStorage(session.page)).catalog!;
    const selectedBranch = catalog.find(item => item.branchId === currentAuthority.branchId)!;
    const staleSelection = { ...selectedBranch, token: `${selectedBranch.token}-stale` };
    await expectJobError(session.page, workerAsset, 'removeBranch', staleSelection, /Browser history changed/);
    expect((await readStorage(session.page)).catalog).toEqual(catalog);

    await expectJob(session.page, workerAsset, 'removeBranch', selectedBranch);
    const afterBranchRemoval = await readStorage(session.page, [currentAuthority.branchId]);
    expect(afterBranchRemoval.catalog).toEqual([]);
    expect(afterBranchRemoval.manifests[currentAuthority.branchId]).toBeUndefined();
    expect(afterBranchRemoval.keys.some(key => key.startsWith(`versions:${currentAuthority.branchId}:`))).toBe(false);
    expect(afterBranchRemoval.metadata?.historyBranchId).toBeUndefined();
    expect(afterBranchRemoval.metadata?.previousHistoryBranchId).toBeUndefined();
    expect(afterBranchRemoval.currentRaw).toBe(backupCurrent);
    expect(afterBranchRemoval.previousRaw).toBe(backupPrevious);
  } finally {
    await closeSession(session);
  }
});

test('quota and interrupted writes roll back the manifest, catalog, and earlier readable state', async ({ browser, baseURL }) => {
  const workerAsset = await findWorkerAsset();
  const session = await openStorageFixture(browser, baseURL);
  try {
    for (const [index, mode] of (['quota', 'abort'] as const).entries()) {
      const project = projectFixture(`failure-project-${index}`, `Failure ${mode}`);
      const currentAuthority = authority(`failure-${mode}`, `failure-owner-${mode}`, project.metadata.id, 10 + index, `failure-lineage-${mode}`);
      await expectJob(session.page, workerAsset, 'install', { authority: currentAuthority, projectName: project.metadata.name });
      await expectJob(session.page, workerAsset, 'capture', captureInput(rotated(project, 3), currentAuthority, `stable-${mode}`, 1_000));
      const before = await readStorage(session.page, [currentAuthority.branchId]);
      await expectJobError(
        session.page,
        workerAsset,
        'capture',
        captureInput(rotated(project, 77), currentAuthority, `failed-${mode}`, 2_000),
        mode === 'quota' ? /Injected storage quota failure/ : /Injected interrupted write/,
        mode,
      );
      const after = await readStorage(session.page, [currentAuthority.branchId]);
      expect(after.manifests[currentAuthority.branchId]).toEqual(before.manifests[currentAuthority.branchId]);
      expect(after.catalog).toEqual(before.catalog);
      expect(after.keys).toEqual(before.keys);
      const stable = await expectJob(session.page, workerAsset, 'read', { branchId: currentAuthority.branchId, id: `stable-${mode}` });
      expect(stable.project.parts.head.transform.rotation).toBe(3);
    }
  } finally {
    await closeSession(session);
  }
});

test('retained version images are capped across valid captures without partial writes', async ({ browser, baseURL }) => {
  const workerAsset = await findWorkerAsset();
  const session = await openStorageFixture(browser, baseURL);
  try {
    const currentAuthority = authority('asset-limit-branch', 'asset-limit-owner', 'asset-limit-project', 1, 'asset-limit-lineage');
    await expectJob(session.page, workerAsset, 'install', { authority: currentAuthority, projectName: 'Asset limit fixture' });
    const backupCurrent = '{"format":"asset-limit-current"}';
    const backupPrevious = '{"format":"asset-limit-previous"}';
    await mutateStorage(session.page, [
      { operation: 'put', key: 'asset-limit-current-key', value: backupCurrent },
      { operation: 'put', key: 'asset-limit-previous-key', value: backupPrevious },
      {
        operation: 'put',
        key: METADATA_KEY,
        value: {
          currentKey: 'asset-limit-current-key',
          previousKey: 'asset-limit-previous-key',
          historyBranchId: currentAuthority.branchId,
          previousHistoryBranchId: currentAuthority.branchId,
        },
      },
    ]);

    const batches = Array.from({ length: 8 }, (_, batch) =>
      Array.from({ length: 32 }, (_, index) => batch * 32 + index));
    let retained: VersionEntry[] = [];
    for (const [batch, partIndexes] of batches.entries()) {
      retained = await expectJob(
        session.page,
        workerAsset,
        'capture',
        captureInput(assetLimitProject(partIndexes), currentAuthority, `asset-limit-${batch}`, 10_000 + batch),
      );
    }
    expect(retained).toHaveLength(batches.length);
    const before = await readStorage(session.page, [currentAuthority.branchId]);
    const beforeManifest = before.manifests[currentAuthority.branchId] as { entries: VersionEntry[] };
    const retainedAssetIds = new Set(beforeManifest.entries.flatMap(entry => entry.assetIds));
    expect(retainedAssetIds.size).toBe(VERSION_POLICY.assetCount);
    expect(before.catalog).toEqual([
      expect.objectContaining({ branchId: currentAuthority.branchId, projectId: currentAuthority.projectId, versions: batches.length }),
    ]);
    const priorList = await expectJob(session.page, workerAsset, 'list', { branchId: currentAuthority.branchId });
    const priorRead = await expectJob(session.page, workerAsset, 'read', {
      branchId: currentAuthority.branchId,
      id: 'asset-limit-7',
    });
    expect(priorRead.project.parts['asset-part-224'].textureUrl).toBe(versionImage(448));

    const finalBatch = batches[batches.length - 1];
    const changed = assetLimitProject(finalBatch);
    changed.parts['asset-part-224'] = {
      ...changed.parts['asset-part-224'],
      textureUrl: versionImage(VERSION_POLICY.assetCount),
    };
    await expectJobError(
      session.page,
      workerAsset,
      'capture',
      captureInput(changed, currentAuthority, 'asset-limit-overflow', 20_000),
      /Version images fill storage/,
    );

    const after = await readStorage(session.page, [currentAuthority.branchId]);
    expect(after.manifests[currentAuthority.branchId]).toEqual(before.manifests[currentAuthority.branchId]);
    expect(after.catalog).toEqual(before.catalog);
    expect(after.keys).toEqual(before.keys);
    expect(after.metadata).toEqual(before.metadata);
    expect(after.currentRaw).toBe(before.currentRaw);
    expect(after.previousRaw).toBe(before.previousRaw);
    expect(await expectJob(session.page, workerAsset, 'list', { branchId: currentAuthority.branchId })).toEqual(priorList);
    const afterRead = await expectJob(session.page, workerAsset, 'read', {
      branchId: currentAuthority.branchId,
      id: 'asset-limit-7',
    });
    expect(afterRead.entry).toEqual(priorRead.entry);
    expect(afterRead.project).toEqual(priorRead.project);
  } finally {
    await closeSession(session);
  }
});

test('corrupt snapshots and missing assets reject selected reads while retaining historical metadata', async ({ browser, baseURL }) => {
  const workerAsset = await findWorkerAsset();
  const session = await openStorageFixture(browser, baseURL);
  try {
    const project = projectFixture('corrupt-project', 'Corrupt fixture');
    const missingAuthority = authority('missing-asset-branch', 'missing-asset-owner', project.metadata.id, 1, 'missing-asset-lineage');
    await expectJob(session.page, workerAsset, 'install', { authority: missingAuthority, projectName: project.metadata.name });
    const entries = await expectJob(session.page, workerAsset, 'capture', captureInput(rotated(project, 6), missingAuthority, 'missing-asset', 1_000));
    const missingEntry = entries.find(entry => entry.id === 'missing-asset')!;
    const beforeMissing = await readStorage(session.page, [missingAuthority.branchId]);

    const corruptAuthority = authority('corrupt-snapshot-branch', 'corrupt-snapshot-owner', project.metadata.id, 2, 'corrupt-snapshot-lineage');
    await expectJob(session.page, workerAsset, 'install', { authority: corruptAuthority, projectName: project.metadata.name });
    const valid = await expectJob(session.page, workerAsset, 'capture', captureInput(rotated(project, 14), corruptAuthority, 'corrupt-snapshot', 2_000));
    const corruptEntry = valid.find(entry => entry.id === 'corrupt-snapshot')!;

    await mutateStorage(session.page, [{ operation: 'delete', key: assetKey(missingAuthority.branchId, missingEntry.assetIds[0]) }]);
    await expectJobError(session.page, workerAsset, 'read', { branchId: missingAuthority.branchId, id: missingEntry.id }, /Version artwork is missing|integrity check failed/);
    expect((await readStorage(session.page, [missingAuthority.branchId])).manifests[missingAuthority.branchId]).toEqual(beforeMissing.manifests[missingAuthority.branchId]);

    await mutateStorage(session.page, [{ operation: 'put', key: snapshotKey(corruptAuthority.branchId, corruptEntry.snapshotId), value: '{"corrupt":true}' }]);
    await expectJobError(session.page, workerAsset, 'read', { branchId: corruptAuthority.branchId, id: corruptEntry.id }, /integrity check failed/);
    const afterCorruption = await readStorage(session.page, [corruptAuthority.branchId]);
    expect((afterCorruption.manifests[corruptAuthority.branchId] as { entries: VersionEntry[] }).entries.map(entry => entry.id)).toEqual(['corrupt-snapshot']);
  } finally {
    await closeSession(session);
  }
});

test('same project IDs keep distinct branches, old owners cannot capture late, and browser branch count is capped', async ({ browser, baseURL }) => {
  const workerAsset = await findWorkerAsset();
  const session = await openStorageFixture(browser, baseURL);
  try {
    const project = projectFixture('same-project', 'Shared ID fixture');
    const firstAuthority = authority('same-id-a', 'same-owner-a', project.metadata.id, 10, 'lineage-a');
    const secondAuthority = authority('same-id-b', 'same-owner-b', project.metadata.id, 20, 'lineage-b');
    await expectJob(session.page, workerAsset, 'install', { authority: firstAuthority, projectName: 'First branch' });
    await expectJob(session.page, workerAsset, 'capture', captureInput(rotated(project, 11), firstAuthority, 'first-only', 100));
    await expectJob(session.page, workerAsset, 'install', { authority: secondAuthority, projectName: 'Second branch' });
    await expectJob(session.page, workerAsset, 'capture', captureInput(rotated(project, 22), secondAuthority, 'second-only', 200));
    expect((await expectJob(session.page, workerAsset, 'list', { branchId: firstAuthority.branchId })).map(entry => entry.id)).toEqual(['first-only']);
    expect((await expectJob(session.page, workerAsset, 'list', { branchId: secondAuthority.branchId })).map(entry => entry.id)).toEqual(['second-only']);

    const ownedBranch = authority('owner-branch', 'owner-a', project.metadata.id, 30, 'owner-lineage');
    await expectJob(session.page, workerAsset, 'install', { authority: ownedBranch, projectName: 'Owner branch' });
    await expectJob(session.page, workerAsset, 'capture', captureInput(rotated(project, 30), ownedBranch, 'before-claim', 300));
    const claimed = await expectJob(session.page, workerAsset, 'claim', {
      branchId: ownedBranch.branchId,
      ownerId: 'owner-b',
      projectId: project.metadata.id,
      chosenAt: 40,
    });
    expect(claimed.authority.ownerId).toBe('owner-b');
    await expectJobError(
      session.page,
      workerAsset,
      'capture',
      captureInput(rotated(project, 31), ownedBranch, 'late-old-owner', 400),
      /Another tab owns browser storage/,
    );
    expect((await expectJob(session.page, workerAsset, 'list', { branchId: ownedBranch.branchId })).map(entry => entry.id)).toEqual(['before-claim']);

    const emptyBranches: Array<Pick<VersionBranchInfo, 'branchId' | 'projectId' | 'projectName'>> = [];
    for (let index = 0; index < VERSION_POLICY.branches - 3; index += 1) {
      const branch = authority(`capacity-${index}`, `capacity-owner-${index}`, `capacity-project-${index}`, 100 + index, `capacity-lineage-${index}`);
      await expectJob(session.page, workerAsset, 'install', { authority: branch, projectName: `Capacity ${index}` });
      emptyBranches.push({ branchId: branch.branchId, projectId: branch.projectId, projectName: `Capacity ${index}` });
    }
    const catalog = (await readStorage(session.page)).catalog!;
    expect(catalog).toHaveLength(VERSION_POLICY.branches);
    for (const branch of emptyBranches) {
      expect(catalog).toEqual(expect.arrayContaining([expect.objectContaining({ ...branch, versions: 0 })]));
    }
    const extra = authority('capacity-overflow', 'capacity-overflow-owner', 'capacity-overflow-project', 200, 'capacity-overflow-lineage');
    await expectJobError(session.page, workerAsset, 'install', { authority: extra, projectName: 'Overflow' }, /Browser history is full/);
    const afterOverflow = await readStorage(session.page, [extra.branchId]);
    expect(afterOverflow.catalog).toHaveLength(VERSION_POLICY.branches);
    expect(afterOverflow.manifests[extra.branchId]).toBeUndefined();
  } finally {
    await closeSession(session);
  }
});

const openStarterForAutosave = async (browser: Browser, baseURL: string | undefined) => {
  const context = await browser.newContext({ baseURL, acceptDownloads: true, viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  const dialog = page.getByTestId('getting-started-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Open starter rig', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('character-screen')).toBeVisible();
  await expect.poll(async () => (await readStorage(page)).catalog?.[0]?.branchId ?? '').not.toBe('');
  await page.getByTestId('workflow-stage-project').click();
  await expect(page.getByTestId('project-backup-status')).toHaveAttribute('data-backup-state', 'saved');
  return { context, page };
};

test('a late owner change blocks the real autosave commit and leaves the last committed backup intact', async ({ browser, baseURL }) => {
  const session = await openStarterForAutosave(browser, baseURL);
  try {
    const initial = await readStorage(session.page);
    const branchId = initial.catalog![0].branchId;
    const before = await readStorage(session.page, [branchId]);
    const branchManifest = before.manifests[branchId] as { authority: VersionAuthority } | undefined;
    expect(branchManifest?.authority.ownerId).toBeTruthy();
    expect(before.metadata?.historyBranchId).toBe(branchId);
    await session.page.evaluate(async ({ databaseName, storeName, activeWriterKey }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put('foreign-autosave-owner', activeWriterKey);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('authority mutation aborted'));
      });
      db.close();
    }, { databaseName: DATABASE_NAME, storeName: STORE_NAME, activeWriterKey: ACTIVE_WRITER_KEY });

    await session.page.getByTestId('workflow-stage-character').click();
    await session.page.getByTestId('character-part-item-head').click();
    const field = session.page.getByTestId('stage-right-inspector').getByLabel('Rotation number', { exact: true });
    await field.fill('47');
    await field.press('Tab');
    await expect(field).toHaveValue('47');
    await session.page.getByTestId('workflow-stage-project').click();
    await expect(session.page.getByTestId('project-backup-status')).toHaveAttribute('data-backup-state', 'failed');
    await expect(session.page.getByTestId('status-bar')).toContainText('Browser backup unavailable. Save Project.');

    const after = await readStorage(session.page, [branchId]);
    expect(after.currentRaw).toBe(before.currentRaw);
    expect(after.previousRaw).toBe(before.previousRaw);
    expect(after.metadata).toEqual(before.metadata);
    expect(after.manifests[branchId]).toEqual(before.manifests[branchId]);
  } finally {
    await session.context.close();
  }
});
