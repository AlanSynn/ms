import type { ProjectState } from '../../types';
import type { VersionArchive, VersionAuthority, VersionBranchInfo, VersionEntry, VersionReason } from './versionTypes';
import { appendVersion, claimVersionBranch, exportVersionArchive, installVersionBranch, inspectVersionBranch, listBrowserVersionBranches, listVersions, readStoredVersion, removeBrowserVersionBranch, updateStoredVersion } from './versionStore';
import { decodeVersion, encodeVersion, validateVersionArchive, versionHash } from './versionCodec';
import { createVersionedProjectBlob } from './versionPortable';

export type VersionJobs = {
  install: { input: { authority: VersionAuthority; archive?: VersionArchive; projectName?: string }; output: VersionEntry[] };
  catalog: { input: Record<string, never>; output: VersionBranchInfo[] };
  removeBranch: { input: VersionBranchInfo; output: VersionBranchInfo[] };
  claim: { input: { branchId: string; ownerId: string; projectId: string; chosenAt: number }; output: { authority: VersionAuthority; entries: VersionEntry[] } };
  list: { input: { branchId: string }; output: VersionEntry[] };
  inspect: { input: { branchId: string; projectId: string }; output: VersionEntry[] };
  capture: { input: { authority: VersionAuthority; source: ProjectState | string; id: string; projectId: string; createdAt: number; reason: VersionReason; description: string; name?: string }; output: VersionEntry[] };
  read: { input: { branchId: string; id: string; archive?: VersionArchive }; output: { entry: VersionEntry; project: ProjectState } };
  update: { input: { authority: VersionAuthority; id: string; change: { name: string } | 'remove' }; output: VersionEntry[] };
  download: { input: { branchId: string; project: ProjectState; archive?: VersionArchive }; output: Blob };
};

export type VersionJobRequest = { [K in keyof VersionJobs]: { id: number; type: K; input: VersionJobs[K]['input'] } }[keyof VersionJobs];
export type VersionJobResponse = { id: number; result?: VersionJobs[keyof VersionJobs]['output']; error?: string; durationMs: number };

export const runVersionJob = async (job: VersionJobRequest): Promise<VersionJobs[keyof VersionJobs]['output']> => {
  switch (job.type) {
    case 'install':
      return installVersionBranch(job.input.authority, job.input.archive, job.input.projectName);
    case 'catalog': return listBrowserVersionBranches();
    case 'removeBranch': return removeBrowserVersionBranch(job.input);
    case 'claim': return claimVersionBranch(job.input.branchId, job.input.ownerId, job.input.chosenAt, job.input.projectId);
    case 'list': return listVersions(job.input.branchId);
    case 'inspect': return inspectVersionBranch(job.input.branchId, job.input.projectId);
    case 'capture': {
      const input = job.input;
      const encoded = await encodeVersion(input.source);
      if (encoded.projectId !== input.projectId) throw new Error('Project changed before version capture.');
      const entry: VersionEntry = {
        id: input.id, lineageId: input.authority.lineageId, projectId: input.projectId,
        createdAt: input.createdAt, committedAt: Math.max(input.createdAt, Date.now()), status: 'committed',
        reason: input.reason, name: input.name?.trim().slice(0, 80) || undefined,
        description: input.description.slice(0, 120), snapshotId: encoded.snapshotId,
        bytes: encoded.bytes, assetIds: encoded.assetIds,
      };
      return appendVersion(input.authority, entry, encoded);
    }
    case 'read': {
      const { archive, branchId, id } = job.input;
      const selected = archive ? {
        entry: archive.entries.find(entry => entry.id === id)!,
        snapshot: archive.snapshots[archive.entries.find(entry => entry.id === id)?.snapshotId ?? ''], assets: archive.assets,
      } : await readStoredVersion(branchId, id);
      if (!selected.entry || !selected.snapshot) throw new Error('Version is unavailable.');
      for (const assetId of selected.entry.assetIds) {
        if (typeof selected.assets[assetId] !== 'string' || await versionHash(selected.assets[assetId]) !== assetId) throw new Error('Version artwork integrity check failed.');
      }
      const project = await decodeVersion(selected.snapshot, selected.entry.snapshotId, selected.assets);
      if (project.metadata.id !== selected.entry.projectId) throw new Error('Version project identity disagrees.');
      return { entry: selected.entry, project };
    }
    case 'update': return updateStoredVersion(job.input.authority, job.input.id, job.input.change);
    case 'download': {
      const archive = job.input.archive ?? await exportVersionArchive(job.input.branchId);
      await validateVersionArchive(archive);
      return createVersionedProjectBlob(job.input.project, archive);
    }
  }
};
