import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDefaultMechanism, createEmptyProject, createSampleProject } from '../utils/project';
import { ALL_MECHANISM_TYPES } from '../utils/mechanismTemplates';
import { mechanismBoardPlacementIssues, validateForFabrication, validateMechanismPreviewReadiness } from '../utils/fabrication';
import * as validation from '../utils/fabricationValidation';

const sample = createSampleProject();
const emptyValidation = validateForFabrication(createEmptyProject());
const cases = ALL_MECHANISM_TYPES.flatMap(type => [false, true].map(invalid => {
  const mechanism = createDefaultMechanism(type, `golden-${type}`);
  if (invalid) {
    mechanism.anchorX = 9999;
    mechanism.groundLength = 1;
    mechanism.crankLength = Number.NaN;
  }
  const project = { ...sample, mechanisms: [mechanism] };
  return {
    type, invalid,
    preview: validateMechanismPreviewReadiness(mechanism),
    placement: mechanismBoardPlacementIssues(project, mechanism),
    project: validateForFabrication(project),
  };
}));
const hash = createHash('sha256').update(JSON.stringify({ emptyValidation, cases })).digest('hex');
assert.equal(hash, 'a8e5d5adcbdbbcbf5bf2feedb5520452703955f8cd6eef060578e624d1282f07',
  'all mechanism and project validation outputs match the pre-extraction baseline');
assert.equal(validateForFabrication, validation.validateForFabrication);
assert.equal(validateMechanismPreviewReadiness, validation.validateMechanismPreviewReadiness);
assert.equal(mechanismBoardPlacementIssues, validation.mechanismBoardPlacementIssues);
console.log('fabrication validation extraction preserves all mechanism and project results');
