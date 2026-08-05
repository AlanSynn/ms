import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import {
  authorMechanismConnectionSelection,
  normalizeMechanismConnectionSelections,
} from '../utils/mechanismConnectionSelections';
import {
  constrainMechanismCommit,
  constrainMechanismUpdate,
  mechanismEditIsSafe,
  mechanismMotionCompletes,
  motionSafeParamRange,
  resolveMechanismCandidateCommit,
  resolveNewMechanismCandidateCommit,
} from '../utils/mechanismEditAuthority';
import { calculateLinkage, mechanismSafetyPhaseSchedule } from '../utils/kinematics';
import { createLessonProject } from '../utils/project';

const finiteNumbers = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteNumbers);
  if (value && typeof value === 'object') return Object.values(value).every(finiteNumbers);
  return true;
};

const invalidNew = createDefaultMechanism('4bar', 'invalid-new');
invalidNew.crankLength = Number.NaN;
assert.equal(
  resolveNewMechanismCandidateCommit(invalidNew).status,
  'rejected',
  'new candidates cannot bypass complete validation with non-finite geometry',
);

const previous = {
  ...createDefaultMechanism('4bar', 'recovery'),
  targetPartId: 'old-target',
};
const failedRecovery = resolveMechanismCandidateCommit(
  previous,
  { ...previous, targetPartId: 'new-target', crankLength: Number.NaN },
  undefined,
  'recovery',
);
assert.equal(failedRecovery.status, 'recovery-blocked');
assert.strictEqual(
  failedRecovery.mechanism,
  previous,
  'failed recovery returns the exact prior canonical object',
);
assert.equal(failedRecovery.mechanism.targetPartId, 'old-target');

const unsafePrior = { ...previous, crankLength: Number.NaN };
const canonicalRecovery = resolveMechanismCandidateCommit(
  unsafePrior,
  { ...unsafePrior, id: 'disallowed-replacement' },
  undefined,
  'recovery',
);
assert.equal(canonicalRecovery.status, 'recovery-blocked');
assert.strictEqual(canonicalRecovery.mechanism, unsafePrior);

const differentId = { ...previous, id: 'new-id', crankLength: Number.NaN };
assert.strictEqual(
  constrainMechanismCommit(previous, differentId),
  previous,
  'edit authority cannot insert an unvalidated different-id candidate',
);
const authoritySource = readFileSync(
  new URL('../utils/mechanismEditAuthority.ts', import.meta.url),
  'utf8',
);
assert.match(
  authoritySource,
  /constrainMechanismCommit = \(\s*previous: MechanismConfig,/,
  'constrainMechanismCommit requires a prior mechanism',
);
assert.match(
  authoritySource,
  /mechanismMotionCompletes[\s\S]*?mechanismHasFiniteValidStates\(mechanism, kit\)/,
  'live completion uses the exact shared kit-aware safety oracle',
);
assert(!authoritySource.includes('sampleFeasibleRange'), 'authority does not use heuristic fabrication sampling');

const stalePathCandidate = {
  ...createDefaultMechanism('crank', 'stale-path'),
  generatedPath: [{ x: Number.NaN, y: 999_999 }],
};
const freshCandidate = resolveNewMechanismCandidateCommit(stalePathCandidate);
assert.equal(freshCandidate.status, 'accepted');
if (freshCandidate.status === 'accepted') {
  assert.notDeepEqual(freshCandidate.mechanism.generatedPath, stalePathCandidate.generatedPath);
  assert(freshCandidate.mechanism.generatedPath?.every(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  ));
}

const simulationOnly = {
  ...createDefaultMechanism('5bar', 'simulation-only'),
  crankLength: 61,
};
assert.equal(
  resolveNewMechanismCandidateCommit(simulationOnly).status,
  'accepted',
  'simulation-safe candidates do not need recipe support or dimensional quantization',
);
assert.equal(
  resolveNewMechanismCandidateCommit({ ...simulationOnly, anchorX: -119 }).status,
  'rejected',
  'active anchors must still satisfy the board-hole policy',
);

const connected = resolveNewMechanismCandidateCommit(
  createDefaultMechanism('4bar', 'exact-connections'),
);
assert.equal(connected.status, 'accepted');
if (connected.status === 'accepted') {
  assert.equal(
    resolveNewMechanismCandidateCommit({
      ...connected.mechanism,
      crankLength: connected.mechanism.crankLength + 1,
    }).status,
    'rejected',
    'declared connection selections must exactly match candidate geometry',
  );
}

const atomicGearPrevious = createDefaultMechanism('gear', 'atomic-gear');
const atomicGearCandidate = {
  ...atomicGearPrevious,
  crankLength: 83,
  rockerLength: 51,
  groundLength: 999,
  gearTrainRadii: [83, 51],
};
const atomicGearResult = resolveMechanismCandidateCommit(
  atomicGearPrevious,
  atomicGearCandidate,
);
assert.equal(atomicGearResult.status, 'accepted', 'authority accepts a resolvable gear edit');
if (atomicGearResult.status === 'accepted') {
  assert.deepEqual(atomicGearResult.mechanism.gearTrainRadii, [100, 60]);
  assert.equal(atomicGearResult.mechanism.groundLength, 160);
  assert.equal(atomicGearResult.mechanism.gearRatio, -100 / 60);
  assert.equal(atomicGearResult.mechanism.speed2, -100 / 60);
  assert(atomicGearResult.mechanism.generatedPath?.length, 'accepted authority result rebuilds generated path state');
}

const atomicGearUpdate = constrainMechanismUpdate(
  atomicGearPrevious,
  {
    crankLength: 83,
    rockerLength: 51,
    groundLength: 999,
    gearTrainRadii: [83, 51],
  },
);
assert.deepEqual(atomicGearUpdate.gearTrainRadii, [100, 60], 'geometric command carries the resolved gear tuple');
assert.equal(atomicGearUpdate.groundLength, 160, 'geometric command carries the resolved center span');
assert.equal(atomicGearUpdate.gearRatio, -100 / 60, 'geometric command carries the resolved ratio');
assert.equal(atomicGearUpdate.speed2, -100 / 60, 'geometric command carries the resolved speed');
assert(atomicGearUpdate.generatedPath?.length, 'geometric command carries rebuilt derived path state');

const staleValidationProject = createLessonProject('waving-arm');
const staleValidationPrior = staleValidationProject.mechanisms[0]!;
const staleValidationCandidate = {
  ...staleValidationPrior,
  groundAngle: (staleValidationPrior.groundAngle ?? 0) + 90,
  connectionSelectionValidation: {
    status: 'invalid' as const,
    entries: [{ role: 'stale-derived-entry', status: 'rejected' as const }],
  },
};
const staleValidationResult = resolveMechanismCandidateCommit(
  staleValidationPrior,
  staleValidationCandidate,
  staleValidationProject.settings.physicalKit,
);
assert.equal(staleValidationResult.status, 'accepted', 'stale derived connection validation cannot reject safe geometry');
if (staleValidationResult.status === 'accepted') {
  assert.equal(
    staleValidationResult.mechanism.groundAngle,
    staleValidationCandidate.groundAngle,
    'safe geometry survives stale validation stripping',
  );
}

const provenanceBase = createDefaultMechanism('4bar', 'correction-provenance');
const provenanceDefaults = normalizeMechanismConnectionSelections(provenanceBase, undefined);
const provenanceUntouched = { ...provenanceBase, ...provenanceDefaults };
const provenanceInput = provenanceUntouched.connectionSelections?.['4bar.input-joint'];
assert(provenanceInput);
const provenanceAuthored = {
  ...provenanceUntouched,
  ...authorMechanismConnectionSelection(provenanceUntouched, '4bar.input-joint', provenanceInput),
};
const provenanceCommitted = resolveMechanismCandidateCommit(provenanceUntouched, provenanceAuthored);
assert.equal(provenanceCommitted.status, 'accepted');
if (provenanceCommitted.status === 'accepted') {
  const provenanceCandidate = resolveMechanismCandidateCommit(provenanceCommitted.mechanism, {
    ...provenanceCommitted.mechanism,
    targetPartId: 'correction-target',
    connectionSelectionValidation: {
      status: 'valid',
      entries: [{ role: '4bar.input-joint', status: 'accepted' }],
    },
  });
  assert.equal(provenanceCandidate.status, 'accepted');
  if (provenanceCandidate.status === 'accepted') {
    const outputStatus = provenanceCandidate.mechanism.connectionSelectionValidation?.entries
      .find((entry) => entry.role === '4bar.output-joint')?.status;
    assert.equal(outputStatus, 'defaulted', 'stale omitted validation cannot rewrite retained defaulted provenance');
  }
}

const noKitPrevious = createDefaultMechanism('gear', 'no-kit-fit');
const noKitResult = resolveMechanismCandidateCommit(noKitPrevious, {
  ...noKitPrevious,
  anchorX: 99_999,
  anchorY: 99_999,
});
assert.equal(noKitResult.status, 'preserved', 'authority rejects a candidate with no legal combination');
assert.equal(noKitResult.blocker, 'No kit fit');
assert.strictEqual(noKitResult.mechanism, noKitPrevious, 'rejection preserves the exact last-valid aggregate');

const explicitInvalidSelectionPrevious = createDefaultMechanism('4bar', 'explicit-invalid-selection');
const explicitInvalidSelection = resolveMechanismCandidateCommit(
  explicitInvalidSelectionPrevious,
  {
    ...explicitInvalidSelectionPrevious,
    connectionSelections: {
      '4bar.input-joint': {
        kind: 'linkage-hole',
        linkageKey: 'linkage-8-cell',
        holeIndex: 999,
      },
    },
  },
);
assert.equal(
  explicitInvalidSelection.status,
  'preserved',
  'authority rejects an explicitly requested connection it cannot retain',
);
assert.equal(explicitInvalidSelection.blocker, 'No kit fit');
assert.strictEqual(
  explicitInvalidSelection.mechanism,
  explicitInvalidSelectionPrevious,
  'an explicitly rejected connection preserves the exact prior aggregate',
);

for (const type of ['4bar', 'crank', 'gear_linkage'] as const) {
  const phases = mechanismSafetyPhaseSchedule(type);
  assert.equal(phases.length, 48, `${type} uses 48 safety phases`);
  assert.equal(phases[0], 0);
  assert.equal(phases.at(-1), (Math.PI * 2 * 47) / 48);
  assert.equal(new Set(phases).size, phases.length);
  assert(phases.every((phase) => phase >= 0 && phase < Math.PI * 2));
}

for (const type of ['5bar', '6bar', 'planetary_gear'] as const) {
  const phases = mechanismSafetyPhaseSchedule(type);
  assert.equal(phases.length, 384, `${type} uses 384 safety phases`);
  assert.equal(phases[0], 0);
  assert.equal(phases.at(-1), (Math.PI * 2 * 383) / 384);
  assert.equal(new Set(phases).size, phases.length);
  assert(phases.every((phase) => phase >= 0 && phase < Math.PI * 2));
}

for (const type of ['4bar', '5bar', '6bar', 'planetary_gear'] as const) {
  const mechanism = createDefaultMechanism(type, `motion-completes-${type}`);
  const exactResult = mechanismSafetyPhaseSchedule(type).every((phase) => {
    const state = calculateLinkage(mechanism, phase);
    return state.isValid && finiteNumbers(state);
  });
  assert.equal(mechanismMotionCompletes(mechanism), exactResult);
}

const wavingArm = createLessonProject('waving-arm');
const wavingFourBar = wavingArm.mechanisms.find(({ type }) => type === '4bar');
assert(wavingFourBar, 'waving-arm lesson has a 4bar mechanism');
assert.equal(wavingFourBar.groundLength, 160, 'waving-arm regression fixture starts at groundLength 160');
const wavingGroundRange = motionSafeParamRange(
  wavingFourBar,
  'groundLength',
  wavingArm.settings.physicalKit,
);
assert(wavingGroundRange, 'waving-arm groundLength exposes a motion-safe range');
assert(
  wavingGroundRange.min < 160 && wavingGroundRange.max > 160,
  `waving-arm groundLength safe range spans 160 instead of locking at ${wavingGroundRange.min}..${wavingGroundRange.max}`,
);
assert(
  mechanismEditIsSafe(
    { ...wavingFourBar, groundLength: wavingGroundRange.min },
    wavingArm.settings.physicalKit,
  ),
  'waving-arm accepted groundLength minimum remains safe',
);
assert(
  mechanismEditIsSafe(
    { ...wavingFourBar, groundLength: wavingGroundRange.max },
    wavingArm.settings.physicalKit,
  ),
  'waving-arm accepted groundLength maximum remains safe',
);

console.log('mechanism edit authority contracts passed');
