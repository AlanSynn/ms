import assert from 'node:assert/strict';

import { prepareAssemblyGuideModel } from '../components/stages/assembly/assemblyGuideModel';
import {
    BUILD_PLAN_SCHEMA_V1,
    buildPlanSectionSteps,
    createBuildPlanV1,
    createCharacterBuildPlanV1
} from '../utils/buildPlan';
import { makeAssemblyGuideHtml, makeAssemblyGuidePdf } from '../utils/fabricationAssemblyGuide';
import { makeBuildPacketPdfFromBuildPlan } from '../utils/fabricationBuildPacketPdf';
import { makeCharacterTemplatePdfFromBuildPlan } from '../utils/fabricationCustomParts';
import { makeCutSheetPdf } from '../utils/fabricationCutSheetPdf';
import { makeSimplePdf } from '../utils/simplePdf';
import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';

const project = createFabricationReadyFourBarProject();
const firstPlan = createBuildPlanV1(project);
const secondPlan = createBuildPlanV1(project);

assert.equal(firstPlan.schema, BUILD_PLAN_SCHEMA_V1);
assert.equal(JSON.stringify(firstPlan), JSON.stringify(secondPlan), 'build plan is deterministic');
assert.equal(firstPlan.mechanisms.length, 1, 'enabled mechanism is represented');
assert(firstPlan.character.parts.length > 0, 'character assembly is represented');
assert(firstPlan.character.stepIds.length > 0, 'character steps have stable references');
assert(firstPlan.mechanisms[0].stepIds.every(id => id.startsWith(firstPlan.mechanisms[0].ref)), 'mechanism step refs are namespaced');
assert(firstPlan.mechanisms[0].partRefs.every(ref => firstPlan.parts.some(part => part.ref === ref)), 'mechanism part refs resolve');

const changedPlan = createBuildPlanV1({
    ...project,
    mechanisms: project.mechanisms.map((mechanism, index) => index === 0
        ? { ...mechanism, crankLength: mechanism.crankLength + 1 }
        : mechanism)
});
assert.notEqual(changedPlan.sourceDigest, firstPlan.sourceDigest, 'build-relevant source changes update the digest');

const characterOnly = createCharacterBuildPlanV1({
    ...project,
    mechanisms: project.mechanisms.map(mechanism => ({ ...mechanism, anchorX: undefined, anchorY: undefined }))
});
assert.equal(characterOnly.scope, 'character');
assert.equal(characterOnly.mechanisms.length, 0, 'character-only generation skips invalid mechanisms');
assert(characterOnly.character.stepIds.length > 0, 'character-only plan retains assembly steps');

const prepared = prepareAssemblyGuideModel({
    project,
    selectedRecipeId: project.selectedMechanismId ?? null,
    assemblyMode: 'mechanism',
    lane: 'kit'
});
assert.deepEqual(
    prepared.activePlaybackSteps.map(step => ({ index: step.index, label: step.label, instruction: step.instruction })),
    prepared.activeBuildSteps.map(step => ({ index: step.index, label: step.label, instruction: step.instruction })),
    'on-screen playback adapts the canonical semantic steps'
);

const manyMechanisms = Array.from({ length: 15 }, (_, index) => ({
    ...project.mechanisms[0],
    id: `classroom-mechanism-${String(index + 1).padStart(2, '0')}`
}));
const manyProject = {
    ...project,
    mechanisms: manyMechanisms,
    selectedMechanismId: manyMechanisms[0].id
};
const manyPlan = createBuildPlanV1(manyProject);
const manyRecipes = manyPlan.mechanisms.map(mechanism => mechanism.recipe);
const lastMechanismId = manyMechanisms[manyMechanisms.length - 1].id;
assert.equal(manyPlan.mechanisms.length, manyMechanisms.length, 'all enabled mechanisms are retained');
assert.equal(
    manyPlan.steps.length,
    buildPlanSectionSteps(manyPlan, 'character').length + manyPlan.mechanisms.reduce(
        (count, mechanism) => count + buildPlanSectionSteps(manyPlan, mechanism.sectionId).length,
        0
    ),
    'the global semantic sequence contains every section step exactly once'
);

const assemblyHtml = makeAssemblyGuideHtml(manyProject, manyRecipes, []);
const assemblyPdf = makeAssemblyGuidePdf(manyProject, manyRecipes, []);
const cutSheetPdf = makeCutSheetPdf(manyProject, manyRecipes);
const sourceFingerprint = 'classroom-source-fingerprint';
const characterTemplatePdf = makeCharacterTemplatePdfFromBuildPlan(characterOnly, sourceFingerprint);
const buildPacketPdf = makeBuildPacketPdfFromBuildPlan(manyPlan, createCharacterBuildPlanV1(manyProject), sourceFingerprint);
assert(assemblyHtml.includes('Character assembly'), 'assembly HTML includes character assembly');
assert(assemblyHtml.includes(lastMechanismId), 'assembly HTML includes the last mechanism');
assert(assemblyPdf.includes(lastMechanismId), 'assembly PDF includes the last mechanism');
assert(cutSheetPdf.includes(lastMechanismId), 'cut-sheet PDF includes the last mechanism');
assert(characterTemplatePdf.includes(characterOnly.sourceDigest), 'character template carries its character BuildPlan digest');
assert(characterTemplatePdf.includes(sourceFingerprint), 'character template carries its project fingerprint');
assert(buildPacketPdf.includes(manyPlan.sourceDigest), 'legacy packet alias carries its canonical BuildPlan digest');
assert(!buildPacketPdf.includes(sourceFingerprint), 'Blueprint PDF excludes unrelated project transport metadata');
assert(buildPacketPdf.includes(lastMechanismId), 'Blueprint PDF contains every mechanism');
assert(manyPlan.character.parts.every(part => !buildPacketPdf.includes(part.ref)), 'Blueprint PDF excludes character cut-sheet parts');
assert(manyPlan.steps.every(step => !buildPacketPdf.includes(step.id)), 'Blueprint PDF excludes the verbose ordered tutorial');

const longPdf = makeSimplePdf(
    'Pagination contract',
    Array.from({ length: 100 }, (_, index) => `Line ${index + 1} marker-${index + 1}`)
);
assert(longPdf.includes('marker-100'), 'simple PDF does not truncate after 46 lines');
assert.match(longPdf, /\/Count [3-9]/, 'long simple PDF contains multiple pages');
const assemblyPdfPageCount = Number(assemblyPdf.match(/\/Count (\d+)/)?.[1] ?? 0);
const cutSheetPdfPageCount = Number(cutSheetPdf.match(/\/Count (\d+)/)?.[1] ?? 0);
assert(assemblyPdfPageCount >= 2, 'large assembly guide is multi-page');
assert(cutSheetPdfPageCount === manyPlan.mechanisms.length, 'each mechanism uses one native-size Blueprint sheet');
const buildPacketPageCount = Number(buildPacketPdf.match(/\/Count (\d+)/)?.[1] ?? 0);
assert(buildPacketPageCount === cutSheetPdfPageCount, 'legacy packet alias is the same minimal Blueprint PDF');

console.log('canonical build plan and native-size PDF contracts ok');

// Canonical Blueprint geometry and true-scale print regression.
import { createDefaultMechanism as createBlueprintMechanism, createSampleProject as createBlueprintProject } from '../utils/project';
import { createBuildPlanV1 as createBlueprintPlan } from '../utils/buildPlan';
import { blueprintTilesForBuildPlan, makeBlueprintPdfFromBuildPlan } from '../utils/fabricationBlueprintPdf';
import { buildCharacterPrintLayout as buildBlueprintCharacterLayout } from '../utils/fabricationCharacterPrintLayout';
import { PDF_POINTS_PER_MM as blueprintPointsPerMm } from '../utils/simplePdf';

const blueprintAssert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
};
const blueprintBase = createBlueprintProject({ includeMechanism: true });
const blueprintPlan = createBlueprintPlan(blueprintBase);
const blueprintPlanAgain = createBlueprintPlan(blueprintBase);
blueprintAssert(blueprintPlan.sourceDigest === blueprintPlanAgain.sourceDigest, 'BuildPlan source digest is deterministic');
blueprintAssert(JSON.stringify(blueprintPlan.mechanisms.map(item => item.geometry)) === JSON.stringify(blueprintPlanAgain.mechanisms.map(item => item.geometry)), 'BuildPlan physical geometry is deterministic');
blueprintAssert(blueprintPlan.motions.map(motion => motion.id).join('|') === (blueprintBase.pathOrder ?? Object.keys(blueprintBase.paths)).join('|'), 'BuildPlan preserves canonical motion order');
blueprintAssert(blueprintPlan.mechanisms.every(item => item.geometry.units === 'mm' && item.geometry.signature.startsWith('fnv1a32:')), 'Every mechanism has signed millimeter geometry');
blueprintAssert(blueprintTilesForBuildPlan(blueprintPlan).length === blueprintPlan.mechanisms.length, 'Each mechanism stays on one native 12x12-inch sheet');
blueprintAssert(Math.abs(blueprintPointsPerMm * 20 - 56.6929133858) < 0.000001, '20mm converts exactly to PDF points');
const blueprintPdf = makeBlueprintPdfFromBuildPlan(blueprintPlan);
blueprintAssert(blueprintPdf.includes('/MediaBox [0 0 864 864]'), 'Blueprint PDF uses a native 12x12-inch MediaBox');
blueprintAssert(blueprintPdf.includes('sheet=12x12in scale=1') && blueprintPdf.includes(`points_per_mm=${(72 / 25.4).toFixed(9)}`), 'Blueprint PDF carries native sheet size and exact 100% scale metadata');
blueprintAssert(!blueprintPdf.includes('character cut sheet') && !blueprintPdf.includes('Complete ordered steps'), 'Blueprint PDF excludes character and tutorial packets');
blueprintAssert(blueprintPlan.mechanisms.every(item => blueprintPdf.includes(item.geometry.signature)), 'PDF carries the same mechanism geometry signatures as BuildPlan');
blueprintAssert(buildBlueprintCharacterLayout(blueprintBase).scale === 1, 'Character output never silently shrinks');
for (const type of ['4bar', 'gear', 'cam'] as const) {
    const mechanism = createBlueprintMechanism(type, `blueprint-${type}`);
    const project = { ...blueprintBase, mechanisms: [{ ...mechanism, targetPathId: (blueprintBase.pathOrder ?? Object.keys(blueprintBase.paths))[0], targetPartId: blueprintBase.selectedPartId }], selectedMechanismId: mechanism.id };
    const plan = createBlueprintPlan(project);
    blueprintAssert(plan.mechanisms[0]?.geometry.outlines.length > 0, `${type} produces printable physical outlines`);
    blueprintAssert(makeBlueprintPdfFromBuildPlan(plan).includes(plan.mechanisms[0].geometry.signature), `${type} screen/PDF geometry remains identical`);
}
