import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';

import {
  clearFourBarFitCache,
  fitFourBarKitMechanismToPath,
  fourBarFitCacheEntryCount,
} from '../utils/fourBarPathFit';
import { createDefaultMechanism, createSampleProject } from '../utils/project';
import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

clearFourBarFitCache();
const acceptedProject = createFabricationReadyFourBarProject();
assert.equal(
  hash(acceptedProject.mechanisms[0]),
  'b33e88832ba03bdacfee35cde070aefb083e62872c77b69cbff030bdcb65dcc0',
  'radial pruning preserves the accepted fabrication-fit mechanism byte-for-byte',
);

const project = createSampleProject();
const sourcePath = project.paths['path-right-arm'];
assert(sourcePath);
const mechanism = createDefaultMechanism('4bar', 'bounded-fit-cache');
for (let index = 0; index < 48; index += 1) {
  const path = {
    ...sourcePath,
    id: `short-cache-path-${index}`,
    points: sourcePath.points.slice(0, 2),
  };
  fitFourBarKitMechanismToPath(project, mechanism, path);
}
assert.equal(
  fourBarFitCacheEntryCount(),
  32,
  'repeated path edits retain only the most recent bounded fit inputs',
);
clearFourBarFitCache();
assert.equal(fourBarFitCacheEntryCount(), 0);

console.log('four-bar fit pruning and retention contract ok');
