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
  'b648398934a2d10f5dc9365b7a875b16a5de67ce7fb00b6a07fd20b7280bae70',
  'accepted four-bar output remains byte-stable with b695',
);
assert.equal(
  sha256(rejected),
  '7623c31343c0c4bbec3f55626c401fc076a80f0ece65e7c3f28d260bb8788ebd',
  'rejected four-bar output remains byte-stable with b695',
);
assert.equal(accepted.warnings?.length, 0, 'accepted four-bar keeps b695 warning status');
assert.equal(rejected.targetPathId, 'path-right-arm', 'short-path fallback keeps the prior target path');

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
