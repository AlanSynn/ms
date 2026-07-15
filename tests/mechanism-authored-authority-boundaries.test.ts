import assert from 'node:assert/strict';
import { buildAutomataSceneModel } from '../utils/automataSceneModel';
import { compileMechanismGraphFabrication } from '../utils/mechanismCompiler';
import {
  authorMechanismConnectionSelection,
  connectionSelectionAccepted,
  resolveFourBarConnectionSelections,
} from '../utils/mechanismConnectionSelections';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import { fitRecommendedMechanismToSheet } from '../utils/mechanismRecommendations';
import { buildMechanismSnapshot } from '../utils/mechanismSnapshot';
import { createEmptyProject } from '../utils/project';
import { sanitizeMechanismRuntime } from '../utils/sanitize';
import { buildFoundryMechanismPreviewModel } from '../utils/foundryPreviewModel';

const fullLinkageKey = 'linkage-8-cell' as const;
let authored = createDefaultMechanism('4bar', 'authored-interior-hole-4bar');
authored = {
  ...authored,
  ...authorMechanismConnectionSelection(
    authored,
    '4bar.input-joint',
    { kind: 'linkage-hole', linkageKey: fullLinkageKey, holeIndex: 3 },
  ),
};
authored = {
  ...authored,
  ...authorMechanismConnectionSelection(
    authored,
    '4bar.output-joint',
    { kind: 'linkage-hole', linkageKey: fullLinkageKey, holeIndex: 5 },
  ),
};

const resolved = resolveFourBarConnectionSelections(authored);
assert(connectionSelectionAccepted(resolved.validation, '4bar.input-joint'));
assert(connectionSelectionAccepted(resolved.validation, '4bar.output-joint'));
assert(resolved.inputJoint && resolved.outputJoint);
const expected = {
  crankLength: resolved.inputJoint.length,
  rockerLength: resolved.outputJoint.length,
};
assert.deepEqual(expected, { crankLength: 120, rockerLength: 200 });

const project = createEmptyProject();
project.mechanisms = [authored];
const originalMechanism = structuredClone(authored);
const originalProject = structuredClone(project);
const fabrication = compileMechanismGraphFabrication(authored, project.settings.physicalKit);
assert.equal(fabrication.buildable, true, fabrication.blocker ?? fabrication.renderPlan.validationErrors.join(' | '));
const failures: string[] = [];
const check = (name: string, assertion: () => void) => {
  try {
    assertion();
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const automata = buildAutomataSceneModel(project, authored, Math.PI / 3);
assert.equal(automata.mechanism, undefined, 'unbound authored geometry is not project-active');
assert(automata.recoveryMechanism, 'unbound safe geometry remains available as a static mechanical diagnostic');
check('automata mechanism', () => assert.deepEqual(
    { crankLength: automata.recoveryMechanism!.crankLength, rockerLength: automata.recoveryMechanism!.rockerLength },
    expected,
    'automata scene keeps authored selected-hole lengths authoritative',
  ));
check('automata mechanism collection', () => assert.deepEqual(
    automata.mechanisms.map(({ crankLength, rockerLength }) => ({ crankLength, rockerLength })),
    [],
    'static recovery never re-inserts the unbound mechanism into the active collection',
  ));

const foundry = buildFoundryMechanismPreviewModel(authored, Math.PI / 3, project.settings);
check('Foundry preview', () => assert.deepEqual(
    { crankLength: foundry.mechanism.crankLength, rockerLength: foundry.mechanism.rockerLength },
    expected,
    'Foundry preview keeps authored selected-hole lengths authoritative',
  ));

const snapshot = buildMechanismSnapshot(project, authored.id);
assert(snapshot);
const inputConstraint = snapshot.graph.constraints.find(({ id }) => id === 'input-length');
const outputConstraint = snapshot.graph.constraints.find(({ id }) => id === 'output-length');
check('snapshot input scalar', () => assert.equal(snapshot.mechanism.crankLength, inputConstraint?.value, 'snapshot crank scalar equals its graph input constraint'));
check('snapshot output scalar', () => assert.equal(snapshot.mechanism.rockerLength, outputConstraint?.value, 'snapshot rocker scalar equals its graph output constraint'));
const snapshotInputSelection = snapshot.fabricationPlan.connectionSelectionSummary?.connectionSelections?.['4bar.input-joint'];
const snapshotOutputSelection = snapshot.fabricationPlan.connectionSelectionSummary?.connectionSelections?.['4bar.output-joint'];
assert(snapshotInputSelection?.kind === 'linkage-hole', 'snapshot fabrication summary keeps the input linkage-hole selection');
assert(snapshotOutputSelection?.kind === 'linkage-hole', 'snapshot fabrication summary keeps the output linkage-hole selection');
assert.equal(
  snapshotInputSelection.linkageKey,
  fullLinkageKey,
  'snapshot fabrication summary keeps the selected full input linkage blank',
);
assert.equal(
  snapshotOutputSelection.linkageKey,
  fullLinkageKey,
  'snapshot fabrication summary keeps the selected full output linkage blank',
);

const sanitized = sanitizeMechanismRuntime(authored);
check('runtime sanitization', () => assert.deepEqual(
    { crankLength: sanitized.crankLength, rockerLength: sanitized.rockerLength },
    expected,
    'runtime sanitization keeps authored selected-hole lengths authoritative',
  ));
assert(connectionSelectionAccepted(sanitized.connectionSelectionValidation, '4bar.input-joint'));
assert(connectionSelectionAccepted(sanitized.connectionSelectionValidation, '4bar.output-joint'));

const fitted = fitRecommendedMechanismToSheet(project, authored);
assert.deepEqual(
  { crankLength: fitted.crankLength, rockerLength: fitted.rockerLength },
  expected,
  'existing-mechanism sheet fit keeps authored selected-hole lengths authoritative',
);
assert(connectionSelectionAccepted(fitted.connectionSelectionValidation, '4bar.input-joint'));
assert(connectionSelectionAccepted(fitted.connectionSelectionValidation, '4bar.output-joint'));

assert.deepEqual(authored, originalMechanism, 'production boundaries do not mutate the authored mechanism input');
assert.deepEqual(project, originalProject, 'production boundaries do not mutate the project input');
assert.deepEqual(failures, [], 'authored selected-hole authority survives every production boundary');

console.log('mechanism authored authority boundary contracts passed');
