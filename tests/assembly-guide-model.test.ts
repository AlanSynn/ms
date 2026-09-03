import assert from 'node:assert/strict';

import {
  prepareAssemblyGuideModel,
  selectAssemblyGuideStep,
} from '../components/stages/assembly/assemblyGuideModel';
import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';
import { createFabricationPackage } from '../utils/fabrication';
import { assemblyLaneForExportMode } from '../utils/assemblyPlayback';

const project = createFabricationReadyFourBarProject();
const pkg = createFabricationPackage(project);
const prepared = prepareAssemblyGuideModel({
  project,
  pkg,
  selectedRecipeId: project.selectedMechanismId ?? null,
  assemblyMode: 'mechanism',
  lane: assemblyLaneForExportMode(project.settings.physicalKit.exportMode),
});
const first = selectAssemblyGuideStep(prepared, 0);
const second = selectAssemblyGuideStep(prepared, 1);
const staticSteps = prepared.activePlaybackSteps;

assert.equal(
  prepared.buildPlan.sourceDigest,
  pkg.buildPlanSourceDigest,
  'Assembly and the downloadable package use the same BuildPlan source digest',
);

assert(prepared.activePlaybackSteps.length > 1, 'fixture has multiple assembly steps');
assert.notEqual(first.currentStep?.index, second.currentStep?.index, 'step selection advances');
assert.equal(
  prepared.activePlaybackSteps,
  staticSteps,
  'step selection retains the prepared static step list',
);
assert.equal(first.currentStep, staticSteps[0], 'first selection reuses the prepared step');
assert.equal(second.currentStep, staticSteps[1], 'second selection reuses the prepared step');
assert.equal(
  first.activeDisplayStep,
  first.currentStep,
  'mechanism mode selects from the prepared mechanism steps',
);

console.log('assembly guide prepared model contract ok');
