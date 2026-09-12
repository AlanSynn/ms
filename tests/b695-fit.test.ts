import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createDefaultMechanism, createSampleProject } from '../utils/project';
import { clearFourBarFitCache } from '../utils/fourBarPathFit';
import { fitMechanismToTargetPath } from '../utils/mechanismRecommendations';

const sha256 = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Hash pins must be order-independent: no cache entry from another test file
// may feed this contract when files run in one process.
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

assert.equal(
  sha256(accepted),
  'ba1e7a2e21e626eda76d821d0255b9f36cbce3b47fdc92c94be5d7160f0eccdc',
  'closest four-bar output remains byte-stable after hard physical trace fitting',
);
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

console.log('b695 Fit parity contract passed');
