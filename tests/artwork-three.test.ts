import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { BodyPartLayer, Bounds, Point } from '../types';
import { appendArtworkOperation, artworkLocalToPixel, createArtworkDocument, ownerLocalToScene } from '../utils/artwork';
import { createSampleProject } from '../utils/project';
import { characterFabricationHoles } from '../utils/characterFabricationHoles';
import { buildCharacterBuildSectionV1 } from '../utils/buildPlanCharacter';
import { SCENE_PX_PER_MM } from '../utils/coordinates';
import { resolveRenderPerformancePolicy } from '../utils/renderPerformancePolicy';
import { disposeFoundryThreeObject } from '../components/stages/foundry/foundryThreePrimitives';
import { disposePuppetObjectGraph } from '../runtime/render/puppetSceneDisposal';
import {
  createPartArtMaterial, disposePartArtMaterial, isInitialSceneMaterialResourcePending,
  updatePartArtMaterial, type PartArtMaterialOptions,
} from '../runtime/render/partArtMaterial';
import {
  artworkSurfaceFrame, mapArtworkSurfaceUvs, retainArtworkGroup,
} from '../runtime/render/artworkSurface';
import { diffPuppetPartTopologies, preparePuppetPartTopology } from '../runtime/render/puppetPartTopology';

const outline: Point[] = [{ x: -40, y: -30 }, { x: 55, y: -30 }, { x: 48, y: 45 }, { x: -30, y: 45 }];
const bounds: Bounds = { x: -40, y: -30, width: 95, height: 75 };
const part: BodyPartLayer = {
  id: 'painted-head', name: 'Painted head', anchorJointId: 'neck',
  transform: { x: 120, y: 100, scale: 1, rotation: 0 },
  zIndex: 1, opacity: 1, visible: true, locked: false, selectable: true,
  bounds, contourPoints: outline, contourSource: 'user', fillColor: '#f6d79b',
  artwork: appendArtworkOperation(createArtworkDocument(bounds), {
    id: 'ink-eye', kind: 'brush', points: [{ x: 10, y: 18 }], width: 6, color: '#123456',
  }),
};
const repainted = { ...part, artwork: appendArtworkOperation(part.artwork!, {
  id: 'ink-shirt', kind: 'line', from: { x: 0, y: -10 }, to: { x: 20, y: -10 }, width: 8, color: '#ef4444',
}) };
const topologyPolicy = resolveRenderPerformancePolicy('balanced').partTopology;
const original = preparePuppetPartTopology(part, null, topologyPolicy);
const changed = preparePuppetPartTopology(repainted, null, topologyPolicy);
assert.equal(original.identity.geometry, changed.identity.geometry, 'paint leaves physical geometry identity unchanged');
assert.deepEqual(original.localHoles, changed.localHoles, 'ink marks never introduce holes');
const other = preparePuppetPartTopology({ ...part, id: 'second-owner' }, null, topologyPolicy);
const diff = diffPuppetPartTopologies(new Map([
  [part.id, original.identity], [other.part.id, other.identity],
]), [changed, other]);
assert.deepEqual(diff.removeIds, []);
assert.deepEqual(diff.build, []);
assert.deepEqual(diff.updateArt.map(entry => entry.part.id), [part.id], 'only the changed owner updates its surface');

const characterProject = createSampleProject({ includeMechanism: false });
const actualHoles = characterFabricationHoles(characterProject);
assert.deepEqual(actualHoles.get('head')?.map(hole => hole.jointId), ['neck'],
  'head_top remains a guide landmark; only the neck is a drilled hole');
assert.equal(characterFabricationHoles(characterProject), actualHoles, 'playback reuses the captured project pin plan');
const canonicalCharacter = buildCharacterBuildSectionV1(characterProject).character;
const canonicalPins = [...canonicalCharacter.fixedPins, ...canonicalCharacter.freePivots];
for (const [partId, holes] of actualHoles) {
  const owner = characterProject.parts[partId];
  const topology = preparePuppetPartTopology(owner, characterProject.skeleton, topologyPolicy, holes);
  assert.deepEqual(topology.localHoles, holes.map(hole => hole.center));
  for (const hole of holes) {
    const pin = canonicalPins.find(pin => pin.jointId === hole.jointId && pin.partIds.includes(partId));
    assert(pin, 'every renderer hole is a canonical build pin');
    const scene = ownerLocalToScene(hole.center, owner.transform);
    assert(Math.hypot(scene.x - pin.scene.x, scene.y - pin.scene.y) < 1e-8);
    assert.equal(hole.radius * owner.transform.scale * 2 / SCENE_PX_PER_MM,
      characterProject.settings.physicalKit.holeDiameterMm);
  }
}
const head = characterProject.parts.head;
const scaledProject = { ...characterProject,
  parts: { ...characterProject.parts, head: { ...head, transform: { ...head.transform, scale: 1.75, rotation: 23 } } },
  settings: { ...characterProject.settings, physicalKit: { ...characterProject.settings.physicalKit, holeDiameterMm: 5 } },
};
const scaledHole = characterFabricationHoles(scaledProject).get('head')![0];
assert.equal(scaledHole.radius * 1.75 * 2 / SCENE_PX_PER_MM, 5,
  'resizing a painted piece does not resize its physical drill diameter');
const scaledWorld = ownerLocalToScene(scaledHole.center, scaledProject.parts.head.transform);
assert(Math.hypot(scaledWorld.x - characterProject.skeleton!.joints.neck.position.x,
  scaledWorld.y - characterProject.skeleton!.joints.neck.position.y) < 1e-8,
  'rotation and scale preserve canonical assembly pin registration');

// The same landmark maps to a different raster crop but the same local point.
const landmark = { x: 10, y: 18 };
const shrunkOutline = outline.map(point => ({ x: point.x * 0.75, y: point.y * 0.75 }));
const restoredOutline = outline.map(point => ({ x: point.x * 1.2, y: point.y * 1.2 }));
for (const contour of [outline, shrunkOutline, restoredOutline]) {
  const target = artworkSurfaceFrame(part, contour);
  const positions = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([
    landmark.x / 35, landmark.y / 35, 0,
  ], 3));
  mapArtworkSurfaceUvs(positions, target, (x, y) => ({ x: x * 35, y: y * 35 }));
  const uv = positions.getAttribute('uv');
  const pixel = artworkLocalToPixel(landmark, target, { width: 300, height: 240 });
  assert(Math.abs(uv.getX(0) - pixel.x / 300) < 1e-6);
  assert(Math.abs(uv.getY(0) - (1 - pixel.y / 240)) < 1e-6, 'one canvas-to-Three Y flip aligns marks');
  assert(Math.abs(target.x + uv.getX(0) * target.width - landmark.x) < 1e-5);
  assert(Math.abs(target.y + uv.getY(0) * target.height - landmark.y) < 1e-5);
  positions.dispose();
}
assert.deepEqual(part.artwork?.frame, bounds, 'shrinking and expanding never redefines retained art coordinates');
assert.deepEqual(artworkSurfaceFrame({ ...part, artwork: undefined }, shrunkOutline), bounds,
  'legacy raster geometry keeps its original mapping');

// Decal geometry uses the same physical contour and hole boundary as the plate.
const shape = new THREE.Shape(outline.map(point => new THREE.Vector2(point.x, point.y)));
const hole = new THREE.Path();
hole.absellipse(0, 0, 5, 5, 0, Math.PI * 2, true);
shape.holes.push(hole);
const decal = mapArtworkSurfaceUvs(new THREE.ShapeGeometry(shape, 24), bounds, (x, y) => ({ x, y }));
const holeRay = new THREE.Raycaster(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
assert.equal(holeRay.intersectObject(new THREE.Mesh(decal, new THREE.MeshBasicMaterial())).length, 0,
  'the painted decal contains an actual hole, not a painted hole color');
decal.dispose();

type Canvas = HTMLCanvasElement;
type Request = {
  resolve: (canvas: Canvas) => void; reject: (reason: unknown) => void;
  signal?: AbortSignal; revision?: string;
};
const requests: Request[] = [];
const installs: (() => void)[] = [];
const canceled: number[] = [];
const options: PartArtMaterialOptions = {
  targetFrame: bounds, clip: { kind: 'contour', points: outline },
  rasterize: input => new Promise((resolve, reject) => {
    requests.push({ resolve, reject, signal: input.signal, revision: input.owner.artwork?.revision });
  }),
  scheduleInstall: install => {
    const index = installs.push(install) - 1;
    return () => { canceled.push(index); };
  },
};
const canvas = (label: string): Canvas => ({ width: 190, height: 150, label }) as unknown as Canvas;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
let settled = 0;
const material = createPartArtMaterial(part, () => { settled += 1; }, options);
assert.equal(material.side, THREE.FrontSide, 'authored artwork has one defined front side');
assert.equal(isInitialSceneMaterialResourcePending(material), true);
assert.equal(updatePartArtMaterial(material, { ...part }, () => {}, options), false);
assert.equal(requests.length, 1, 'unchanged document reuses its pending raster generation');
assert.equal(updatePartArtMaterial(material, repainted, () => { settled += 1; }, options), true);
assert.equal(requests[0].signal?.aborted, true, 'new artwork revision aborts obsolete decode');
const obsolete = canvas('obsolete');
requests[0].resolve(obsolete);
await flush();
assert.equal(obsolete.width, 0, 'late obsolete surfaces release their pixel storage');
assert.equal(installs.length, 0, 'obsolete response cannot queue a texture install');
const latest = canvas('latest');
requests[1].resolve(latest);
await flush();
assert.equal(material.map, null);
installs[0]();
assert.equal((material as THREE.MeshBasicMaterial).map?.image, latest);
assert.equal(material.userData.partArtInstalledRevision, repainted.artwork.revision);
assert.equal(settled, 1, 'only a current installed revision settles readiness');
assert.equal(isInitialSceneMaterialResourcePending(material), false);
const retainedTexture = material.map;
assert.equal(updatePartArtMaterial(material, repainted, () => {}, options), false);
assert.equal(material.map, retainedTexture, 'unaffected textures and materials retain identity');

// A canceled callback may still be delivered by the browser. It cannot clear
// the newer install's cleanup handle or write over its texture.
updatePartArtMaterial(material, part, () => {}, options);
assert.equal(latest.width, 0, 'replacing a texture releases its previous raster pixels');
const queuedOld = canvas('queued-old');
requests[2].resolve(queuedOld);
await flush();
updatePartArtMaterial(material, repainted, () => {}, options);
assert.equal(queuedOld.width, 0, 'superseding an uninstalled raster releases it immediately');
const queuedNew = canvas('queued-new');
requests[3].resolve(queuedNew);
await flush();
installs[1]();
disposePartArtMaterial(material);
assert.equal(queuedNew.width, 0, 'old callback cannot destroy the latest cancel/disposal handle');
assert(canceled.includes(1) && canceled.includes(2));
installs[2]();
assert.equal(material.map, null, 'disposed surfaces reject delivered texture installs');
assert.equal(updatePartArtMaterial(material, part, () => {}, options), false, 'disposed material cannot restart raster work');

const failing = createPartArtMaterial(part, () => { settled += 1; }, options);
const unchangedDocument = JSON.stringify(part.artwork);
requests[4].reject(new Error('decode failed'));
await flush();
assert.equal(isInitialSceneMaterialResourcePending(failing), false, 'failed texture cannot block startup indefinitely');
assert.equal(failing.userData.partArtError, 'Artwork preview unavailable');
assert.equal(failing.map, null);
assert.equal(JSON.stringify(part.artwork), unchangedDocument, 'texture failure preserves the editable drawing');
disposePartArtMaterial(failing);

for (const dispose of [disposeFoundryThreeObject, disposePuppetObjectGraph]) {
  const owned = createPartArtMaterial(part, () => {}, options);
  const request = requests.at(-1)!;
  const group = new THREE.Group();
  group.name = 'paint-owner';
  group.userData.geometryKey = 'same-physical-shape';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), owned);
  group.add(mesh);
  const scene = new THREE.Group();
  scene.add(group);
  assert.equal(retainArtworkGroup(scene, group.name, 'same-physical-shape', dispose), group);
  assert.equal(group.children[0], mesh, 'an unrelated owner edit retains draw-object identity');
  assert.equal(retainArtworkGroup(scene, group.name, 'new-shape', dispose), undefined);
  assert.equal(request.signal?.aborted, true, 'both shared renderer paths cancel removed owner work');
  const removedOwnerResult = canvas('removed-owner');
  request.resolve(removedOwnerResult);
  await flush();
  assert.equal(removedOwnerResult.width, 0, 'a deleted owner releases a late compositor result');
  assert.equal(owned.map, null);
}

// Legacy viewBox-only SVGs are drawable on canvas but some browsers reject
// their direct HTMLImageElement WebGL upload. The fallback owns its raster.
const originalTextureLoad = THREE.TextureLoader.prototype.load;
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const fallbackLoads: Array<{ texture: THREE.Texture<HTMLImageElement>; finish: () => void }> = [];
const fallbackCanvases: HTMLCanvasElement[] = [];
let drawFails = false;
let rasterDraws = 0;
try {
  THREE.TextureLoader.prototype.load = function (_url, onLoad) {
    const texture = new THREE.Texture({ width: 120, height: 150, naturalWidth: 120, naturalHeight: 150 } as HTMLImageElement);
    fallbackLoads.push({ texture, finish: () => onLoad?.(texture) });
    return texture;
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => {
      const result = { width: 0, height: 0, getContext: () => ({ drawImage: () => {
        rasterDraws += 1;
        if (drawFails) throw new Error('SVG decode unavailable');
      } }) } as unknown as HTMLCanvasElement;
      fallbackCanvases.push(result);
      return result;
    },
  } });
  const legacyOwner = { ...part, artwork: undefined, textureUrl: 'data:image/svg+xml;utf8,legacy' };
  const legacy = createPartArtMaterial(legacyOwner, () => {}, { bitmapSupported: false });
  fallbackLoads[0].finish();
  assert.equal(legacy.map?.image, fallbackCanvases[0], 'SVG fallback uploads an owned raster');
  assert.equal(fallbackCanvases[0].width, 120);
  assert.equal(fallbackCanvases[0].height, 150, 'legacy raster preserves decoded aspect and UV orientation');
  assert.equal(isInitialSceneMaterialResourcePending(legacy), false);
  disposePartArtMaterial(legacy);
  assert.equal(fallbackCanvases[0].width, 0, 'SVG fallback releases owned pixel storage');

  const removedLegacy = createPartArtMaterial(legacyOwner, () => {}, { bitmapSupported: false });
  disposePartArtMaterial(removedLegacy);
  fallbackLoads[1].finish();
  assert.equal(rasterDraws, 1, 'removed legacy owner does not allocate a late SVG raster');
  assert.equal(removedLegacy.map, null);

  drawFails = true;
  const failedLegacy = createPartArtMaterial(legacyOwner, () => {}, { bitmapSupported: false });
  fallbackLoads[2].finish();
  assert.equal(failedLegacy.map, null);
  assert.equal(failedLegacy.userData.partArtError, 'Artwork preview unavailable');
  assert.equal(fallbackCanvases[1].width, 0, 'a failed SVG raster also releases pixel storage');
  assert.equal(isInitialSceneMaterialResourcePending(failedLegacy), false);
  disposePartArtMaterial(failedLegacy);
} finally {
  THREE.TextureLoader.prototype.load = originalTextureLoad;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
}

console.log('artwork Three registration, freshness, retention and disposal checks passed');
