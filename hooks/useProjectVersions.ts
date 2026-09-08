import { useEffect, useRef, useState } from 'react';
import type { ProjectState } from '../types';
import { projectHasStudentWork } from '../runtime/persistence/projectDecisionBoundary';
import { browserAutosaveIdleBoundary, type AutosaveSerializedSnapshot } from '../runtime/persistence/autosaveTransaction';
import { createVersionWorkerClient } from '../runtime/versions/versionWorkerClient';
import { describeVersionChange, VERSION_POLICY, versionContentChanged } from '../runtime/versions/versionPolicy';
import type { ProjectVersionsView, VersionArchive, VersionAuthority, VersionBranchInfo, VersionEntry, VersionReason } from '../runtime/versions/versionTypes';

import type { VersionActionContext, VersionScope as Scope, VersionOptions as Options } from '../runtime/versions/versionActions';

export const useProjectVersions = (options: Options) => {
  const latest = useRef(options);
  latest.current = options;
  const clientRef = useRef<ReturnType<typeof createVersionWorkerClient> | null>(null);
  clientRef.current ??= createVersionWorkerClient();
  const client = clientRef.current;
  const scopeRef = useRef<Scope | undefined>(undefined);
  const prepared = useRef<{ project: ProjectState; snapshot: AutosaveSerializedSnapshot } | undefined>(undefined);
  const previewGeneration = useRef(0);
  const lifecycle = useRef(0);
  const pendingRestore = useRef<{ source: ProjectState; next: ProjectState; scope: Scope } | undefined>(undefined);
  const retryOperation = useRef<(() => void) | undefined>(undefined);
  const downloads = useRef(new WeakMap<Blob, { scope: Scope; entries: VersionEntry[] }>());
  const [authority, setAuthority] = useState<VersionAuthority>();
  const [storageReady, setStorageReady] = useState(false);
  const [browserBranches, setBrowserBranches] = useState<VersionBranchInfo[]>();
  const [view, setView] = useState<Pick<ProjectVersionsView, 'open' | 'entries' | 'state' | 'message' | 'preview' | 'selectedId' | 'includedInFile'>>({
    open: false, entries: [], state: 'idle', includedInFile: false,
  });
  const fail = (error: unknown, reveal = false) => {
    const message = error instanceof Error ? error.message : String(error);
    setView(previous => ({ ...previous, open: reveal || previous.open, state: 'failed', message }));
    latest.current.onStatus(`Earlier versions: ${message}`);
    if (reveal) latest.current.showProject();
  };
  const choose = (project: ProjectState, input: { history?: VersionArchive; recoveryBranchId?: string } = {}) => {
    previewGeneration.current++;
    retryOperation.current = undefined;
    prepared.current = undefined;
    const nextAuthority: VersionAuthority = {
      branchId: crypto.randomUUID(), ownerId: crypto.randomUUID(),
      lineageId: input.history?.lineageId ?? crypto.randomUUID(), projectId: project.metadata.id, chosenAt: Date.now(),
    };
    const fallback: VersionArchive | undefined = input.recoveryBranchId ? undefined : input.history ?? { schemaVersion: 1, lineageId: nextAuthority.lineageId, entries: [], snapshots: {}, assets: {} };
    const scope: Scope = { authority: nextAuthority, project, archive: fallback, ready: Promise.resolve(), initialize: async () => undefined, dirty: false, capturedAt: Date.now(), description: 'Current project' };
    scopeRef.current = scope;
    setStorageReady(false);
    setBrowserBranches(undefined);
    setAuthority(undefined);
    setView({ open: false, entries: input.history?.entries ?? [], state: 'idle', includedInFile: Boolean(input.history?.entries.length) });
    scope.initialize = async () => {
      scope.initializationError = undefined;
      let entries: VersionEntry[];
      if (input.recoveryBranchId) {
        const claimed = await client.request('claim', { branchId: input.recoveryBranchId, ownerId: nextAuthority.ownerId, projectId: project.metadata.id, chosenAt: nextAuthority.chosenAt });
        scope.authority = claimed.authority;
        entries = claimed.entries;
      } else entries = await client.request('install', { authority: nextAuthority, archive: input.history, projectName: project.metadata.name });
      if (scopeRef.current !== scope) return;
      scope.archive = undefined;
      setAuthority(scope.authority);
      setStorageReady(true);
      setView(previous => ({ ...previous, entries, state: 'idle', message: undefined }));
    };
    scope.ready = scope.initialize();
    void scope.ready.catch(error => { scope.initializationError = error; if (scopeRef.current === scope) fail(error, true); });
  };

  const context = (description = scopeRef.current?.description): VersionActionContext => ({ scope: scopeRef.current, source: latest.current.project, generation: previewGeneration.current, requestedAt: Date.now(), description, scopeRef, latest, view, client, prepared, setView, downloads, previewGeneration, pendingRestore, fail, cancelPreview });
  const capture = (source: ProjectState, reason: VersionReason, name?: string, scope = scopeRef.current, description = scope?.description) => {
    const request = context(description);
    return import('../runtime/versions/versionActions').then(actions => actions.capture(request, source, reason, name, scope));
  };
  const download = (source: ProjectState) => {
    const request = context();
    return import('../runtime/versions/versionActions').then(actions => actions.download(request, source));
  };
  const protectReplacement = (source: ProjectState, label: string, reason: 'before-reset' | 'before-replace' = 'before-replace') => {
    const request = context();
    return import('../runtime/versions/versionActions').then(actions => actions.protectReplacement(request, source, label, reason));
  };
  const select = (id: string) => {
    previewGeneration.current++;
    const request = context();
    return import('../runtime/versions/versionActions').then(actions => actions.select(request, id));
  };
  const restore = () => {
    const request = context();
    return import('../runtime/versions/versionActions').then(actions => actions.restore(request));
  };

  const cancelPreview = () => {
    previewGeneration.current++;
    setView(previous => ({ ...previous, selectedId: undefined, preview: undefined, state: 'idle', message: undefined }));
  };
  const close = () => { cancelPreview(); setView(previous => ({ ...previous, open: false })); };
  const show = async () => {
    setView(previous => ({ ...previous, open: true, state: 'loading' }));
    const scope = scopeRef.current;
    if (!scope) { setView(previous => ({ ...previous, state: 'idle', entries: [] })); return; }
    try {
      await scope.ready.catch(error => { if (!scope.archive) throw error; });
      const entries = scope.archive?.entries ?? await client.request('list', { branchId: scope.authority.branchId });
      if (scopeRef.current === scope) {
        setView(previous => ({ ...previous, entries, state: scope.initializationError ? 'failed' : 'idle' }));
        if (scope.initializationError) fail(scope.initializationError);
      }
    } catch (error) { if (scopeRef.current === scope) fail(error); }
  };

  useEffect(() => {
    const restoration = pendingRestore.current;
    if (restoration && options.project !== restoration.source) {
      pendingRestore.current = undefined;
      if (options.project === restoration.next && scopeRef.current === restoration.scope) {
        latest.current.onRestored(restoration.next);
        latest.current.onStatus('Version restored. Current work was kept.');
        void capture(restoration.next, 'restored', undefined, restoration.scope).catch(fail);
      }
    }
    const scope = scopeRef.current;
    if (!scope) {
      if (options.decision.isAuthorized() && projectHasStudentWork(options.project)) choose(options.project);
      return;
    }
    if (scope.project !== options.project) {
      if (versionContentChanged(scope.project, options.project)) {
        scope.description = describeVersionChange(scope.project, options.project);
        scope.dirty = true;
      }
      scope.project = options.project;
    }
  }, [options.project, options.decision]);

  useEffect(() => {
    const idle = browserAutosaveIdleBoundary();
    let boundary: ReturnType<typeof idle.request> | undefined;
    let running = false;
    const tick = () => {
      const scope = scopeRef.current;
      if (!scope?.dirty || running || Date.now() - scope.capturedAt < VERSION_POLICY.intervalMs) return;
      running = true;
      // Capture the committed state, even if a later pointer/modal draft remains open.
      const source = scope.project, description = scope.description;
      boundary = idle.request(() => {
        boundary = undefined;
        void capture(source, 'automatic', undefined, scope, description).catch(error => {
          if (scopeRef.current === scope) { scope.capturedAt = Date.now(); fail(error); }
        }).finally(() => { running = false; });
      });
    };
    const interval = setInterval(tick, 1_000);
    const visibility = () => { if (document.visibilityState === 'hidden') tick(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(interval); if (boundary) idle.cancel(boundary); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  useEffect(() => {
    const generation = ++lifecycle.current;
    return () => queueMicrotask(() => { if (lifecycle.current === generation) client.dispose(); });
  }, [client]);

  const update = async (id: string, change: { name: string } | 'remove') => {
    const scope = scopeRef.current;
    if (!scope) return;
    if (change === 'remove' && !window.confirm('Remove this kept version? Current work stays unchanged.')) return;
    try {
      const entries = await client.request('update', { authority: scope.authority, id, change });
      if (scopeRef.current === scope) { cancelPreview(); setView(previous => ({ ...previous, entries, includedInFile: false })); }
    } catch (error) { if (scopeRef.current === scope) fail(error); }
  };
  const publicView: ProjectVersionsView = {
    ...view, browserBranches,
    manageStorage: () => { void client.request('catalog', {}).then(entries => setBrowserBranches(entries.filter(entry => entry.branchId !== scopeRef.current?.authority.branchId)), fail); },
    removeBrowserBranch: branch => {
      if (branch.branchId === scopeRef.current?.authority.branchId || !window.confirm(`Delete browser versions for ${branch.projectName}? Project files stay unchanged.`)) return;
      void client.request('removeBranch', branch).then(entries => setBrowserBranches(entries.filter(entry => entry.branchId !== scopeRef.current?.authority.branchId)), fail);
    },
    show: () => { void show(); }, close, cancelPreview,
    keep: name => {
      setView(previous => ({ ...previous, open: true }));
      const source = latest.current.project, scope = scopeRef.current, description = scope?.description;
      const keep = () => {
        if (scopeRef.current !== scope) return;
        void capture(source, 'manual', name, scope, description).then(() => { retryOperation.current = undefined; }, error => {
          if (scopeRef.current === scope) { retryOperation.current = keep; fail(error); }
        });
      };
      keep();
    },
    select: id => { void select(id).catch(fail); }, restore: () => { void restore().catch(fail); },
    remove: id => { void update(id, 'remove'); }, rename: (id, name) => { void update(id, { name }); },
    retry: () => {
      const scope = scopeRef.current;
      if (scope?.initializationError) {
        setView(previous => ({ ...previous, state: 'loading', message: 'Retrying browser storage…' }));
        scope.ready = scope.initialize();
        void scope.ready.then(() => {
          if (scopeRef.current === scope) {
            if (retryOperation.current) retryOperation.current();
            else void show();
          }
        }, error => { scope.initializationError = error; if (scopeRef.current === scope) fail(error); });
      } else if (retryOperation.current) retryOperation.current();
      else if (view.selectedId) void select(view.selectedId).catch(fail);
      else void show();
    }, saveCurrentOnly: options.saveCurrentOnly,
  };
  return {
    view: publicView, authority, storageReady, choose, download, protectReplacement,
    downloadStarted: (blob: Blob) => {
      const receipt = downloads.current.get(blob);
      if (receipt && receipt.scope === scopeRef.current) setView(previous => previous.entries === receipt.entries ? { ...previous, includedInFile: true } : previous);
      downloads.current.delete(blob);
    },
    prepared: (project: ProjectState, snapshot: AutosaveSerializedSnapshot) => { prepared.current = { project, snapshot }; },
    reportFailure: (error: unknown, retry?: () => void) => {
      retryOperation.current = retry;
      fail(error, true);
    },
    validateRecovery: async (branchId: string, projectId: string) => { await client.request('inspect', { branchId, projectId }); },
  };
};

export type ProjectVersionsController = ReturnType<typeof useProjectVersions>;
