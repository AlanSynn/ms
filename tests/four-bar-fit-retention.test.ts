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
  createHash('sha256').update(JSON.stringify(value, (_key, item) =>
    typeof item === 'number' && Number.isFinite(item)
      ? Number(item.toFixed(12))
      : item
  )).digest('hex');

clearFourBarFitCache();
const acceptedProject = createFabricationReadyFourBarProject();
assert.equal(
  hash(acceptedProject.mechanisms[0]),
  '645b94868d10409da5f7fe75f2bf9457ac6bb0e53c6c8f28a8c0f9f3be48ac7a',
  'radial pruning preserves the accepted fabrication-fit mechanism after platform-stable float normalization',
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
