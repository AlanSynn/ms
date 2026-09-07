import assert from 'node:assert/strict';
import { createSampleProject, createDefaultSceneObject, loadProjectSnapshot } from '../utils/project';
import { artworkForOwner, artworkOwnerFrame } from '../utils/artwork';
import { fabricablePartOutlinePoints } from '../utils/partGeometry';
import { characterFabricationHoles } from '../utils/characterFabricationHoles';
import { ellipseOutline, PHYSICAL_OUTLINE_POINT_LIMIT, rectangleOutline, scalePhysicalOutline, validatePhysicalOutline } from '../utils/shapeEditing';
import { createPortableProjectBlob } from '../runtime/persistence/projectDownloadJob';
import { readProjectFileCandidate } from '../runtime/import/projectFileCandidate';
import { assertProjectRoundTrip } from '../utils/projectSerialization';
import { unpaintedStarter } from '../utils/artworkTargets';

const square = rectangleOutline({ x: -20, y: -20, width: 40, height: 40 });
const attachment = { jointId: 'pivot', center: { x: 0, y: 0 }, radius: 4 };
const result = validatePhysicalOutline(square, { attachments: [attachment] });
assert(result.ok);
assert.deepEqual(result.points, square);
assert.notEqual(result.points, square, 'candidate validation never mutates caller points');
assert.deepEqual(result.bounds, { x: -20, y: -20, width: 40, height: 40 });
assert.deepEqual(validatePhysicalOutline([...square, square[0]]), validatePhysicalOutline(square), 'an explicit closing endpoint is the same outer contour');
assert(validatePhysicalOutline([...square].reverse(), { attachments: [attachment] }).ok, 'both winding directions preserve the same cut');
assert(validatePhysicalOutline(rectangleOutline({ x: -4, y: -4, width: 8, height: 8 }), { attachments: [attachment] }).ok,
  'the existing hole radius is authoritative; no invented margin enlarges it');
assert(!validatePhysicalOutline(rectangleOutline({ x: -3.99, y: -4, width: 8, height: 8 }), { attachments: [attachment] }).ok);
assert(!validatePhysicalOutline(rectangleOutline({ x: 4, y: -20, width: 40, height: 40 }), { attachments: [attachment] }).ok);
const concave = [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: 6, y: 20 }, { x: 6, y: 2 }, { x: -6, y: 2 }, { x: -6, y: 20 }, { x: -20, y: 20 }];
assert(validatePhysicalOutline(concave).ok, 'concave blocky shapes remain exact');
assert(!validatePhysicalOutline(concave, { attachments: [attachment] }).ok, 'a concave bite cannot cross a real hole');
for (const points of [
  [], [{ x: 0, y: 0 }], [square[0], square[0], square[0]],
  [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }],
  [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 10 }],
  [...square, { x: 20, y: -20 }],
  [{ x: NaN, y: 0 }, ...square], [{ x: Infinity, y: 0 }, ...square],
  [{ x: 100001, y: 0 }, ...square], [{ x: '1', y: 0 }, ...square],
  Array(PHYSICAL_OUTLINE_POINT_LIMIT + 2).fill({ x: 0, y: 0 }),
]) assert(!validatePhysicalOutline(points).ok);
assert(validatePhysicalOutline(rectangleOutline({ x: 0, y: 0, width: .1, height: .1 })).ok, 'nonzero area is checked without imposing an unrelated kit tolerance');
assert(validatePhysicalOutline(ellipseOutline({ x: -20, y: -30, width: 40, height: 60 })).ok);
assert.deepEqual(scalePhysicalOutline(square, 2), rectangleOutline({ x: -40, y: -40, width: 80, height: 80 }));

const project = createSampleProject({ includeMechanism: false });
const part = project.parts.head;
const outsideOldBounds = rectangleOutline({ x: -200, y: -160, width: 400, height: 320 });
const explicit = { ...part, contourSource: 'user' as const, contourPoints: outsideOldBounds, artwork: artworkForOwner(part) };
assert.deepEqual(fabricablePartOutlinePoints(explicit), outsideOldBounds, 'explicit silhouettes are never clamped into an old image crop');
assert.deepEqual(fabricablePartOutlinePoints({ ...explicit, contourPoints: [{ x: 0, y: 0 }] }), [], 'invalid explicit geometry cannot silently become a capsule');
assert(fabricablePartOutlinePoints({ ...part, contourSource: 'imported', contourPoints: [{ x: 0, y: 0 }] }).length >= 3, 'legacy imported fallback remains supported');
const shaped = { ...project, parts: { ...project.parts, head: explicit } };
const reopened = readProjectFileCandidate(JSON.parse(await createPortableProjectBlob(shaped).text()));
assertProjectRoundTrip(shaped, reopened);
assert.deepEqual(reopened.parts.head.artwork?.frame, part.bounds);
assert.deepEqual(reopened.parts.head.bounds, part.bounds);
assert.deepEqual(reopened.parts.head.transform, part.transform);
const hole = characterFabricationHoles(project).get('head')![0];
const missingHole = { ...explicit, contourPoints: rectangleOutline({ x: hole.center.x + hole.radius + 1, y: hole.center.y - 10, width: 20, height: 20 }) };
assert.throws(() => readProjectFileCandidate({ ...project, parts: { ...project.parts, head: missingHole } }), /attachment ring/);
for (const invalid of [[{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }, { x: 3, y: 0 }]]) {
  assert.throws(() => loadProjectSnapshot({ ...project, parts: { ...project.parts, head: { ...explicit, contourPoints: invalid } } }), /Invalid cut outline/);
}

const object = createDefaultSceneObject('block', 'fine-cut-prop');
const many = Array.from({ length: PHYSICAL_OUTLINE_POINT_LIMIT }, (_, index) => {
  const angle = index * Math.PI * 2 / PHYSICAL_OUTLINE_POINT_LIMIT;
  return { x: Math.cos(angle) * 30, y: Math.sin(angle) * 30 };
});
assert(validatePhysicalOutline(many).ok);
const customObject = { ...object, fabrication: 'cuttable' as const, contourSource: 'user' as const,
  contourPoints: many, artwork: artworkForOwner(object) };
const custom = { ...project, sceneObjects: { [object.id]: customObject }, sceneObjectOrder: [object.id] };
const reopenedObject = readProjectFileCandidate(JSON.parse(await createPortableProjectBlob(custom).text()));
assertProjectRoundTrip(custom, reopenedObject);
assert.equal(reopenedObject.sceneObjects[object.id].contourPoints?.length, 512, 'new authored shapes survive the full import limit without legacy 256-point truncation');
assert.deepEqual(reopenedObject.sceneObjects[object.id].artwork?.frame, artworkOwnerFrame(object));
const beforeStarter = JSON.stringify(project);
const scaffold = unpaintedStarter(project);
const scaffoldHoles = characterFabricationHoles(scaffold);
for (const part of Object.values(scaffold.parts)) {
  assert.equal(part.textureUrl, undefined);
  assert.equal(part.artwork, undefined);
  const outline = fabricablePartOutlinePoints(part);
  assert(validatePhysicalOutline(outline, { attachments: scaffoldHoles.get(part.id) }).ok, `${part.id} scaffold contains its real kit hole rings`);
}
assert.equal(scaffold.parts.head.contourPoints, project.parts.head.contourPoints, 'already valid scaffold shapes stay unchanged');
assert.equal(scaffold.skeleton, project.skeleton);
assert.equal(scaffold.paths, project.paths);
assert.equal(scaffold.mechanisms, project.mechanisms);
assert.equal(JSON.stringify(project), beforeStarter, 'creation never edits a lesson or current project');
assertProjectRoundTrip(scaffold, readProjectFileCandidate(JSON.parse(await createPortableProjectBlob(scaffold).text())));
console.log('physical shape validity, attachment clearance, retained frames, and strict portable import ok');
