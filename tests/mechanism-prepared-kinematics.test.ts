import assert from "node:assert/strict";

import { defaultPhysicalKit } from "../utils/coordinates";
import {
  calculateLinkage,
  calculatePreparedLinkage,
  gearTrainMeshPhaseRadAt,
  normalizeCamProfileSamples,
  prepareMechanismKinematics,
} from "../utils/kinematics";
import {
  resolveMechanismPhysicalConnections,
} from "../utils/mechanismConnectionSelections";
import { createDefaultMechanism } from "../utils/mechanismDefaults";
import {
  normalizeGearLinkageToReference,
  normalizeMechanismToReference,
} from "../utils/mechanismReference";
import { ALL_MECHANISM_TYPES } from "../utils/mechanismTemplates";

const kit = defaultPhysicalKit();
const phases = [0, Math.PI / 5, Math.PI, Math.PI * 1.75];

for (const type of ALL_MECHANISM_TYPES) {
  const mechanism = normalizeMechanismToReference(
    createDefaultMechanism(type, `prepared-${type}`),
  );
  const calls = {
    physicalConnections: 0,
    gearLinkageNormalization: 0,
    camProfileNormalization: 0,
    gearCatalogPhase: 0,
  };
  const prepared = prepareMechanismKinematics(mechanism, kit, {
    resolvePhysicalConnections: (candidate, candidateKit) => {
      calls.physicalConnections += 1;
      return resolveMechanismPhysicalConnections(candidate, candidateKit);
    },
    normalizeGearLinkage: (candidate) => {
      calls.gearLinkageNormalization += 1;
      return normalizeGearLinkageToReference(candidate);
    },
    normalizeCamProfile: (samples) => {
      calls.camProfileNormalization += 1;
      return normalizeCamProfileSamples(samples);
    },
    gearMeshPhaseAt: (radii, index) => {
      calls.gearCatalogPhase += 1;
      return gearTrainMeshPhaseRadAt(radii, index);
    },
  });
  const structuralCalls = { ...calls };

  for (const phase of phases) {
    assert.deepEqual(
      calculatePreparedLinkage(prepared, phase),
      calculateLinkage(mechanism, phase, kit),
      `${type} prepared frames preserve the canonical kinematic result`,
    );
  }
  assert.deepEqual(
    calls,
    structuralCalls,
    `${type} ordinary frames perform zero catalog resolution or normalization calls`,
  );
}

console.log("prepared mechanism kinematics contracts passed");
