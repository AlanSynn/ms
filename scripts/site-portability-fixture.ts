import assert from 'node:assert/strict';
import type { ProjectState } from '../types';
import { createFabricationReadyFourBarProject } from '../tests/fixtures/fabricationProject';
import { createDefaultSceneObject, loadProjectSnapshot } from '../utils/project';
import { appendArtworkOperation, artworkForOwner } from '../utils/artwork';
import { mechanismOutputBindings } from '../utils/mechanismBindings';
import { encodeVersion } from '../runtime/versions/versionCodec';
import { createVersionedProjectBlob } from '../runtime/versions/versionPortable';
import type { VersionArchive } from '../runtime/versions/versionTypes';

/** Synthetic retained artwork and authored state; never reads browser storage. */
export const sitePortabilityFixture = async () => {
  const seed = createFabricationReadyFourBarProject();
  const first = seed.paths['fabrication-fit-path'];
  const second = { ...first, id: 'portability-left-path', partId: 'left_arm_lower',
    targetAnchorJointId: 'left_hand', chainRootJointId: 'left_shoulder',
    points: first.points.map(point => ({ x: -point.x, y: point.y + 14 })),
    timedPoints: first.points.map((point, index) => ({ x: -point.x, y: point.y + 14, time: index * 25 })),
    smoothness: 47, duration: 3200, source: 'imported' as const };
  const head = seed.parts.head;
  const artwork = appendArtworkOperation(artworkForOwner(head), {
    id: 'portability-painted-eye', kind: 'brush',
    points: [{ x: -12, y: 12 }, { x: -10, y: 12 }], width: 4, color: '#172033',
  });
  const prop = createDefaultSceneObject('star', 'portability-star');
  const propTexture = `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2389da"/></svg>',
  ).toString('base64')}`;
  const project = loadProjectSnapshot({ ...seed, revision: 12,
    metadata: { ...seed.metadata, id: 'site-portability-fixture', name: 'Portable motion study',
      createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z' },
    parts: { ...seed.parts, head: { ...head, artwork } },
    sceneObjects: { [prop.id]: { ...prop, textureUrl: propTexture, sourceImageName: 'synthetic-star.svg' } },
    sceneObjectOrder: [prop.id],
    paths: { ...seed.paths, [second.id]: second }, pathOrder: [first.id, second.id],
    motionTimeline: { durationMs: 4000, startOffsetByPathId: { [first.id]: 0, [second.id]: 250 } },
    settings: { ...seed.settings, autosave: false, theme: 'blueprint', animationSpeed: 1.4,
      animationDurationMs: 4000, simulationFriction: 0.35, simulationMassKg: 0.12 },
  });
  assert.equal(project.mechanisms[0].fabricationMetadata?.pathFit?.status, 'fit');
  assert.equal(mechanismOutputBindings(project.mechanisms[0])[0].pathId, first.id);
  assert.equal(Object.keys(project.paths).length, 2);
  const historical: ProjectState = structuredClone(project);
  historical.parts.head.transform.rotation = 5;
  historical.revision = 4;
  const encoded = await encodeVersion(historical);
  const history: VersionArchive = {
    schemaVersion: 1, lineageId: 'site-portability-lineage',
    entries: [{ id: 'site-portability-kept-version', lineageId: 'site-portability-lineage',
      projectId: encoded.projectId, createdAt: 10_000, committedAt: 10_001,
      status: 'committed', reason: 'manual', name: 'Before the site move',
      description: 'Retained synthetic artwork and motion', snapshotId: encoded.snapshotId,
      bytes: encoded.bytes, assetIds: encoded.assetIds }],
    snapshots: { [encoded.snapshotId]: encoded.snapshot }, assets: encoded.assets,
  };
  return { project, history, blob: await createVersionedProjectBlob(project, history) };
};

export const assertEmbeddedProjectImages = (project: ProjectState) => {
  const owners = [...Object.values(project.parts), ...Object.values(project.sceneObjects), project.characterPackage];
  let embedded = 0;
  for (const owner of owners) {
    if (!owner) continue;
    for (const key of ['textureUrl', 'maskUrl', 'sourceTextureUrl']) {
      const value: unknown = (owner as unknown as Record<string, unknown>)[key];
      if (value === undefined) continue;
      assert.equal(typeof value, 'string', `${key} must be text`);
      assert.match(value as string, /^data:image\//, `${key} must be embedded, without a blob or previous origin`);
      embedded++;
    }
  }
  assert(embedded >= 15, 'All character textures and scene artwork must survive');
  assert.equal(project.parts.head.artwork?.operations[0]?.id, 'portability-painted-eye');
};
