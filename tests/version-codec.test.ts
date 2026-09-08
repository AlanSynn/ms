import assert from 'node:assert/strict';
import type { ProjectState } from '../types';
import { createSampleProject, loadProjectSnapshot } from '../utils/project';
import {
  archiveBytes,
  decodeVersion,
  encodeVersion,
  retainedArchive,
  validateVersionArchive,
  versionBytes,
  versionHash,
} from '../runtime/versions/versionCodec';
import { AUTHORED_SETTINGS } from '../runtime/versions/versionPolicy';
import type { VersionArchive, VersionEntry } from '../runtime/versions/versionTypes';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const authoredProjection = (project: ProjectState) => ({
  parts: project.parts,
  partOrder: project.partOrder,
  sceneObjects: project.sceneObjects,
  sceneObjectOrder: project.sceneObjectOrder,
  skeleton: project.skeleton,
  paths: project.paths,
  pathOrder: project.pathOrder,
  motionTimeline: project.motionTimeline,
  mechanisms: project.mechanisms,
  characterPackage: project.characterPackage,
  settings: Object.fromEntries(AUTHORED_SETTINGS.map(key => [key, project.settings[key]])),
});

const project = loadProjectSnapshot(clone(createSampleProject({ includeMechanism: true })));
project.metadata = { ...project.metadata, name: 'Arm experiment' };
project.revision = 17;
project.selectedPartId = 'right_arm_lower';
project.selectedPathId = 'path-right-arm';
project.selectedMechanismId = project.mechanisms[0]?.id;
project.settings = {
  ...project.settings,
  theme: 'dark',
  animationSpeed: 1.8,
  simulationFriction: 0.72,
};
project.skeleton = clone(project.skeleton);
if (project.skeleton) project.skeleton.joints.right_elbow.position = { x: 130, y: 18 };
project.paths['path-right-arm'] = {
  ...project.paths['path-right-arm'],
  points: project.paths['path-right-arm'].points.map((point, index) =>
    index === 1 ? { ...point, x: point.x + 14, y: point.y - 9 } : point,
  ),
};
project.mechanisms = project.mechanisms.map(mechanism => ({
  ...mechanism,
  phase: (mechanism.phase ?? 0) + 0.25,
  targetPathId: 'path-right-arm',
}));

const makeEntry = (
  encoded: Awaited<ReturnType<typeof encodeVersion>>,
  id: string,
  reason: VersionEntry['reason'] = 'automatic',
  createdAt = 1_000,
): VersionEntry => ({
  id,
  lineageId: 'lineage-codec',
  projectId: encoded.projectId,
  createdAt,
  committedAt: createdAt + 1,
  status: 'committed',
  reason,
  description: reason === 'automatic' ? 'Changed arm motion' : `Kept ${id}`,
  snapshotId: encoded.snapshotId,
  bytes: encoded.bytes,
  assetIds: encoded.assetIds,
});

const replaceAllImageUrls = (source: ProjectState, url: string): ProjectState => {
  const next = clone(source);
  next.parts = Object.fromEntries(
    Object.entries(next.parts).map(([id, part]) => [id, { ...part, textureUrl: url }]),
  );
  return next;
};

const encoded = await encodeVersion(project);
const decoded = await decodeVersion(encoded.snapshot, encoded.snapshotId, encoded.assets);

assert.equal(encoded.projectId, project.metadata.id);
assert.equal(encoded.bytes, versionBytes(encoded.snapshot));
assert.equal(await versionHash(encoded.snapshot), encoded.snapshotId);
assert.deepEqual(Object.keys(encoded.assets).sort(), encoded.assetIds);
assert(encoded.assetIds.length > 0, 'sample project exercises image extraction');
assert(!encoded.snapshot.includes('data:image/'), 'snapshots store image references, not image payloads');
assert(encoded.snapshot.includes('motionsmith-asset:'), 'snapshots identify externalized assets');
assert.deepEqual(authoredProjection(decoded), authoredProjection(project));
assert.equal(decoded.metadata.id, project.metadata.id);
assert.equal(decoded.revision, 0, 'automatic version snapshots normalize revision metadata');
assert.equal(decoded.metadata.updatedAt, decoded.metadata.createdAt);
assert.equal(decoded.selectedPartId, undefined);
assert.equal(decoded.selectedPathId, undefined);
assert.equal(decoded.selectedMechanismId, undefined);
assert.equal(decoded.processing.stage, 'ready');
assert.equal(decoded.settings.theme, 'light', 'presentation settings are restored from current work');
assert.equal(decoded.settings.animationSpeed, 1);

const preserved = await encodeVersion(project, true);
const preservedProject = await decodeVersion(preserved.snapshot, preserved.snapshotId, preserved.assets);
assert.equal(preservedProject.settings.theme, 'dark');
assert.equal(preservedProject.settings.animationSpeed, 1.8);
assert.equal(preservedProject.revision, project.revision);
assert.equal(preservedProject.selectedPartId, project.selectedPartId);

const shared = 'data:image/svg+xml;utf8,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E';
const sharedEncoded = await encodeVersion(replaceAllImageUrls(project, shared));
const sharedReferences = [...sharedEncoded.snapshot.matchAll(/motionsmith-asset:[a-f0-9]{64}/g)];
assert(sharedReferences.length > 1, 'fixture contains repeated references');
assert.equal(sharedEncoded.assetIds.length, 1, 'repeated immutable artwork is stored once');
assert.equal(new Set(Object.values(sharedEncoded.assets)).size, 1);
const sharedDecoded = await decodeVersion(sharedEncoded.snapshot, sharedEncoded.snapshotId, sharedEncoded.assets);
assert.equal(new Set(Object.values(sharedDecoded.parts).map(part => part.textureUrl)).size, 1);

await assert.rejects(
  () => decodeVersion(encoded.snapshot, encoded.snapshotId, {}),
  /Version artwork is missing/,
);
await assert.rejects(
  () => decodeVersion(
    encoded.snapshot,
    `${encoded.snapshotId.slice(0, -1)}${encoded.snapshotId.endsWith('0') ? '1' : '0'}`,
    encoded.assets,
  ),
  /Version integrity check failed/,
);
const recursiveRaw = JSON.parse(encoded.snapshot) as Record<string, unknown>;
recursiveRaw.history = { entries: [] };
const recursiveSnapshot = JSON.stringify(recursiveRaw);
const recursiveSnapshotId = await versionHash(recursiveSnapshot);
await assert.rejects(
  () => decodeVersion(recursiveSnapshot, recursiveSnapshotId, encoded.assets),
  /Recursive version history is invalid/,
);
const unresolvedRaw = JSON.parse(encoded.snapshot) as Record<string, unknown>;
unresolvedRaw.parts = {
  ...unresolvedRaw.parts as Record<string, unknown>,
  head: {
    ...(unresolvedRaw.parts as Record<string, Record<string, unknown>>).head,
    textureUrl: 'motionsmith-asset:bad-id',
  },
};
const unresolvedSnapshot = JSON.stringify(unresolvedRaw);
const unresolvedSnapshotId = await versionHash(unresolvedSnapshot);
await assert.rejects(
  () => decodeVersion(unresolvedSnapshot, unresolvedSnapshotId, encoded.assets),
  /Version artwork is missing/,
);

const secondProject = clone(project);
secondProject.skeleton = clone(secondProject.skeleton);
if (secondProject.skeleton) secondProject.skeleton.joints.right_elbow.bendDirection *= -1;
const secondEncoded = await encodeVersion(secondProject);
const firstEntry = makeEntry(encoded, 'version-a', 'manual', 1_000);
const secondEntry = makeEntry(secondEncoded, 'version-b', 'automatic', 2_000);
const archive: VersionArchive = {
  schemaVersion: 1,
  lineageId: 'lineage-codec',
  entries: [firstEntry, secondEntry],
  snapshots: {
    [encoded.snapshotId]: encoded.snapshot,
    [secondEncoded.snapshotId]: secondEncoded.snapshot,
  },
  assets: { ...encoded.assets, ...secondEncoded.assets },
};
const validated = await validateVersionArchive(archive);
assert.deepEqual(validated.entries, archive.entries);
assert.equal(archiveBytes(archive),
  versionBytes(encoded.snapshot) + versionBytes(secondEncoded.snapshot) +
  Object.values(archive.assets).reduce((sum, value) => sum + versionBytes(value), 0) +
  versionBytes(JSON.stringify(archive.entries)));
const reduced = retainedArchive(archive, [secondEntry]);
assert.deepEqual(reduced.entries, [secondEntry]);
assert.deepEqual(Object.keys(reduced.snapshots), [secondEncoded.snapshotId]);
assert.deepEqual(Object.keys(reduced.assets).sort(), secondEncoded.assetIds);

const expectInvalidArchive = async (mutate: (value: VersionArchive & Record<string, unknown>) => void, message: RegExp) => {
  const candidate = clone(archive) as VersionArchive & Record<string, unknown>;
  mutate(candidate);
  await assert.rejects(() => validateVersionArchive(candidate), message);
};

await expectInvalidArchive(value => { Object.assign(value, { schemaVersion: 2 }); }, /Invalid earlier versions format/);
await expectInvalidArchive(value => {
  value.entries = [{ ...firstEntry, bytes: firstEntry.bytes + 1 }, secondEntry];
}, /Invalid earlier version entry/);
await expectInvalidArchive(value => {
  delete value.assets[firstEntry.assetIds[0]];
}, /Invalid earlier version entry/);
await expectInvalidArchive(value => {
  value.snapshots[firstEntry.snapshotId] = `${value.snapshots[firstEntry.snapshotId]}x`;
}, /Invalid earlier version entry|Version integrity|Invalid version snapshot/);
await expectInvalidArchive(value => {
  value.snapshots['a'.repeat(64)] = value.snapshots[firstEntry.snapshotId];
}, /Earlier versions contain unreferenced data/);
await expectInvalidArchive(value => {
  value.assets['b'.repeat(64)] = 'data:image/svg+xml;base64,AAAA';
}, /Version artwork integrity|Earlier versions contain unreferenced data/);
await expectInvalidArchive(value => {
  value.entries[0] = { ...value.entries[0], projectId: 'other-project' };
}, /Version project identity disagrees/);

console.log('version codec, asset extraction, and archive validation contracts ok');
