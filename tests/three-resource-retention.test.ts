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
  disposeThreeObjectGraph,
  pruneUnusedThreeResourceCache,
} from '../utils/threeResourceKit';
import { scheduleIncrementalTopologyBuild } from '../runtime/render/incrementalTopologyBuild';
import {
  createPuppetCutHoleRingInstances,
  createPuppetJointHardwareInstances,
  puppetJointIdForInstance,
  updatePuppetJointHardwareInstances,
} from '../runtime/render/puppetJointHardware';
import {
  createPartArtMaterial,
  disposePartArtMaterial,
} from '../runtime/render/partArtMaterial';
import { warmPartTopologyPipeline } from '../runtime/render/warmPartTopology';
import { resolveRenderPerformancePolicy } from '../utils/renderPerformancePolicy';
import {
  diffPuppetPartTopologies,
  preparePuppetPartTopology,
} from '../runtime/render/puppetPartTopology';
import type { BodyPartLayer, StandardSkeleton } from '../types';
import { defaultPhysicalKit } from '../utils/coordinates';
import { createDefaultMechanism } from '../utils/project';

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
let bitmapCloses = 0;
bitmapLoad?.({ close: () => { bitmapCloses += 1; } } as ImageBitmap);
assert.equal(artLoads, 1, 'part artwork reports readiness after asynchronous bitmap decode');
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
