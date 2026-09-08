import { AUTOSAVE_INDEXED_DB_STORE, openAutosaveDatabase, requestResult, transactionDone } from '../persistence/autosaveIndexedDb';
import { versionRetention } from './versionPolicy';
import { validateVersionArchive, type EncodedVersion } from './versionCodec';
import type { VersionArchive, VersionAuthority, VersionBranchInfo, VersionEntry } from './versionTypes';
import { browserVersionCapacity, readVersionCatalog, recordVersionBranch, VERSION_CATALOG_KEY } from './versionCatalog';
import { VERSION_POLICY } from './versionPolicy';
import { activateVersionAuthority, verifyVersionAuthority, versionManifestKey } from './versionAuthority';
import { validateVersionManifest, validVersionEntry, type VersionManifest as Manifest } from './versionManifest';
export { VERSION_ACTIVE_WRITER_KEY, versionManifestKey } from './versionAuthority';

const snapshotKey = (branchId: string, id: string) => `versions:${branchId}:snapshot:${id}`;
const assetKey = (branchId: string, id: string) => `versions:${branchId}:asset:${id}`;

const withStore = async <T>(mode: IDBTransactionMode, job: (store: IDBObjectStore) => Promise<T>) => {
  const db = await openAutosaveDatabase();
  const tx = db.transaction(AUTOSAVE_INDEXED_DB_STORE, mode);
  const done = transactionDone(tx);
  // Observe abort immediately, even when a request rejects before job returns.
  void done.catch(() => undefined);
  try {
    const result = await job(tx.objectStore(AUTOSAVE_INDEXED_DB_STORE));
    await done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* Already rolled back or completed. */ }
    await done.catch(() => undefined);
    throw error;
  }
};

const manifestFor = async (store: IDBObjectStore, branchId: string): Promise<Manifest> => {
  return validateVersionManifest(await requestResult(store.get(versionManifestKey(branchId))), branchId);
};

export const assertVersionWriter = async (store: IDBObjectStore, authority: VersionAuthority) => {
  await verifyVersionAuthority(store, authority);
  return manifestFor(store, authority.branchId);
};

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;
const sizeOf = (manifest: Manifest, entries: readonly VersionEntry[]) => {
  const snapshots = new Set(entries.map(entry => entry.snapshotId));
  const assets = new Set(entries.flatMap(entry => entry.assetIds));
  return [...snapshots].reduce((sum, id) => sum + (manifest.snapshotBytes[id] ?? 0), 0) +
    [...assets].reduce((sum, id) => sum + (manifest.assetBytes[id] ?? 0), 0) + byteLength(JSON.stringify(entries));
};

const prune = (store: IDBObjectStore, manifest: Manifest) => {
  const snapshots = new Set(manifest.entries.map(entry => entry.snapshotId));
  const assets = new Set(manifest.entries.flatMap(entry => entry.assetIds));
  for (const id of Object.keys(manifest.snapshotBytes)) if (!snapshots.has(id)) {
    store.delete(snapshotKey(manifest.authority.branchId, id));
    delete manifest.snapshotBytes[id];
  }
  for (const id of Object.keys(manifest.assetBytes)) if (!assets.has(id)) {
    store.delete(assetKey(manifest.authority.branchId, id));
    delete manifest.assetBytes[id];
  }
  store.put(manifest, versionManifestKey(manifest.authority.branchId));
};

const updateCatalog = (store: IDBObjectStore, manifest: Manifest) => recordVersionBranch(store, {
  branchId: manifest.authority.branchId, projectId: manifest.authority.projectId, projectName: manifest.projectName,
  bytes: sizeOf(manifest, manifest.entries), versions: manifest.entries.length, updatedAt: Date.now(),
});

export const installVersionBranch = async (authority: VersionAuthority, archive?: VersionArchive, projectName = 'Project') => {
  if (archive) await validateVersionArchive(archive);
  if (archive?.entries.some(entry => entry.projectId !== authority.projectId)) throw new Error('Earlier versions belong to a different project.');
  return withStore('readwrite', async store => {
  const prior = await requestResult(store.get(versionManifestKey(authority.branchId)));
  if (prior) {
    await assertVersionWriter(store, authority);
    return validateVersionManifest(prior, authority.branchId).entries;
  }
  const manifest: Manifest = { authority, projectName: projectName.slice(0, 240), entries: archive?.entries ?? [], snapshotBytes: {}, assetBytes: {} };
  if (archive && archive.lineageId !== authority.lineageId) throw new Error('History lineage disagrees.');
  for (const [id, value] of Object.entries(archive?.snapshots ?? {})) {
    manifest.snapshotBytes[id] = byteLength(value);
    store.put(value, snapshotKey(authority.branchId, id));
  }
  for (const [id, value] of Object.entries(archive?.assets ?? {})) {
    manifest.assetBytes[id] = byteLength(value);
    store.put(value, assetKey(authority.branchId, id));
  }
  store.put(manifest, versionManifestKey(authority.branchId));
  await activateVersionAuthority(store, authority);
  await updateCatalog(store, manifest);
  return manifest.entries;
  });
};

export const claimVersionBranch = (branchId: string, ownerId: string, chosenAt: number, projectId: string) => withStore('readwrite', async store => {
  const manifest = await manifestFor(store, branchId);
  if (manifest.authority.projectId !== projectId) throw new Error('Browser backup history belongs to a different project.');
  manifest.authority = { ...manifest.authority, ownerId, chosenAt };
  store.put(manifest, versionManifestKey(branchId));
  await activateVersionAuthority(store, manifest.authority);
  await updateCatalog(store, manifest);
  return { authority: manifest.authority, entries: manifest.entries };
});

export const listVersions = (branchId: string) => withStore('readonly', async store => (await manifestFor(store, branchId)).entries);
export const inspectVersionBranch = (branchId: string, projectId: string) => withStore('readonly', async store => {
  const manifest = await manifestFor(store, branchId);
  if (manifest.authority.projectId !== projectId) throw new Error('Browser backup history belongs to a different project.');
  return manifest.entries;
});

export const readStoredVersion = (branchId: string, id: string) => withStore('readonly', async store => {
  const manifest = await manifestFor(store, branchId);
  const entry = manifest.entries.find(item => item.id === id);
  if (!entry) throw new Error('Version no longer exists.');
  const snapshot = await requestResult(store.get(snapshotKey(branchId, entry.snapshotId)));
  if (typeof snapshot !== 'string') throw new Error('Version snapshot is missing.');
  const assets: Record<string, string> = {};
  await Promise.all(entry.assetIds.map(async assetId => {
    const asset = await requestResult(store.get(assetKey(branchId, assetId)));
    if (typeof asset !== 'string') throw new Error('Version artwork is missing.');
    assets[assetId] = asset;
  }));
  return { entry, snapshot, assets };
});

export const appendVersion = (authority: VersionAuthority, entry: VersionEntry, encoded: EncodedVersion) => withStore('readwrite', async store => {
  const manifest = await assertVersionWriter(store, authority);
  if (!validVersionEntry(entry, authority.lineageId) || entry.projectId !== authority.projectId || entry.projectId !== encoded.projectId || entry.snapshotId !== encoded.snapshotId || entry.bytes !== encoded.bytes ||
    entry.assetIds.length !== encoded.assetIds.length || entry.assetIds.some(id => !encoded.assetIds.includes(id))) throw new Error('Version identity disagrees.');
  if (manifest.entries.some(item => item.id === entry.id)) return manifest.entries;
  const latest = manifest.entries[0];
  if (latest?.snapshotId === entry.snapshotId && (entry.reason === 'automatic' ||
    (entry.reason === 'manual' && latest.reason === 'manual' && latest.name === entry.name))) return manifest.entries;
  manifest.snapshotBytes[encoded.snapshotId] = encoded.bytes;
  for (const [id, value] of Object.entries(encoded.assets)) manifest.assetBytes[id] = byteLength(value);
  manifest.entries = versionRetention([entry, ...manifest.entries], entry.createdAt, entries => sizeOf(manifest, entries), {
    entries: VERSION_POLICY.entries, bytes: await browserVersionCapacity(store, authority.branchId),
  }).retained;
  if (!manifest.entries.some(item => item.id === entry.id)) throw new Error('Version does not fit. Save Project or remove versions.');
  if (new Set(manifest.entries.flatMap(item => item.assetIds)).size > VERSION_POLICY.assetCount) {
    throw new Error('Version images fill storage. Save current only or remove a version.');
  }
  store.put(encoded.snapshot, snapshotKey(authority.branchId, encoded.snapshotId));
  for (const [id, value] of Object.entries(encoded.assets)) store.put(value, assetKey(authority.branchId, id));
  prune(store, manifest);
  await updateCatalog(store, manifest);
  return manifest.entries;
});

export const updateStoredVersion = (authority: VersionAuthority, id: string, change: { name: string } | 'remove') => withStore('readwrite', async store => {
  const manifest = await assertVersionWriter(store, authority);
  if (!manifest.entries.some(entry => entry.id === id)) throw new Error('Version no longer exists.');
  manifest.entries = change === 'remove' ? manifest.entries.filter(entry => entry.id !== id)
    : manifest.entries.map(entry => entry.id === id ? { ...entry, name: change.name.slice(0, 80), reason: 'manual' as const } : entry);
  prune(store, manifest);
  await updateCatalog(store, manifest);
  return manifest.entries;
});

export const exportVersionArchive = (branchId: string) => withStore('readonly', async store => {
  const manifest = await manifestFor(store, branchId);
  const archive: VersionArchive = { schemaVersion: 1, lineageId: manifest.authority.lineageId, entries: manifest.entries, snapshots: {}, assets: {} };
  await Promise.all(Object.keys(manifest.snapshotBytes).map(async id => {
    const value = await requestResult(store.get(snapshotKey(branchId, id)));
    if (typeof value !== 'string') throw new Error('Version snapshot is missing.');
    archive.snapshots[id] = value;
  }));
  await Promise.all(Object.keys(manifest.assetBytes).map(async id => {
    const value = await requestResult(store.get(assetKey(branchId, id)));
    if (typeof value !== 'string') throw new Error('Version artwork is missing.');
    archive.assets[id] = value;
  }));
  return archive;
});

export const listBrowserVersionBranches = () => withStore('readonly', readVersionCatalog);

/** Explicit management only; compare the displayed token before deleting feature-owned keys. */
export const removeBrowserVersionBranch = (selected: VersionBranchInfo) => withStore('readwrite', async store => {
  const catalog = await readVersionCatalog(store);
  const current = catalog.find(item => item.branchId === selected.branchId);
  if (!current || current.token !== selected.token) throw new Error('Browser history changed. Refresh the list.');
  const prefix = `versions:${selected.branchId}:`;
  const keys = await requestResult(store.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`)));
  for (const key of keys) store.delete(key);
  store.put(catalog.filter(item => item.branchId !== selected.branchId), VERSION_CATALOG_KEY);
  // The current/previous backup bodies stay intact after explicit history deletion.
  const backup = await requestResult(store.get('metadata'));
  if (backup) {
    if (backup.historyBranchId === selected.branchId) delete backup.historyBranchId;
    if (backup.previousHistoryBranchId === selected.branchId) delete backup.previousHistoryBranchId;
    store.put(backup, 'metadata');
  }
  return catalog.filter(item => item.branchId !== selected.branchId);
});
