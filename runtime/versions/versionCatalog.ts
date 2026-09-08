import { requestResult } from '../persistence/autosaveIndexedDb';
import { VERSION_POLICY } from './versionPolicy';
import type { VersionBranchInfo } from './versionTypes';

export const VERSION_CATALOG_KEY = 'versions:catalog';
export const readVersionCatalog = async (store: IDBObjectStore): Promise<VersionBranchInfo[]> => {
  const value = await requestResult(store.get(VERSION_CATALOG_KEY));
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > VERSION_POLICY.branches || value.some(item => !item ||
    typeof item.branchId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.branchId) || typeof item.projectName !== 'string' || item.projectName.length > 240 ||
    typeof item.projectId !== 'string' || typeof item.token !== 'string' || !Number.isSafeInteger(item.bytes) || item.bytes < 0 ||
    !Number.isSafeInteger(item.versions) || item.versions < 0 || item.versions > VERSION_POLICY.entries || !Number.isFinite(item.updatedAt))) {
    throw new Error('Browser history catalog is corrupt. Save your project file.');
  }
  return value;
};

export const browserVersionCapacity = async (store: IDBObjectStore, branchId: string) => {
  const catalog = await readVersionCatalog(store);
  if (!catalog.some(item => item.branchId === branchId) && catalog.length >= VERSION_POLICY.branches) {
    throw new Error('Browser history is full. Save Project, then manage browser versions.');
  }
  const otherBytes = catalog.filter(item => item.branchId !== branchId).reduce((sum, item) => sum + item.bytes, 0);
  return Math.max(0, Math.min(VERSION_POLICY.bytes, VERSION_POLICY.totalBrowserBytes - otherBytes));
};

export const recordVersionBranch = async (store: IDBObjectStore, info: Omit<VersionBranchInfo, 'token'>) => {
  if (info.bytes > await browserVersionCapacity(store, info.branchId)) throw new Error('Browser history is full. Save Project, then manage browser versions.');
  const catalog = await readVersionCatalog(store);
  store.put([{ ...info, token: crypto.randomUUID() }, ...catalog.filter(item => item.branchId !== info.branchId)], VERSION_CATALOG_KEY);
};
