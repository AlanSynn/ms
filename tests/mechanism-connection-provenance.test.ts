import assert from 'node:assert/strict';
import type { ConnectionSelectionRole, MechanismConfig, ProjectState } from '../types';
import {
  authorMechanismConnectionSelection,
  connectionSelectionAccepted,
  connectionSelectionSignature,
  normalizeMechanismConnectionSelections,
} from '../utils/mechanismConnectionSelections';
import { compileMechanism, compileMechanismGraphFabrication } from '../utils/mechanismCompiler';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import { resolveMechanismCandidateCommit } from '../utils/mechanismEditAuthority';
import { createSampleProject, loadProjectSnapshot, serializeProject } from '../utils/project';
import { snapshotMechanism } from '../utils/mechanismSnapshot';

const statusFor = (mechanism: MechanismConfig, role: ConnectionSelectionRole) =>
  mechanism.connectionSelectionValidation?.entries.find((entry) => entry.role === role)?.status;

const withDefaults = (mechanism: MechanismConfig): MechanismConfig => ({
  ...mechanism,
  ...normalizeMechanismConnectionSelections(mechanism, undefined),
});

{
  const untouched = withDefaults(createDefaultMechanism('4bar', 'provenance-4bar'));
  const input = untouched.connectionSelections?.['4bar.input-joint'];
  assert(input);
  const authored = {
    ...untouched,
    ...authorMechanismConnectionSelection(untouched, '4bar.input-joint', input),
  };
  const committed = resolveMechanismCandidateCommit(untouched, authored);
  assert.equal(committed.status, 'accepted');
  assert.equal(committed.geometryChanged, false);
  assert.equal(statusFor(committed.mechanism, '4bar.input-joint'), 'accepted');
  assert.equal(statusFor(committed.mechanism, '4bar.output-joint'), 'defaulted');
  assert(connectionSelectionAccepted(committed.mechanism.connectionSelectionValidation, '4bar.input-joint'));
  assert(!connectionSelectionAccepted(committed.mechanism.connectionSelectionValidation, '4bar.output-joint'));

  const provenanceOmitted = resolveMechanismCandidateCommit(committed.mechanism, {
    ...committed.mechanism,
    targetPartId: 'new-target',
    connectionSelectionValidation: {
      status: 'valid',
      entries: [{ role: '4bar.input-joint', status: 'accepted' }],
    },
  });
  assert.equal(provenanceOmitted.status, 'accepted');
  assert.equal(statusFor(provenanceOmitted.mechanism, '4bar.input-joint'), 'accepted');
  assert.equal(statusFor(provenanceOmitted.mechanism, '4bar.output-joint'), 'defaulted');

  const sameHole = resolveMechanismCandidateCommit(committed.mechanism, {
    ...committed.mechanism,
    ...authorMechanismConnectionSelection(committed.mechanism, '4bar.input-joint', input),
  });
  assert.equal(sameHole.status, 'accepted');
  assert.equal(sameHole.geometryChanged, false);
  assert.equal(statusFor(sameHole.mechanism, '4bar.input-joint'), 'accepted');
  assert.equal(statusFor(sameHole.mechanism, '4bar.output-joint'), 'defaulted');

  const mixedProject: ProjectState = { ...createSampleProject(), mechanisms: [sameHole.mechanism] };
  const mixedRoundTrip = loadProjectSnapshot(JSON.parse(serializeProject(mixedProject))).mechanisms[0];
  const mixedSnapshot = snapshotMechanism(mixedRoundTrip);
  assert.equal(statusFor(mixedRoundTrip, '4bar.input-joint'), 'accepted');
  assert.equal(statusFor(mixedRoundTrip, '4bar.output-joint'), 'defaulted');
  assert.equal(mixedSnapshot.connectionSelectionValidation?.entries.find((entry) => entry.role === '4bar.input-joint')?.status, 'accepted');
  assert.equal(mixedSnapshot.connectionSelectionValidation?.entries.find((entry) => entry.role === '4bar.output-joint')?.status, 'defaulted');
}

const g24 = 60;
const g40 = 100;
const gearGeometry = (mechanism: MechanismConfig, drive: number, output: number): MechanismConfig => ({
  ...mechanism,
  crankLength: drive,
  rockerLength: output,
  gearTrainRadii: [drive, output],
});

{
  let mechanism = withDefaults(gearGeometry(createDefaultMechanism('gear_linkage', 'provenance-gears'), g24, g24));
  const expected = [
    'gear_linkage.drive-pin:g24:0:0|gear_linkage.output-pin:g24:1:0',
    'gear_linkage.drive-pin:g40:0:0|gear_linkage.output-pin:g24:1:0',
    'gear_linkage.drive-pin:g40:0:0|gear_linkage.output-pin:g40:1:0',
  ];
  assert.equal(connectionSelectionSignature(mechanism.connectionSelections), expected[0]);
  for (const [index, radii] of [[g40, g24], [g40, g40]].entries()) {
    const result = resolveMechanismCandidateCommit(mechanism, gearGeometry(mechanism, radii[0], radii[1]));
    assert.equal(result.status, 'accepted');
    mechanism = result.mechanism;
    assert.equal(connectionSelectionSignature(mechanism.connectionSelections), expected[index + 1]);
    assert.equal(statusFor(mechanism, 'gear_linkage.drive-pin'), 'defaulted');
    assert.equal(statusFor(mechanism, 'gear_linkage.output-pin'), 'defaulted');
  }

  const staleAuthored = normalizeMechanismConnectionSelections(
    gearGeometry(createDefaultMechanism('gear_linkage', 'stale-authored'), g40, g24),
    withDefaults(createDefaultMechanism('gear_linkage', 'stale-authored')).connectionSelections,
  );
  assert.equal(staleAuthored.connectionSelectionValidation?.status, 'invalid');
  assert.equal(staleAuthored.connectionSelections?.['gear_linkage.drive-pin'], undefined);
  assert.equal(statusFor({ ...mechanism, ...staleAuthored }, 'gear_linkage.drive-pin'), 'rejected');

  const driveDefaultOutputAuthored = withDefaults(createDefaultMechanism('gear_linkage', 'independent-roles'));
  const output = driveDefaultOutputAuthored.connectionSelections?.['gear_linkage.output-pin'];
  assert(output);
  const mixed = {
    ...driveDefaultOutputAuthored,
    ...authorMechanismConnectionSelection(driveDefaultOutputAuthored, 'gear_linkage.output-pin', output),
  };
  const changedDrive = resolveMechanismCandidateCommit(mixed, gearGeometry(mixed, g40, g24));
  assert.equal(changedDrive.status, 'accepted');
  assert.equal(statusFor(changedDrive.mechanism, 'gear_linkage.drive-pin'), 'defaulted');
  assert.equal(statusFor(changedDrive.mechanism, 'gear_linkage.output-pin'), 'accepted');
  assert.deepEqual(changedDrive.mechanism.connectionSelections?.['gear_linkage.output-pin'], output);

  const driveAuthoredOutputDefault = withDefaults(createDefaultMechanism('gear_linkage', 'independent-output'));
  const drive = driveAuthoredOutputDefault.connectionSelections?.['gear_linkage.drive-pin'];
  assert(drive);
  const reverseMixed = {
    ...driveAuthoredOutputDefault,
    ...authorMechanismConnectionSelection(driveAuthoredOutputDefault, 'gear_linkage.drive-pin', drive),
  };
  const changedOutput = resolveMechanismCandidateCommit(reverseMixed, gearGeometry(reverseMixed, g24, g40));
  assert.equal(changedOutput.status, 'accepted');
  assert.equal(statusFor(changedOutput.mechanism, 'gear_linkage.drive-pin'), 'accepted');
  assert.equal(statusFor(changedOutput.mechanism, 'gear_linkage.output-pin'), 'defaulted');
  assert.deepEqual(changedOutput.mechanism.connectionSelections?.['gear_linkage.drive-pin'], drive);

  const project: ProjectState = { ...createSampleProject(), mechanisms: [mechanism] };
  const roundTrip = loadProjectSnapshot(JSON.parse(serializeProject(project))).mechanisms[0];
  const snap = snapshotMechanism(roundTrip);
  for (const role of ['gear_linkage.drive-pin', 'gear_linkage.output-pin'] as const) {
    assert.equal(statusFor(roundTrip, role), 'defaulted');
    assert.equal(snap.connectionSelectionValidation?.entries.find((entry) => entry.role === role)?.status, 'defaulted');
  }

  const signature = connectionSelectionSignature(mechanism.connectionSelections);
  const compiled = compileMechanism(mechanism);
  const fabrication = compileMechanismGraphFabrication(mechanism);
  assert.equal(connectionSelectionSignature(compiled.graph.connectionSelectionSummary?.connectionSelections), signature);
  assert.equal(connectionSelectionSignature(compiled.fabrication.renderPlan.connectionSelectionSummary?.connectionSelections), signature);
  assert.equal(connectionSelectionSignature(fabrication.renderPlan.connectionSelectionSummary?.connectionSelections), signature);
  assert(signature.includes('gear_linkage.drive-pin') && signature.includes('gear_linkage.output-pin'));
}

console.log('mechanism connection provenance contracts passed');
