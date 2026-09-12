import assert from 'node:assert/strict';

import { clearFourBarFitCache, fitFourBarKitMechanismToPath } from '../utils/fourBarPathFit';
import { SCENE_PX_PER_MM } from '../utils/coordinates';
import { createDefaultMechanism, createSampleProject } from '../utils/project';
import { fitMechanismToTargetPath } from '../utils/mechanismRecommendations';
import { motionPathReadiness } from '../utils/motion';

// Nonsense, degenerate, and physically impossible path inputs must never
// crash the fitter, never leak NaN/Infinity, never escape the board, never
// claim a fabricated exact fit, and stay deterministic. The app-facing
// entry (fitMechanismToTargetPath) additionally gates unready paths before
// the fitter runs; the raw fitter is probed directly as defense-in-depth.
clearFourBarFitCache();
const project = createSampleProject();
const base = project.paths['path-right-arm'];
assert(base, 'sample project supplies the right-arm target path');

const boardHalfSpan =
  ((project.settings.physicalKit.boardCells - 1) / 2) *
  project.settings.physicalKit.gridPitchMm *
  SCENE_PX_PER_MM;
const boardSweep = boardHalfSpan * Math.SQRT2;

const circle = (radius: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    x: radius * Math.cos((index / count) * 2 * Math.PI),
    y: radius * Math.sin((index / count) * 2 * Math.PI),
  }));

const CASES: Array<{ name: string; points: Array<{ x: number; y: number }>; followable?: boolean }> = [
  { name: 'single point', points: [{ x: 0, y: 0 }] },
  { name: 'two points', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], followable: true },
  { name: 'zero-length', points: Array.from({ length: 8 }, () => ({ x: 50, y: 30 })), followable: true },
  { name: 'straight line', points: Array.from({ length: 12 }, (_, index) => ({ x: -200 + index * 36.36, y: 0 })), followable: true },
  { name: 'circle', points: circle(40, 24), followable: true },
  { name: 'figure-8', points: Array.from({ length: 32 }, (_, index) => ({ x: 60 * Math.sin((index / 32) * 2 * Math.PI), y: 40 * Math.sin((index / 32) * 4 * Math.PI) })), followable: true },
  { name: 'sub-pixel', points: Array.from({ length: 10 }, (_, index) => ({ x: index * 1e-4, y: (index % 2) * 1e-4 })), followable: true },
  { name: 'nan point', points: [{ x: 0, y: 0 }, { x: NaN, y: 50 }, { x: 100, y: 0 }], followable: true },
  { name: 'infinity point', points: [{ x: 0, y: 0 }, { x: Infinity, y: 50 }, { x: 100, y: 0 }] },
  { name: 'huge coords', points: [{ x: 0, y: 0 }, { x: 1e9, y: 5e8 }, { x: 2e9, y: 0 }] },
  { name: 'deep negative', points: [{ x: -1e6, y: -1e6 }, { x: -1e6 + 50, y: -1e6 }] },
  { name: '5000-point noise', points: Array.from({ length: 5000 }, (_, index) => ({ x: Math.sin(index * 12.9898) * 150, y: Math.cos(index * 78.233) * 150 })), followable: true },
];

for (const testCase of CASES) {
  const id = `adversarial-${testCase.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  const path = { ...base!, id, points: testCase.points };
  const isolated = { ...project, paths: { [id]: path } };
  const seed = {
    ...createDefaultMechanism('4bar', id),
    targetPartId: path.partId,
    targetPathId: id,
    targetAnchorJointId: path.targetAnchorJointId,
    activeVisualPartIds: [path.partId],
  };

  // App-facing fit: never throws; unready paths are rejected before fitting.
  const readiness = motionPathReadiness(isolated, path);
  let appFit: ReturnType<typeof fitMechanismToTargetPath>;
  assert.doesNotThrow(() => {
    appFit = fitMechanismToTargetPath(isolated, seed, id);
  }, `${testCase.name}: app-facing fit must not throw`);
  if (!readiness.playable) {
    assert.equal(
      appFit!.fabricationMetadata?.pathFit?.status,
      'rejected',
      `${testCase.name}: unready path is rejected without fitting`,
    );
  }

  // Raw fitter (readiness bypassed): outcome must be a recommendation or a
  // bare rejection — never a fabricated exact fit — with sane geometry.
  clearFourBarFitCache();
  let candidate: ReturnType<typeof fitFourBarKitMechanismToPath>;
  assert.doesNotThrow(() => {
    candidate = fitFourBarKitMechanismToPath(isolated, seed, path);
  }, `${testCase.name}: raw fitter must not throw`);
  if (!candidate) continue; // full rejection: every candidate pruned
  const pathFit = candidate.fabricationMetadata?.pathFit;
  assert.notEqual(pathFit?.status, 'fit', `${testCase.name}: nonsense input must not claim an exact fit`);
  assert.notEqual(pathFit?.status, undefined, `${testCase.name}: partial outcome is labeled closest`);
  assert.equal(pathFit?.status, 'closest', `${testCase.name}: partial outcome is labeled closest`);
  assert(Number.isFinite(pathFit?.error), `${testCase.name}: closest reports a finite error`);
  const anchorX = candidate.anchorX ?? 0;
  const anchorY = candidate.anchorY ?? 0;
  assert(
    Math.abs(anchorX) <= boardHalfSpan + 1e-6 && Math.abs(anchorY) <= boardHalfSpan + 1e-6,
    `${testCase.name}: anchor stays on the board`,
  );
  assert(
    (candidate.generatedPath ?? []).every(
      (point) =>
        Number.isFinite(point.x) && Number.isFinite(point.y) &&
        Math.abs(point.x) <= boardSweep + 1e-6 && Math.abs(point.y) <= boardSweep + 1e-6,
    ),
    `${testCase.name}: generated path stays finite and on the board`,
  );
  clearFourBarFitCache();
  const again = fitFourBarKitMechanismToPath(isolated, seed, path);
  assert.equal(
    again?.fabricationMetadata?.pathFit?.error,
    pathFit?.error,
    `${testCase.name}: refit is deterministic`,
  );
}

// Hostile mechanism geometry against a followable path: no throw, sane labels.
const normalPath = project.paths['path-right-arm']!;
for (const patch of [
  { couplerPointDist: 1e6 },
  { couplerPointDist: -50 },
  { anchorX: 1e7, anchorY: -1e7 },
  { groundAngle: 1e9 },
]) {
  clearFourBarFitCache();
  const seed = {
    ...createDefaultMechanism('4bar', 'adversarial-mechanism'),
    targetPartId: normalPath.partId,
    targetPathId: normalPath.id,
    targetAnchorJointId: normalPath.targetAnchorJointId,
    ...patch,
  };
  let result: ReturnType<typeof fitMechanismToTargetPath>;
  assert.doesNotThrow(() => {
    result = fitMechanismToTargetPath(project, seed, normalPath.id);
  }, `mechanism patch ${JSON.stringify(patch)}: fit must not throw`);
  const status = result!.fabricationMetadata?.pathFit?.status;
  assert(
    status === 'rejected' || status === 'closest' || status === 'fit',
    `mechanism patch ${JSON.stringify(patch)}: status is a valid outcome`,
  );
}

console.log('adversarial path-fit contract passed');
