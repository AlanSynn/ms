import type { VersionAuthority } from './versionTypes';

export const VERSION_ACTIVE_WRITER_KEY = 'versions:active-writer';
export const VERSION_CHOSEN_AT_KEY = 'versions:chosen-at';
export const versionManifestKey = (branchId: string) => `versions:${branchId}:manifest`;
const get = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export const verifyVersionAuthority = async (store: IDBObjectStore, authority: VersionAuthority) => {
  const [active, manifest] = await Promise.all([
    get(store.get(VERSION_ACTIVE_WRITER_KEY)), get(store.get(versionManifestKey(authority.branchId))),
  ]);
  if (active !== authority.ownerId || manifest?.authority?.ownerId !== authority.ownerId || manifest?.authority?.lineageId !== authority.lineageId || manifest?.authority?.projectId !== authority.projectId) {
    throw new Error('Another tab owns browser storage. Save Project, then reopen it here.');
  }
};

export const activateVersionAuthority = async (store: IDBObjectStore, authority: VersionAuthority) => {
  const previous = await get(store.get(VERSION_CHOSEN_AT_KEY));
  const owner = await get(store.get(VERSION_ACTIVE_WRITER_KEY));
  if (typeof previous === 'number' && previous >= authority.chosenAt && owner !== authority.ownerId) throw new Error('Another project already owns browser storage. Reopen this file to continue here.');
  store.put(authority.ownerId, VERSION_ACTIVE_WRITER_KEY);
  store.put(authority.chosenAt, VERSION_CHOSEN_AT_KEY);
};
