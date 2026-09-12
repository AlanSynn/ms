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
  // Recomputed after explicit closed target tangents: the i/count resample,
  // phase/geometry/output trace, and 96-point generated trace remain
  // unchanged; tangent RMS/max changes 19.7923/90.0251 -> 7.2569/35.3532.
  'f31926408c6c6aea20516127dbff326bbaff2e12d70084b41846f52e9d8b2df5',
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
// path-right-arm on the sample project has a fabrication-valid closest match,
// so the stale binding no longer vetoes the recommendation: the refit reports
// 'closest' (never a fabricated 'fit') and syncs the binding to that label.
assert.equal(
  refreshedRejected.fabricationMetadata?.pathFit?.status,
  'closest',
  'a stale binding does not hide an available closest recommendation',
);
assert.equal(
  refreshedRejected.outputs?.[0]?.fit?.status,
  'closest',
  'the refit synchronizes the stale output binding to the fresh fit label',
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
