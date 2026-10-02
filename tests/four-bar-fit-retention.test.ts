import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

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
import type { MechanismOutputBinding, ProjectMotionPath } from '../types';
import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';
import { assertFourBarFitMechanism, FOUR_BAR_GOLDEN_EPSILON } from './fixtures/fourBarFitAssertions';

clearFourBarFitCache();
const acceptedProject = createFabricationReadyFourBarProject();
// This complete mechanism is captured before the ranking fix (b5998cd).
// Keep geometry, bindings, phase, keys and trace order exact; tolerate only
// measured numeric drift in trace coordinates and diagnostic errors.
const fabricationGolden = JSON.parse(readFileSync(
  new URL('./fixtures/fourBarFabricationFit.json', import.meta.url), 'utf8',
));
assertFourBarFitMechanism(acceptedProject.mechanisms[0], fabricationGolden, 'accepted fabrication fit golden');

// Exercise the assertion itself: rounding noise must pass, while geometry,
// missing trace points, changed topology and nonfinite diagnostics must fail.
const goldenMutation = (change: (copy: typeof fabricationGolden) => void) => {
  const copy = structuredClone(fabricationGolden);
  change(copy);
  return copy;
};
assertFourBarFitMechanism(goldenMutation((copy) => {
  copy.generatedPath[1].x += FOUR_BAR_GOLDEN_EPSILON / 2;
  copy.fabricationMetadata.pathFit.tangentError += FOUR_BAR_GOLDEN_EPSILON / 2;
}), fabricationGolden, 'continuous rounding noise');
const forbiddenMutations = [
  (copy: typeof fabricationGolden) => { copy.generatedPath[1].x += FOUR_BAR_GOLDEN_EPSILON * 2; },
  (copy: typeof fabricationGolden) => { copy.fabricationMetadata.pathFit.maxError += FOUR_BAR_GOLDEN_EPSILON * 2; },
  (copy: typeof fabricationGolden) => { copy.generatedPath[1].y = NaN; },
  (copy: typeof fabricationGolden) => { copy.fabricationMetadata.pathFit.error = Infinity; },
  (copy: typeof fabricationGolden) => { copy.generatedPath.pop(); },
  (copy: typeof fabricationGolden) => { copy.generatedPath.reverse(); },
  (copy: typeof fabricationGolden) => { delete copy.fabricationMetadata.pathFit.direction; },
  (copy: typeof fabricationGolden) => { copy.outputs = []; },
  (copy: typeof fabricationGolden) => { copy.crankLength += FOUR_BAR_GOLDEN_EPSILON / 2; },
  (copy: typeof fabricationGolden) => { copy.anchorX += FOUR_BAR_GOLDEN_EPSILON / 2; },
  (copy: typeof fabricationGolden) => { copy.transform.rotation += FOUR_BAR_GOLDEN_EPSILON / 2; },
  (copy: typeof fabricationGolden) => { copy.sceneAnchor.y += FOUR_BAR_GOLDEN_EPSILON / 2; },
  (copy: typeof fabricationGolden) => { copy.fabricationMetadata.gridPitchMm += FOUR_BAR_GOLDEN_EPSILON / 2; },
  (copy: typeof fabricationGolden) => { copy.fabricationMetadata.pathFit.tolerance += FOUR_BAR_GOLDEN_EPSILON / 2; },
  (copy: typeof fabricationGolden) => { copy.fabricationMetadata.pathFit.phaseOffset += FOUR_BAR_GOLDEN_EPSILON / 2; },
  (copy: typeof fabricationGolden) => { copy.fabricationMetadata.pathFit.direction = -1; },
  (copy: typeof fabricationGolden) => { copy.fabricationMetadata.pathFit.outputTraceId = 'B'; },
  (copy: typeof fabricationGolden) => { copy.fabricationMetadata.pathFit.status = 'closest'; },
];
for (const change of forbiddenMutations) {
  assert.throws(() => assertFourBarFitMechanism(
    goldenMutation(change), fabricationGolden, 'intentional contract violation',
  ), 'the complete golden rejects changes outside its numeric allowance');
}

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
const assertSynchronizedOutput = (
  mechanism: typeof refreshedAccepted, requestedPath: ProjectMotionPath,
  priorBinding: MechanismOutputBinding,
) => {
  const fit = mechanism.fabricationMetadata?.pathFit;
  const output = mechanism.outputs?.[0];
  assert(fit && output?.fit, 'refit retains explicit output fit metadata');
  assert.deepEqual(output.fit, fit, 'binding and mechanism keep all fit fields synchronized');
  assert.equal(output.id, priorBinding.id, 'refit preserves the binding identity');
  assert.equal(output.enabled, true);
  assert.equal(output.pathId, requestedPath.id);
  assert.equal(mechanism.targetPathId, requestedPath.id);
  assert.equal(output.targetPartId, requestedPath.partId);
  assert.equal(output.targetAnchorJointId, requestedPath.targetAnchorJointId);
  assert.equal(output.portId, fit.outputTraceId);
  assert.equal(output.outputTraceId, fit.outputTraceId);
  assert.equal(output.phaseOffset, fit.phaseOffset);
  assert.equal(output.direction, fit.direction);
};
assertSynchronizedOutput(refreshedAccepted, acceptedPath, staleAcceptedBinding);

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
assertSynchronizedOutput(refreshedRejected, rejectedPath, staleRejectedBinding);

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
