import type { ProjectState } from '../../types';

export type VersionReason = 'automatic' | 'manual' | 'before-restore' | 'before-reset' | 'before-replace' | 'restored';
export type VersionEntry = {
  id: string;
  lineageId: string;
  projectId: string;
  createdAt: number;
  committedAt: number;
  status: 'committed';
  reason: VersionReason;
  name?: string;
  description: string;
  snapshotId: string;
  bytes: number;
  assetIds: string[];
};

/** History is a file extension / persistence sidecar, never a ProjectState member. */
export type VersionArchive = {
  schemaVersion: 1;
  lineageId: string;
  entries: VersionEntry[];
  snapshots: Record<string, string>;
  assets: Record<string, string>;
};

export type VersionAuthority = { branchId: string; ownerId: string; lineageId: string; projectId: string; chosenAt: number };
export type VersionBranchInfo = { branchId: string; projectId: string; projectName: string; updatedAt: number; bytes: number; versions: number; token: string };

export type ProjectVersionsView = {
  open: boolean;
  entries: VersionEntry[];
  state: 'idle' | 'loading' | 'saving' | 'failed';
  message?: string;
  selectedId?: string;
  preview?: { entry: VersionEntry; project: ProjectState };
  includedInFile: boolean;
  browserBranches?: VersionBranchInfo[];
  manageStorage?: () => void;
  removeBrowserBranch?: (branch: VersionBranchInfo) => void;
  show: () => void;
  close: () => void;
  keep: (name?: string) => void;
  select: (id: string) => void;
  cancelPreview: () => void;
  restore: () => void;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  retry: () => void;
  saveCurrentOnly: () => void;
};
