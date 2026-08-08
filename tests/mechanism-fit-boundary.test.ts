import assert from 'node:assert/strict';
import type { MechanismConfig } from '../types';
import {
  completeAutomaticFitCandidate,
  FOUR_BAR_FIT_VALIDATION_LIMIT,
  fitFourBarKitMechanismToPathResult,
} from '../utils/fourBarPathFit';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import { mechanismUsesExactFabricationCombination } from '../utils/mechanismFabricationCombinations';
import { pathOwnedTargetFields } from '../utils/pathTargets';
import { createSampleProject } from '../utils/project';

const project = createSampleProject();
project.mechanisms = [];
const path = project.paths['path-right-arm'];
assert(path, 'the fit boundary fixture has a target path');

const seed: MechanismConfig = {
  ...createDefaultMechanism('4bar', 'bounded-fit'),
  ...pathOwnedTargetFields(path),
};

const runFit = () => {
  let validationCount = 0;
  const result = fitFourBarKitMechanismToPathResult(
    project,
    seed,
    path,
    {
      validateCandidate: (candidateProject, prior, candidate) => {
        validationCount += 1;
        return completeAutomaticFitCandidate(candidateProject, prior, candidate);
      },
    },
  );
  return { result, validationCount };
};

const first = runFit();
const second = runFit();

assert.equal(first.result.accepted, true, 'bounded Fit accepts a four-bar candidate');
assert.equal(
  mechanismUsesExactFabricationCombination(first.result.mechanism, project.settings.physicalKit),
  true,
  'bounded Fit returns an exact fabrication combination',
);
assert(first.validationCount > 0, 'bounded Fit performs authoritative validation');
assert(
  first.validationCount <= FOUR_BAR_FIT_VALIDATION_LIMIT,
  `bounded Fit validates no more than ${FOUR_BAR_FIT_VALIDATION_LIMIT} candidates`,
);
assert.deepEqual(second.result, first.result, 'bounded Fit remains deterministic across repeated runs');
assert.equal(
  second.validationCount,
  first.validationCount,
  'bounded Fit repeats the same bounded validation work',
);

console.log('mechanism Fit boundary contracts passed');
