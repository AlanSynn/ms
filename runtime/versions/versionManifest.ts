import { VERSION_POLICY } from './versionPolicy';
import type { VersionAuthority, VersionEntry } from './versionTypes';

export type VersionManifest = {
  projectName: string;
  authority: VersionAuthority;
  entries: VersionEntry[];
  snapshotBytes: Record<string, number>;
  assetBytes: Record<string, number>;
};
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 8_640_000_000_000_000;
const reasons = new Set(['automatic', 'manual', 'before-restore', 'before-reset', 'before-replace', 'restored']);

export const validVersionEntry = (value: unknown, lineageId: string): value is VersionEntry => {
  if (!record(value)) return false;
  if (Object.keys(value).some(key => !['id', 'lineageId', 'projectId', 'createdAt', 'committedAt', 'status', 'reason', 'name', 'description', 'snapshotId', 'bytes', 'assetIds'].includes(key))) return false;
  return id(value.id) && value.lineageId === lineageId && typeof value.projectId === 'string' && value.projectId.length > 0 && value.projectId.length <= 240 &&
    timestamp(value.createdAt) && timestamp(value.committedAt) && Number(value.committedAt) >= Number(value.createdAt) && value.status === 'committed' &&
    reasons.has(String(value.reason)) && (value.name === undefined || (typeof value.name === 'string' && value.name.length <= 80)) &&
    typeof value.description === 'string' && value.description.length <= 120 && hash(value.snapshotId) &&
    Number.isSafeInteger(value.bytes) && Number(value.bytes) >= 0 && Number(value.bytes) <= VERSION_POLICY.snapshotBytes &&
    Array.isArray(value.assetIds) && value.assetIds.length <= VERSION_POLICY.assetCount && value.assetIds.every(hash) && new Set(value.assetIds).size === value.assetIds.length;
};

export const validateVersionManifest = (raw: unknown, branchId: string): VersionManifest => {
  if (!record(raw) || !record(raw.authority) || raw.authority.branchId !== branchId || !id(raw.authority.ownerId) || !id(raw.authority.lineageId) ||
    typeof raw.projectName !== 'string' || raw.projectName.length > 240 ||
    typeof raw.authority.projectId !== 'string' || !raw.authority.projectId || raw.authority.projectId.length > 240 ||
    !timestamp(raw.authority.chosenAt) || !Array.isArray(raw.entries) || raw.entries.length > VERSION_POLICY.entries ||
    !record(raw.snapshotBytes) || !record(raw.assetBytes) || Object.keys(raw.snapshotBytes).length > VERSION_POLICY.entries || Object.keys(raw.assetBytes).length > VERSION_POLICY.assetCount ||
    !raw.entries.every(entry => validVersionEntry(entry, String(raw.authority && (raw.authority as Record<string, unknown>).lineageId))) ||
    new Set(raw.entries.map(entry => entry.id)).size !== raw.entries.length) throw new Error('Earlier versions metadata is corrupt. Open your project file.');
  const manifest = raw as unknown as VersionManifest;
  if (manifest.entries.some(entry => entry.projectId !== manifest.authority.projectId)) throw new Error('Earlier versions belong to a different project.');
  for (const sizes of [manifest.snapshotBytes, manifest.assetBytes]) {
    if (Object.entries(sizes).some(([key, bytes]) => !hash(key) || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > VERSION_POLICY.snapshotBytes)) throw new Error('Earlier versions size metadata is corrupt.');
  }
  for (const entry of manifest.entries) if (manifest.snapshotBytes[entry.snapshotId] !== entry.bytes || entry.assetIds.some(key => !(key in manifest.assetBytes))) throw new Error('Earlier versions dependencies are missing.');
  if (Object.values(manifest.snapshotBytes).reduce((sum, bytes) => sum + bytes, 0) + Object.values(manifest.assetBytes).reduce((sum, bytes) => sum + bytes, 0) > VERSION_POLICY.bytes) throw new Error('Earlier versions exceed the storage budget.');
  return manifest;
};
