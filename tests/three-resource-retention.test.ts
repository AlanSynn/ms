import { strict as assert } from 'node:assert';

import * as THREE from 'three';

import { FoundryThreeObjectPool } from '../components/stages/foundry/foundryThreeObjectPool';
import {
  createFoundryThreePrimitiveFactory,
  disposeFoundryThreeObject,
} from '../components/stages/foundry/foundryThreePrimitives';
import {
  cachedThreeResource,
  collectThreeObjectResourceUsage,
  configureThreeShaderDiagnostics,
  disposeThreeObjectGraph,
  pruneUnusedThreeResourceCache,
  scheduleBoundedRendererIdleShrink,
  SHARED_RENDERER_IDLE_PIXEL_BUDGET,
  SHARED_RENDERER_IDLE_SHRINK_DELAY_MS,
} from '../utils/threeResourceKit';
import { scheduleIncrementalTopologyBuild } from '../runtime/render/incrementalTopologyBuild';
import {
  createInitialSceneReadinessGeneration,
  realizeInitialSceneResources,
  type InitialSceneResourceUploadRenderer,
} from '../runtime/render/initialSceneResourceUpload';
import {
  createKeyedInitialTopologySettlement,
  foundryInitialShaderSettlementSteps,
  foundryInitialTopologySettlementSteps,
  puppetInitialTopologyBatchPolicy,
  puppetInitialTopologySettlementSteps,
} from '../runtime/render/initialSceneSettlement';
import {
  recordViewerDragDistance,
  VIEWER_CLICK_MAX_DISTANCE_PX,
} from '../runtime/render/viewerDragDistance';
import {
  createPuppetCutHoleRingInstances,
  createPuppetJointHardwareInstances,
  puppetJointIdForInstance,
  updatePuppetJointHardwareInstances,
} from '../runtime/render/puppetJointHardware';
import {
  createPartArtMaterial,
  disposePartArtMaterial,
  isInitialSceneMaterialResourcePending,
} from '../runtime/render/partArtMaterial';
import { disposePuppetObjectGraph } from '../runtime/render/puppetSceneDisposal';
import { warmPartTopologyPipeline } from '../runtime/render/warmPartTopology';
import { resolveRenderPerformancePolicy } from '../utils/renderPerformancePolicy';
import {
  diffPuppetPartTopologies,
  preparePuppetPartTopology,
} from '../runtime/render/puppetPartTopology';
import type { BodyPartLayer, StandardSkeleton } from '../types';
import { defaultPhysicalKit } from '../utils/coordinates';
import { createDefaultMechanism } from '../utils/project';

const rendererDiagnostics = { debug: { checkShaderErrors: true } };
configureThreeShaderDiagnostics(rendererDiagnostics, false);
assert.equal(
  rendererDiagnostics.debug.checkShaderErrors,
  false,
  'production renderer setup avoids synchronous shader info-log diagnostics',
);
configureThreeShaderDiagnostics(rendererDiagnostics, true);
assert.equal(
  rendererDiagnostics.debug.checkShaderErrors,
  true,
  'development renderer setup retains shader diagnostics',
);

let pendingIdleShrink: (() => void) | undefined;
let pendingIdleShrinkDelay = -1;
let cancelledIdleShrinks = 0;
let idleShrinkCalls = 0;
const cancelIdleShrink = scheduleBoundedRendererIdleShrink({
  retainedPixels: SHARED_RENDERER_IDLE_PIXEL_BUDGET,
  shrink: () => { idleShrinkCalls += 1; },
  scheduler: {
    schedule: (callback, delayMs) => {
      pendingIdleShrink = callback;
      pendingIdleShrinkDelay = delayMs;
      return 'idle-shrink';
    },
    cancel: (handle) => {
      assert.equal(handle, 'idle-shrink');
      cancelledIdleShrinks += 1;
    },
  },
});
assert.equal(
  pendingIdleShrinkDelay,
  SHARED_RENDERER_IDLE_SHRINK_DELAY_MS,
  'an in-budget released renderer keeps its drawing buffer for one bounded reuse window',
);
cancelIdleShrink();
pendingIdleShrink?.();
assert.equal(cancelledIdleShrinks, 1, 'renderer reacquisition cancels the pending idle shrink');
assert.equal(idleShrinkCalls, 0, 'a cancelled shrink cannot resize the reused drawing buffer');

let completedIdleShrink: (() => void) | undefined;
scheduleBoundedRendererIdleShrink({
  retainedPixels: SHARED_RENDERER_IDLE_PIXEL_BUDGET,
  shrink: () => { idleShrinkCalls += 1; },
  scheduler: {
    schedule: (callback) => {
      completedIdleShrink = callback;
      return 1;
    },
    cancel: () => undefined,
  },
});
completedIdleShrink?.();
completedIdleShrink?.();
assert.equal(idleShrinkCalls, 1, 'an unused renderer shrinks exactly once after the reuse window');

let oversizedIdleShrinkScheduled = false;
scheduleBoundedRendererIdleShrink({
  retainedPixels: SHARED_RENDERER_IDLE_PIXEL_BUDGET + 1,
  shrink: () => { idleShrinkCalls += 1; },
  scheduler: {
    schedule: () => {
      oversizedIdleShrinkScheduled = true;
      return 1;
    },
    cancel: () => undefined,
  },
});
assert.equal(oversizedIdleShrinkScheduled, false, 'an oversized idle drawing buffer is never retained');
assert.equal(idleShrinkCalls, 2, 'an oversized idle drawing buffer shrinks synchronously');

const returningOrbit = { x: 320, y: 240, maxDistance: 0 };
recordViewerDragDistance(returningOrbit, 410, 270);
recordViewerDragDistance(returningOrbit, 320, 240);
assert.equal(
  returningOrbit.maxDistance,
  Math.hypot(90, 30),
  'a drag keeps its maximum displacement after returning to its pointerdown origin',
);
assert(
  returningOrbit.maxDistance >= VIEWER_CLICK_MAX_DISTANCE_PX,
  'a completed closed-loop orbit cannot fall back into click selection',
);
const clickJitter = { x: 100, y: 100, maxDistance: 0 };
recordViewerDragDistance(clickJitter, 102, 101);
recordViewerDragDistance(clickJitter, 100, 100);
assert(
  clickJitter.maxDistance < VIEWER_CLICK_MAX_DISTANCE_PX,
  'sub-threshold pointer jitter remains a selectable click',
);

const root = new THREE.Group();
const disposed: string[] = [];
const pool = new FoundryThreeObjectPool(
  root,
  (object) => disposed.push(object.name),
  2,
);

pool.beginFrame();
const first = pool.acquire('bar', 'bar:2', () => {
  const object = new THREE.Group();
  object.name = 'first';
  return object;
}).object;
const second = pool.acquire('bar', 'bar:2', () => {
  const object = new THREE.Group();
  object.name = 'second';
  return object;
}).object;
pool.endFrame();
assert.equal(pool.retainedObjectCount, 2, 'pool retains the active semantic slots');

pool.beginFrame();
const reused = pool.acquire('bar', 'bar:2', () => {
  throw new Error('matching topology must not allocate');
}).object;
pool.endFrame();
assert.strictEqual(reused, first, 'matching semantic slot reuses the same Object3D');
assert.equal(second.visible, false, 'unused slot becomes invisible without disposal');

pool.beginFrame();
pool.acquire('bar', 'bar:2', () => new THREE.Group());
pool.acquire('bar', 'bar:2', () => new THREE.Group());
pool.acquire('bar', 'bar:2', () => {
  const object = new THREE.Group();
  object.name = 'third';
  return object;
});
pool.endFrame();
assert.equal(
  pool.retainedObjectCount,
  3,
  'an active frame is never truncated even when it exceeds the retention budget',
);

pool.beginFrame();
pool.acquire('bar', 'bar:2', () => new THREE.Group());
pool.endFrame();
assert.equal(pool.retainedObjectCount, 2, 'inactive high-water slots trim back to the budget');
assert.deepEqual(disposed, ['third'], 'trimming disposes the evicted Object3D');

pool.beginFrame();
const replacement = pool.acquire('bar', 'bar:3', () => {
  const object = new THREE.Group();
  object.name = 'replacement';
  return object;
}).object;
pool.endFrame();
assert.notStrictEqual(replacement, first, 'topology mismatch replaces the semantic slot');
assert(disposed.includes('first'), 'topology replacement disposes the old Object3D');

const gesturePoolRoot = new THREE.Group();
const gestureGeometryCache = new Map<string, THREE.BufferGeometry>();
const gestureMaterialCache = new Map<string, THREE.Material>();
const gesturePool = new FoundryThreeObjectPool(
  gesturePoolRoot,
  disposeFoundryThreeObject,
  32,
);
const gestureMechanism = createDefaultMechanism('4bar', 'gesture-render-retention');
const gestureBarMaterial = new THREE.MeshBasicMaterial();
const createGesturePrimitives = (deferBarTopologyChanges: boolean) =>
  createFoundryThreePrimitiveFactory({
    geometryCache: gestureGeometryCache,
    materialCache: gestureMaterialCache,
    mechanism: gestureMechanism,
    kit: defaultPhysicalKit(),
    color: '#2563eb',
    rigOpacity: 1,
    baseColor: '#f1f5f9',
    simulationScale: 1,
    objectPool: gesturePool,
    edgeGeometryEnabled: false,
    bevelEnabled: false,
    curveSegments: 2,
    deferBarTopologyChanges,
  });
gesturePool.beginFrame();
createGesturePrimitives(false).addBar(
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  0,
  gestureBarMaterial,
  3,
);
gesturePool.endFrame();
const retainedGestureBar = gesturePoolRoot.children[0];
const gestureRevisionBeforeDraft = gesturePool.topologyRevision;
const gestureGeometryBeforeDraft = gestureGeometryCache.size;

gesturePool.beginFrame();
createGesturePrimitives(true).addBar(
  { x: 0, y: 0 },
  { x: 132, y: 0 },
  0,
  gestureBarMaterial,
  3,
);
gesturePool.endFrame();
assert.strictEqual(
  gesturePoolRoot.children[0],
  retainedGestureBar,
  'a direct-manipulation draft retains the committed bar Object3D',
);
assert.equal(
  gesturePool.topologyRevision,
  gestureRevisionBeforeDraft,
  'a direct-manipulation draft does not report topology work',
);
assert.equal(
  gestureGeometryCache.size,
  gestureGeometryBeforeDraft,
  'a direct-manipulation draft does not add length-specific geometry',
);
assert(
  retainedGestureBar.scale.x > 1,
  'the retained bar follows the draft endpoints through a transient transform',
);

gesturePool.beginFrame();
createGesturePrimitives(false).addBar(
  { x: 0, y: 0 },
  { x: 132, y: 0 },
  0,
  gestureBarMaterial,
  3,
);
gesturePool.endFrame();
assert.notStrictEqual(
  gesturePoolRoot.children[0],
  retainedGestureBar,
  'the committed length change installs its fabrication topology once',
);
assert.equal(
  gesturePool.topologyRevision,
  gestureRevisionBeforeDraft + 1,
  'only the committed length change increments topology revision',
);
assert.equal(
  gestureGeometryCache.size,
  gestureGeometryBeforeDraft + 1,
  'only the committed bar adds one length-specific geometry',
);

const usedGeometry = new THREE.BoxGeometry(1, 1, 1);
const staleGeometry = new THREE.SphereGeometry(1);
const usedMaterial = new THREE.MeshBasicMaterial();
const staleMaterial = new THREE.MeshBasicMaterial();
let staleGeometryDisposals = 0;
let staleMaterialDisposals = 0;
staleGeometry.addEventListener('dispose', () => {
  staleGeometryDisposals += 1;
});
staleMaterial.addEventListener('dispose', () => {
  staleMaterialDisposals += 1;
});
const resourceRoot = new THREE.Group();
resourceRoot.add(new THREE.Mesh(usedGeometry, usedMaterial));
const usage = collectThreeObjectResourceUsage(resourceRoot);
const geometryCache = new Map<string, THREE.BufferGeometry>([
  ['used', usedGeometry],
  ['stale', staleGeometry],
]);
const materialCache = new Map<string, THREE.Material>([
  ['used', usedMaterial],
  ['stale', staleMaterial],
]);

assert.equal(
  pruneUnusedThreeResourceCache(geometryCache, usage.geometries, 1),
  1,
  'geometry cache evicts one unused entry at its budget',
);
assert.equal(
  pruneUnusedThreeResourceCache(materialCache, usage.materials, 1),
  1,
  'material cache evicts one unused entry at its budget',
);
assert.strictEqual(geometryCache.get('used'), usedGeometry, 'live geometry is retained');
assert.strictEqual(materialCache.get('used'), usedMaterial, 'live material is retained');
assert.equal(staleGeometryDisposals, 1, 'evicted geometry is disposed exactly once');
assert.equal(staleMaterialDisposals, 1, 'evicted material is disposed exactly once');

usedGeometry.dispose();
usedMaterial.dispose();

const retainedAcrossMountsCache = new Map<string, THREE.BufferGeometry>();
let retainedAcrossMountsDisposals = 0;
const retainedAcrossMountsGeometry = cachedThreeResource(
  retainedAcrossMountsCache,
  'puppet-part-plate:stable-topology',
  () => {
    const geometry = new THREE.BoxGeometry(1, 1, 0.22);
    geometry.addEventListener('dispose', () => {
      retainedAcrossMountsDisposals += 1;
    });
    return geometry;
  },
  'sharedFabricationGeometry',
);
const retainedMountRoot = new THREE.Group();
retainedMountRoot.add(new THREE.Mesh(
  retainedAcrossMountsGeometry,
  new THREE.MeshBasicMaterial(),
));
disposeThreeObjectGraph(retainedMountRoot, {
  keepGeometry: (geometry) =>
    Boolean(geometry.userData.sharedFabricationGeometry),
});
assert.equal(
  retainedAcrossMountsDisposals,
  0,
  'a released puppet scene leaves shared part topology alive for the next mount',
);
assert.strictEqual(
  cachedThreeResource(
    retainedAcrossMountsCache,
    'puppet-part-plate:stable-topology',
    () => {
      throw new Error('a warm puppet mount must reuse retained part topology');
    },
    'sharedFabricationGeometry',
  ),
  retainedAcrossMountsGeometry,
  'the next puppet mount receives the same geometry object',
);
assert.equal(
  pruneUnusedThreeResourceCache(
    retainedAcrossMountsCache,
    new Set(),
    1,
  ),
  0,
  'the idle retention budget keeps a bounded warm topology entry',
);
assert.equal(
  pruneUnusedThreeResourceCache(
    retainedAcrossMountsCache,
    new Set(),
    0,
  ),
  1,
  'reducing the idle budget evicts and disposes retained topology',
);
assert.equal(retainedAcrossMountsDisposals, 1);

const puppetCleanupEvents: string[] = [];
const puppetCleanupRoot = new THREE.Group();
let puppetCleanupTraversals = 0;
const traversePuppetCleanupRoot = puppetCleanupRoot.traverse.bind(puppetCleanupRoot);
puppetCleanupRoot.traverse = (callback) => {
  puppetCleanupTraversals += 1;
  traversePuppetCleanupRoot(callback);
};

const puppetSharedGeometry = new THREE.BoxGeometry(1, 1, 0.22);
puppetSharedGeometry.userData.sharedFabricationGeometry = true;
puppetSharedGeometry.addEventListener('dispose', () => {
  puppetCleanupEvents.push('shared-geometry');
});
const puppetPrivateGeometry = new THREE.PlaneGeometry(1, 1);
puppetPrivateGeometry.addEventListener('dispose', () => {
  puppetCleanupEvents.push('private-geometry');
});

const partArtBitmap = {
  close: () => puppetCleanupEvents.push('part-art-bitmap'),
};
const partArtTexture = new THREE.Texture(partArtBitmap);
partArtTexture.addEventListener('dispose', () => {
  puppetCleanupEvents.push('part-art-texture');
});
const ownedPartArtMaterial = new THREE.MeshBasicMaterial({ map: partArtTexture });
ownedPartArtMaterial.userData.ownedByPartArt = true;
ownedPartArtMaterial.userData.initialSceneResourcePending = true;
ownedPartArtMaterial.addEventListener('dispose', () => {
  assert.equal(ownedPartArtMaterial.map, null, 'part-art cleanup releases its texture before its material');
  puppetCleanupEvents.push('part-art-material');
});

const sceneObjectTexture = new THREE.Texture();
const ownedSceneObjectMaterial = new THREE.MeshBasicMaterial({ map: sceneObjectTexture });
ownedSceneObjectMaterial.userData.ownedBySceneObject = true;
ownedSceneObjectMaterial.userData.initialSceneResourcePending = true;
sceneObjectTexture.addEventListener('dispose', () => {
  assert.equal(ownedSceneObjectMaterial.userData.sceneObjectDisposed, true);
  assert.equal(ownedSceneObjectMaterial.userData.initialSceneResourcePending, false);
  puppetCleanupEvents.push('scene-object-texture');
});
ownedSceneObjectMaterial.addEventListener('dispose', () => {
  puppetCleanupEvents.push('scene-object-material');
});

const retainedMaterialKitEntry = new THREE.MeshBasicMaterial();
retainedMaterialKitEntry.addEventListener('dispose', () => {
  puppetCleanupEvents.push('material-kit');
});
const cleanupInstancedMesh = new THREE.InstancedMesh(
  puppetSharedGeometry,
  retainedMaterialKitEntry,
  1,
);
cleanupInstancedMesh.addEventListener('dispose', () => {
  puppetCleanupEvents.push('instanced-buffers');
});
puppetCleanupRoot.add(
  new THREE.Mesh(puppetSharedGeometry, ownedPartArtMaterial),
  new THREE.Mesh(puppetPrivateGeometry, ownedSceneObjectMaterial),
  cleanupInstancedMesh,
);

disposePuppetObjectGraph(puppetCleanupRoot);
assert.equal(
  puppetCleanupTraversals,
  1,
  'Puppet teardown releases owned resources and private geometry in one Object3D traversal',
);
assert.deepEqual(
  puppetCleanupEvents,
  [
    'part-art-bitmap',
    'part-art-texture',
    'part-art-material',
    'private-geometry',
    'scene-object-texture',
    'scene-object-material',
    'instanced-buffers',
  ],
  'Puppet teardown synchronously releases owned texture/material and instance resources exactly once',
);
assert.equal(
  ownedPartArtMaterial.userData.initialSceneResourcePending,
  false,
  'part-art teardown cannot leave initial-resource readiness pending',
);
assert.equal(
  puppetSharedGeometry.userData.sharedFabricationGeometry,
  true,
  'shared fabrication geometry remains retained for the warm cache',
);
assert.equal(
  puppetCleanupEvents.includes('material-kit'),
  false,
  'the graph walk leaves the caller-owned material kit for the ordered outer cleanup',
);
retainedMaterialKitEntry.dispose();
assert.equal(
  puppetCleanupEvents.at(-1),
  'material-kit',
  'the caller can dispose retained kit materials after the scene graph has released its owned resources',
);
puppetSharedGeometry.dispose();

const instancedGeometry = new THREE.BoxGeometry(1, 1, 1);
const instancedMaterial = new THREE.MeshBasicMaterial();
const instanced = new THREE.InstancedMesh(
  instancedGeometry,
  instancedMaterial,
  2,
);
let instancedDisposals = 0;
instanced.addEventListener('dispose', () => {
  instancedDisposals += 1;
});
const instancedRoot = new THREE.Group();
instancedRoot.add(instanced);
disposeThreeObjectGraph(instancedRoot);
assert.equal(
  instancedDisposals,
  1,
  'graph cleanup releases InstancedMesh-owned matrix and color buffers',
);

const hardwareGeometry = new THREE.BoxGeometry(1, 1, 1);
const washerGeometry = new THREE.TorusGeometry(1, 0.1, 4, 8);
const hardwareMaterial = new THREE.MeshBasicMaterial();
const washerMaterial = new THREE.MeshBasicMaterial();
const jointHardware = createPuppetJointHardwareInstances({
  jointIds: ['root', 'tip'],
  pinGeometry: hardwareGeometry,
  washerGeometry,
  pinMaterial: hardwareMaterial,
  washerMaterial,
});
updatePuppetJointHardwareInstances({
  hardware: jointHardware,
  joints: [
    { id: 'root', position: { x: 35, y: -70 } },
    { id: 'tip', position: { x: 105, y: 140 } },
  ],
  viewScale: 35,
  pinZ: 0.35,
  washerZ: 0.55,
  isVisible: (jointId) => jointId === 'root',
});
assert.equal(jointHardware.pins.count, 2, 'one pin draw object retains every joint instance');
assert.equal(jointHardware.washers.count, 2, 'one washer draw object retains every joint instance');
assert.equal(
  puppetJointIdForInstance(jointHardware.pins, 1),
  'tip',
  'an instanced raycast index preserves direct joint selection',
);
assert.equal(
  puppetJointIdForInstance(new THREE.Group(), 0),
  undefined,
  'non-instanced scene objects cannot masquerade as joint hardware',
);
const visiblePinMatrix = new THREE.Matrix4();
jointHardware.pins.getMatrixAt(0, visiblePinMatrix);
const visiblePinPosition = new THREE.Vector3();
const visiblePinRotation = new THREE.Quaternion();
const visiblePinScale = new THREE.Vector3();
visiblePinMatrix.decompose(
  visiblePinPosition,
  visiblePinRotation,
  visiblePinScale,
);
assert.deepEqual(
  visiblePinPosition.toArray().map((value) => Number(value.toFixed(3))),
  [1, -2, 0.35],
  'instanced pin transforms retain canonical joint coordinates and depth',
);
assert.deepEqual(
  visiblePinScale.toArray().map((value) => Number(value.toFixed(3))),
  [1, 1, 1],
  'visible joint hardware retains fabrication scale',
);
const expectedPinRotation = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI / 2,
);
assert(
  Math.abs(visiblePinRotation.dot(expectedPinRotation)) > 0.999,
  'instanced pins retain the original front-view cylinder orientation',
);
const visibleWasherMatrix = new THREE.Matrix4();
jointHardware.washers.getMatrixAt(0, visibleWasherMatrix);
assert.deepEqual(
  new THREE.Vector3()
    .setFromMatrixPosition(visibleWasherMatrix)
    .toArray()
    .map((value) => Number(value.toFixed(3))),
  [1, -2, 0.55],
  'instanced washers retain their fabrication layer depth',
);
const hiddenPinMatrix = new THREE.Matrix4();
jointHardware.pins.getMatrixAt(1, hiddenPinMatrix);
assert.equal(hiddenPinMatrix.elements[0], 0, 'inactive assembly pins collapse without a new mesh');
assert.equal(hiddenPinMatrix.elements[5], 0, 'inactive assembly pins have no visible y extent');
assert.equal(hiddenPinMatrix.elements[10], 0, 'inactive assembly pins have no visible z extent');

jointHardware.pins.updateMatrixWorld(true);
const initialJointHits = new THREE.Raycaster(
  new THREE.Vector3(1, -2, 5),
  new THREE.Vector3(0, 0, -1),
).intersectObject(jointHardware.pins, false);
assert(
  initialJointHits.some((hit) => hit.instanceId === 0),
  'joint raycasting finds the initial instanced pin and populates its bounds',
);
assert(jointHardware.pins.boundingSphere, 'the first raycast caches instance bounds');
updatePuppetJointHardwareInstances({
  hardware: jointHardware,
  joints: [
    { id: 'root', position: { x: 700, y: -70 } },
    { id: 'tip', position: { x: 105, y: 140 } },
  ],
  viewScale: 35,
  pinZ: 0.35,
  washerZ: 0.55,
  isVisible: (jointId) => jointId === 'root',
});
assert.equal(
  jointHardware.pins.boundingSphere,
  null,
  'moving instances invalidates the raycaster bounding sphere',
);
jointHardware.pins.updateMatrixWorld(true);
const movedJointHits = new THREE.Raycaster(
  new THREE.Vector3(20, -2, 5),
  new THREE.Vector3(0, 0, -1),
).intersectObject(jointHardware.pins, false);
assert(
  movedJointHits.some((hit) => hit.instanceId === 0),
  'joint raycasting follows an instanced pin beyond its previously cached bounds',
);

const ringGeometry = new THREE.TorusGeometry(0.11, 0.014, 4, 8);
const ringMaterial = new THREE.MeshBasicMaterial();
const rings = createPuppetCutHoleRingInstances({
  partId: 'plate-a',
  holes: [{ x: 35, y: 70 }, { x: -35, y: 0 }],
  viewScale: 35,
  z: 0.26,
  geometry: ringGeometry,
  material: ringMaterial,
});
assert.equal(rings.count, 2, 'all part holes share one retained ring draw object');
assert.equal(rings.userData.partId, 'plate-a', 'instanced rings preserve part picking ownership');
const secondRingMatrix = new THREE.Matrix4();
rings.getMatrixAt(1, secondRingMatrix);
assert.deepEqual(
  new THREE.Vector3()
    .setFromMatrixPosition(secondRingMatrix)
    .toArray()
    .map((value) => Number(value.toFixed(3))),
  [-1, 0, 0.26],
  'each cut-hole ring keeps its fabrication-local placement',
);
hardwareGeometry.dispose();
washerGeometry.dispose();
hardwareMaterial.dispose();
washerMaterial.dispose();
jointHardware.pins.dispose();
jointHardware.washers.dispose();
ringGeometry.dispose();
ringMaterial.dispose();
rings.dispose();

const scheduledFrames = new Map<number, () => void>();
let nextFrameHandle = 1;
const cancelledFrames: number[] = [];
const scheduler = {
  request(callback: () => void) {
    const handle = nextFrameHandle;
    nextFrameHandle += 1;
    scheduledFrames.set(handle, callback);
    return handle;
  },
  cancel(handle: number) {
    cancelledFrames.push(handle);
    scheduledFrames.delete(handle);
  },
};
const builtItems: string[] = [];
let completionCount = 0;
const cancelBuild = scheduleIncrementalTopologyBuild(
  ['head', 'body', 'arm'],
  (item) => builtItems.push(item),
  { scheduler, onComplete: () => { completionCount += 1; } },
);
const runNextFrame = () => {
  const next = scheduledFrames.entries().next().value as [number, () => void] | undefined;
  assert(next, 'an incremental topology frame is scheduled');
  scheduledFrames.delete(next[0]);
  next[1]();
};
runNextFrame();
assert.deepEqual(builtItems, ['head'], 'topology construction builds at most one part per frame');
runNextFrame();
assert.deepEqual(builtItems, ['head', 'body'], 'the next part waits for the next frame');
cancelBuild();
assert.equal(scheduledFrames.size, 0, 'cancellation removes the pending topology frame');
assert.equal(cancelledFrames.length, 1, 'cancellation releases the scheduler handle once');
assert.equal(completionCount, 0, 'cancelled topology work never reports completion');

scheduleIncrementalTopologyBuild(
  ['leg'],
  (item) => builtItems.push(item),
  { scheduler, onComplete: () => { completionCount += 1; } },
);
runNextFrame();
assert.deepEqual(builtItems, ['head', 'body', 'leg']);
assert.equal(completionCount, 1, 'the final topology frame completes without an extra frame');

scheduleIncrementalTopologyBuild(
  ['delayed'],
  (item) => builtItems.push(item),
  { scheduler, initialDelayFrames: 1 },
);
runNextFrame();
assert(!builtItems.includes('delayed'), 'an initial delay frame separates topology from the React commit and first render');
runNextFrame();
assert(builtItems.includes('delayed'), 'topology starts after its declared initial frame delay');

const batchedItems: string[] = [];
let virtualFrameTime = 0;
let batchedCompletionCount = 0;
scheduleIncrementalTopologyBuild(
  ['a', 'b', 'c', 'd', 'e'],
  (item) => {
    batchedItems.push(item);
    virtualFrameTime += 4;
  },
  {
    scheduler,
    maxItemsPerFrame: 4,
    frameBudgetMs: 9,
    now: () => virtualFrameTime,
    onComplete: () => { batchedCompletionCount += 1; },
  },
);
runNextFrame();
assert.deepEqual(
  batchedItems,
  ['a', 'b', 'c'],
  'a topology frame batches cheap work but stops after crossing its time budget',
);
assert.equal(batchedCompletionCount, 0, 'budgeted work does not complete early');
runNextFrame();
assert.deepEqual(
  batchedItems,
  ['a', 'b', 'c', 'd', 'e'],
  'the next frame finishes the bounded topology batch',
);
assert.equal(batchedCompletionCount, 1, 'the final bounded batch completes once');

for (const preset of ['fast', 'balanced', 'high'] as const) {
  assert.deepEqual(
    puppetInitialTopologyBatchPolicy(preset),
    {
      maxItemsPerFrame: 1,
      frameBudgetMs: 4,
      interBatchDelayFrames: 1,
    },
    `${preset} cold Puppet topology builds one exact part and leaves a submission frame before the next part`,
  );
}

const coldPartSteps = puppetInitialTopologySettlementSteps(
  ['torso', 'arm'],
  { hasOutline: true, hasArt: true, hasHardware: true },
  true,
);
assert.deepEqual(
  coldPartSteps,
  [
    { item: 'torso', phase: 'base', finalForPart: false },
    { item: 'torso', phase: 'outline', finalForPart: false },
    { item: 'torso', phase: 'art', finalForPart: false },
    { item: 'torso', phase: 'hardware', finalForPart: true },
    { item: 'arm', phase: 'complete', finalForPart: true },
  ],
  'the first cold Puppet part separates every program/resource variant while later parts keep one bounded batch',
);
assert.deepEqual(
  puppetInitialTopologySettlementSteps(
    ['arm'],
    { hasOutline: true, hasArt: true, hasHardware: true },
    false,
  ),
  [{ item: 'arm', phase: 'complete', finalForPart: true }],
  'an incremental warm topology change retains the ordinary exact one-part path',
);

const coldPartEvents: string[] = [];
scheduleIncrementalTopologyBuild(
  coldPartSteps,
  (step) => coldPartEvents.push(`build:${step.item}:${step.phase}`),
  {
    scheduler,
    maxItemsPerFrame: 1,
    interBatchDelayFrames: 1,
    onBatchComplete: ({ builtTotal }) => {
      const phase = coldPartSteps[builtTotal - 1]?.phase;
      scheduler.request(() => coldPartEvents.push(`submit:${phase}`));
    },
  },
);
while (scheduledFrames.size > 0) runNextFrame();
assert.deepEqual(
  coldPartEvents.slice(0, 8),
  [
    'build:torso:base',
    'submit:base',
    'build:torso:outline',
    'submit:outline',
    'build:torso:art',
    'submit:art',
    'build:torso:hardware',
    'submit:hardware',
  ],
  'each first-part visual/resource phase reaches its own submission before the next phase is constructed',
);
assert(
  coldPartEvents.indexOf('submit:hardware') <
    coldPartEvents.indexOf('build:arm:complete'),
  'the remaining exact parts start only after the first part has reached its final hardware submission',
);

const alternatingItems: string[] = [];
const alternatingEvents: string[] = [];
let alternatingComplete = 0;
scheduleIncrementalTopologyBuild(
  ['torso', 'arm'],
  (item) => {
    alternatingItems.push(item);
    alternatingEvents.push(`build:${item}`);
  },
  {
    scheduler,
    maxItemsPerFrame: 1,
    interBatchDelayFrames: 1,
    onBatchComplete: ({ builtTotal, complete }) => {
      alternatingEvents.push(`batch:${builtTotal}:${complete}`);
      scheduler.request(() => alternatingEvents.push(`submit:${builtTotal}`));
    },
    onComplete: () => { alternatingComplete += 1; },
  },
);
runNextFrame();
assert.deepEqual(alternatingItems, ['torso'], 'the first cold part owns one construction frame');
runNextFrame();
assert.deepEqual(
  alternatingEvents.slice(0, 3),
  ['build:torso', 'batch:1:false', 'submit:1'],
  'the completed slice submits before another topology item can start',
);
runNextFrame();
assert.deepEqual(alternatingItems, ['torso'], 'the inter-batch yield keeps GPU submission and the next build in separate frame callbacks');
runNextFrame();
assert.deepEqual(alternatingItems, ['torso', 'arm'], 'the next exact part starts after the submission boundary');
runNextFrame();
assert.equal(alternatingComplete, 1, 'alternating topology settlement completes exactly once');

const foundrySettlement = foundryInitialTopologySettlementSteps(3, 2);
assert.deepEqual(
  foundrySettlement,
  [
    { visibleLayerCount: 1, visiblePinStackCount: 0, complete: false },
    { visibleLayerCount: 2, visiblePinStackCount: 0, complete: false },
    { visibleLayerCount: 3, visiblePinStackCount: 0, complete: false },
    { visibleLayerCount: 3, visiblePinStackCount: 1, complete: false },
    { visibleLayerCount: 3, visiblePinStackCount: 2, complete: true },
  ],
  'cold Foundry settlement grows one canonical layer or pin stack per submitted frame',
);
assert.deepEqual(
  foundryInitialTopologySettlementSteps(0, 0),
  [{ visibleLayerCount: 0, visiblePinStackCount: 0, complete: true }],
  'an empty valid Foundry scene still owns one exact completion boundary',
);

const foundryShaderSettlement = foundryInitialShaderSettlementSteps();
assert.deepEqual(
  foundryShaderSettlement,
  [
    { gridLines: true, workSurface: false, complete: false },
    { gridLines: true, workSurface: true, complete: true },
  ],
  'cold Foundry settlement separates the line and lit-surface shader families while ending on the exact static scene',
);
const foundryShaderEvents: string[] = [];
const [firstFoundryShaderFamily, ...remainingFoundryShaderFamilies] =
  foundryShaderSettlement;
assert(firstFoundryShaderFamily);
foundryShaderEvents.push(
  `submit:${firstFoundryShaderFamily.gridLines}:${firstFoundryShaderFamily.workSurface}`,
);
scheduleIncrementalTopologyBuild(
  remainingFoundryShaderFamilies,
  (step) =>
    foundryShaderEvents.push(`submit:${step.gridLines}:${step.workSurface}`),
  {
    scheduler,
    maxItemsPerFrame: 1,
    frameBudgetMs: 4,
    onComplete: () => foundryShaderEvents.push('ready'),
  },
);
assert.deepEqual(
  foundryShaderEvents,
  ['submit:true:false'],
  'the first line-only submission is delivered before the next frame',
);
runNextFrame();
assert.deepEqual(
  foundryShaderEvents,
  ['submit:true:false', 'submit:true:true', 'ready'],
  'the next frame submits the exact grid-and-surface scene before readiness',
);

type SettlementFrame = { revision: string; phase: number };
type SettlementJob = {
  steps: readonly string[];
  visit: (step: string) => void;
  complete: () => void;
  cancelled: boolean;
};
const settlementJobs: SettlementJob[] = [];
const settlementEvents: string[] = [];
const keyedSettlement = createKeyedInitialTopologySettlement<
  SettlementFrame,
  string
>({
  schedule: (steps, visit, complete) => {
    const job: SettlementJob = {
      steps,
      visit,
      complete,
      cancelled: false,
    };
    settlementJobs.push(job);
    return () => {
      job.cancelled = true;
    };
  },
  onStart: (frame, key) => settlementEvents.push(`start:${key}:${frame.phase}`),
  onStep: (step, frame, key) =>
    settlementEvents.push(`step:${key}:${step}:${frame.phase}`),
  onComplete: (frame, key) =>
    settlementEvents.push(`complete:${key}:${frame.phase}`),
  onCancel: (key) => settlementEvents.push(`cancel:${key}`),
});

assert.equal(
  keyedSettlement.update('topology-a', { revision: 'a-0', phase: 0 }, ['bar', 'pins']),
  'started',
);
for (let phase = 1; phase <= 40; phase += 1) {
  assert.equal(
    keyedSettlement.update(
      'topology-a',
      { revision: `a-${phase}`, phase },
      ['bar', 'pins'],
    ),
    'updated',
  );
}
assert.equal(
  settlementJobs.length,
  1,
  'repeated same-topology React frames never replace the active scheduler generation',
);
settlementJobs[0].steps.forEach(settlementJobs[0].visit);
settlementJobs[0].complete();
assert.deepEqual(
  settlementEvents.slice(-3),
  [
    'step:topology-a:bar:40',
    'step:topology-a:pins:40',
    'complete:topology-a:40',
  ],
  'same-topology settlement completes from the latest frame despite adversarial rerenders',
);
assert.equal(keyedSettlement.isActive(), false);
assert.deepEqual(
  keyedSettlement.snapshot(),
  {
    active: false,
    activeKey: null,
    generationsStarted: 1,
    sameKeyUpdates: 40,
    generationsRestarted: 0,
    generationsCancelled: 0,
    stepsDelivered: 2,
    generationsCompleted: 1,
  },
  'the keyed controller exposes deterministic start/update/step/completion transitions',
);

keyedSettlement.update('topology-b', { revision: 'b', phase: 1 }, ['old']);
const supersededJob = settlementJobs.at(-1)!;
assert.equal(
  keyedSettlement.update('topology-c', { revision: 'c', phase: 2 }, ['new']),
  'restarted',
  'a real topology revision replaces the active generation',
);
const winningJob = settlementJobs.at(-1)!;
assert.equal(supersededJob.cancelled, true, 'supersession cancels old scheduled work');
supersededJob.visit('stale');
supersededJob.complete();
winningJob.visit('new');
winningJob.complete();
assert(
  !settlementEvents.some((event) => event.includes('topology-b:stale')) &&
    !settlementEvents.some((event) => event.startsWith('complete:topology-b')),
  'late callbacks from a cancelled topology generation cannot publish stale scene work',
);
assert.deepEqual(
  settlementEvents.slice(-2),
  ['step:topology-c:new:2', 'complete:topology-c:2'],
  'the replacement topology is the only generation allowed to complete',
);
assert.deepEqual(
  keyedSettlement.snapshot(),
  {
    active: false,
    activeKey: null,
    generationsStarted: 3,
    sameKeyUpdates: 40,
    generationsRestarted: 1,
    generationsCancelled: 1,
    stepsDelivered: 3,
    generationsCompleted: 2,
  },
  'supersession telemetry distinguishes a cancelled generation from its winning completion',
);

keyedSettlement.update('topology-unmount', { revision: 'unmount', phase: 3 }, ['late']);
const unmountedJob = settlementJobs.at(-1)!;
assert.equal(keyedSettlement.cancel(), true);
unmountedJob.visit('late');
unmountedJob.complete();
assert.equal(
  settlementEvents.some((event) => event.startsWith('complete:topology-unmount')),
  false,
  'unmount cancellation prevents a pending generation from reporting readiness',
);
assert.equal(keyedSettlement.snapshot().generationsCancelled, 2);

const uploadRoot = new THREE.Group();
uploadRoot.visible = false;
const uploadMaterial = new THREE.MeshBasicMaterial();
uploadMaterial.visible = false;
const uploadMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  uploadMaterial,
);
uploadMesh.visible = false;
uploadMesh.frustumCulled = true;
uploadRoot.add(uploadMesh);
let uploadScissor = new THREE.Vector4(4, 5, 6, 7);
let uploadScissorTest = false;
const uploadSubmissions: Array<{
  rootVisible: boolean;
  meshVisible: boolean;
  materialVisible: boolean;
  frustumCulled: boolean;
  scissor: number[];
  scissorTest: boolean;
}> = [];
const uploadRenderer = {
  getScissor(target: THREE.Vector4) {
    return target.copy(uploadScissor);
  },
  getScissorTest() {
    return uploadScissorTest;
  },
  setScissor(...args: [THREE.Vector4] | [number, number, number, number]) {
    uploadScissor = args.length === 1
      ? args[0].clone()
      : new THREE.Vector4(args[0], args[1], args[2], args[3]);
  },
  setScissorTest(enabled: boolean) {
    uploadScissorTest = enabled;
  },
} as InitialSceneResourceUploadRenderer;

realizeInitialSceneResources({
  renderer: uploadRenderer,
  roots: [uploadRoot],
  submit: () => {
    uploadSubmissions.push({
      rootVisible: uploadRoot.visible,
      meshVisible: uploadMesh.visible,
      materialVisible: uploadMaterial.visible,
      frustumCulled: uploadMesh.frustumCulled,
      scissor: uploadScissor.toArray(),
      scissorTest: uploadScissorTest,
    });
  },
});
assert.deepEqual(
  uploadSubmissions,
  [
    {
      rootVisible: true,
      meshVisible: true,
      materialVisible: true,
      frustumCulled: false,
      scissor: [0, 0, 1, 1],
      scissorTest: true,
    },
    {
      rootVisible: false,
      meshVisible: false,
      materialVisible: false,
      frustumCulled: true,
      scissor: [4, 5, 6, 7],
      scissorTest: false,
    },
  ],
  'initial resource upload warms every retained draw object in one pixel, then submits the exact restored scene',
);
assert.equal(uploadRoot.visible, false);
assert.equal(uploadMesh.visible, false);
assert.equal(uploadMesh.frustumCulled, true);
assert.equal(uploadMaterial.visible, false);
uploadMesh.geometry.dispose();
uploadMaterial.dispose();

const readinessCallbacks = new Map<number, () => void>();
const cancelledReadinessFrames: number[] = [];
let nextReadinessHandle = 1;
const readinessChanges: boolean[] = [];
const readinessGeneration = createInitialSceneReadinessGeneration({
  onReadyChange: (ready) => readinessChanges.push(ready),
  scheduler: {
    request(callback) {
      const handle = nextReadinessHandle;
      nextReadinessHandle += 1;
      readinessCallbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      // Keep the callback deliberately callable to model a stale frame that
      // was already delivered to the browser's animation-frame queue.
      cancelledReadinessFrames.push(handle);
    },
  },
});
assert.equal(readinessGeneration.schedule(() => true), true);
assert.equal(
  readinessGeneration.schedule(() => true),
  false,
  'one scene revision owns at most one pending readiness publication',
);
readinessGeneration.invalidate();
assert.deepEqual(cancelledReadinessFrames, [1]);
readinessCallbacks.get(1)!();
assert.deepEqual(
  readinessChanges,
  [false],
  'an invalidated scene revision stays not-ready even if its cancelled frame is delivered',
);
assert.equal(readinessGeneration.schedule(() => false), true);
readinessCallbacks.get(2)!();
assert.deepEqual(
  readinessChanges,
  [false],
  'a failed latest-revision validation does not publish readiness',
);
assert.equal(
  readinessGeneration.schedule(() => true),
  true,
  'a revision can recheck after its resource validation initially fails',
);
readinessCallbacks.get(3)!();
assert.deepEqual(
  readinessChanges,
  [false, true],
  'only the validated latest retained-scene revision publishes readiness',
);
readinessGeneration.invalidate();
assert.deepEqual(
  readinessChanges,
  [false, true, false],
  'replacing an already-ready retained scene resets readiness immediately',
);
assert.equal(readinessGeneration.schedule(() => true), true);
readinessCallbacks.get(4)!();
assert.deepEqual(
  readinessChanges,
  [false, true, false, true],
  'the replacement scene can publish readiness after its own validation frame',
);

let bitmapLoad: ((bitmap: ImageBitmap) => void) | undefined;
let bitmapLoaderAborts = 0;
let artLoads = 0;
const artMaterial = createPartArtMaterial(
  {
    textureUrl: 'data:image/png;base64,audit',
    fillColor: '#ffffff',
    opacity: 1,
  } as never,
  () => { artLoads += 1; },
  {
    bitmapSupported: true,
    createBitmapLoader: () => ({
      load: (_url, onLoad) => { bitmapLoad = onLoad; },
      abort: () => { bitmapLoaderAborts += 1; },
    }),
    scheduleInstall: (install) => {
      install();
      return () => {};
    },
  },
);
assert.equal(
  isInitialSceneMaterialResourcePending(artMaterial),
  true,
  'a decoded part-art resource remains pending until its texture install callback runs',
);
let bitmapCloses = 0;
bitmapLoad?.({ close: () => { bitmapCloses += 1; } } as ImageBitmap);
assert.equal(artLoads, 1, 'part artwork reports readiness after asynchronous bitmap decode');
assert.equal(
  isInitialSceneMaterialResourcePending(artMaterial),
  false,
  'the successful texture install closes the part-art readiness lease',
);
assert(artMaterial.map, 'part artwork installs the decoded bitmap as a Three texture');
disposePartArtMaterial(artMaterial);
assert.equal(bitmapLoaderAborts, 1, 'part artwork disposal aborts its loader');
assert.equal(bitmapCloses, 1, 'part artwork disposal closes its owned ImageBitmap');
assert.equal(artMaterial.map, null, 'part artwork disposal releases its texture reference');

let lateBitmapLoad: ((bitmap: ImageBitmap) => void) | undefined;
const disposedBeforeLoad = createPartArtMaterial(
  { textureUrl: 'data:image/png;base64,late', fillColor: '#ffffff' } as never,
  () => { artLoads += 1; },
  {
    bitmapSupported: true,
    createBitmapLoader: () => ({
      load: (_url, onLoad) => { lateBitmapLoad = onLoad; },
      abort: () => { bitmapLoaderAborts += 1; },
    }),
  },
);
disposePartArtMaterial(disposedBeforeLoad);
assert.equal(
  isInitialSceneMaterialResourcePending(disposedBeforeLoad),
  false,
  'disposing a queued part-art material cannot leave initial scene settlement pending',
);
lateBitmapLoad?.({ close: () => { bitmapCloses += 1; } } as ImageBitmap);
assert.equal(artLoads, 1, 'a disposed material ignores a late bitmap result');
assert.equal(bitmapCloses, 2, 'a late bitmap is closed instead of being retained');

const balancedTopology = resolveRenderPerformancePolicy('balanced').partTopology;
assert.equal(warmPartTopologyPipeline(balancedTopology), true, 'part topology warms once before an interactive import');
assert.equal(warmPartTopologyPipeline(balancedTopology), false, 'the same topology policy does not repeat warm-up allocations');

const topologySkeleton: StandardSkeleton = {
  joints: {
    root: {
      id: 'root',
      name: 'root',
      position: { x: 0, y: 0 },
      parentId: null,
      locked: false,
      bendDirection: 1,
    },
    tip: {
      id: 'tip',
      name: 'tip',
      position: { x: 48, y: 0 },
      parentId: 'root',
      locked: false,
      bendDirection: 1,
    },
  },
  bones: [['root', 'tip']],
  rootJointIds: ['root'],
  jointMap: {},
  hierarchy: { root: ['tip'], tip: [] },
  metadata: { sourceFormat: 'retention-test', scale: 1 },
};
const topologyPart: BodyPartLayer = {
  id: 'plate-a',
  name: 'Plate A',
  anchorJointId: 'root',
  transform: { x: 0, y: 0, rotation: 0, scale: 1 },
  zIndex: 1,
  opacity: 1,
  visible: true,
  locked: false,
  selectable: true,
  bounds: { x: -12, y: -28, width: 72, height: 56 },
  fillColor: '#64748b',
};
const preparedPlateA = preparePuppetPartTopology(
  topologyPart,
  topologySkeleton,
  balancedTopology,
);
const preparedPlateB = preparePuppetPartTopology(
  { ...topologyPart, id: 'plate-b', name: 'Plate B', zIndex: 2 },
  topologySkeleton,
  balancedTopology,
);
const retainedIdentities = new Map([
  [preparedPlateA.part.id, preparedPlateA.identity],
  [preparedPlateB.part.id, preparedPlateB.identity],
]);
const lockOnlyDiff = diffPuppetPartTopologies(retainedIdentities, [
  preparePuppetPartTopology(
    { ...topologyPart, locked: true },
    topologySkeleton,
    balancedTopology,
  ),
  preparedPlateB,
]);
assert.deepEqual(lockOnlyDiff.removeIds, [], 'nonvisual lock state retains every part topology');
assert.deepEqual(lockOnlyDiff.build, [], 'nonvisual lock state allocates no geometry');

const movedPlateA = preparePuppetPartTopology(
  {
    ...topologyPart,
    transform: { ...topologyPart.transform, x: topologyPart.transform.x + 6 },
  },
  topologySkeleton,
  balancedTopology,
);
const onePartDiff = diffPuppetPartTopologies(retainedIdentities, [
  movedPlateA,
  preparedPlateB,
]);
assert.deepEqual(onePartDiff.removeIds, ['plate-a'], 'one changed plate replaces only its prior topology');
assert.deepEqual(onePartDiff.build.map((entry) => entry.part.id), ['plate-a'], 'one changed plate rebuilds only itself');

const removedPartDiff = diffPuppetPartTopologies(retainedIdentities, [preparedPlateA]);
assert.deepEqual(removedPartDiff.removeIds, ['plate-b'], 'removing a layer releases only its retained plate');
assert.deepEqual(removedPartDiff.build, [], 'removing a layer does not rebuild surviving plates');

console.log('three resource retention contract ok');
