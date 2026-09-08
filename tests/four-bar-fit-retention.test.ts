import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';

import {
  clearFourBarFitCache,
  fitFourBarKitMechanismToPath,
  fourBarFitCacheEntryCount,
} from '../utils/fourBarPathFit';
import {
  mechanismBindingForPath,
  mechanismWithOutputBindings,
} from '../utils/mechanismBindings';
import { fitMechanismToTargetPath } from '../utils/mechanismRecommendations';
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

const acceptedPath = acceptedProject.paths['fabrication-fit-path'];
const acceptedMechanism = acceptedProject.mechanisms[0];
assert(acceptedPath && acceptedMechanism, 'accepted fixture provides a path-bound mechanism');
const staleAcceptedFit = {
  status: 'unfitted' as const,
  targetPathId: acceptedPath.id,
  outputTraceId: 'C',
};
const staleAcceptedBinding = mechanismBindingForPath(
  acceptedProject,
  acceptedMechanism,
  acceptedPath.id,
  { fit: staleAcceptedFit },
);
assert(staleAcceptedBinding, 'accepted fixture can create an explicit output binding');
const staleAcceptedMechanism = mechanismWithOutputBindings(
  acceptedMechanism,
  [{ ...staleAcceptedBinding, fit: staleAcceptedFit }],
);
assert.equal(staleAcceptedMechanism.outputs?.[0]?.fit?.status, 'unfitted');
clearFourBarFitCache();
const refreshedAccepted = fitMechanismToTargetPath(
  acceptedProject,
  staleAcceptedMechanism,
  acceptedPath.id,
);
assert.equal(
  refreshedAccepted.fabricationMetadata?.pathFit?.status,
  'fit',
  'a fresh accepted fit remains accepted after an output was invalidated',
);
assert.equal(
  refreshedAccepted.outputs?.[0]?.fit?.status,
  'fit',
  'an accepted fit synchronizes the selected output binding metadata',
);

const rejectedProject = createSampleProject();
const rejectedPath = rejectedProject.paths['path-right-arm'];
assert(rejectedPath, 'sample fixture provides the rejected target path');
const rejectedSeed = {
  ...createDefaultMechanism('4bar', 'stale-rejected-output-fit'),
  targetPartId: rejectedPath.partId,
  targetPathId: rejectedPath.id,
  targetAnchorJointId: rejectedPath.targetAnchorJointId,
};
const staleRejectedFit = {
  status: 'unfitted' as const,
  targetPathId: rejectedPath.id,
  outputTraceId: 'C',
};
const staleRejectedBinding = mechanismBindingForPath(
  rejectedProject,
  rejectedSeed,
  rejectedPath.id,
  { fit: staleRejectedFit },
);
assert(staleRejectedBinding, 'rejected fixture can create an explicit output binding');
const staleRejectedMechanism = mechanismWithOutputBindings(
  rejectedSeed,
  [{ ...staleRejectedBinding, fit: staleRejectedFit }],
);
const refreshedRejected = fitMechanismToTargetPath(
  rejectedProject,
  staleRejectedMechanism,
  rejectedPath.id,
);
assert.equal(
  refreshedRejected.fabricationMetadata?.pathFit?.status,
  'rejected',
  'a fresh rejected fit remains rejected after an output was invalidated',
);
assert.equal(
  refreshedRejected.outputs?.[0]?.fit?.status,
  'rejected',
  'a rejected fit synchronizes the selected output binding metadata',
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
