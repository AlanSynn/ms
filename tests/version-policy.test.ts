import assert from 'node:assert/strict';
import type { ProjectState } from '../types';
import {
  applyProjectAction,
  createSampleProject,
  loadProjectSnapshot,
} from '../utils/project';
import {
  AUTHORED_SETTINGS,
  describeVersionChange,
  protectedVersion,
  versionContentChanged,
  versionRetention,
  VERSION_POLICY,
} from '../runtime/versions/versionPolicy';
import { restoredProjectState } from '../runtime/versions/versionRestoration';
import type { VersionEntry } from '../runtime/versions/versionTypes';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const mechanismAuthored = (mechanisms: ProjectState['mechanisms']) => mechanisms.map(mechanism => {
  const next = clone(mechanism) as ProjectState['mechanisms'][number] & {
    fabricationMetadata?: Record<string, unknown>;
    outputs?: Array<Record<string, unknown>>;
  };
  if (next.fabricationMetadata) {
    delete next.fabricationMetadata.pathFit;
    delete next.fabricationMetadata.warnings;
  }
  if (next.outputs) next.outputs = next.outputs.map(output => {
    const { fit: _fit, ...authoredOutput } = output;
    return authoredOutput;
  });
  return next;
});

const entry = (
  id: string,
  createdAt: number,
  reason: VersionEntry['reason'] = 'automatic',
  overrides: Partial<VersionEntry> = {},
): VersionEntry => ({
  id,
  lineageId: 'lineage-policy',
  projectId: 'project-policy',
  createdAt,
  committedAt: createdAt + 1,
  status: 'committed',
  reason,
  description: reason === 'automatic' ? 'Changed project settings' : `Protected ${id}`,
  snapshotId: id.padEnd(64, '0').slice(0, 64),
  bytes: 1_024,
  assetIds: [],
  ...overrides,
});

const minute = 60_000;
const now = 30 * minute;

// A half-hour of one-minute commits keeps representative states from the
// 10–15 minute window instead of collapsing to the latest FIFO entries.
const halfHour = Array.from({ length: 30 }, (_, index) =>
  entry(`auto-${index}`, index * minute),
);
const retainedHalfHour = versionRetention(
  halfHour,
  now,
  values => values.reduce((sum, value) => sum + value.bytes, 0),
  { entries: VERSION_POLICY.entries, bytes: VERSION_POLICY.bytes },
).retained;
assert(retainedHalfHour.length > 0);
assert(
  retainedHalfHour.some(item => item.createdAt >= 15 * minute && item.createdAt <= 20 * minute),
  'automatic retention keeps a state from 10–15 minutes before now',
);
assert(retainedHalfHour.some(item => item.createdAt < 10 * minute));
assert(retainedHalfHour.some(item => item.createdAt > 20 * minute));

// A burst at the current time must not evict the older temporal buckets.
const burst = [
  ...halfHour,
  ...Array.from({ length: 64 }, (_, index) => entry(`burst-${index}`, now)),
];
const retainedBurst = versionRetention(
  burst,
  now,
  values => values.reduce((sum, value) => sum + value.bytes, 0),
  { entries: VERSION_POLICY.entries, bytes: VERSION_POLICY.bytes },
).retained;
assert(retainedBurst.length <= VERSION_POLICY.entries);
assert(retainedBurst.some(item => item.createdAt >= 15 * minute && item.createdAt <= 20 * minute));
assert(retainedBurst.some(item => item.createdAt < 10 * minute));

// Seven-day automatic cleanup is bounded, while manually kept points remain
// discoverable and are protected from automatic pruning.
const oldAutomatic = entry('old-auto', now - VERSION_POLICY.automaticMaxAgeMs - minute);
const kept = entry('kept-old', now - VERSION_POLICY.automaticMaxAgeMs - minute, 'manual');
const ageBounded = versionRetention(
  [oldAutomatic, kept, entry('fresh', now - minute)],
  now,
  values => values.reduce((sum, value) => sum + value.bytes, 0),
  { entries: 48, bytes: 48 * 1_024 },
);
assert(!ageBounded.retained.some(item => item.id === oldAutomatic.id));
assert(ageBounded.retained.some(item => item.id === kept.id));
assert(protectedVersion(kept));
assert(!protectedVersion(oldAutomatic));

assert.throws(
  () => versionRetention(
    [entry('kept-a', now, 'manual'), entry('kept-b', now - minute, 'before-reset')],
    now,
    values => values.reduce((sum, value) => sum + value.bytes, 0),
    { entries: 1, bytes: 1_024 },
  ),
  /Kept versions fill storage/,
);

const baseline = createSampleProject({ includeMechanism: true });
const selected = loadProjectSnapshot(clone(baseline));
const presentation = applyProjectAction(baseline, {
  type: 'update_settings',
  settings: { theme: 'dark', animationSpeed: 1.7 },
});
assert.equal(versionContentChanged(baseline, presentation), false);
assert.equal(
  versionContentChanged(
    baseline,
    applyProjectAction(baseline, {
      type: 'set_processing',
      processing: { stage: 'ready', progress: 100, message: 'Preview only' },
    }),
  ),
  false,
);
assert.equal(
  versionContentChanged(
    baseline,
    applyProjectAction(baseline, {
      type: 'update_part',
      partId: 'head',
      updates: { transform: { ...baseline.parts.head.transform, rotation: 14 } },
    }),
  ),
  true,
);
assert.equal(
  versionContentChanged(
    baseline,
    applyProjectAction(baseline, {
      type: 'update_settings',
      settings: { simulationFriction: baseline.settings.simulationFriction + 0.1 },
    }),
  ),
  true,
);
assert.equal(
  versionContentChanged(
    baseline,
    { ...baseline, metadata: { ...baseline.metadata, updatedAt: '2099-01-01T00:00:00.000Z' } },
  ),
  false,
);
assert.match(
  describeVersionChange(
    baseline,
    applyProjectAction(baseline, {
      type: 'update_part',
      partId: 'head',
      updates: { transform: { ...baseline.parts.head.transform, rotation: 14 } },
    }),
  ),
  /Head/,
);
assert.match(
  describeVersionChange(
    baseline,
    applyProjectAction(baseline, {
      type: 'update_settings',
      settings: { simulationMassKg: baseline.settings.simulationMassKg + 0.5 },
    }),
  ),
  /settings/,
);

const current = loadProjectSnapshot(clone(baseline));
current.metadata = { ...current.metadata, id: 'current-lineage-project' };
current.revision = 9;
current.settings = {
  ...current.settings,
  theme: 'blueprint',
  animationSpeed: 1.8,
  simulationFriction: 0.91,
};
current.selectedPartId = 'head';
current.selectedPathId = 'path-right-arm';
current.selectedMechanismId = current.mechanisms[0]?.id;
current.processing = { stage: 'error', progress: 12, message: 'Stale preview' };
current.lastFoundryExport = { id: 'stale-export' } as never;

const restored = restoredProjectState(current, selected, now + minute);
assert.equal(restored.metadata.id, current.metadata.id, 'restoration stays in the active project lineage');
assert.equal(restored.metadata.updatedAt, new Date(now + minute).toISOString());
assert.equal(restored.revision, Math.max(current.revision ?? 0, selected.revision ?? 0) + 1);
assert.deepEqual(restored.parts, selected.parts);
assert.deepEqual(restored.skeleton, selected.skeleton);
assert.deepEqual(restored.paths, selected.paths);
assert.deepEqual(mechanismAuthored(restored.mechanisms), mechanismAuthored(selected.mechanisms));
assert.deepEqual(restored.characterPackage, selected.characterPackage);
assert.equal(restored.settings.theme, current.settings.theme, 'presentation setting stays with current work');
assert.equal(restored.settings.animationSpeed, current.settings.animationSpeed);
for (const key of AUTHORED_SETTINGS) {
  assert.deepEqual(restored.settings[key], selected.settings[key], `${key} restores from the selected version`);
}
assert.equal(restored.processing.stage, 'ready');
assert.equal(restored.processing.progress, 100);
assert.equal(restored.lastFoundryExport, undefined);
assert.equal(restored.selectedPartId, current.selectedPartId);
assert.equal(restored.selectedPathId, current.selectedPathId);
assert.equal(restored.selectedMechanismId, current.selectedMechanismId);

console.log('version policy retention, change detection, and restoration contracts ok');
