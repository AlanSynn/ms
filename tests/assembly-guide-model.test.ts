import assert from 'node:assert/strict';

import {
  prepareAssemblyGuideModel,
  selectAssemblyGuideStep,
} from '../components/stages/assembly/assemblyGuideModel';
import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';
import { createFabricationPackage } from '../utils/fabrication';
import { assemblyLaneForExportMode } from '../utils/assemblyPlayback';
import { createEmptyProject } from '../utils/project';
import { createDrawableObject } from '../utils/artworkTargets';
import { buildCharacterAssemblySceneFrame } from '../utils/assemblySceneFrame';

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

const objectOnly = createEmptyProject();
const object = createDrawableObject('standalone-cutout');
objectOnly.sceneObjects[object.id] = object;
objectOnly.sceneObjectOrder = [object.id];
const objectBefore = JSON.stringify(objectOnly);
const localAssembly = prepareAssemblyGuideModel({
  project: objectOnly, selectedRecipeId: null, assemblyMode: 'mechanism',
  lane: assemblyLaneForExportMode(objectOnly.settings.physicalKit.exportMode),
});
assert.equal(localAssembly.hasCharacterAssembly, true, 'the shared local-piece lane accepts an object-only scene');
assert.equal(localAssembly.activeAssemblyMode, 'character', 'without a mechanism the existing local-parts renderer is selected');
assert.equal(localAssembly.selectedRecipe, undefined);
assert.deepEqual(localAssembly.buildPlan.character.parts, []);
assert.deepEqual(localAssembly.characterAssemblyPlan.fixedPins, []);
assert.deepEqual(localAssembly.characterAssemblyPlan.freePivots, []);
assert.deepEqual(localAssembly.characterAssemblyPlan.parts.map(part => part.id), [object.id]);
assert.deepEqual(localAssembly.characterPlaybackSteps.map(step => step.phase), ['cut-object', 'place-object']);
for (const [index, step] of localAssembly.characterPlaybackSteps.entries()) {
  assert.equal(selectAssemblyGuideStep(localAssembly, index).activeDisplayStep, step);
  assert.deepEqual(step.pinIds, []);
  const frame = buildCharacterAssemblySceneFrame({
    plan: localAssembly.characterAssemblyPlan, step, kit: objectOnly.settings.physicalKit, progress: .5,
  });
  assert.equal(frame.boardMode, 'hidden');
  assert.deepEqual(frame.activePartIds, [object.id]);
  assert.deepEqual(frame.activeBoardCoords, []);
}
assert.equal(JSON.stringify(objectOnly), objectBefore, 'assembly invents no body rig, mechanism, or hardware');

console.log('assembly guide prepared model contract ok');
