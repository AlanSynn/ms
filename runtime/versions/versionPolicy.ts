import type { AppSettings, ProjectState } from '../../types';
import { projectAuthoringChanged } from '../persistence/projectDecisionBoundary';
import type { VersionEntry } from './versionTypes';

export const VERSION_POLICY = Object.freeze({
  intervalMs: 60_000,
  entries: 48,
  bytes: 24 * 1024 * 1024,
  portableBytes: 48 * 1024 * 1024,
  snapshotBytes: 12 * 1024 * 1024,
  assetCount: 512,
  branches: 16,
  totalBrowserBytes: 96 * 1024 * 1024,
  automaticMaxAgeMs: 7 * 24 * 60 * 60_000,
});

export const AUTHORED_SETTINGS = [
  'animationDurationMs', 'timingProfile', 'physicsSnapMode', 'simulationFriction',
  'simulationMassKg', 'fabricationReadyMode', 'physicalKit',
] as const satisfies readonly (keyof AppSettings)[];

const equalSetting = (left: unknown, right: unknown) => {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => a[key] === b[key]);
};

/** Small identity/setting checks only; no serialization on editing paths. */
export const versionContentChanged = (before: ProjectState, after: ProjectState) =>
  projectAuthoringChanged(before, after) ||
  AUTHORED_SETTINGS.some(key => !equalSetting(before.settings[key], after.settings[key]));

export const protectedVersion = (entry: Pick<VersionEntry, 'reason'>) => entry.reason !== 'automatic';

export const versionRetention = (
  entries: readonly VersionEntry[],
  now: number,
  sizeOf: (entries: readonly VersionEntry[]) => number,
  limits: { entries: number; bytes: number } = VERSION_POLICY,
) => {
  const retained = entries.slice().sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const protectedEntries = retained.filter(protectedVersion);
  if (protectedEntries.length > limits.entries || sizeOf(protectedEntries) > limits.bytes) {
    throw new Error('Kept versions fill storage. Save Project, then remove a kept version.');
  }
  const buckets = new Set<string>();
  let next = retained.filter(entry => {
    if (protectedVersion(entry)) return true;
    const age = Math.max(0, now - entry.createdAt);
    if (age > VERSION_POLICY.automaticMaxAgeMs) return false;
    const width = age < 10 * 60_000 ? 60_000 : age < 60 * 60_000 ? 5 * 60_000
      : age < 6 * 60 * 60_000 ? 15 * 60_000 : age < 24 * 60 * 60_000 ? 60 * 60_000 : 6 * 60 * 60_000;
    const key = `${width}:${Math.floor(entry.createdAt / width)}`;
    if (buckets.has(key)) return false;
    buckets.add(key);
    return true;
  });
  while (next.length > limits.entries || sizeOf(next) > limits.bytes) {
    const candidates = next.map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !protectedVersion(entry));
    // Remove the least isolated sample first, preserving temporal diversity.
    const removable = candidates.sort((a, b) => {
      const gap = (index: number) => index === 0 || index === next.length - 1
        ? Number.MAX_SAFE_INTEGER
        : next[index - 1].createdAt - next[index + 1].createdAt;
      return gap(a.index) - gap(b.index) || b.entry.createdAt - a.entry.createdAt;
    })[0];
    if (!removable) throw new Error('Kept versions fill storage. Save Project, then remove a kept version.');
    next.splice(removable.index, 1);
  }
  return { retained: next, removed: retained.filter(entry => !next.includes(entry)) };
};

export const describeVersionChange = (before: ProjectState, after: ProjectState): string => {
  if (before.metadata.name !== after.metadata.name) return `Renamed ${after.metadata.name}`.slice(0, 120);
  if (before.skeleton !== after.skeleton) return 'Changed joints';
  if (before.parts !== after.parts) {
    const id = Object.keys(after.parts).find(key => before.parts[key] !== after.parts[key]);
    return id ? `Changed ${after.parts[id].name}`.slice(0, 120) : 'Removed a part';
  }
  if (before.paths !== after.paths) {
    const id = Object.keys(after.paths).find(key => before.paths[key] !== after.paths[key]);
    const path = id ? after.paths[id] : undefined;
    const target = path && (after.parts[path.partId]?.name ?? after.sceneObjects[path.sceneObjectId ?? '']?.name);
    return path ? `${target ?? 'Motion'} path changed`.slice(0, 120) : 'Removed a path';
  }
  if (before.mechanisms !== after.mechanisms) return 'Changed mechanisms';
  if (before.sceneObjects !== after.sceneObjects) return 'Changed objects';
  return 'Changed project settings';
};

/** Authored state restores, while presentation preferences and camera remain current. */
export const restoreAuthoredSettings = (current: AppSettings, selected: AppSettings): AppSettings => {
  const settings = { ...current };
  for (const key of AUTHORED_SETTINGS) Object.assign(settings, { [key]: selected[key] });
  return settings;
};
