import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { FoundryExportPackage, MechanismConfig } from '../types';
import { resolveLocalFoundryCandidate } from '../components/stages/foundry/MechanismFoundry';
import { SCENE_PX_PER_MM } from '../utils/coordinates';
import { FABRICATION_LINKAGE_SPECS } from '../utils/fabricationContract';
import { foundryMechanismFingerprint, resolveFoundryTransaction } from '../utils/foundryTransaction';
import {
  authorMechanismConnectionSelection,
  connectionSelectionAccepted,
  normalizeAuthoredMechanismToFabricationSet,
  resolveFourBarConnectionSelections,
} from '../utils/mechanismConnectionSelections';
import { mechanismDescriptorWithinSheet } from '../utils/mechanismCollision';
import { compileMechanismGraphFabrication } from '../utils/mechanismCompiler';
import { mechanismEditIsSafe, mechanismMotionCompletes } from '../utils/mechanismEditAuthority';
import { buildMechanismPhysicalEnvelopeDescriptors } from '../utils/mechanismPhysicalEnvelope';
import { fitRecommendedMechanismToSheet } from '../utils/mechanismRecommendations';
import { applyProjectAction, CLASSROOM_LESSONS, createLessonProject } from '../utils/project';
import { mechanismReadiness, projectMechanismReadiness } from '../utils/mechanismReadiness';
import { isReferenceExportReady } from '../utils/mechanismReference';
import { FOUNDRY_PRESETS } from '../utils/mechanismTemplates';

const project = createLessonProject('walking-leg');
const prior = project.mechanisms[0]!;
const stalePackage = {
  id: 'stale',
  createdAt: '2026-01-01T00:00:00.000Z',
  mechanismId: prior.id,
  mechanismType: prior.type,
  parameters: { ...prior },
  pivot: { x: prior.anchorX ?? 0, y: prior.anchorY ?? 0 },
  generatedPath: prior.generatedPath ?? [],
  simulationSummary: 'stale',
  visual: { color: prior.color, scale: 1, constraintsVisible: true },
  animation: { duration: 1000, steps: 1, loop: true },
  metadata: { sourceTab: 'mechanism-foundry' },
  warnings: [],
  source: 'mechanism-foundry',
} satisfies FoundryExportPackage;
const withStalePackage = {
  ...project,
  mechanisms: [{ ...prior, foundryExport: stalePackage }],
  lastFoundryExport: stalePackage,
};

{
  const movedAnchorX = (prior.anchorX ?? 0) + project.settings.physicalKit.gridPitchMm * 2;
  const staleTransform = prior.transform ?? {
    x: prior.anchorX ?? 0,
    y: prior.anchorY ?? 0,
    rotation: prior.groundAngle ?? 0,
    scale: 1,
  };
  const moved = resolveLocalFoundryCandidate(
    prior,
    {
      ...prior,
      anchorX: movedAnchorX,
      sceneAnchor: { x: movedAnchorX, y: prior.anchorY ?? 0 },
      transform: staleTransform,
    },
    project.settings.physicalKit,
  );
  assert.equal(moved.accepted, true, 'safe local anchor candidate is accepted');
  assert.equal(moved.mechanism.anchorX, movedAnchorX);
  assert.equal(moved.mechanism.sceneAnchor?.x, movedAnchorX);
  assert.equal(moved.mechanism.transform?.x, movedAnchorX, 'authority-approved transform cannot be replaced by the stale prior anchor');

  const invalid = resolveLocalFoundryCandidate(
    prior,
    { ...prior, anchorX: (prior.anchorX ?? 0) + 1 },
    project.settings.physicalKit,
  );
  assert.equal(invalid.accepted, false);
  assert.strictEqual(invalid.mechanism, prior, 'invalid local candidate preserves the exact previous preview');

  const foundrySource = readFileSync(
    new URL('../components/stages/foundry/MechanismFoundry.tsx', import.meta.url),
    'utf8',
  );
  assert.equal(
    foundrySource.match(/\bsetFoundry\(/g)?.length,
    1,
    'all physical local Foundry installations use one setter boundary',
  );
  assert.match(
    foundrySource,
    /setFoundry\(result\.mechanism\)/,
    'the setter installs exactly the authority-approved mechanism',
  );
}

{
  const presetProject = createLessonProject('waving-arm');
  const kit = presetProject.settings.physicalKit;
  const managedLinkageLengths = new Set(
    FABRICATION_LINKAGE_SPECS.map((spec) => spec.cells * kit.gridPitchMm * SCENE_PX_PER_MM),
  );
  const expectedDimensions = {
    balanced: { groundLength: 160, crankLength: 80, couplerLength: 160, rockerLength: 160 },
    compact: { groundLength: 120, crankLength: 80, couplerLength: 160, rockerLength: 160 },
    broad: { groundLength: 240, crankLength: 80, couplerLength: 240, rockerLength: 160 },
  } as const;
  let installed = presetProject.mechanisms[0]!;

  for (const presetId of ['balanced', 'compact', 'broad'] as const) {
    const preset = FOUNDRY_PRESETS[presetId];
    const { label: _label, ...updates } = preset;
    const normalized = normalizeAuthoredMechanismToFabricationSet({
      ...installed,
      ...updates,
      presetId,
      recommendation: preset.recommendation,
    });
    const expected = expectedDimensions[presetId];

    for (const key of ['groundLength', 'crankLength', 'couplerLength', 'rockerLength'] as const) {
      assert.equal(normalized[key], expected[key], `${presetId} keeps its exact ${key} after fabrication normalization`);
    }
    assert.equal(
      (normalized.groundLength ?? 0) % (kit.gridPitchMm * SCENE_PX_PER_MM),
      0,
      `${presetId} ground uses the active board pitch`,
    );
    for (const key of ['crankLength', 'couplerLength', 'rockerLength'] as const) {
      assert(managedLinkageLengths.has(normalized[key] ?? Number.NaN), `${presetId} ${key} uses a managed linkage blank`);
    }
    assert(mechanismEditIsSafe(normalized, kit), `${presetId} passes exact mechanism edit safety`);
    assert(mechanismMotionCompletes(normalized), `${presetId} completes the full motion schedule`);

    const fitted = fitRecommendedMechanismToSheet(presetProject, normalized);
    const compiled = compileMechanismGraphFabrication(fitted, kit);
    const descriptors = buildMechanismPhysicalEnvelopeDescriptors(
      fitted,
      undefined,
      compiled.renderPlan,
      kit,
    );
    assert(descriptors.length > 0, `${presetId} publishes physical envelope descriptors`);
    assert(
      descriptors.every((descriptor) => mechanismDescriptorWithinSheet(descriptor, kit)),
      `${presetId} fits every physical descriptor within the sheet`,
    );
    assert.equal(
      mechanismReadiness({ ...presetProject, mechanisms: [fitted] }, fitted).fabricationReady,
      true,
      `${presetId} is fabrication ready after sheet fitting`,
    );
    assert.equal(
      projectMechanismReadiness({ ...presetProject, mechanisms: [fitted] }).status,
      'project-ready',
      `${presetId} remains collision-safe in the active project`,
    );

    const result = resolveLocalFoundryCandidate(installed, fitted, kit, presetId === 'balanced');
    assert.equal(result.accepted, true, `${presetId} local preset installation is accepted`);
    assert.equal(result.mechanism.groundLength, expected.groundLength, `${presetId} installs its declared ground span`);
    if (presetId !== 'balanced') {
      assert.notEqual(installed.groundLength, expected.groundLength, `${presetId} changes the prior ground span`);
    }
    installed = result.mechanism;
  }

  assert.equal(
    new Set(Object.values(expectedDimensions).map((dimensions) => JSON.stringify(dimensions))).size,
    3,
    'managed four-bar presets remain geometrically distinct',
  );
}

const candidate = { ...prior, color: '#123456' };
let generationCalls = 0;
const packageFor = (mechanism: MechanismConfig): FoundryExportPackage => {
  generationCalls += 1;
  return {
    ...stalePackage,
    id: 'fresh',
    mechanismId: mechanism.id,
    mechanismType: mechanism.type,
    parameters: { ...mechanism },
    pivot: { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 },
    generatedPath: mechanism.generatedPath ?? [],
  };
};

const simulation = resolveFoundryTransaction({
  project: withStalePackage,
  candidate,
  intent: 'simulation-only',
  generatePackage: packageFor,
});
assert.equal(simulation.status, 'committed');
assert.equal(generationCalls, 0, 'simulation-only never generates a package');
const simulatedProject = applyProjectAction(withStalePackage, {
  type: 'commit_mechanism_candidate',
  result: simulation,
});
assert.equal(simulatedProject.mechanisms[0]?.color, '#123456');
assert.equal(simulatedProject.mechanisms[0]?.foundryExport, undefined);
assert.equal(simulatedProject.lastFoundryExport, undefined);

const simulationNoop = resolveFoundryTransaction({
  project: withStalePackage,
  candidate: { ...prior },
  intent: 'simulation-only',
  generatePackage: packageFor,
});
assert.equal(simulationNoop.status, 'committed');
assert.strictEqual(simulationNoop.mechanism, withStalePackage.mechanisms[0], 'simulation-only no-op returns the exact prior packaged mechanism');
const simulationNoopProject = applyProjectAction(withStalePackage, {
  type: 'commit_mechanism_candidate',
  result: simulationNoop,
});
assert.strictEqual(simulationNoopProject, withStalePackage, 'simulation-only no-op preserves the exact aggregate and package');

const rejected = resolveFoundryTransaction({
  project: withStalePackage,
  candidate: { ...candidate, crankLength: Number.NaN },
  intent: 'fabrication-package',
  generatePackage: packageFor,
});
assert.equal(rejected.status, 'blocked');
assert.equal(generationCalls, 0, 'simulation rejection happens before generation');
const rejectedProject = applyProjectAction(withStalePackage, {
  type: 'commit_mechanism_candidate',
  result: rejected,
});
assert.equal(rejectedProject.mechanisms[0]?.crankLength, prior.crankLength);
assert.strictEqual(rejectedProject, withStalePackage, 'rejected Foundry authoring preserves the exact prior aggregate');
assert.strictEqual(rejectedProject.mechanisms[0]?.foundryExport, stalePackage);
assert.strictEqual(rejectedProject.lastFoundryExport, stalePackage);

const bindingRejected = resolveFoundryTransaction({
  project: withStalePackage,
  candidate: { ...candidate, targetPathId: 'missing-path' },
  intent: 'fabrication-package',
  generatePackage: packageFor,
});
assert.equal(bindingRejected.status, 'blocked');
assert.equal(bindingRejected.blocker, 'Fix: Choose anchor');
assert(bindingRejected.recoveryCandidates?.targetPathIds.includes(prior.targetPathId!), 'binding rejection returns compatible path recovery data');
assert.strictEqual(bindingRejected.mechanism, withStalePackage.mechanisms[0], 'binding rejection returns the exact prior mechanism');
assert.strictEqual(
  applyProjectAction(withStalePackage, { type: 'commit_mechanism_candidate', result: bindingRejected }),
  withStalePackage,
  'binding-rejected Foundry commit is a true aggregate no-op',
);

const duplicateRejected = resolveFoundryTransaction({
  project: withStalePackage,
  candidate: { ...candidate, id: 'duplicate-foundry-driver' },
  intent: 'fabrication-package',
  generatePackage: packageFor,
});
assert.equal(duplicateRejected.status, 'blocked');
assert.equal(duplicateRejected.blocker, 'Fix: Choose anchor');
assert(duplicateRejected.recoveryCandidates?.targetAnchorJointIds.includes(prior.targetAnchorJointId!), 'duplicate Foundry rejection returns compatible anchor recovery data');
assert.strictEqual(
  applyProjectAction(withStalePackage, { type: 'commit_mechanism_candidate', result: duplicateRejected }),
  withStalePackage,
  'duplicate Foundry commit preserves the exact prior aggregate and package',
);

const packageSuccess = resolveFoundryTransaction({
  project: withStalePackage,
  candidate,
  intent: 'fabrication-package',
  generatePackage: packageFor,
});
assert.equal(packageSuccess.status, 'committed', packageSuccess.blocker ?? 'package transaction blocked');
assert.equal(generationCalls, 1, 'generation runs once after readiness');
const packagedProject = applyProjectAction(withStalePackage, {
  type: 'commit_mechanism_candidate',
  result: packageSuccess,
});
assert.equal(packagedProject.mechanisms[0]?.color, '#123456');
assert.equal(packagedProject.mechanisms[0]?.foundryExport?.id, 'fresh');
assert.equal(packagedProject.lastFoundryExport?.id, 'fresh');

{
  let selectedHoleCandidate = { ...prior };
  selectedHoleCandidate = {
    ...selectedHoleCandidate,
    ...authorMechanismConnectionSelection(
      selectedHoleCandidate,
      '4bar.input-joint',
      { kind: 'linkage-hole', linkageKey: 'linkage-2-cell', holeIndex: 1 },
    ),
  };
  selectedHoleCandidate = {
    ...selectedHoleCandidate,
    ...authorMechanismConnectionSelection(
      selectedHoleCandidate,
      '4bar.output-joint',
      { kind: 'linkage-hole', linkageKey: 'linkage-6-cell', holeIndex: 5 },
    ),
  };
  const selectedConnections = resolveFourBarConnectionSelections(selectedHoleCandidate);
  assert(connectionSelectionAccepted(selectedConnections.validation, '4bar.input-joint'));
  assert(connectionSelectionAccepted(selectedConnections.validation, '4bar.output-joint'));
  assert.equal(selectedHoleCandidate.crankLength, selectedConnections.inputJoint?.length);
  assert.equal(selectedHoleCandidate.rockerLength, selectedConnections.outputJoint?.length);

  const fittedSelectedHoleCandidate = fitRecommendedMechanismToSheet(withStalePackage, selectedHoleCandidate);
  assert.equal(fittedSelectedHoleCandidate.crankLength, selectedConnections.inputJoint?.length, 'sheet fitting preserves the selected interior input-hole length');
  assert.equal(fittedSelectedHoleCandidate.rockerLength, selectedConnections.outputJoint?.length, 'sheet fitting preserves the selected interior output-hole length');

  const selectedHoleTransaction = resolveFoundryTransaction({
    project: withStalePackage,
    candidate: fittedSelectedHoleCandidate,
    intent: 'fabrication-package',
    generatePackage: mechanism => ({
      ...stalePackage,
      id: 'selected-hole-package',
      mechanismId: mechanism.id,
      mechanismType: mechanism.type,
      parameters: { ...mechanism },
      pivot: { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 },
      generatedPath: mechanism.generatedPath ?? [],
    }),
  });
  assert.equal(selectedHoleTransaction.status, 'committed', selectedHoleTransaction.blocker ?? 'selected-hole transaction blocked');
  assert.equal(selectedHoleTransaction.mechanism.crankLength, selectedConnections.inputJoint?.length);
  assert.equal(selectedHoleTransaction.mechanism.rockerLength, selectedConnections.outputJoint?.length);
  assert.equal(selectedHoleTransaction.foundryExport?.parameters.crankLength, selectedHoleTransaction.mechanism.crankLength);
  assert.equal(selectedHoleTransaction.foundryExport?.parameters.rockerLength, selectedHoleTransaction.mechanism.rockerLength);
  assert.equal(
    foundryMechanismFingerprint(selectedHoleTransaction.foundryExport?.parameters as MechanismConfig),
    selectedHoleTransaction.fingerprint,
    'package parameters match the committed transaction fingerprint',
  );
  const committedSelectedHoleProject = applyProjectAction(withStalePackage, {
    type: 'commit_mechanism_candidate',
    result: selectedHoleTransaction,
  });
  assert.equal(committedSelectedHoleProject.mechanisms[0]?.foundryExport?.id, 'selected-hole-package');

  const mechanismActionsSource = readFileSync(new URL('../hooks/useAppMechanismActions.ts', import.meta.url), 'utf8');
  assert.match(
    mechanismActionsSource,
    /fitRecommendedMechanismToSheet\(\s*project,\s*rawMechanism,\s*\)/,
    'Foundry export fits the already-authored candidate without redundant normalization',
  );
}

const generationFailure = resolveFoundryTransaction({
  project: withStalePackage,
  candidate,
  intent: 'fabrication-package',
  generatePackage: () => {
    throw new Error('disk full');
  },
});
assert.equal(generationFailure.status, 'blocked');
assert.match(generationFailure.blocker ?? '', /package/i);
const generationFailureProject = applyProjectAction(withStalePackage, {
  type: 'commit_mechanism_candidate',
  result: generationFailure,
});
assert.equal(generationFailureProject.mechanisms[0]?.color, prior.color);
assert.strictEqual(generationFailureProject, withStalePackage, 'package generation failure preserves the exact prior package state');

const validationFailure = resolveFoundryTransaction({
  project: withStalePackage,
  candidate,
  intent: 'fabrication-package',
  generatePackage: mechanism => ({
    ...packageFor(mechanism),
    parameters: { ...mechanism, crankLength: (mechanism.crankLength ?? 0) + 1 },
  }),
});
assert.equal(validationFailure.status, 'blocked');
assert.match(validationFailure.blocker ?? '', /validation/i);
const validationFailureProject = applyProjectAction(withStalePackage, {
  type: 'commit_mechanism_candidate',
  result: validationFailure,
});
assert.equal(validationFailureProject.mechanisms[0]?.color, prior.color);
assert.strictEqual(validationFailureProject, withStalePackage, 'package validation failure preserves the exact prior package state');

const projectBlocked = resolveFoundryTransaction({
  project: withStalePackage,
  candidate: { ...candidate, anchorX: 10000, sceneAnchor: { x: 10000, y: candidate.anchorY ?? 0 } },
  intent: 'fabrication-package',
  generatePackage: packageFor,
});
assert.equal(projectBlocked.status, 'blocked');
assert.equal(generationCalls, 2, 'project readiness blocks generation');

const emptyMechanismProject = { ...project, mechanisms: [], selectedMechanismId: undefined };
const forgedNewCandidate = {
  ...prior,
  id: 'new-foundry-candidate',
  generatedPath: [{ x: 9999, y: 9999 }],
  foundryExport: stalePackage,
};
const newTransaction = resolveFoundryTransaction({
  project: emptyMechanismProject,
  candidate: forgedNewCandidate,
  intent: 'simulation-only',
});
assert.equal(newTransaction.status, 'committed');
assert.notDeepEqual(newTransaction.mechanism.generatedPath, forgedNewCandidate.generatedPath, 'new Foundry candidates recompute derived paths');
assert.equal(newTransaction.mechanism.foundryExport, undefined, 'new Foundry candidates discard candidate packages');

const inserted = applyProjectAction(emptyMechanismProject, {
  type: 'upsert_mechanism',
  mechanism: forgedNewCandidate,
});
assert.notDeepEqual(inserted.mechanisms[0]?.generatedPath, forgedNewCandidate.generatedPath, 'new reducer inserts recompute derived paths');
assert.equal(inserted.mechanisms[0]?.foundryExport, undefined, 'legacy upsert cannot insert a candidate package');
const rejectedInsert = applyProjectAction(emptyMechanismProject, {
  type: 'upsert_mechanism',
  mechanism: { ...forgedNewCandidate, crankLength: Number.NaN },
});
assert.equal(rejectedInsert.mechanisms.length, 0, 'new reducer inserts use new-candidate authority');

for (const lesson of CLASSROOM_LESSONS) {
  const guided = createLessonProject(lesson.id);
  assert(guided.mechanisms.every(mechanism => isReferenceExportReady(mechanism.type)), `${lesson.id} uses only export-ready families`);
  assert.equal(projectMechanismReadiness(guided).status, 'project-ready', `${lesson.id} is project-ready after direct guided Fit`);
  assert(guided.mechanisms.every(mechanism => !mechanism.foundryExport), `${lesson.id} does not leak a candidate package`);
}

console.log('foundry transaction contracts passed');
