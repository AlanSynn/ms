import assert from "node:assert/strict";

import { defaultPhysicalKit } from "../utils/coordinates";
import {
  calculateLinkage,
  calculatePreparedLinkage,
  gearTrainCenters,
  gearTrainMeshPhaseRadAt,
  gearTrainOutputRatio,
  gearTrainPitchRadii,
  gearTrainRotationRatioAt,
  normalizeCamProfileSamples,
  planetaryCarrierOutputRatio,
  planetaryPlanetSpinRatio,
  prepareMechanismKinematics,
} from "../utils/kinematics";
import { createDefaultMechanism } from "../utils/mechanismDefaults";
import { resolveMechanismPhysicalConnections } from "../utils/mechanismConnectionSelections";
import { normalizeGearLinkageToReference } from "../utils/mechanismReference";
import { planetaryGearRadii, planetaryPlanetCenters } from "../utils/fabrication";
import { ALL_MECHANISM_TYPES } from "../utils/mechanismTemplates";
import {
  prepareThreePuppetMechanism,
  sampleThreePuppetMechanism,
} from "../components/ThreePuppetPreview";

const kit = defaultPhysicalKit();
const phases = [0, Math.PI / 7, Math.PI, Math.PI * 1.9];
const epsilon = 1e-9;

const assertPointClose = (actual: { x: number; y: number }, expected: { x: number; y: number }, label: string) => {
  assert(Math.abs(actual.x - expected.x) <= epsilon, `${label} x preserves canonical value`);
  assert(Math.abs(actual.y - expected.y) <= epsilon, `${label} y preserves canonical value`);
};

const gearLinkageOutputRatio = (mechanism: ReturnType<typeof createDefaultMechanism>, radii: number[]) =>
  radii.length <= 2
    ? Number.isFinite(mechanism.speed2)
      ? mechanism.speed2 ?? 1
      : Number.isFinite(mechanism.gearRatio)
        ? mechanism.gearRatio ?? 1
        : gearTrainOutputRatio(radii)
    : gearTrainOutputRatio(radii);

const authoredGearRotations = (mechanism: ReturnType<typeof createDefaultMechanism>, angle: number) => {
  const input = angle * (mechanism.speed1 ?? 1);
  const phase = mechanism.phase ?? 0;
  if (mechanism.type === "5bar") {
    return [input, angle * (mechanism.speed2 ?? mechanism.gearRatio ?? 1) + phase];
  }
  if (mechanism.type === "gear" || mechanism.type === "gear_linkage") {
    const radii = gearTrainPitchRadii(mechanism);
    if (mechanism.type === "gear_linkage" && radii.length <= 2) {
      return [input, input * gearLinkageOutputRatio(mechanism, radii) + phase];
    }
    return radii.map((_, index) =>
      input * gearTrainRotationRatioAt(radii, index)
        + gearTrainMeshPhaseRadAt(radii, index)
        + (index === radii.length - 1 ? phase : 0),
    );
  }
  if (mechanism.type === "planetary_gear") {
    return [
      input,
      input * planetaryPlanetSpinRatio(mechanism.crankLength, mechanism.rockerLength) + phase,
    ];
  }
  return [input];
};

const prepareWithCounters = (mechanism: ReturnType<typeof createDefaultMechanism>) => {
  const calls = {
    physicalConnections: 0,
    gearLinkageNormalization: 0,
    camProfileNormalization: 0,
    gearCatalogPhase: 0,
  };
  const kinematics = prepareMechanismKinematics(mechanism, kit, {
    resolvePhysicalConnections: (candidate, candidateKit) => {
      calls.physicalConnections += 1;
      return resolveMechanismPhysicalConnections(candidate, candidateKit);
    },
    normalizeGearLinkage: candidate => {
      calls.gearLinkageNormalization += 1;
      return normalizeGearLinkageToReference(candidate);
    },
    normalizeCamProfile: samples => {
      calls.camProfileNormalization += 1;
      return normalizeCamProfileSamples(samples);
    },
    gearMeshPhaseAt: (radii, index) => {
      calls.gearCatalogPhase += 1;
      return gearTrainMeshPhaseRadAt(radii, index);
    },
  });
  return { calls, kinematics };
};

for (const type of ALL_MECHANISM_TYPES) {
  const mechanism = createDefaultMechanism(type, `g3-puppet-prepared-${type}`);
  const { calls, kinematics } = prepareWithCounters(mechanism);
  const prepared = prepareThreePuppetMechanism(mechanism, kit, kinematics);
  const afterPreparation = { ...calls };

  assert.equal(prepared.mechanism, mechanism, `${type} keeps the authored mechanism identity`);
  assert.equal(prepared.kinematics, kinematics, `${type} keeps the prepared kinematics identity`);
  if (type === "gear" || type === "gear_linkage") {
    const radii = gearTrainPitchRadii(mechanism);
    assert.deepEqual(prepared.gearRadii, radii, `${type} uses authored gear radii`);
    assert.deepEqual(prepared.gearCenters, gearTrainCenters(mechanism), `${type} uses authored gear centers`);
    assert.deepEqual(prepared.displayGearRadii, radii, `${type} uses authored display radii`);
  }
  if (type === "planetary_gear") {
    assert.deepEqual(prepared.displayGearRadii, planetaryGearRadii(mechanism), `${type} uses authored planetary display radii`);
    assert.deepEqual(prepared.gearRadii, [mechanism.crankLength, mechanism.rockerLength], `${type} keeps planetary mesh radii`);
  }
  if (type === "cam") {
    assert.deepEqual(prepared.camProfileSamples, kinematics.camProfileSamples, `${type} keeps prepared cam samples`);
  }

  for (const phase of phases) {
    const frame = sampleThreePuppetMechanism(prepared, phase);
    const canonicalState = calculateLinkage(mechanism, phase, kit);
    assert.deepEqual(
      frame.state,
      canonicalState,
      `${type} prepared frame matches the canonical linkage calculation at ${phase}`,
    );
    assert.deepEqual(
      frame.state,
      calculatePreparedLinkage(kinematics, phase),
      `${type} live sample uses the prepared kinematics at ${phase}`,
    );

    const expectedRotations = authoredGearRotations(mechanism, phase);
    assert.equal(frame.gearRotations.length, expectedRotations.length, `${type} preserves gear rotation count`);
    expectedRotations.forEach((expected, index) => {
      assert(Math.abs((frame.gearRotations[index] ?? 0) - expected) <= epsilon, `${type} preserves rotation ${index}`);
    });

    if (mechanism.type === "planetary_gear") {
      const expectedCenters = planetaryPlanetCenters(
        frame.state.p1,
        mechanism,
        phase * (mechanism.speed1 ?? 1) * planetaryCarrierOutputRatio(
          mechanism.crankLength,
          mechanism.rockerLength,
        ),
      );
      assert.equal(frame.planetaryCenters.length, expectedCenters.length, `${type} preserves planet-center count`);
      expectedCenters.forEach((expected, index) => {
        const actual = frame.planetaryCenters[index];
        assert(actual, `${type} samples planet center ${index}`);
        assertPointClose(actual, expected, `${type} planet center ${index}`);
      });
    }
  }

  assert.deepEqual(
    calls,
    afterPreparation,
    `${type} ordinary samples perform no physical resolution, normalization, or catalog lookup`,
  );

  const staleMechanism = { ...mechanism };
  assert.throws(
    () => prepareThreePuppetMechanism(staleMechanism, kit, kinematics),
    /authored mechanism and physical kit/,
    `${type} rejects stale mechanism input`,
  );
  const staleKit = { ...kit };
  assert.throws(
    () => prepareThreePuppetMechanism(mechanism, staleKit, kinematics),
    /authored mechanism and physical kit/,
    `${type} rejects stale cloned-kit input`,
  );

  const replacement = {
    ...mechanism,
    id: `${mechanism.id}-replacement`,
    crankLength: mechanism.crankLength + 1,
  };
  const replacementPrepared = prepareThreePuppetMechanism(replacement, kit);
  assert.notEqual(replacementPrepared, prepared, `${type} replacement creates a fresh prepared entry`);
  assert.notEqual(replacementPrepared.kinematics, prepared.kinematics, `${type} replacement does not reuse stale kinematics`);
}

const authoredTwoGear = {
  ...createDefaultMechanism("gear_linkage", "g3-authored-two-gear"),
  anchorX: -37,
  anchorY: 23,
  groundAngle: 17,
  groundLength: 260,
  crankLength: 60,
  rockerLength: 90,
  gearTrainRadii: [60, 90],
  speed1: 1.25,
  speed2: -1.75,
  gearRatio: -1.2,
  phase: 0.31,
};
const authoredTwoGearKinematics = prepareMechanismKinematics(authoredTwoGear, kit);
const authoredTwoGearPrepared = prepareThreePuppetMechanism(authoredTwoGear, kit, authoredTwoGearKinematics);
const authoredTwoGearRadii = gearTrainPitchRadii(authoredTwoGear);
assert.deepEqual(authoredTwoGearPrepared.gearRadii, authoredTwoGearRadii, "authored two-gear linkage preserves authored radii");
assert.deepEqual(authoredTwoGearPrepared.gearCenters, gearTrainCenters(authoredTwoGear), "authored two-gear linkage preserves authored centers");
assert.deepEqual(authoredTwoGearPrepared.displayGearRadii, authoredTwoGearRadii, "authored two-gear linkage preserves display radii");
assert.equal(
  authoredTwoGearPrepared.gearOutputRatio,
  authoredTwoGear.speed2,
  "authored two-gear linkage uses the speed2 override before gearRatio",
);
const authoredTwoGearFrame = sampleThreePuppetMechanism(authoredTwoGearPrepared, 0.73);
authoredGearRotations(authoredTwoGear, 0.73).forEach((expected, index) => {
  assert(Math.abs((authoredTwoGearFrame.gearRotations[index] ?? 0) - expected) <= epsilon, `authored two-gear linkage preserves rotation ${index}`);
});

const authoredIdlerGear = {
  ...createDefaultMechanism("gear_linkage", "g3-authored-idler-gear"),
  anchorX: 11,
  anchorY: -19,
  groundAngle: -23,
  groundLength: 400,
  crankLength: 60,
  rockerLength: 90,
  gearTrainRadii: [60, 20, 90],
  speed1: 0.8,
  speed2: 4.5,
  gearRatio: 4.5,
  phase: -0.27,
};
const authoredIdlerKinematics = prepareMechanismKinematics(authoredIdlerGear, kit);
const authoredIdlerPrepared = prepareThreePuppetMechanism(authoredIdlerGear, kit, authoredIdlerKinematics);
const authoredIdlerRadii = gearTrainPitchRadii(authoredIdlerGear);
assert.deepEqual(authoredIdlerPrepared.gearRadii, authoredIdlerRadii, "authored idler linkage preserves authored radii");
assert.deepEqual(authoredIdlerPrepared.gearCenters, gearTrainCenters(authoredIdlerGear), "authored idler linkage preserves authored centers");
assert.deepEqual(authoredIdlerPrepared.displayGearRadii, authoredIdlerRadii, "authored idler linkage preserves display radii");
assert.equal(
  authoredIdlerPrepared.gearOutputRatio,
  gearTrainOutputRatio(authoredIdlerRadii),
  "authored idler linkage uses the authored gear train output ratio",
);
const authoredIdlerFrame = sampleThreePuppetMechanism(authoredIdlerPrepared, 0.73);
authoredGearRotations(authoredIdlerGear, 0.73).forEach((expected, index) => {
  assert(Math.abs((authoredIdlerFrame.gearRotations[index] ?? 0) - expected) <= epsilon, `authored idler linkage preserves rotation ${index}`);
});

console.log("G3 puppet prepared-frame contracts passed");
