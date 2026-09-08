import assert from 'node:assert/strict';
import { createSampleProject, loadProjectSnapshot } from '../utils/project';
import {
  assertProjectRoundTrip,
  serializeProject,
} from '../utils/projectSerialization';
import {
  decodeVersion,
  encodeVersion,
  versionHash,
} from '../runtime/versions/versionCodec';
import {
  createVersionedProjectBlob,
  readPortableProjectBundle,
} from '../runtime/versions/versionPortable';
import { PORTABLE_PROJECT_MIME_TYPE } from '../runtime/persistence/projectDownloadJob';
import type { VersionArchive, VersionEntry } from '../runtime/versions/versionTypes';
import { VERSION_POLICY } from '../runtime/versions/versionPolicy';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fingerprint = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const project = loadProjectSnapshot(clone(createSampleProject({ includeMechanism: true })));
project.metadata = { ...project.metadata, name: 'Portable arm study' };
project.revision = 12;
project.selectedPartId = 'right_arm_lower';
project.settings = { ...project.settings, theme: 'blueprint', animationSpeed: 1.4 };

const historical = clone(project);
historical.revision = 4;
if (historical.skeleton) historical.skeleton.joints.right_elbow.position = { x: 121, y: 22 };
const encoded = await encodeVersion(historical);
const entry: VersionEntry = {
  id: 'kept-arm-state',
  lineageId: 'lineage-portable',
  projectId: encoded.projectId,
  createdAt: 10_000,
  committedAt: 10_001,
  status: 'committed',
  reason: 'manual',
  name: 'Working arm',
  description: 'Kept before mechanism changes',
  snapshotId: encoded.snapshotId,
  bytes: encoded.bytes,
  assetIds: encoded.assetIds,
};
const archive: VersionArchive = {
  schemaVersion: 1,
  lineageId: 'lineage-portable',
  entries: [entry],
  snapshots: { [encoded.snapshotId]: encoded.snapshot },
  assets: { ...encoded.assets },
};

const blob = await createVersionedProjectBlob(project, archive);
assert.equal(blob.type, PORTABLE_PROJECT_MIME_TYPE);
assert(blob.size > 0);
const document = JSON.parse(await blob.text()) as Record<string, any>;
assert.equal(document.format, 'motionsmith-project');
assert(document.history, 'saved project carries the version extension');
assert.equal(document.history.currentSnapshotId.length, 64);
assert.equal(document.history.entries.length, 1);
assert(!JSON.stringify(document.project).includes('history'), 'current snapshot does not recursively contain history');
assert(document.history.currentAssetIds.every((id: string) => id in document.history.assets));

const reopened = await readPortableProjectBundle(document);
assertProjectRoundTrip(project, reopened.project);
assert(reopened.history);
assert.deepEqual(reopened.history.entries, archive.entries);
assert.deepEqual(Object.keys(reopened.history.snapshots), [encoded.snapshotId]);
assert.deepEqual(Object.keys(reopened.history.assets).sort(), encoded.assetIds);
assert.equal(reopened.project.parts.right_arm_lower.textureUrl?.startsWith('data:image/'), true);
const reopenedHistorical = await decodeVersion(
  reopened.history.snapshots[entry.snapshotId],
  entry.snapshotId,
  reopened.history.assets,
);
assert.equal(reopenedHistorical.skeleton?.joints.right_elbow.position.x, 121);

// A file written before history existed remains a current project with no
// fabricated entries or timestamps.
const legacyDocument = JSON.parse(serializeProject(project));
const legacy = await readPortableProjectBundle(legacyDocument);
assert.equal(legacy.history, undefined);
assertProjectRoundTrip(project, legacy.project);

const expectUnchangedRejection = async (
  mutate: (value: Record<string, any>) => void | Promise<void>,
  message: RegExp,
) => {
  const candidate = clone(document);
  const before = JSON.stringify(document.project);
  await mutate(candidate);
  await assert.rejects(() => readPortableProjectBundle(candidate), message);
  assert.equal(JSON.stringify(document.project), before, 'invalid history cannot mutate the current project');
};

await expectUnchangedRejection(value => {
  value.history.currentAssetIds = value.history.currentAssetIds.slice(1);
}, /Current artwork references disagree/);
await expectUnchangedRejection(value => {
  delete value.history.assets[value.history.currentAssetIds[0]];
}, /Earlier versions contain unreferenced data|Invalid earlier version entry/);
await expectUnchangedRejection(value => {
  value.history.snapshots[encoded.snapshotId] += 'x';
}, /Invalid earlier version entry|Version integrity/);
await expectUnchangedRejection(value => {
  value.history.currentSnapshotId = '0'.repeat(64);
}, /Version integrity check failed/);
await expectUnchangedRejection(value => {
  value.project.history = { entries: [] };
  value.integrity.contentFingerprint = fingerprint(JSON.stringify(value.project));
  return versionHash(JSON.stringify(value.project)).then(snapshotId => {
    value.history.currentSnapshotId = snapshotId;
  });
}, /Recursive version history is invalid/);
await expectUnchangedRejection(value => {
  value.history.schemaVersion = 2;
}, /Invalid earlier versions format/);

// Each asset stays below the per-asset limit, but the archive as a whole is
// over the 24 MiB browser-history limit. This exercises the archive guard
// without relying on a malformed hash or an invalid image MIME type.
const oversized = {
  ...document,
  history: {
    ...document.history,
    assets: { ...document.history.assets },
  },
} as Record<string, any>;
for (const seed of ['a', 'b']) {
  const image = `data:image/png;base64,${seed.repeat(12_570_000)}`;
  oversized.history.assets[await versionHash(image)] = image;
}
assert(Object.values(oversized.history.assets).every((value: any) =>
  new TextEncoder().encode(value).byteLength <= VERSION_POLICY.snapshotBytes));
await assert.rejects(
  () => readPortableProjectBundle(oversized),
  /Earlier versions exceed the 24 MB history limit/,
);
assert.equal(JSON.stringify(oversized.project), JSON.stringify(document.project));

console.log('portable version archive, legacy compatibility, and corruption guards ok');
