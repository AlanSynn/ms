import type { ProjectState } from '../../types';
import { assertProjectRoundTrip, projectStateFromPortableDocument, serializeProject } from '../../utils/projectSerialization';
import { readProjectFileCandidate } from '../import/projectFileCandidate';
import { PORTABLE_PROJECT_MIME_TYPE } from '../persistence/projectDownloadJob';
import { decodeVersion, encodeVersion, retainedArchive, validateVersionArchive, versionBytes, versionHash } from './versionCodec';
import { VERSION_POLICY } from './versionPolicy';
import type { VersionArchive } from './versionTypes';

export const readPortableProjectBundle = async (document: unknown): Promise<{ project: ProjectState; history?: VersionArchive }> => {
  if (!document || typeof document !== 'object' || !('history' in document)) return { project: readProjectFileCandidate(document) };
  const raw = document as Record<string, unknown>;
  const history = raw.history as VersionArchive & { currentSnapshotId?: unknown; currentAssetIds?: unknown };
  if (!history || typeof history.currentSnapshotId !== 'string' || !Array.isArray(history.currentAssetIds) ||
    history.currentAssetIds.length > VERSION_POLICY.assetCount || history.currentAssetIds.some(id => typeof id !== 'string')) {
    throw new Error('Invalid portable earlier versions extension.');
  }
  // The envelope's original integrity guard covers the encoded current state too.
  const encoded = projectStateFromPortableDocument(raw);
  const current = JSON.stringify(encoded);
  const refs = new Set<string>();
  JSON.parse(current, (_key, value) => {
    if (typeof value === 'string' && value.startsWith('motionsmith-asset:')) refs.add(value.slice('motionsmith-asset:'.length));
    return value;
  });
  if (refs.size !== history.currentAssetIds.length || history.currentAssetIds.some(id => !refs.has(id))) throw new Error('Current artwork references disagree.');
  const archive = await validateVersionArchive(history, history.currentAssetIds as string[]);
  const project = await decodeVersion(current, history.currentSnapshotId, archive.assets);
  if (archive.entries.some(entry => entry.projectId !== project.metadata.id)) throw new Error('Earlier versions belong to a different project.');
  return { project, history: retainedArchive(archive, archive.entries) };
};

export const createVersionedProjectBlob = async (project: ProjectState, history: VersionArchive): Promise<Blob> => {
  const current = await encodeVersion(project, true);
  const envelope = JSON.parse(serializeProject(project));
  envelope.project = JSON.parse(current.snapshot);
  // Keep the existing envelope integrity algorithm; SHA-256 also covers the snapshot and assets.
  let hash = 0x811c9dc5;
  for (let i = 0; i < current.snapshot.length; i++) hash = Math.imul(hash ^ current.snapshot.charCodeAt(i), 0x01000193);
  envelope.integrity.contentFingerprint = (hash >>> 0).toString(16).padStart(8, '0');
  envelope.history = {
    ...history, assets: { ...history.assets, ...current.assets },
    currentSnapshotId: await versionHash(current.snapshot), currentAssetIds: current.assetIds,
  };
  const serialized = JSON.stringify(envelope);
  if (versionBytes(serialized) > VERSION_POLICY.portableBytes) throw new Error('Project with versions exceeds 48 MB. Remove versions or Save current only.');
  const reopened = await readPortableProjectBundle(JSON.parse(serialized));
  assertProjectRoundTrip(project, reopened.project);
  return new Blob([serialized], { type: PORTABLE_PROJECT_MIME_TYPE });
};
