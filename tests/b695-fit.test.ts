import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createDefaultMechanism, createSampleProject } from '../utils/project';
import { clearFourBarFitCache, orderedFourBarPathFit, pathFitPassesHardTolerance } from '../utils/fourBarPathFit';
import { fitMechanismToTargetPath } from '../utils/mechanismRecommendations';
import { assertFourBarFitMechanism } from './fixtures/fourBarFitAssertions';
import { compareFourBarFitRanks, compareFourBarFitScores, retainFourBarFitCandidate, type FourBarFitRank } from '../utils/fourBarFitRanking';

const sha256 = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

// No cache entry from another test may feed this golden contract.
clearFourBarFitCache();

const project = createSampleProject();
const path = project.paths['path-right-arm'];
assert(path, 'sample project supplies the b695 four-bar target path');

const seed = {
  ...createDefaultMechanism('4bar', 'fit-parity'),
  targetPartId: path.partId,
  targetPathId: path.id,
  targetAnchorJointId: path.targetAnchorJointId,
  activeVisualPartIds: [path.partId],
};
const accepted = fitMechanismToTargetPath(project, seed, path.id);

const shortPath = { ...path, id: 'short-fit', points: path.points.slice(0, 2) };
const rejected = fitMechanismToTargetPath(
  { ...project, paths: { ...project.paths, [shortPath.id]: shortPath } },
  { ...seed, id: 'short-seed' },
  shortPath.id,
);

// Stabilizing the 12-candidate cutoff intentionally changes this closest fit
// from runtime-dependent geometry to one golden for the recorded rounding drift.
assertFourBarFitMechanism(accepted, JSON.parse(readFileSync(
  new URL('./fixtures/fourBarClosestFit.json', import.meta.url), 'utf8',
)), 'closest four-bar golden');
assert.equal(
  sha256(rejected),
  'ac962d72e51eb1f1add4bceb2d4f2b307f0ea33170d724df76f42e1f5c02486b',
  'short-path four-bar rejection remains byte-stable with b695',
);
assert.equal(accepted.fabricationMetadata?.pathFit?.status, 'closest', 'four-bar fitting keeps the closest fabrication-valid candidate when hard tolerance is missed');
assert(Array.isArray(accepted.generatedPath) && accepted.generatedPath.length > 8, 'closest four-bar exposes its generated path preview');
assert(accepted.warnings?.includes('No fabrication-valid path fit.'), 'closest four-bar exposes a direct fit blocker');
assert.equal(rejected.targetPathId, 'short-fit', 'short-path rejection keeps the selected target path');
assert.equal(rejected.fabricationMetadata?.pathFit?.status, 'rejected', 'short-path four-bar fitting records an explicit rejection');

const recommendationsSource = readFileSync(
  new URL('../utils/mechanismRecommendations.ts', import.meta.url),
  'utf8',
);
assert.match(
  recommendationsSource,
  /const acceptedFourBarFit = mechanism\.type === "4bar"[\s\S]*?if \(acceptedFourBarFit\) return acceptedFourBarFit;[\s\S]*?const fittedCandidate/,
  'accepted four-bar Fit returns before generic fallback construction',
);

// The cutoff and sort share the full order, including geometry for score ties.
// These are the recorded Bun/Node radial scores; none lies on a bin boundary.
const scores = [16.829463699034438, 16.829463699034445, 16.82946369903445];
const candidates = Array.from({ length: 25 }, (_, index) => ({
  score: scores[index % scores.length], geometryOrder: [index],
}));
const retain = (input: FourBarFitRank[]) => {
  const pool: FourBarFitRank[] = [];
  input.forEach((candidate) => retainFourBarFitCandidate(pool, candidate, 12));
  return pool.map((candidate) => candidate.geometryOrder[0]);
};
const expectedKeys = Array.from({ length: 12 }, (_, index) => index);
for (const input of [candidates, [...candidates].reverse(),
  candidates.filter((_, index) => index % 2).concat(candidates.filter((_, index) => !(index % 2)))]) {
  assert.deepEqual(retain(input), expectedKeys, 'tied pool cutoff is independent of insertion order');
  assert.deepEqual(retain(input.map((candidate, index) => ({
    ...candidate, score: candidate.score + (index % 2 ? 1 : -1) * 4e-15,
  }))), expectedKeys, 'observed rounding perturbations keep the same twelve geometries');
}
const full = candidates.slice(1, 13);
retainFourBarFitCandidate(full, candidates[0], 12);
assert.deepEqual(full.map((candidate) => candidate.geometryOrder[0]), expectedKeys,
  'a better geometry key replaces the last full-pool entry in the same score bin');
assert.equal(compareFourBarFitScores(scores[0], scores[2]), 0, 'recorded radial score drift stays in one bin');
assert.match(readFileSync(new URL('../utils/fourBarPathFit.ts', import.meta.url), 'utf8'),
  /const crankWins = compareFourBarFitScores\(crankDeviation, rockerDeviation\) <= 0/,
  'the radial B/C choice uses the same score bins with B first on ties');
assert.equal(compareFourBarFitScores(scores[0] + 2e-9, scores[0]), 1, 'resolvable score differences retain priority');
assert.equal(compareFourBarFitScores(16.829463699499996, 16.829463699500003), -1,
  'opposite sides of a quantization boundary remain distinct');
for (const score of [NaN, Infinity, -Infinity]) {
  const pool: FourBarFitRank[] = [];
  retainFourBarFitCandidate(pool, { score, geometryOrder: [0] }, 12);
  assert.equal(pool.length, 0, 'nonfinite scores never enter a fit pool');
  assert.equal(compareFourBarFitScores(score, 1), 1);
}
assert.equal(compareFourBarFitScores(Infinity, NaN), 0);
assert.equal(compareFourBarFitScores(Number.MAX_VALUE, Infinity), -1, 'large finite scores do not overflow to an invalid rank');
for (const coordinate of [NaN, Infinity, -Infinity]) {
  const pool: FourBarFitRank[] = [];
  retainFourBarFitCandidate(pool, { score: 1, geometryOrder: [coordinate] }, 12);
  assert.equal(pool.length, 0, 'nonfinite geometry keys never enter a fit pool');
}
assert.equal(compareFourBarFitRanks(
  { score: 1, geometryOrder: [0, 1] }, { score: 1, geometryOrder: [0, 2] },
), -1, 'later authored geometry fields resolve ties lexicographically');
assert.equal(compareFourBarFitRanks(
  { score: 1, geometryOrder: [0] }, { score: 1, geometryOrder: [0, 1] },
), -1, 'a geometry prefix has a defined total order');
const mixedRanks = candidates.slice(0, 6).concat(candidates.slice(0, 6).map((candidate, index) => ({
  score: scores[0] + (index + 1) * 2e-9, geometryOrder: [5 - index],
})));
for (const a of mixedRanks) for (const b of mixedRanks) for (const c of mixedRanks) {
  if (compareFourBarFitRanks(a, b) <= 0 && compareFourBarFitRanks(b, c) <= 0) {
    assert(compareFourBarFitRanks(a, c) <= 0, 'ranking remains transitive');
  }
}

// Every phase/direction of this symmetric trace has the same score. Slight
// hypot perturbations must retain the canonical first phase and forward turn.
const symmetricTrace = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
const symmetricTarget = symmetricTrace.map(() => ({ x: 0, y: 0 }));
const originalHypot = Math.hypot;
for (const perturb of [false, true]) {
  let calls = 0;
  try {
    if (perturb) Math.hypot = (...values) => {
      const value = originalHypot(...values);
      return value === 0 ? value : value + (++calls % 7) * 1e-12;
    };
    const fit = orderedFourBarPathFit(symmetricTrace, symmetricTarget, 4, 'closed');
    assert.equal(fit.phaseOffset, 0, 'equal-bin phase scores retain the first phase');
    assert.equal(fit.direction, 1, 'equal-bin direction scores retain the forward turn');
    fit.points.forEach((point, index) => {
      assert(Math.abs(point.x - symmetricTrace[index].x) < 1e-10);
      assert(Math.abs(point.y - symmetricTrace[index].y) < 1e-10);
    });
  } finally {
    Math.hypot = originalHypot;
  }
}
const atTolerance = { error: 30, maxError: 30, tangentError: 0, maxTangentError: 0 };
assert(pathFitPassesHardTolerance(atTolerance, 30));
assert.equal(compareFourBarFitScores(30, 30 + 1e-10), 0);
assert.equal(pathFitPassesHardTolerance({ ...atTolerance, error: 30 + 1e-10 }, 30), false,
  'a ranking tie never relaxes the raw physical error boundary');
assert.equal(pathFitPassesHardTolerance({ ...atTolerance, maxError: 30 + 1e-10 }, 30), false,
  'a ranking tie never relaxes the raw physical maximum error boundary');

console.log('b695 Fit parity contract passed');
