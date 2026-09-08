import type { ProjectState } from '../../types';
import { serializeProjectCompact } from '../../utils/projectSerialization';
import { readProjectFileCandidate } from '../import/projectFileCandidate';
import { AUTHORED_SETTINGS, VERSION_POLICY } from './versionPolicy';
import type { VersionArchive, VersionEntry } from './versionTypes';
import { validVersionEntry } from './versionManifest';

const ASSET_PREFIX = 'motionsmith-asset:';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const REASONS = new Set(['automatic', 'manual', 'before-restore', 'before-reset', 'before-replace', 'restored']);
const encoder = new TextEncoder();
export const versionBytes = (text: string) => encoder.encode(text).byteLength;
export const versionHash = async (text: string) => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))),
  byte => byte.toString(16).padStart(2, '0'),
).join('');

export type EncodedVersion = {
  projectId: string;
  snapshotId: string;
  snapshot: string;
  bytes: number;
  assets: Record<string, string>;
  assetIds: string[];
};

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Called in a Worker or explicit file job, never from an editing updater. */
export const encodeVersion = async (source: ProjectState | string, preservePresentation = false): Promise<EncodedVersion> => {
  const serialized = typeof source === 'string' ? source : serializeProjectCompact(source);
  if (versionBytes(serialized) > VERSION_POLICY.snapshotBytes) throw new Error('Version exceeds the 12 MB state limit. Save current only.');
  const project = readProjectFileCandidate(JSON.parse(serialized));
  const neutral = preservePresentation ? JSON.parse(serialized) : {
    ...project, revision: 0,
    metadata: { ...project.metadata, updatedAt: project.metadata.createdAt },
    selectedPartId: undefined, selectedPathId: undefined, selectedMechanismId: undefined, selectedSceneObjectId: undefined,
    processing: { stage: 'ready', progress: 100, message: '' },
    lastExport: undefined, lastFoundryExport: undefined,
    // Presentation settings are excluded from content identity and restored from current work.
    settings: Object.fromEntries(AUTHORED_SETTINGS.map(key => [key, project.settings[key]])),
  };
  const urls = new Set<string>();
  JSON.stringify(neutral, (_key, value) => {
    if (typeof value === 'string' && value.startsWith('data:image/')) urls.add(value);
    if (typeof value === 'string' && value.startsWith(ASSET_PREFIX)) throw new Error('Unresolved artwork reference.');
    return value;
  });
  if (urls.size > VERSION_POLICY.assetCount) throw new Error('Too many version images.');
  const byUrl = new Map<string, string>();
  const assets: Record<string, string> = {};
  for (const url of urls) {
    const id = await versionHash(url);
    byUrl.set(url, id);
    assets[id] = url;
  }
  const snapshot = JSON.stringify(neutral, (_key, value) =>
    typeof value === 'string' && byUrl.has(value) ? `${ASSET_PREFIX}${byUrl.get(value)}` : value);
  return { projectId: project.metadata.id, snapshot, snapshotId: await versionHash(snapshot), bytes: versionBytes(snapshot), assets, assetIds: Object.keys(assets).sort() };
};

export const decodeVersion = async (snapshot: string, snapshotId: string, assets: Record<string, string>): Promise<ProjectState> => {
  if (versionBytes(snapshot) > VERSION_POLICY.snapshotBytes || await versionHash(snapshot) !== snapshotId) {
    throw new Error('Version integrity check failed. Current work is unchanged.');
  }
  const raw = JSON.parse(snapshot, (_key, value) => {
    if (typeof value !== 'string' || !value.startsWith(ASSET_PREFIX)) return value;
    const id = value.slice(ASSET_PREFIX.length);
    if (!HASH.test(id) || typeof assets[id] !== 'string') throw new Error('Version artwork is missing. Current work is unchanged.');
    return assets[id];
  });
  if (!record(raw) || raw.history !== undefined || raw.versions !== undefined) throw new Error('Recursive version history is invalid.');
  if (versionBytes(JSON.stringify(raw)) > VERSION_POLICY.snapshotBytes) throw new Error('Expanded version exceeds the 12 MB state limit.');
  // The standard import validator supplies absent presentation defaults.
  return readProjectFileCandidate(raw);
};

export const archiveBytes = (archive: Pick<VersionArchive, 'snapshots' | 'assets' | 'entries'>) =>
  Object.values(archive.snapshots).reduce((sum, item) => sum + versionBytes(item), 0) +
  Object.values(archive.assets).reduce((sum, item) => sum + versionBytes(item), 0) +
  versionBytes(JSON.stringify(archive.entries));

export const retainedArchive = (archive: VersionArchive, entries: readonly VersionEntry[]): VersionArchive => {
  const snapshots: Record<string, string> = {}, assets: Record<string, string> = {};
  for (const entry of entries) {
    snapshots[entry.snapshotId] = archive.snapshots[entry.snapshotId];
    for (const id of entry.assetIds) assets[id] = archive.assets[id];
  }
  return { schemaVersion: 1, lineageId: archive.lineageId, entries: entries.slice(), snapshots, assets };
};

export const validateVersionArchive = async (raw: unknown, currentAssetIds: readonly string[] = []): Promise<VersionArchive> => {
  if (!record(raw) || raw.schemaVersion !== 1 || typeof raw.lineageId !== 'string' || !ID.test(raw.lineageId) ||
    Object.keys(raw).some(key => !['schemaVersion', 'lineageId', 'entries', 'snapshots', 'assets', 'currentSnapshotId', 'currentAssetIds'].includes(key)) ||
    !Array.isArray(raw.entries) || raw.entries.length > VERSION_POLICY.entries || !record(raw.snapshots) || !record(raw.assets) ||
    Object.keys(raw.snapshots).length > VERSION_POLICY.entries || Object.keys(raw.assets).length > VERSION_POLICY.assetCount) {
    throw new Error('Invalid earlier versions format. Current work is unchanged.');
  }
  const ids = new Set<string>(), usedSnapshots = new Set<string>(), usedAssets = new Set<string>(currentAssetIds);
  for (const [id, value] of Object.entries(raw.assets)) {
    if (!HASH.test(id) || typeof value !== 'string' || !value.startsWith('data:image/') || versionBytes(value) > VERSION_POLICY.snapshotBytes) {
      throw new Error('Invalid version artwork.');
    }
  }
  for (const [id, value] of Object.entries(raw.snapshots)) {
    if (!HASH.test(id) || typeof value !== 'string' || versionBytes(value) > VERSION_POLICY.snapshotBytes) throw new Error('Invalid version snapshot.');
  }
  const archive = raw as unknown as VersionArchive;
  if (archiveBytes(archive) > VERSION_POLICY.bytes) throw new Error('Earlier versions exceed the 24 MB history limit.');
  for (const [id, value] of Object.entries(archive.assets)) {
    if (await versionHash(value) !== id) throw new Error('Version artwork integrity check failed.');
  }
  for (const item of raw.entries) {
    if (!validVersionEntry(item, archive.lineageId) || !record(item) || typeof item.id !== 'string' || !ID.test(item.id) || ids.has(item.id) ||
      item.lineageId !== raw.lineageId || typeof item.projectId !== 'string' || !item.projectId || item.projectId.length > 240 ||
      !Number.isFinite(item.createdAt) || Number(item.createdAt) < 0 ||
      !Number.isFinite(item.committedAt) || Number(item.committedAt) < Number(item.createdAt) || item.status !== 'committed' ||
      !REASONS.has(String(item.reason)) || (item.name !== undefined && (typeof item.name !== 'string' || item.name.length > 80)) ||
      typeof item.description !== 'string' || item.description.length > 120 || typeof item.snapshotId !== 'string' ||
      !HASH.test(item.snapshotId) || typeof archive.snapshots[item.snapshotId] !== 'string' ||
      !Number.isInteger(item.bytes) || item.bytes !== versionBytes(archive.snapshots[item.snapshotId]) ||
      !Array.isArray(item.assetIds) || item.assetIds.length > VERSION_POLICY.assetCount ||
      new Set(item.assetIds).size !== item.assetIds.length || item.assetIds.some(id => typeof id !== 'string' || !(id in archive.assets))) {
      throw new Error('Invalid earlier version entry.');
    }
    ids.add(item.id);
    usedSnapshots.add(item.snapshotId);
    item.assetIds.forEach(id => usedAssets.add(id));
    const references = new Set<string>();
    JSON.parse(archive.snapshots[item.snapshotId], (_key, value) => {
      if (typeof value === 'string' && value.startsWith(ASSET_PREFIX)) references.add(value.slice(ASSET_PREFIX.length));
      return value;
    });
    if (references.size !== item.assetIds.length || item.assetIds.some(id => !references.has(id))) throw new Error('Version artwork references disagree.');
    const project = await decodeVersion(archive.snapshots[item.snapshotId], item.snapshotId, archive.assets);
    if (project.metadata.id !== item.projectId) throw new Error('Version project identity disagrees.');
  }
  if (usedSnapshots.size !== Object.keys(archive.snapshots).length || usedAssets.size !== Object.keys(archive.assets).length) {
    throw new Error('Earlier versions contain unreferenced data.');
  }
  return archive;
};
