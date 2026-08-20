import { strict as assert } from 'node:assert';

import * as THREE from 'three';

import { FoundryThreeObjectPool } from '../components/stages/foundry/foundryThreeObjectPool';
import {
  collectThreeObjectResourceUsage,
  pruneUnusedThreeResourceCache,
} from '../utils/threeResourceKit';
import { scheduleIncrementalTopologyBuild } from '../runtime/render/incrementalTopologyBuild';
import {
  createPartArtMaterial,
  disposePartArtMaterial,
} from '../runtime/render/partArtMaterial';
import { warmPartTopologyPipeline } from '../runtime/render/warmPartTopology';
import { resolveRenderPerformancePolicy } from '../utils/renderPerformancePolicy';

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

console.log('three resource retention contract ok');
