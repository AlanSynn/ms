import type { SetStateAction } from 'react';
import type { ProjectState } from '../../types';
import { downloadBlob } from '../../utils/project';
import { projectSnapshotFileName } from '../../utils/projectPersistence';
import type { ProjectDecisionBoundary } from '../persistence/projectDecisionBoundary';
import { projectHasStudentWork } from '../persistence/projectDecisionBoundary';
import type { AutosaveSerializedSnapshot } from '../persistence/autosaveTransaction';
import type { createVersionWorkerClient } from './versionWorkerClient';
import { restoredProjectState } from './versionRestoration';
import type { ProjectVersionsView, VersionArchive, VersionAuthority, VersionEntry, VersionReason } from './versionTypes';

type Ref<T> = { current: T };
export type VersionScope = {
  authority: VersionAuthority;
  ready: Promise<void>;
  initialize: () => Promise<void>;
  initializationError?: unknown;
  project: ProjectState;
  archive?: VersionArchive;
  dirty: boolean;
  capturedAt: number;
  description: string;
};
export type VersionOptions = {
  project: ProjectState;
  decision: ProjectDecisionBoundary;
  setProject: (update: SetStateAction<ProjectState>, options?: { history?: boolean; resetHistory?: boolean }) => void;
  onStatus: (message: string) => void;
  showProject: () => void;
  onRestored: (project: ProjectState) => void;
  saveCurrentOnly: () => void;
};
export type VersionViewState = Pick<ProjectVersionsView, 'open' | 'entries' | 'state' | 'message' | 'preview' | 'selectedId' | 'includedInFile'>;
export type VersionRestoration = { source: ProjectState; next: ProjectState; scope: VersionScope };
export type VersionActionContext = {
  scope: VersionScope | undefined;
  source: ProjectState;
  generation: number;
  requestedAt: number;
  description?: string;
  scopeRef: Ref<VersionScope | undefined>;
  latest: Ref<VersionOptions>;
  view: VersionViewState;
  client: ReturnType<typeof createVersionWorkerClient>;
  prepared: Ref<{ project: ProjectState; snapshot: AutosaveSerializedSnapshot } | undefined>;
  setView: (update: SetStateAction<VersionViewState>) => void;
  downloads: Ref<WeakMap<Blob, { scope: VersionScope; entries: VersionEntry[] }>>;
  previewGeneration: Ref<number>;
  pendingRestore: Ref<VersionRestoration | undefined>;
  fail: (error: unknown) => void;
  cancelPreview: () => void;
};

export const capture = async (context: VersionActionContext, source: ProjectState, reason: VersionReason, name?: string, expectedScope = context.scopeRef.current) => {
  const { scopeRef, latest, client, prepared, setView } = context;
  const scope = expectedScope;
  if (!scope) throw new Error('Open or create a project first.');
  // Fix identity and source before yielding. Later edits cannot replace this request.
  const id = crypto.randomUUID(), createdAt = context.requestedAt;
  const snapshotSource = prepared.current?.project === source ? prepared.current.snapshot.serialized : source;
  const description = reason === 'before-restore' ? 'Before restoring a version'
    : reason === 'before-reset' ? 'Before Reset Lesson' : reason === 'before-replace' ? 'Before replacing project'
    : reason === 'restored' ? 'Restored version' : context.description ?? 'Current project';
  await scope.ready;
  if (scopeRef.current !== scope) throw new Error('Project changed. Try again.');
  setView(previous => ({ ...previous, state: 'saving', message: 'Keeping version…' }));
  const entries = await client.request('capture', { authority: scope.authority, source: snapshotSource, id, projectId: source.metadata.id, createdAt, reason, description, name });
  if (scopeRef.current === scope) {
    scope.capturedAt = createdAt;
    if (scope.project === source) scope.dirty = false;
    setView(previous => ({ ...previous, entries, state: 'idle', includedInFile: false, message: 'Version kept in this browser' }));
    if (reason === 'manual') latest.current.onStatus('Version kept in this browser');
  }
  return entries;
};

export const download = async (context: VersionActionContext, source: ProjectState) => {
  const { scopeRef, latest, view, client, downloads } = context;
  const scope = context.scope;
  if (scopeRef.current !== scope || latest.current.project !== source) throw new Error('Project changed. Save again.');
  if (!scope) throw new Error('Earlier versions are unavailable. Save current only.');
  await scope.ready.catch(error => { if (!scope.archive) throw error; });
  const entries = view.entries;
  const blob = await client.request('download', { branchId: scope.authority.branchId, project: source, archive: scope.archive });
  downloads.current.set(blob, { scope, entries });
  return blob;
};

export const protectReplacement = async (context: VersionActionContext, source: ProjectState, label: string, reason: 'before-reset' | 'before-replace' = 'before-replace') => {
  const { scopeRef, latest, view } = context;
  if (scopeRef.current !== context.scope || latest.current.project !== source) return false;
  if (!projectHasStudentWork(source) && !scopeRef.current?.dirty && !view.entries.length) return true;
  if (!window.confirm(`${label}? Current work will be kept in Earlier versions and a recovery copy.`)) return false;
  const scope = scopeRef.current;
  await capture(context, source, reason, undefined, scope);
  if (latest.current.project !== source || scopeRef.current !== scope) return false;
  const blob = await download(context, source);
  if (latest.current.project !== source || scopeRef.current !== scope) return false;
  downloadBlob(projectSnapshotFileName(source.metadata.name, `-recovery-${Date.now()}`), blob);
  return true;
};

export const select = async (context: VersionActionContext, id: string) => {
  const { scopeRef, client, setView, previewGeneration, fail } = context;
  if (scopeRef.current !== context.scope || previewGeneration.current !== context.generation) return;
  const scope = scopeRef.current, token = context.generation;
  if (!scope) return;
  setView(previous => ({ ...previous, selectedId: id, preview: undefined, state: 'loading' }));
  try {
    await scope.ready.catch(error => { if (!scope.archive) throw error; });
    const preview = await client.request('read', { branchId: scope.authority.branchId, id, archive: scope.archive });
    if (scopeRef.current === scope && previewGeneration.current === token) setView(previous => ({ ...previous, preview, state: 'idle', message: undefined }));
  } catch (error) { if (scopeRef.current === scope && previewGeneration.current === token) fail(error); }
};
export const restore = async (context: VersionActionContext) => {
  const { scopeRef, latest, view, client, setView, previewGeneration, pendingRestore, fail, cancelPreview } = context;
  if (!view.preview || scopeRef.current !== context.scope || latest.current.project !== context.source || previewGeneration.current !== context.generation) return;
  const scope = scopeRef.current, source = latest.current.project;
  if (!scope || !window.confirm('Restore this version? Your current work will be kept.')) return;
  const decision = latest.current.decision, token = decision.begin(), selected = view.preview.entry.id;
  const generation = previewGeneration.current;
  const current = () => scopeRef.current === scope && latest.current.project === source && decision.isCurrent(token) && generation === previewGeneration.current;
  const stale = () => {
    if (scopeRef.current === scope && generation === previewGeneration.current) setView(previous => ({ ...previous, state: 'idle', message: 'Project changed. Select the version again.' }));
  };
  try {
    setView(previous => ({ ...previous, state: 'loading', message: 'Checking version…' }));
    const candidate = await client.request('read', { branchId: scope.authority.branchId, id: selected, archive: scope.archive });
    if (!current()) { stale(); return; }
    await capture(context, source, 'before-restore', undefined, scope);
    if (!current()) { stale(); return; }
    const next = restoredProjectState(source, candidate.project, Date.now());
    pendingRestore.current = { source, next, scope };
    latest.current.setProject(previous => previous === source && decision.isCurrent(token) ? next : previous, { history: true });
    cancelPreview();
  } catch (error) { if (current()) fail(error); }
};
