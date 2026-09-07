import { strict as assert } from 'node:assert';
import * as THREE from 'three';
import { createDefaultMechanism, createEmptyProject, createSampleProject } from '../utils/project';
import { createDrawableObject } from '../utils/artworkTargets';
import { appendArtworkOperation, createArtworkDocument } from '../utils/artwork';
import { createAutomataSceneRuntime, sampleAutomataSceneRuntime } from '../utils/automataSceneModel';
import { createWorkingPathPreview, visibleWorkingProjectPaths, workingProjectMechanism } from '../utils/workingProjectPreview';
import { fitPuppetViewport, fitWorkingPreviewCamera, visibleObjectBounds } from '../utils/workingPreviewCamera';
import { foundryCameraPosition, foundryCameraTarget, type FoundryCamera } from '../utils/foundryCamera';
import { createMotionPathForTarget, motionPreviewForPaths, playableMotionPaths, motionTimelineMsForPhase } from '../utils/motion';
import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';

const project = createFabricationReadyFourBarProject();
const fittedPath = Object.values(project.paths)[0];
project.paths.unfitted = { ...fittedPath, id: 'unfitted', partId: 'left_arm_lower', targetAnchorJointId: 'left_hand', enabled: false,
  points: fittedPath.points.map(point => ({ x: -point.x, y: point.y })) };
project.paths.hidden = { ...fittedPath, id: 'hidden', visible: false };
project.pathOrder = [fittedPath.id, 'unfitted', 'hidden'];
const serialized = JSON.stringify(project);
assert.deepEqual(visibleWorkingProjectPaths(project).map(path => path.id), [fittedPath.id, 'unfitted'],
  'visible authored traces include an unfitted path disabled for playback; hidden content is excluded');
assert.strictEqual(workingProjectMechanism(project), project.mechanisms[0]);
assert.equal(workingProjectMechanism({ ...project, mechanisms: project.mechanisms.map(mechanism => ({ ...mechanism, visible: false })) }), undefined);

const pathOnly = { ...createSampleProject(), mechanisms: [], selectedMechanismId: undefined };
const beforePath = JSON.stringify(pathOnly);
const preview = createWorkingPathPreview(pathOnly);
assert(preview.paths.length > 0);
for (const phase of [0, 0.4, 1.8, 4.5]) {
  assert.deepEqual(preview.sample(phase), motionPreviewForPaths(pathOnly, playableMotionPaths(pathOnly),
    motionTimelineMsForPhase(phase, preview.durationMs)), 'overview uses the existing path pose at the exact paused phase');
}
assert.notDeepEqual(preview.sample(0)?.parts, preview.sample(1.8)?.parts, 'path-only sampling changes actual part transforms');
assert.deepEqual(preview.sample(1.8, preview.durationMs * 2.3), motionPreviewForPaths(pathOnly,
  playableMotionPaths(pathOnly), preview.durationMs * 2.3), 'paused elapsed time is retained after complete shared cycles');
assert.equal(JSON.stringify(pathOnly), beforePath, 'fallback sampling never changes authored paths or geometry');
const characterOnly = { ...pathOnly, paths: {}, pathOrder: [], selectedPathId: undefined };
assert.equal(createWorkingPathPreview(characterOnly).sample(1.8), undefined, 'character-only preview uses its canonical character without synthetic motion');
assert.equal(createWorkingPathPreview(createEmptyProject()).sample(2), undefined);
assert.equal(JSON.stringify(project), serialized);

// A drawn object is a complete scene owner without a body rig or mechanism.
const objectOnly = createEmptyProject();
const prop = createDrawableObject('painted-prop');
prop.artwork = appendArtworkOperation(createArtworkDocument({ x: -40, y: -40, width: 80, height: 80 }), {
  id: 'prop-line', kind: 'line', from: { x: -15, y: 4 }, to: { x: 15, y: 4 }, width: 5, color: '#ef476f',
});
objectOnly.sceneObjects[prop.id] = prop;
objectOnly.sceneObjectOrder = [prop.id];
objectOnly.selectedSceneObjectId = prop.id;
assert.equal(createWorkingPathPreview(objectOnly).sample(1), undefined, 'a still object receives no synthetic motion');
const propPath = createMotionPathForTarget(objectOnly, 'scene-object', prop.id)!;
propPath.points = [{ x: -70, y: 0 }, { x: 0, y: 65 }, { x: 70, y: 0 }, { x: 0, y: -65 }];
objectOnly.paths[propPath.id] = propPath;
objectOnly.pathOrder = [propPath.id];
const objectBefore = JSON.stringify(objectOnly);
const propPreview = createWorkingPathPreview(objectOnly);
assert.equal(workingProjectMechanism(objectOnly), undefined);
assert.deepEqual(playableMotionPaths(objectOnly).map(path => path.id), [propPath.id]);
const propPositions = [0, Math.PI / 2, Math.PI].map(phase => {
  const pose = propPreview.sample(phase)!;
  assert.deepEqual(pose.parts, {}, 'object motion creates no placeholder body parts');
  assert.equal(pose.skeleton, null, 'object motion needs no skeleton');
  const animated = pose.sceneObjects![prop.id];
  assert.equal(animated.artwork, prop.artwork, 'motion retains the canonical artwork document');
  assert.equal(animated.contourPoints, prop.contourPoints, 'motion retains the cut geometry');
  assert.equal(animated.transform.scale, prop.transform.scale);
  assert.equal(animated.transform.rotation, prop.transform.rotation);
  return { x: animated.transform.x, y: animated.transform.y };
});
assert.equal(new Set(propPositions.map(point => JSON.stringify(point))).size, 3, 'the object moves through its own authored path');
assert.equal(JSON.stringify(objectOnly), objectBefore, 'preview sampling leaves the object-only project unchanged');

// Design/Foundry use the same object when the user actually adds a mechanism.
const objectDriver = { ...createDefaultMechanism('4bar', 'prop-driver'), targetSceneObjectId: prop.id, targetPathId: propPath.id };
const drivenObjectOnly = { ...objectOnly, mechanisms: [objectDriver], selectedMechanismId: objectDriver.id };
const propRuntime = createAutomataSceneRuntime(drivenObjectOnly, objectDriver);
const drivenPositions = [0, Math.PI / 2].map(phase => {
  const frame = sampleAutomataSceneRuntime(propRuntime, phase);
  assert.equal(frame.mechanisms.length, 1);
  assert.deepEqual(frame.animatedParts, {});
  assert.equal(frame.skeleton, null);
  const animated = frame.animatedSceneObjects[prop.id];
  assert(animated, 'an explicitly bound mechanism drives an object without a rig');
  assert.equal(animated.artwork, prop.artwork);
  assert.equal(animated.contourPoints, prop.contourPoints);
  return animated.transform;
});
assert.notDeepEqual(drivenPositions[0], drivenPositions[1]);
assert.equal(JSON.stringify(objectOnly), objectBefore);

const scene = new THREE.Group();
const content = new THREE.Group();
scene.add(content);
const part = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 0.2));
part.position.set(8, 4, 1.1);
part.rotation.z = Math.PI / 6;
content.add(part);
const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(3, 2, 1), new THREE.Vector3(13, 8, 1),
]));
content.add(path);
const hidden = new THREE.Mesh(new THREE.BoxGeometry(3000, 3000, 3000));
hidden.visible = false;
content.add(hidden);
const board = new THREE.Mesh(new THREE.PlaneGeometry(60, 40));
scene.add(board);
const transformBefore = JSON.stringify([part.position, part.rotation, part.scale]);
const contentBounds = visibleObjectBounds(content);
const fullBounds = visibleObjectBounds(scene);
assert(contentBounds.max.x < 20 && contentBounds.min.x > 0, 'hidden retained meshes do not enter actual visible bounds');
assert(fullBounds.getSize(new THREE.Vector3()).x > contentBounds.getSize(new THREE.Vector3()).x * 4);
const initial: FoundryCamera = { yaw: -24, pitch: 18, zoom: 0.82, pan: { x: 0, y: 0 }, preset: 'iso' };
const initialJson = JSON.stringify(initial);
const fitted = fitWorkingPreviewCamera(initial, contentBounds, 1.1);
const full = fitWorkingPreviewCamera(initial, fullBounds, 1.1);
assert(fitted.zoom > full.zoom, 'content fit excludes the oversized board; full-scene fit includes it');
assert.deepEqual(fitted.pan, { x: (contentBounds.min.x + contentBounds.max.x) / 2, y: (contentBounds.min.y + contentBounds.max.y) / 2 });
for (const [bounds, fit] of [[contentBounds, fitted], [fullBounds, full]] as const) {
  const camera = new THREE.PerspectiveCamera(38, 1.1, .1, 1000);
  camera.position.copy(foundryCameraPosition(fit));
  camera.lookAt(foundryCameraTarget(fit));
  camera.updateMatrixWorld();
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const point = new THREE.Vector3(x, y, z).project(camera);
    assert(Math.abs(point.x) <= .73 && Math.abs(point.y) <= .73, 'all actual fitted content lies inside the padded camera');
  }
}
const puppetCamera = new THREE.PerspectiveCamera(35, 1.1, .1, 100);
puppetCamera.position.set(0, 0, 24);
puppetCamera.lookAt(0, 0, .1);
const viewport = { offset: { x: 0, y: 0 }, zoom: 1 };
const puppetFit = fitPuppetViewport(puppetCamera, contentBounds, viewport, 35);
assert(puppetFit.offset.x < 0 && puppetFit.offset.y < 0, 'Puppet fit recenters through view offsets');
assert.deepEqual(viewport, { offset: { x: 0, y: 0 }, zoom: 1 });
assert.equal(JSON.stringify(initial), initialJson);
assert.equal(JSON.stringify([part.position, part.rotation, part.scale]), transformBefore, 'camera framing does not alter actual part transforms');
const freeView = { left: -.94, right: .94, top: .7, bottom: -.45 };
const unobscured = fitWorkingPreviewCamera(initial, contentBounds, 1.1, freeView);
const unclippedCamera = new THREE.PerspectiveCamera(38, 1.1, .1, 1000);
unclippedCamera.position.copy(foundryCameraPosition(unobscured));
unclippedCamera.lookAt(foundryCameraTarget(unobscured));
unclippedCamera.updateMatrixWorld();
for (const x of [contentBounds.min.x, contentBounds.max.x]) for (const y of [contentBounds.min.y, contentBounds.max.y]) for (const z of [contentBounds.min.z, contentBounds.max.z]) {
  const projected = new THREE.Vector3(x, y, z).project(unclippedCamera);
  assert(projected.y < freeView.top && projected.y > freeView.bottom, 'camera framing respects the real HUD and dock exclusion area');
}
for (const position of [new THREE.Vector3(0, 0, 24), new THREE.Vector3(.62, -.86, .72).normalize().multiplyScalar(15)]) {
  const camera = new THREE.PerspectiveCamera(35, 1.1, .1, 1000);
  camera.position.copy(position);
  if (position.x) camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, .1);
  const fittedView = fitPuppetViewport(camera, contentBounds, viewport, 35, freeView);
  camera.position.multiplyScalar(1 / fittedView.zoom);
  camera.lookAt(0, 0, .1);
  camera.updateMatrixWorld();
  for (const x of [contentBounds.min.x, contentBounds.max.x]) for (const y of [contentBounds.min.y, contentBounds.max.y]) for (const z of [contentBounds.min.z, contentBounds.max.z]) {
    const projected = new THREE.Vector3(x + fittedView.offset.x / 35, y + fittedView.offset.y / 35, z).project(camera);
    assert(projected.y < freeView.top && projected.y > freeView.bottom, 'front and orbiting Puppet fits retain actual geometry above the player');
  }
}
for (const object of [part, path, hidden, board]) object.geometry.dispose();
console.log('working Project preview contracts ok');
