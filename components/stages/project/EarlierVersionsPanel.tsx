import { Check, ChevronDown, ChevronLeft, Clock3, Database, Pencil, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ProjectVersionsView, VersionBranchInfo, VersionEntry, VersionReason } from '../../../runtime/versions/versionTypes';

export type EarlierVersionsPanelProps = {
  versions: ProjectVersionsView;
};

const SHORT_TIME_FORMAT = {
  year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
} as const;
const EXACT_TIME_FORMAT = {
  dateStyle: 'full', timeStyle: 'long',
} as const;

const dateFor = (timestamp: number) => {
  if (!Number.isFinite(timestamp)) return undefined;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const formatVersionTimestamp = (timestamp: number) => {
  const date = dateFor(timestamp);
  return date ? new Intl.DateTimeFormat(undefined, SHORT_TIME_FORMAT).format(date) : 'Time unavailable';
};

export const versionTimestampTitle = (timestamp: number) => {
  const date = dateFor(timestamp);
  return date ? new Intl.DateTimeFormat(undefined, EXACT_TIME_FORMAT).format(date) : 'Time unavailable';
};

export const versionReasonLabel = (reason: VersionReason) => {
  if (reason === 'automatic') return 'Automatic';
  if (reason === 'manual') return 'Manual';
  if (reason === 'restored') return 'Restored';
  return `Protected · ${reason.replace('before-', 'before ')}`;
};

const versionStatus = (entry: VersionEntry) => {
  const status = (entry as VersionEntry & { status?: string }).status;
  return status === 'committed' ? 'Committed' : 'Pending';
};

const statusLabel = (state: ProjectVersionsView['state']) => {
  if (state === 'loading') return 'Loading versions…';
  if (state === 'saving') return 'Saving version…';
  if (state === 'failed') return 'Version save failed';
  return '';
};

const retainedRange = (entries: VersionEntry[]) => {
  const timestamps = entries.map(entry => entry.createdAt).filter(timestamp => dateFor(timestamp) !== undefined).sort((a, b) => a - b);
  if (!timestamps.length) return 'Retained range unavailable';
  const first = formatVersionTimestamp(timestamps[0]);
  const last = formatVersionTimestamp(timestamps[timestamps.length - 1]);
  return first === last ? `Retained ${first}` : `Retained ${first} → ${last}`;
};

const formatBranchSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Size unavailable';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

const branchVersionCount = (branch: VersionBranchInfo) =>
  Number.isFinite(branch.versions) && branch.versions >= 0 ? Math.floor(branch.versions) : 0;

const BrowserStorageRow = ({ branch, onRemove }: {
  branch: VersionBranchInfo;
  onRemove?: (branch: VersionBranchInfo) => void;
}) => {
  const projectName = branch.projectName.trim() || 'Unnamed project';
  return <div
    className="grid gap-1 rounded-lg border bg-white p-2"
    data-testid={`earlier-browser-storage-branch-${branch.branchId}`}
  >
    <div className="flex items-start justify-between gap-2">
      <strong className="min-w-0 flex-1 truncate text-xs text-slate-800" title={projectName}>{projectName}</strong>
      {onRemove && <button
        type="button"
        className="btn-secondary"
        onClick={() => onRemove(branch)}
        aria-label={`Delete browser versions for ${projectName}`}
        data-testid={`earlier-browser-storage-delete-${branch.branchId}`}
        style={{ flex: '0 0 auto', padding: '.35rem .55rem', whiteSpace: 'nowrap' }}
      >
        <Trash2 size={13} aria-hidden="true" /> Delete
      </button>}
    </div>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
      <time dateTime={dateFor(branch.updatedAt)?.toISOString()} title={versionTimestampTitle(branch.updatedAt)}>
        {formatVersionTimestamp(branch.updatedAt)}
      </time>
      <span>{formatBranchSize(branch.bytes)}</span>
      <span>{branchVersionCount(branch)} versions</span>
    </div>
  </div>;
};

export const EarlierVersionsPanel = ({ versions }: EarlierVersionsPanelProps) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [editingId, setEditingId] = useState<string>();
  const [draftName, setDraftName] = useState('');
  const [keepName, setKeepName] = useState('');
  const [storageOpen, setStorageOpen] = useState(false);
  const busy = versions.state === 'loading' || versions.state === 'saving';
  const entries = versions.entries;
  const hasStorageManagement = typeof versions.manageStorage === 'function';

  useLayoutEffect(() => {
    closeRef.current?.focus();
  }, []);

  const cancelRename = () => {
    setEditingId(undefined);
    setDraftName('');
  };

  const submitRename = (event: FormEvent<HTMLFormElement>, id: string) => {
    event.preventDefault();
    const name = draftName.trim();
    if (name) versions.rename(id, name);
    cancelRename();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (editingId) cancelRename();
    else versions.close();
  };

  const openBrowserStorage = () => {
    setStorageOpen(true);
    versions.manageStorage?.();
  };

  const toggleBrowserStorage = () => {
    if (storageOpen) setStorageOpen(false);
    else openBrowserStorage();
  };

  return <section
    className="stage-pane-stack"
    data-testid="earlier-versions-panel"
    aria-label="Earlier versions"
    onKeyDown={handleKeyDown}
    style={{ gap: '.72rem' }}
  >
    <div className="flex items-center justify-between gap-2">
      <div>
        <div className="section-title">Project history</div>
        <h3 className="mt-1" style={{ marginBottom: 0 }}>Earlier versions</h3>
      </div>
      <button
        ref={closeRef}
        type="button"
        className="btn-secondary"
        onClick={versions.close}
        aria-label="Back to current project"
        data-testid="earlier-versions-close"
      >
        <ChevronLeft size={15} aria-hidden="true" /> Back
      </button>
    </div>

    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500" data-testid="earlier-versions-retained-range">
      <span>{retainedRange(entries)}</span>
      <span className="status-chip" data-history-file-status={versions.includedInFile ? 'included' : 'browser-only'}>
        {versions.includedInFile ? 'Included in project file' : 'Browser versions'}
      </span>
    </div>

    {hasStorageManagement && <div className="grid gap-2">
        <button
          type="button"
          className="btn-secondary"
          aria-expanded={storageOpen}
          aria-controls="earlier-browser-storage-list"
          onClick={toggleBrowserStorage}
          data-testid="earlier-browser-storage-toggle"
          style={{ justifyContent: 'space-between', width: '100%', whiteSpace: 'nowrap' }}
        >
          <span className="flex items-center gap-2"><Database size={14} aria-hidden="true" /> Browser storage</span>
          <ChevronDown size={14} aria-hidden="true" style={{ transform: storageOpen ? 'rotate(180deg)' : undefined }} />
        </button>
        {storageOpen && <div
          id="earlier-browser-storage-list"
          className="grid gap-2 rounded-xl border bg-slate-50 p-2"
          role="region"
          aria-label="Other browser projects"
          data-testid="earlier-browser-storage"
          style={{ maxHeight: 'min(24vh, 10rem)', overflowY: 'auto', overscrollBehavior: 'contain', scrollbarGutter: 'stable' }}
        >
          {versions.browserBranches === undefined ? <div className="text-xs text-slate-500" role="status">Loading browser storage…</div>
            : versions.browserBranches.length === 0 ? <div className="text-xs text-slate-500" data-testid="earlier-browser-storage-empty">No other browser projects.</div>
              : versions.browserBranches.map(branch => <BrowserStorageRow
                key={branch.branchId}
                branch={branch}
                onRemove={versions.removeBrowserBranch}
              />)}
        </div>}
    </div>}

    <div className="grid gap-2" style={{ gridTemplateColumns: 'minmax(0, 1fr)', alignItems: 'end' }}>
      <label className="grid gap-1 text-xs font-bold text-slate-500" htmlFor="earlier-version-name">
        Keep version name <span className="font-normal">(optional)</span>
        <input
          id="earlier-version-name"
          className="field"
          value={keepName}
          maxLength={80}
          placeholder="Name this point"
          onChange={event => setKeepName(event.target.value)}
          disabled={busy}
        />
      </label>
      <button
        type="button"
        className="btn-primary"
        onClick={() => {
          versions.keep(keepName.trim() || undefined);
          setKeepName('');
        }}
        disabled={busy}
        data-feature-id="project.keepVersion"
        data-testid="earlier-version-keep"
        style={{ justifySelf: 'start', whiteSpace: 'nowrap' }}
      >
        <Save size={15} aria-hidden="true" /> Keep version
      </button>
    </div>

    {statusLabel(versions.state) && versions.state !== 'failed' && <div className="status-chip" role="status" data-testid="earlier-versions-state">{statusLabel(versions.state)}</div>}
    {versions.state === 'failed' && <div className="error" role="alert" data-testid="earlier-versions-failure">
      <div>{versions.message || 'Earlier versions could not be saved.'}</div>
      <div className="flex flex-wrap gap-2 mt-2">
        <button type="button" className="btn-secondary" onClick={versions.retry} data-testid="earlier-versions-retry">
          <RotateCcw size={14} aria-hidden="true" /> Retry
        </button>
        <button type="button" className="btn-secondary" onClick={versions.saveCurrentOnly} data-testid="earlier-versions-save-current-only">
          <Save size={14} aria-hidden="true" /> Save current only
        </button>
        {hasStorageManagement && <button type="button" className="btn-secondary" onClick={openBrowserStorage} data-testid="earlier-versions-manage-storage">
          <Database size={14} aria-hidden="true" /> Browser storage
        </button>}
      </div>
    </div>}

    <div
      className="grid gap-2 overflow-auto"
      role="list"
      aria-label="Retained versions"
      data-testid="earlier-versions-list"
      style={{ maxHeight: 'min(48vh, 25rem)', minHeight: entries.length ? '8rem' : undefined, overscrollBehavior: 'contain', scrollbarGutter: 'stable' }}
    >
      {entries.length ? entries.map(entry => {
        const selected = entry.id === versions.selectedId;
        const status = versionStatus(entry);
        const timestamp = formatVersionTimestamp(entry.createdAt);
        const title = versionTimestampTitle(entry.createdAt);
        const displayName = entry.name || entry.description || 'Unnamed version';
        return <div
          key={entry.id}
          role="listitem"
          className="border rounded-xl bg-white p-3"
          data-testid={`earlier-version-row-${entry.id}`}
          data-version-status={status.toLowerCase()}
          data-version-reason={entry.reason}
          style={{ borderColor: selected ? 'var(--ms-accent)' : undefined, boxShadow: selected ? '0 0 0 2px var(--ms-accent) inset' : undefined }}
        >
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => versions.select(entry.id)}
              disabled={busy}
              aria-pressed={selected}
              data-earlier-version-select={entry.id}
              data-testid={`earlier-version-select-${entry.id}`}
              style={{ appearance: 'none', background: 'transparent', border: 0, color: 'inherit', minWidth: 0, padding: 0, textAlign: 'left' }}
            >
              <span className="flex items-center gap-1 text-xs font-bold text-slate-500">
                <Clock3 size={13} aria-hidden="true" />
                <time dateTime={dateFor(entry.createdAt)?.toISOString()} title={title}>{timestamp}</time>
              </span>
              <strong className="mt-1 block text-sm text-slate-800">{displayName}</strong>
              {entry.name && entry.description && <span className="mt-1 block text-xs text-slate-500">{entry.description}</span>}
            </button>
            <span className="status-chip" data-version-state={status.toLowerCase()}>{status}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="chip" data-version-kind={entry.reason}>{versionReasonLabel(entry.reason)}</span>
            {selected && <span className="chip" aria-label="Selected version"><Check size={12} aria-hidden="true" /> Selected</span>}
          </div>
          {editingId === entry.id ? <form className="mt-2 grid gap-2" onSubmit={event => submitRename(event, entry.id)}>
            <label className="text-xs font-bold text-slate-500" htmlFor={`rename-version-${entry.id}`}>Version name</label>
            <input
              id={`rename-version-${entry.id}`}
              className="field"
              value={draftName}
              maxLength={80}
              autoFocus
              onChange={event => setDraftName(event.target.value)}
            />
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={!draftName.trim()}><Check size={14} aria-hidden="true" /> Save name</button>
              <button type="button" className="btn-secondary" onClick={cancelRename}><X size={14} aria-hidden="true" /> Cancel</button>
            </div>
          </form> : <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setEditingId(entry.id); setDraftName(entry.name ?? ''); }}
              disabled={busy}
              aria-label={`Rename ${displayName}`}
              data-testid={`earlier-version-rename-${entry.id}`}
            >
              <Pencil size={13} aria-hidden="true" /> Rename
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => versions.remove(entry.id)}
              disabled={busy}
              aria-label={`Delete ${displayName}`}
              data-testid={`earlier-version-delete-${entry.id}`}
            >
              <Trash2 size={13} aria-hidden="true" /> Delete
            </button>
          </div>}
        </div>;
      }) : <div className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-500" data-testid="earlier-versions-empty">
        No earlier versions yet.
      </div>}
    </div>

    <div className="text-xs text-slate-500" role="status" data-testid="earlier-versions-hint">
      {versions.preview ? 'Preview is read-only. Current work stays unchanged until Restore.' : 'Select a version to preview it.'}
    </div>
  </section>;
};
