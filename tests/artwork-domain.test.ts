import assert from 'node:assert/strict';
import type { ArtworkDocument, ArtworkOperation } from '../types';
import {
  ARTWORK_LIMITS, appendArtworkOperation, assertArtworkEditWithinProjectLimits, artworkForOwner, artworkLocalToPixel,
  artworkOwnerFrame, artworkPixelToLocal, artworkRevision, clearArtwork,
  createArtworkDocument, normalizeArtworkDocument, ownerLocalToScene, sceneToOwnerLocal,
} from '../utils/artwork';
import { applyProjectAction, createDefaultSceneObject, createSampleProject, loadProjectSnapshot } from '../utils/project';
import { assertProjectRoundTrip, projectContentFingerprint } from '../utils/projectSerialization';
import { createPortableProjectBlob } from '../runtime/persistence/projectDownloadJob';
import { runProjectImportJob } from '../runtime/import/projectImportJob';
import { readProjectFileCandidate } from '../runtime/import/projectFileCandidate';
import { validateProjectImportShape } from '../runtime/import/projectImportPolicy';
import { createProjectHistoryEntry } from '../runtime/persistence/projectHistoryPolicy';
import { isUndoableProjectAction } from '../hooks/useProjectHistory';
import { recommendationProjectSnapshot, recommendationProjectSnapshotChunked } from '../runtime/recommendations/mechanismRecommendationJob';
import { createMechanismFitJobInput } from '../runtime/fitting/mechanismFitJob';
import { createMechanismOptimizerJobInput } from '../runtime/optimizer/mechanismOptimizerJob';
import { designFamilyFitAuthorityChanged } from '../runtime/fitting/designFamilyFitAuthority';
import { rectangleOutline } from '../utils/shapeEditing';

const frame = { x: -40, y: -60, width: 80, height: 120 };
const brush: ArtworkOperation = { id: 'ink-shirt', kind: 'brush', points: [{ x: -20, y: 10 }, { x: 20, y: 10 }], width: 12, color: '#ec4899' };
const erase: ArtworkOperation = { id: 'ink-erase', kind: 'erase', points: [{ x: 0, y: 10 }], width: 8 };
const repaint: ArtworkOperation = { id: 'ink-repaint', kind: 'line', from: { x: 0, y: 8 }, to: { x: 0, y: 12 }, width: 2, color: '#2563eb' };
const source = createArtworkDocument(frame, { sourceImageFrame: frame });
const first = appendArtworkOperation(source, brush);
const second = appendArtworkOperation(first, erase);
const third = appendArtworkOperation(second, repaint);
assert.equal(source.operations.length, 0);
assert.equal(first.operations.length, 1);
assert.equal(second.operations.length, 2);
assert.deepEqual(third.operations.map(operation => operation.kind), ['brush', 'erase', 'line']);
assert.equal(third.operations[0], first.operations[0], 'committed operations share immutable source through history');
assert.notEqual(first.operations[0], brush, 'caller gesture buffers cannot mutate committed source');
assert(Object.isFrozen(first.operations[0]) && Object.isFrozen(first.operations));
(brush.points as Array<{ x: number; y: number }>)[0].x = 999;
assert.equal('points' in first.operations[0] && first.operations[0].points[0].x, -20);
assert.notEqual(first.revision, second.revision);
const reorderedKeys = JSON.parse(JSON.stringify(third)) as ArtworkDocument;
assert.equal(artworkRevision({ ...reorderedKeys, frame: { height: 120, width: 80, y: -60, x: -40 } }), third.revision);
assert.equal(clearArtwork(third).sourceImage, undefined, 'clear removes imported ink from replay while the owner retains its bytes');
assert.deepEqual(clearArtwork(third).frame, frame);

const transform = { x: 10, y: 20, rotation: 90, scale: 2 };
const local = { x: 2, y: 3 };
const scene = ownerLocalToScene(local, transform);
assert(Math.abs(scene.x - 4) < 1e-12 && Math.abs(scene.y - 24) < 1e-12);
const restored = sceneToOwnerLocal(scene, transform);
assert(Math.abs(restored.x - local.x) < 1e-12 && Math.abs(restored.y - local.y) < 1e-12);
assert.throws(() => sceneToOwnerLocal(local, { ...transform, scale: 0 }));
const rasterFrame = { x: -10, y: -20, width: 40, height: 60 }, resolution = { width: 400, height: 600 };
assert.deepEqual(artworkLocalToPixel({ x: 0, y: 20 }, rasterFrame, resolution), { x: 100, y: 200 });
assert.deepEqual(artworkPixelToLocal({ x: 100, y: 200 }, rasterFrame, resolution), { x: 0, y: 20 });

const baseline = createSampleProject({ includeMechanism: true });
const partId = 'torso';
const part = baseline.parts[partId];
const baselineJson = JSON.stringify(baseline);
const initial = artworkForOwner(part);
assert(initial.sourceImage && part.textureUrl);
assert.equal(JSON.stringify(baseline), baselineJson, 'opening an editor does not create project content');
const painted = appendArtworkOperation(initial, first.operations[0]);
const action = { type: 'update_part' as const, partId, updates: { artwork: painted } };
const project = applyProjectAction(baseline, action);
assert(isUndoableProjectAction(action), 'one complete gesture enters the existing project undo history');
assert.equal(project.paths, baseline.paths, 'painting does not refit paths');
assert.equal(project.mechanisms, baseline.mechanisms, 'painting does not refit mechanisms');
assert.equal(project.skeleton, baseline.skeleton);
assert.equal(project.parts[partId].contourPoints, part.contourPoints);
assert.equal(project.parts[partId].transform, part.transform);
assert.notEqual(projectContentFingerprint(project), projectContentFingerprint(baseline));
assert.equal(project.parts.left_arm_lower, baseline.parts.left_arm_lower, 'artwork belongs to one owner');
const undoEntry = createProjectHistoryEntry(baseline, project);
assert.equal(undoEntry.project.parts[partId].artwork, undefined);
assert.deepEqual(project.parts[partId].artwork, painted, 'redo retains editable operations');
assert.equal(JSON.stringify(baseline), baselineJson);
assert.equal(designFamilyFitAuthorityChanged(baseline, project), false, 'painting cannot cancel an otherwise current geometry fit');
const recolored = applyProjectAction(project, { type: 'update_part', partId, updates: { fillColor: '#123456' } });
assert.equal(designFamilyFitAuthorityChanged(project, recolored), false);
const fitProjection = recommendationProjectSnapshot(recolored);
assert.equal(fitProjection.parts[partId].artwork, undefined, 'solver transfer excludes retained painting commands');
assert.equal(fitProjection.parts[partId].textureUrl, undefined);
assert.deepEqual(fitProjection.parts, recommendationProjectSnapshot(baseline).parts, 'art-only edits preserve fitting inputs');
const mechanism = baseline.mechanisms[0];
const pathId = baseline.pathOrder?.[0] ?? Object.keys(baseline.paths)[0];
assert.equal(createMechanismFitJobInput(recolored, mechanism, 'path', pathId).project.parts[partId].artwork, undefined);
const optimizerBefore = createMechanismOptimizerJobInput(baseline, mechanism, pathId, 1);
const optimizerAfter = createMechanismOptimizerJobInput(recolored, mechanism, pathId, 1);
assert.equal(optimizerBefore.inputFingerprint, optimizerAfter.inputFingerprint);
assert.equal(optimizerAfter.project.parts[partId].artwork, undefined);
const shrunk = applyProjectAction(project, { type: 'update_part', partId, updates: {
  bounds: { x: -10, y: -20, width: 20, height: 40 },
  contourPoints: [{ x: -10, y: -20 }, { x: 10, y: -20 }, { x: 10, y: 20 }, { x: -10, y: 20 }],
} });
assert.equal(shrunk.parts[partId].artwork, painted);
assert.equal(designFamilyFitAuthorityChanged(project, shrunk), true, 'explicit cut geometry changes still invalidate fitting');
assert.deepEqual(artworkForOwner(shrunk.parts[partId]).sourceImage?.frame, part.bounds);
assert.deepEqual(artworkForOwner(shrunk.parts[partId]).operations, painted.operations, 'changing outline bounds never scales or destroys ink');

const object = { ...createDefaultSceneObject('star', 'painted-prop'), fabrication: 'cuttable' as const };
object.contourPoints = rectangleOutline(artworkOwnerFrame(object));
object.contourSource = 'user';
assert.deepEqual(artworkOwnerFrame(object), { x: -object.bounds.width / 2, y: -object.bounds.height / 2, ...object.bounds });
object.artwork = appendArtworkOperation(artworkForOwner(object), {
  id: 'prop-eye', kind: 'ellipse', from: { x: -10, y: 8 }, to: { x: -4, y: 14 }, color: '#111111',
});
const both = applyProjectAction(project, { type: 'upsert_scene_object', object });
assert.equal((await recommendationProjectSnapshotChunked(both)).sceneObjects[object.id].artwork, undefined);
const originalTexture = both.parts[partId].textureUrl;
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('No browser caches'); } });
try {
  const blob = createPortableProjectBlob(both);
  const reopened = (await runProjectImportJob({ kind: 'project', file: new File([blob], 'painted.motionsmith') })).project;
  assertProjectRoundTrip(both, reopened);
  assert.deepEqual(reopened.parts[partId].artwork, painted);
  assert.equal(reopened.parts[partId].textureUrl, originalTexture, 'original embedded bytes survive without browser assets');
  assert.equal(reopened.sceneObjects[object.id].fabrication, 'cuttable');
  assert.deepEqual(reopened.sceneObjects[object.id].artwork, object.artwork);
  const continued = applyProjectAction(reopened, { type: 'update_part', partId, updates: {
    artwork: appendArtworkOperation(reopened.parts[partId].artwork!, erase),
  } });
  const nextClass = (await runProjectImportJob({ kind: 'project', file: new File([createPortableProjectBlob(continued)], 'continued.motionsmith') })).project;
  assertProjectRoundTrip(continued, nextClass);
  assert.deepEqual(nextClass.parts[partId].artwork?.operations.map(operation => operation.id), ['ink-shirt', 'ink-erase']);
  assert.deepEqual(nextClass.sceneObjects[object.id].artwork, object.artwork);
} finally {
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}

const valid = JSON.parse(JSON.stringify(painted)) as ArtworkDocument;
assert.deepEqual(normalizeArtworkDocument(valid, { textureUrl: originalTexture }), painted);
for (const invalid of [
  null,
  { ...valid, version: 2 },
  { ...valid, futureLayerStack: [] },
  { ...valid, revision: 'art1-stale' },
  { ...valid, frame: { ...valid.frame, width: 0 } },
  { ...valid, frame: { ...valid.frame, x: Infinity } },
  { ...valid, sourceImage: { asset: 'missing-file.png', frame } },
  { ...valid, operations: [{ ...first.operations[0], points: [{ x: NaN, y: 0 }] }] },
  { ...valid, operations: [{ ...first.operations[0], width: -1 }] },
  { ...valid, operations: [{ ...first.operations[0], color: 'url(https://example.invalid)' }] },
  { ...valid, operations: [{ ...first.operations[0], kind: 'flood-fill' }] },
  { ...valid, operations: [first.operations[0], first.operations[0]] },
  { ...valid, operations: [{ ...first.operations[0], points: Array(ARTWORK_LIMITS.pointsPerOperation + 1).fill({ x: 0, y: 0 }) }] },
]) {
  assert.throws(() => normalizeArtworkDocument(invalid, { textureUrl: originalTexture }));
  assert.throws(() => loadProjectSnapshot({ ...both, parts: { ...both.parts, [partId]: { ...both.parts[partId], artwork: invalid } } }));
  assert.equal(JSON.stringify(baseline), baselineJson);
}
for (const textureUrl of [undefined, 'blob:temporary', 'https://example.invalid/image.png']) {
  assert.throws(() => normalizeArtworkDocument(valid, { textureUrl }), /embedded artwork asset/);
}
const unsafeSvg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image href="https://example.invalid/tracker.png"/></svg>');
assert.throws(() => readProjectFileCandidate({ ...both, parts: { ...both.parts, [partId]: { ...both.parts[partId], textureUrl: unsafeSvg } } }), /SVG|local/i);
const manyOperations = Array.from({ length: ARTWORK_LIMITS.operations }, (_, index) => ({
  id: `mark-${index}`, kind: 'brush' as const, points: [{ x: 0, y: 0 }], width: 1, color: '#000000',
}));
const manyContent = { ...createArtworkDocument(frame), operations: manyOperations };
const many = { ...manyContent, revision: artworkRevision(manyContent) };
assert.throws(() => validateProjectImportShape({ parts: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [index, { artwork: many }])) }), /Total artwork operations/);
const fullPaintProject = { ...baseline, parts: Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`owner-${index}`, { ...part, artwork: many }])) };
assert.doesNotThrow(() => assertArtworkEditWithinProjectLimits(fullPaintProject, 'part', 'owner-0', many), 'replacing a document counts it once');
assert.throws(() => assertArtworkEditWithinProjectLimits(fullPaintProject, 'object', 'new-prop', painted), /paint limit/, 'reject a new command before existing committed work becomes unsaveable');
assert.equal(loadProjectSnapshot(baseline).parts[partId].artwork, undefined, 'legacy projects stay unmodified until painting');
console.log('artwork domain and portable persistence ok');
