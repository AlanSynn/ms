import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createDefaultMechanism, createSampleProject } from '../utils/project';
import { fitMechanismToTargetPath } from '../utils/mechanismRecommendations';

const sha256 = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

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

assert.equal(
  sha256(accepted),
  '7404fb0411d9a2ad25a6f8fbbeac96154b10ae2b6bc3fd3ce2501700e9631d3e',
  'rejected four-bar output remains byte-stable after hard physical trace fitting',
);
assert.equal(
  sha256(rejected),
  'ac962d72e51eb1f1add4bceb2d4f2b307f0ea33170d724df76f42e1f5c02486b',
  'short-path four-bar rejection remains byte-stable with b695',
);
assert.equal(accepted.fabricationMetadata?.pathFit?.status, 'rejected', 'four-bar fitting rejects a fabrication-valid candidate that misses hard target tolerance');
assert.equal(accepted.generatedPath, undefined, 'rejected four-bar does not expose a misleading generated target path');
assert(accepted.warnings?.includes('No fabrication-valid path fit.'), 'rejected four-bar exposes a direct fit blocker');
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

console.log('b695 Fit parity contract passed');
