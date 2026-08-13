import assert from 'node:assert/strict';
import type { MechanismConfig, PhysicalKitSettings } from '../types';
import { commandById } from '../utils/appCommands';
import {
  defaultPhysicalKit,
  physicalKitPreset,
  SCENE_PX_PER_MM,
} from '../utils/coordinates';
import {
  FABRICATION_GEAR_SPECS,
  FABRICATION_LINKAGE_SPECS,
} from '../utils/fabricationContract';
import {
  clampMechanismParamForMotion,
  constrainMechanismUpdate,
  MECHANISM_PARAM_META,
  mechanismEditIsSafe,
  mechanismMotionCompletes,
  mechanismParamIsPlacementRecoveryEditable,
  motionSafeParamRange,
  resolveNewMechanismCandidateCommit,
  safeMechanismUpdate,
  shouldShowMechanismParam,
} from '../utils/mechanismEditAuthority';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import {
  gearTrainResolvedCenterDistance,
  normalizeCamProfileSamples,
} from '../utils/kinematics';
import { ALL_MECHANISM_TYPES } from '../utils/mechanismTemplates';

const defaultKit = defaultPhysicalKit();
const kits: readonly PhysicalKitSettings[] = [
  defaultKit,
  physicalKitPreset('letter-12x12-2cm', defaultKit),
  { ...defaultKit, profileKey: 'test-expanded-21x21', boardCells: 21 },
];

const finiteDeep = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteDeep);
  if (value && typeof value === 'object') return Object.values(value).every(finiteDeep);
  return true;
};

const acceptedScalarUpdate = (
  mechanism: MechanismConfig,
  key: keyof MechanismConfig,
  requested: number,
  kit: PhysicalKitSettings,
) => {
  const value = clampMechanismParamForMotion(mechanism, key, requested, kit);
  const update = constrainMechanismUpdate(mechanism, { [key]: value }, kit);
  const unchanged = Number(mechanism[key]) === value;
  if (unchanged) {
    assert(!Object.hasOwn(update, key), `${kit.profileKey}/${mechanism.type}/${String(key)} legal no-op may be omitted from changed-only update`);
  }
  const result = { ...mechanism, ...update };
  assert(Number.isFinite(Number(result[key])), `${kit.profileKey}/${mechanism.type}/${String(key)} result is finite`);
  assert(mechanismMotionCompletes(result), `${kit.profileKey}/${mechanism.type}/${String(key)} motion completes`);
  assert(mechanismEditIsSafe(result, kit), `${kit.profileKey}/${mechanism.type}/${String(key)} result is safe`);
  return Number(result[key]);
};

assert.equal(ALL_MECHANISM_TYPES.length, 12, 'control matrix covers all 12 mechanism families');
assert.equal(new Set(ALL_MECHANISM_TYPES).size, 12, 'control matrix has no duplicate mechanism family');

const safeMechanismForKit = (type: MechanismConfig['type'], id: string, kit: PhysicalKitSettings) => {
  if (kit.boardCells % 2 !== 0) return createDefaultMechanism(type, id);
  const result = resolveNewMechanismCandidateCommit(createDefaultMechanism(type, id), kit);
  assert.equal(result.status, 'accepted', `${kit.profileKey}/${type} new candidate resolves to the active board grid`);
  if (result.status !== 'accepted') throw new Error(`${kit.profileKey}/${type} candidate rejected`);
  return result.mechanism;
};

for (const kit of kits) {
  for (const type of ALL_MECHANISM_TYPES) {
    const mechanism = safeMechanismForKit(type, `${kit.profileKey}-${type}-controls`, kit);
    assert(finiteDeep(mechanism), `${kit.profileKey}/${type} default is finite`);
    assert(mechanismMotionCompletes(mechanism), `${kit.profileKey}/${type} default motion completes`);
    assert(mechanismEditIsSafe(mechanism, kit), `${kit.profileKey}/${type} default is safe`);

    for (const param of MECHANISM_PARAM_META) {
      if (!shouldShowMechanismParam(type, param.key)) continue;
      const range = motionSafeParamRange(mechanism, param.key, kit);
      if (!range) continue;

      const label = `${kit.profileKey}/${type}/${String(param.key)}`;
      assert.equal(range.currentSafe, true, `${label} default is inside the motion-safe range`);
      assert(Number.isFinite(range.min), `${label} minimum is finite`);
      assert(Number.isFinite(range.max), `${label} maximum is finite`);
      assert(range.min <= range.max, `${label} range is ordered`);
      const acceptedMinimum = acceptedScalarUpdate(mechanism, param.key, range.min, kit);
      assert(acceptedMinimum >= range.min && acceptedMinimum <= range.max, `${label} minimum resolves inside the safe range`);
      const acceptedMaximum = acceptedScalarUpdate(mechanism, param.key, range.max, kit);
      assert(acceptedMaximum >= range.min && acceptedMaximum <= range.max, `${label} maximum resolves inside the safe range`);

      const step = param.step ?? Math.max(1, (param.max - param.min) / 24);
      const below = acceptedScalarUpdate(mechanism, param.key, range.min - step, kit);
      const above = acceptedScalarUpdate(mechanism, param.key, range.max + step, kit);
      assert(below >= range.min && below <= range.max, `${label} one step below is clamped or reverted`);
      assert(above >= range.min && above <= range.max, `${label} one step above is clamped or reverted`);
    }
  }
}

for (const kit of kits) {
  for (const type of ALL_MECHANISM_TYPES) {
    const knownGood = safeMechanismForKit(type, `${kit.profileKey}-${type}-recovery`, kit);
    const offGrid = { ...knownGood, anchorX: Number(knownGood.anchorX) + 1 };
    assert(!mechanismEditIsSafe(offGrid, kit), `${kit.profileKey}/${type} off-grid legacy state starts unsafe`);

    const ordinaryKey = 'crankLength' as const;
    const ordinaryAttempt = clampMechanismParamForMotion(offGrid, ordinaryKey, offGrid.crankLength + 1, kit);
    assert.equal(ordinaryAttempt, offGrid.crankLength, `${kit.profileKey}/${type} ordinary motion stays constrained during recovery`);

    assert(mechanismParamIsPlacementRecoveryEditable(offGrid, 'anchorX', kit), `${kit.profileKey}/${type} anchor placement remains editable`);
    const recoveredAnchor = clampMechanismParamForMotion(offGrid, 'anchorX', knownGood.anchorX ?? 0, kit);
    const recoveryUpdate = constrainMechanismUpdate(offGrid, { anchorX: recoveredAnchor }, kit);
    assert(Object.hasOwn(recoveryUpdate, 'anchorX'), `${kit.profileKey}/${type} placement recovery is accepted`);
    const recovered = { ...offGrid, ...recoveryUpdate };
    assert(mechanismEditIsSafe(recovered, kit), `${kit.profileKey}/${type} placement recovery restores a safe mechanism`);
    assert(mechanismMotionCompletes(recovered), `${kit.profileKey}/${type} recovered motion completes`);
  }
}

assert(mechanismParamIsPlacementRecoveryEditable(createDefaultMechanism('4bar'), 'groundLength'), '4bar ground span is an explicit placement recovery field');
assert(!mechanismParamIsPlacementRecoveryEditable(createDefaultMechanism('crank'), 'groundLength'), 'ordinary family ground span is not a placement recovery field');
assert.equal(commandById('project.resetLesson').testId, 'command-reset-lesson', 'known-good lesson reset remains available');

for (const kit of kits) {
  const fourBar = safeMechanismForKit('4bar', `${kit.profileKey}-discrete-4bar`, kit);
  assert(safeMechanismUpdate(fourBar, { assemblyMode: 'crossed' }, kit), `${kit.profileKey}/4bar crossed assembly is accepted`);
  for (const key of ['crankLength', 'couplerLength', 'rockerLength'] as const) {
    let accepted = 0;
    for (const spec of FABRICATION_LINKAGE_SPECS) {
      const value = spec.lengthMm * SCENE_PX_PER_MM;
      if (!safeMechanismUpdate(fourBar, { [key]: value }, kit)) continue;
      const result = { ...fourBar, ...constrainMechanismUpdate(fourBar, { [key]: value }, kit) };
      assert(mechanismEditIsSafe(result, kit), `${kit.profileKey}/4bar/${key}/${spec.key} accepted option is safe`);
      accepted += 1;
    }
    assert(accepted > 0, `${kit.profileKey}/4bar/${key} exposes at least one safe linkage option`);
  }

  for (const type of ['gear', 'gear_linkage'] as const) {
    const mechanism = safeMechanismForKit(type, `${kit.profileKey}-nested-${type}`, kit);
    let accepted = 0;
    for (const spec of FABRICATION_GEAR_SPECS) {
      const gearTrainRadii = [...(mechanism.gearTrainRadii ?? [])];
      gearTrainRadii[0] = spec.pitchRadiusMm * SCENE_PX_PER_MM;
      const candidate = {
        ...mechanism,
        crankLength: gearTrainRadii[0],
        rockerLength: gearTrainRadii.at(-1) ?? gearTrainRadii[0],
        gearTrainRadii,
      };
      const updates = {
        crankLength: candidate.crankLength,
        rockerLength: candidate.rockerLength,
        gearTrainRadii,
        groundLength: gearTrainResolvedCenterDistance(candidate),
      };
      if (!safeMechanismUpdate(mechanism, updates, kit)) continue;
      assert(mechanismEditIsSafe({ ...mechanism, ...constrainMechanismUpdate(mechanism, updates, kit) }, kit), `${kit.profileKey}/${type}/${spec.key} accepted nested gear option is safe`);
      accepted += 1;
    }
    assert(accepted > 0, `${kit.profileKey}/${type} exposes at least one safe nested gear option`);
  }

  const cam = safeMechanismForKit('cam', `${kit.profileKey}-nested-cam`, kit);
  const profile = normalizeCamProfileSamples(cam.camProfileSamples);
  const editedProfile = profile.map((sample, index) => index === 0 ? 1.2 : sample);
  assert(safeMechanismUpdate(cam, { camProfileSamples: editedProfile }, kit), `${kit.profileKey}/cam accepts a finite profile edit`);
  assert(!safeMechanismUpdate(cam, { camProfileSamples: [-1, ...editedProfile.slice(1)] }, kit), `${kit.profileKey}/cam rejects an out-of-domain profile edit`);
}

console.log('mechanism control range matrix contracts passed');
