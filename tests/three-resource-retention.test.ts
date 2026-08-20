import { strict as assert } from 'node:assert';

import * as THREE from 'three';

import { FoundryThreeObjectPool } from '../components/stages/foundry/foundryThreeObjectPool';
import {
  collectThreeObjectResourceUsage,
  pruneUnusedThreeResourceCache,
} from '../utils/threeResourceKit';

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

console.log('three resource retention contract ok');
